import { Worker } from "node:worker_threads";

const OPERATORS = new Set(["equals", "not_equals", "contains", "exists", "in", "matches"]);
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const MISSING = Symbol("missing");

function error(code, message, path = null) {
  return { code, message, path };
}

function isDateValue(value) {
  return value && typeof value === "object" && value.type === "date" && typeof value.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.value);
}

function isDateTimeValue(value) {
  return value && typeof value === "object" && value.type === "datetime" && typeof value.value === "string" && Number.isFinite(Date.parse(value.value));
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  if (isDateValue(value)) return "date";
  if (isDateTimeValue(value)) return "datetime";
  if (typeof value === "object") return "object";
  return "unsupported";
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sameValue(left, right) {
  const leftType = typeOf(left);
  return leftType === typeOf(right) && stable(left) === stable(right);
}

function resolveField(context, field) {
  if (typeof field !== "string" || field.length === 0) return { error: error("invalid_field_path", "field path must be a non-empty string", field) };
  const segments = field.split(".");
  if (segments.some((segment) => !segment || FORBIDDEN_SEGMENTS.has(segment))) {
    return { error: error("unsafe_field_path", "field path contains an unsafe segment", field) };
  }
  let current = context;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) return { value: MISSING };
    current = current[segment];
  }
  return { value: current };
}

function assertComparable(left, right, field) {
  const leftType = typeOf(left);
  const rightType = typeOf(right);
  if (leftType === "unsupported" || rightType === "unsupported" || leftType !== rightType) {
    return error("type_mismatch", `values are not comparable without coercion (${leftType} vs ${rightType})`, field);
  }
  return null;
}

function compare(operator, actual, expected, field) {
  if (["equals", "not_equals"].includes(operator)) {
    const mismatch = assertComparable(actual, expected, field);
    if (mismatch) return { error: mismatch };
    return { matched: operator === "equals" ? sameValue(actual, expected) : !sameValue(actual, expected) };
  }
  if (operator === "contains") {
    if (typeof actual === "string") return typeof expected === "string" ? { matched: actual.includes(expected) } : { error: error("type_mismatch", "string contains requires a string value", field) };
    if (Array.isArray(actual)) return { matched: actual.some((item) => sameValue(item, expected)) };
    return { error: error("invalid_contains_target", "contains requires a string or array", field) };
  }
  if (operator === "in") {
    if (!Array.isArray(expected)) return { error: error("invalid_in_value", "in requires an array value", field) };
    return { matched: expected.some((item) => sameValue(actual, item)) };
  }
  return { matched: sameValue(actual, expected) };
}

function validateRegexPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return error("regex_policy_required", "matches requires an explicit regex policy");
  if (policy.engine !== "ecmascript-unicode") return error("regex_engine_unsupported", "matches supports only ecmascript-unicode");
  for (const [field, min, max] of [["timeoutMs", 1, 1000], ["maxPatternBytes", 1, 4096], ["maxInputBytes", 1, 1048576]]) {
    if (!Number.isInteger(policy[field]) || policy[field] < min || policy[field] > max) return error("regex_policy_invalid", `${field} is outside the allowed range`);
  }
  return null;
}

function runRegex(pattern, input, policy, workerUrl) {
  return new Promise((resolve) => {
    if (typeof pattern !== "string" || typeof input !== "string") return resolve({ error: error("type_mismatch", "matches requires string pattern and string input") });
    const policyError = validateRegexPolicy(policy);
    if (policyError) return resolve({ error: policyError });
    if (Buffer.byteLength(pattern, "utf8") > policy.maxPatternBytes) return resolve({ error: error("regex_pattern_too_large", "regex pattern exceeds the declared limit") });
    if (Buffer.byteLength(input, "utf8") > policy.maxInputBytes) return resolve({ error: error("regex_input_too_large", "regex input exceeds the declared limit") });
    const worker = new Worker(workerUrl, { workerData: { pattern, input } });
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { worker.terminate(); finish({ error: error("regex_timeout", "regex evaluation exceeded its declared timeout") }); }, policy.timeoutMs);
    worker.once("message", (message) => { worker.terminate(); finish(message.ok ? { matched: message.matched } : { error: error("regex_error", message.message) }); });
    worker.once("error", (cause) => { worker.terminate(); finish({ error: error("regex_error", cause.message) }); });
  });
}

async function evaluateNode(node, context, options, trace, path = "$") {
  if (!node || typeof node !== "object" || Array.isArray(node)) return { error: error("invalid_condition", "condition must be an object", path) };
  const keys = Object.keys(node);
  const compound = ["all", "any", "not"].filter((key) => Object.prototype.hasOwnProperty.call(node, key));
  const comparison = ["field", "op", "value"].filter((key) => Object.prototype.hasOwnProperty.call(node, key));
  if ((compound.length + (comparison.length ? 1 : 0)) !== 1) return { error: error("invalid_condition", "condition must contain exactly one AST variant", path) };
  if (comparison.length) {
    const allowed = node.op === "matches" ? ["field", "op", "value", "regex"] : ["field", "op", "value"];
    if (keys.some((key) => !allowed.includes(key)) || !OPERATORS.has(node.op)) return { error: error("invalid_condition", "comparison has unsupported fields or operator", path) };
    const resolved = resolveField(context, node.field);
    if (resolved.error) return { error: resolved.error };
    if (node.op === "exists") {
      const matched = resolved.value !== MISSING;
      trace.push({ path, operator: node.op, field: node.field, matched });
      return { matched };
    }
    if (resolved.value === MISSING) return { error: error("missing_field", `field does not exist: ${node.field}`, node.field) };
    let result;
    if (node.op === "matches") {
      result = await runRegex(node.value, resolved.value, node.regex, options.regexWorkerUrl);
    } else {
      result = compare(node.op, resolved.value, node.value, node.field);
    }
    if (result.error) return result;
    trace.push({ path, operator: node.op, field: node.field, matched: result.matched });
    return result;
  }
  if (compound[0] === "not") {
    if (keys.length !== 1) return { error: error("invalid_condition", "not accepts exactly one condition", path) };
    const childTrace = [];
    const result = await evaluateNode(node.not, context, options, childTrace, `${path}.not`);
    trace.push(...childTrace, { path, operator: "not", matched: result.error ? false : !result.matched });
    return result.error ? result : { matched: !result.matched };
  }
  const operator = compound[0];
  if (keys.length !== 1 || !Array.isArray(node[operator]) || node[operator].length === 0) return { error: error("invalid_condition", `${operator} requires a non-empty array`, path) };
  for (let index = 0; index < node[operator].length; index += 1) {
    const result = await evaluateNode(node[operator][index], context, options, trace, `${path}.${operator}[${index}]`);
    if (result.error) return result;
    if (operator === "all" && !result.matched) { trace.push({ path, operator, matched: false, shortCircuit: true }); return result; }
    if (operator === "any" && result.matched) { trace.push({ path, operator, matched: true, shortCircuit: true }); return result; }
  }
  const matched = operator === "all";
  trace.push({ path, operator, matched });
  return { matched };
}

export async function evaluateCondition(condition, context, options = {}) {
  const trace = [];
  const result = await evaluateNode(condition, context, { regexWorkerUrl: options.regexWorkerUrl || new URL("./regexWorker.mjs", import.meta.url) }, trace);
  return { matched: result.error ? false : result.matched, trace, error: result.error || null };
}

export { MISSING, resolveField };
