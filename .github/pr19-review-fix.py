from pathlib import Path
import json


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"missing expected block in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


# --- Pure DSL evaluator with explicit regex policy ---
Path("runtime/src/lib/guideEvaluator.mjs").write_text(r'''import { Worker } from "node:worker_threads";

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
''')

# --- Generation input: approved refs only; provenance is returned, not discarded ---
Path("runtime/src/lib/guideGeneration.mjs").write_text(r'''import { revisionHash } from "./canonical.mjs";
import { runConfiguredGuideGenerator } from "./customGuideGenerator.mjs";

function sourceSnapshot(source) {
  return {
    id: source.id,
    family: source.family,
    kind: source.kind,
    role: source.role,
    authority: source.authority,
    availability: source.availability,
    confirmedFingerprint: source.confirmedFingerprint
  };
}

export function buildGuideGenerationInput({ scope, guideKind, sources, config }) {
  const refs = [...new Set(config.documentation?.source_refs || [])].sort();
  if (refs.length === 0) throw new Error("guide generation requires approved Project Context documentation.source_refs");
  const byId = new Map(sources.map((source) => [source.id, source]));
  const missing = refs.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`approved Documentation Source refs do not resolve: ${missing.join(", ")}`);
  const selected = refs.map((id) => byId.get(id));
  const input = {
    schemaVersion: 1,
    dslVersion: 1,
    guideKind,
    scope: { id: scope.id, key: scope.key, label: scope.label, kind: scope.kind, path: scope.path },
    sourceRefs: selected.map((source) => source.id),
    sources: selected.map(sourceSnapshot),
    commands: scope.commands || {},
    configRefs: { scopeCatalog: config.scopeCatalog || null, documentationSourceRefs: refs },
    schemaVersionRef: "guide/1",
    dslVersionRef: "guide-dsl/1"
  };
  return { input, inputHash: revisionHash(input) };
}

export function genericGuideOutput(input) {
  const sourceRefs = [...input.sourceRefs].sort();
  const openGaps = [{
    id: sourceRefs[0],
    category: "generation_incomplete",
    description: "generic metadata-only generation cannot derive executable guide rules; human or custom-generator input is required",
    sourceRefs
  }];
  if (input.guideKind === "task") {
    return { sourceRefs, workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" }, openGaps };
  }
  return { sourceRefs, gatesByWorkPackageType: [], gatesByTaskType: [], commandRefs: [], evidenceRequirements: [], testData: [], executionContexts: [], environments: [], openGaps };
}

export function generateGuideOutput({ workspaceRoot, scope, guideKind, sources, config }) {
  const built = buildGuideGenerationInput({ scope, guideKind, sources, config });
  const generator = scope.customGenerators?.[guideKind];
  if (generator) {
    const result = runConfiguredGuideGenerator({ workspaceRoot, generator, input: built.input, timeoutMs: generator.timeoutMs || 1000, maxOutputBytes: generator.maxOutputBytes || 256 * 1024 });
    return {
      document: result.output,
      evidence: {
        generationMethod: "custom",
        generatorVersion: generator.version,
        generatorFingerprint: result.generatorFingerprint,
        generationInputHash: built.inputHash,
        generationOutputHash: result.outputHash
      }
    };
  }
  const document = genericGuideOutput(built.input);
  return {
    document,
    evidence: {
      generationMethod: "generic",
      generatorVersion: "shipping-mode:generic-guide/1",
      generatorFingerprint: null,
      generationInputHash: built.inputHash,
      generationOutputHash: revisionHash(document)
    }
  };
}
''')

# --- Constrained custom generator runner: no inherited secrets, bounded errors/output ---
Path("runtime/src/lib/customGuideGenerator.mjs").write_text(r'''import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { confineUnder } from "./paths.mjs";
import { contentHash, revisionHash } from "./canonical.mjs";

function confinedExisting(root, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) throw new Error(`${label} must be a relative workspace path`);
  const absolute = confineUnder(root, relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`${label} must resolve to a file`);
  return absolute;
}

function rejectForbiddenOutput(output) {
  const forbidden = ["id", "scopeId", "kind", "revision", "contentHash", "status", "approval", "provenance", "path", "projection"];
  for (const key of forbidden) if (Object.prototype.hasOwnProperty.call(output, key)) throw new Error(`generator output controls server-owned field: ${key}`);
}

export function runConfiguredGuideGenerator({ workspaceRoot, generator, input, timeoutMs = 1000, maxOutputBytes = 256 * 1024 }) {
  const executable = confinedExisting(workspaceRoot, generator.executable, "generator executable");
  const cwd = generator.cwd ? confineUnder(workspaceRoot, generator.cwd) : workspaceRoot;
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("generator cwd must be a directory");
  if (!Array.isArray(generator.args) || generator.args.some((arg) => typeof arg !== "string")) throw new Error("generator args must be an array of strings");
  const inputJson = JSON.stringify(input);
  const child = spawnSync(executable, generator.args, {
    cwd,
    shell: false,
    env: { PATH: process.env.PATH || "" },
    input: inputJson,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes
  });
  if (child.error?.code === "ETIMEDOUT" || child.signal === "SIGTERM" || child.signal === "SIGKILL") throw new Error("generator timeout");
  if (child.error?.code === "ENOBUFS") throw new Error("generator output exceeds limit");
  if (child.error) throw new Error(`generator execution failed: ${child.error.code || child.error.name}`);
  if (Buffer.byteLength(child.stdout || "") > maxOutputBytes || Buffer.byteLength(child.stderr || "") > maxOutputBytes) throw new Error("generator output exceeds limit");
  if (child.status !== 0) throw new Error(`generator exited with code ${child.status}`);
  let output;
  try { output = JSON.parse(child.stdout); } catch { throw new Error("generator output is not valid JSON"); }
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new Error("generator output must be an object");
  rejectForbiddenOutput(output);
  return {
    output,
    inputHash: revisionHash(input),
    outputHash: revisionHash(output),
    generatorFingerprint: contentHash(fs.readFileSync(executable))
  };
}
''')

# --- Closed, discriminated Guide schema with typed values and explicit regex policy ---
uuid = {"type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"}
string_list = {"type": "array", "items": {"type": "string", "minLength": 1}, "uniqueItems": True}
value = {
    "oneOf": [
        {"type": "string"}, {"type": "number"}, {"type": "boolean"}, {"type": "null"},
        {"$ref": "#/$defs/typedValue"},
        {"type": "array", "items": {"$ref": "#/$defs/value"}},
        {"type": "object", "additionalProperties": {"$ref": "#/$defs/value"}, "not": {"required": ["type", "value"], "properties": {"type": {"enum": ["date", "datetime"]}}}}
    ]
}
comparison = {
    "oneOf": [
        {
            "type": "object", "additionalProperties": False,
            "required": ["field", "op", "value"],
            "properties": {
                "field": {"$ref": "#/$defs/fieldPath"},
                "op": {"enum": ["equals", "not_equals", "contains", "exists", "in"]},
                "value": {"$ref": "#/$defs/value"}
            }
        },
        {
            "type": "object", "additionalProperties": False,
            "required": ["field", "op", "value", "regex"],
            "properties": {
                "field": {"$ref": "#/$defs/fieldPath"},
                "op": {"const": "matches"},
                "value": {"type": "string"},
                "regex": {"$ref": "#/$defs/regexPolicy"}
            }
        }
    ]
}
common_props = {
    "schemaVersion": {"const": 1}, "dslVersion": {"const": 1}, "id": uuid,
    "scopeId": uuid, "kind": {"enum": ["task", "test"]},
    "revision": {"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"},
    "sourceRefs": {"$ref": "#/$defs/uuidList"}, "provenance": {"$ref": "#/$defs/provenance"},
    "openGaps": {"type": "array", "items": {"$ref": "#/$defs/gap"}, "uniqueItems": True},
    "workPackageTypes": {"type": "array", "items": {"$ref": "#/$defs/workPackageType"}, "uniqueItems": True},
    "taskTypes": {"type": "array", "items": {"$ref": "#/$defs/taskType"}, "uniqueItems": True},
    "requiredSections": {"type": "array", "items": {"type": "string", "pattern": "^[a-z][a-zA-Z0-9_.-]*$"}, "uniqueItems": True},
    "requiredGateRefs": string_list, "templateRefs": string_list,
    "decompositionRules": {"type": "array", "items": {"$ref": "#/$defs/decompositionRule"}, "uniqueItems": True},
    "automation": {"$ref": "#/$defs/automation"},
    "gatesByWorkPackageType": {"type": "array", "items": {"$ref": "#/$defs/gateRule"}, "uniqueItems": True},
    "gatesByTaskType": {"type": "array", "items": {"$ref": "#/$defs/gateRule"}, "uniqueItems": True},
    "commandRefs": string_list,
    "evidenceRequirements": {"type": "array", "items": {"$ref": "#/$defs/evidenceRequirement"}, "uniqueItems": True},
    "testData": {"type": "array", "items": {"$ref": "#/$defs/testData"}, "uniqueItems": True},
    "executionContexts": string_list, "environments": string_list
}
task_fields = ["workPackageTypes", "taskTypes", "requiredSections", "requiredGateRefs", "templateRefs", "decompositionRules", "automation"]
test_fields = ["gatesByWorkPackageType", "gatesByTaskType", "commandRefs", "evidenceRequirements", "testData", "executionContexts", "environments"]
guide_schema = {
    "$id": "https://shipping-mode.dev/schemas/guide.schema.json",
    "type": "object", "additionalProperties": False,
    "required": ["schemaVersion", "dslVersion", "id", "scopeId", "kind", "revision", "sourceRefs", "provenance", "openGaps"],
    "properties": common_props,
    "oneOf": [
        {
            "properties": {"kind": {"const": "task"}},
            "required": task_fields,
            "not": {"anyOf": [{"required": [field]} for field in test_fields]}
        },
        {
            "properties": {"kind": {"const": "test"}},
            "required": test_fields,
            "not": {"anyOf": [{"required": [field]} for field in task_fields]}
        }
    ],
    "$defs": {
        "uuid": uuid,
        "uuidList": {"type": "array", "items": uuid, "minItems": 1, "uniqueItems": True},
        "stringList": string_list,
        "fieldPath": {"type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)*$"},
        "typedValue": {
            "type": "object", "additionalProperties": False, "required": ["type", "value"],
            "properties": {
                "type": {"enum": ["date", "datetime"]},
                "value": {"type": "string", "minLength": 1}
            },
            "allOf": [
                {"if": {"properties": {"type": {"const": "date"}}}, "then": {"properties": {"value": {"pattern": "^\\d{4}-\\d{2}-\\d{2}$"}}}},
                {"if": {"properties": {"type": {"const": "datetime"}}}, "then": {"properties": {"value": {"format": "date-time"}}}}
            ]
        },
        "value": value,
        "regexPolicy": {
            "type": "object", "additionalProperties": False,
            "required": ["engine", "timeoutMs", "maxPatternBytes", "maxInputBytes"],
            "properties": {
                "engine": {"const": "ecmascript-unicode"},
                "timeoutMs": {"type": "integer", "minimum": 1, "maximum": 1000},
                "maxPatternBytes": {"type": "integer", "minimum": 1, "maximum": 4096},
                "maxInputBytes": {"type": "integer", "minimum": 1, "maximum": 1048576}
            }
        },
        "comparison": comparison,
        "condition": {
            "oneOf": [
                {"$ref": "#/$defs/comparison"},
                {"type": "object", "additionalProperties": False, "required": ["all"], "properties": {"all": {"type": "array", "items": {"$ref": "#/$defs/condition"}, "minItems": 1}}},
                {"type": "object", "additionalProperties": False, "required": ["any"], "properties": {"any": {"type": "array", "items": {"$ref": "#/$defs/condition"}, "minItems": 1}}},
                {"type": "object", "additionalProperties": False, "required": ["not"], "properties": {"not": {"$ref": "#/$defs/condition"}}}
            ]
        },
        "gap": {"type": "object", "additionalProperties": False, "required": ["id", "description"], "properties": {"id": uuid, "description": {"type": "string", "minLength": 1}, "category": {"type": "string", "minLength": 1}, "sourceRefs": {"$ref": "#/$defs/uuidList"}}},
        "workPackageType": {"type": "object", "additionalProperties": False, "required": ["id", "appliesWhen", "requiredSections", "requiredGateRefs"], "properties": {"id": {"type": "string", "pattern": "^[a-z][a-z0-9-]*$"}, "appliesWhen": {"$ref": "#/$defs/condition"}, "requiredSections": string_list, "requiredGateRefs": string_list}},
        "taskType": {"type": "object", "additionalProperties": False, "required": ["id", "appliesWhen", "requiredSections"], "properties": {"id": {"type": "string", "pattern": "^[a-z][a-z0-9-]*$"}, "appliesWhen": {"$ref": "#/$defs/condition"}, "requiredSections": string_list, "templateRef": {"type": "string", "minLength": 1}}},
        "decompositionRule": {"type": "object", "additionalProperties": False, "required": ["id", "ordering"], "properties": {"id": {"type": "string", "pattern": "^[a-z][a-z0-9-]*$"}, "ordering": {"type": "object", "additionalProperties": False, "required": ["predecessorType", "successorType"], "properties": {"predecessorType": {"type": "string", "minLength": 1}, "successorType": {"type": "string", "minLength": 1}}}}},
        "automation": {"type": "object", "additionalProperties": False, "required": ["fallback"], "properties": {"generatorRef": {"type": "string", "minLength": 1}, "inputSchema": {"type": "string", "minLength": 1}, "fallback": {"enum": ["markGaps", "referencesOnly"]}}},
        "gateRule": {"type": "object", "additionalProperties": False, "required": ["type", "requiredGateRefs"], "properties": {"type": {"type": "string", "minLength": 1}, "requiredGateRefs": string_list, "commandRefs": string_list, "evidenceRefs": string_list}},
        "evidenceRequirement": {"type": "object", "additionalProperties": False, "required": ["id", "kind"], "properties": {"id": {"type": "string", "pattern": "^[a-z][a-z0-9-]*$"}, "kind": {"type": "string", "minLength": 1}, "required": {"type": "boolean"}}},
        "testData": {"type": "object", "additionalProperties": False, "required": ["id", "strategy"], "properties": {"id": {"type": "string", "pattern": "^[a-z][a-z0-9-]*$"}, "strategy": {"type": "string", "minLength": 1}, "fixtureRef": {"type": "string", "minLength": 1}}},
        "provenance": {
            "type": "object", "additionalProperties": False,
            "required": ["sourceMapRevision", "generationMethod", "generatorVersion", "generatorFingerprint", "generatedAt", "sourceFingerprints", "generationInputHash", "generationOutputHash"],
            "properties": {
                "sourceMapRevision": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "generationMethod": {"enum": ["generic", "custom", "manual"]},
                "generatorVersion": {"type": "string", "minLength": 1},
                "generatorFingerprint": {"type": ["string", "null"], "pattern": "^[0-9a-f]{64}$"},
                "generationInputHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "generationOutputHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "generatedAt": {"type": "string", "minLength": 1},
                "sourceFingerprints": {"type": "object", "additionalProperties": {"type": "string", "pattern": "^[0-9a-f]{64}$"}},
                "model": {"type": ["string", "null"]},
                "promptVersion": {"type": ["string", "null"]}
            }
        }
    }
}
Path("runtime/src/schemas/guide.schema.json").write_text(json.dumps(guide_schema, indent=2) + "\n")

# --- Narrow, approvable scope.generator.set mutation ---
replace_once("runtime/src/commands/proposalPreparation.mjs",
'''const SUPPORTED_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set", "guide.update"]);''',
'''const SUPPORTED_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set", "scope.generator.set", "guide.update"]);''')
replace_once("runtime/src/commands/proposalPreparation.mjs",
'''  if (kind === "guide.update") {''',
'''  if (kind === "scope.generator.set") {
    if (!operationId || !actor || !proposedAt) throw new UsageError("scope.generator.set requires runtime operationId, actor, and proposedAt");
    const payload = {
      operationId,
      scopeId: rawPayload.scopeId,
      guideKind: rawPayload.guideKind,
      generator: rawPayload.generator ?? null,
      declaredBy: actor,
      declaredAt: proposedAt
    };
    return { payload, targetFiles: [`scopes/${payload.scopeId}/scope.yml`] };
  }

  if (kind === "guide.update") {''')

replace_once("runtime/src/commands/changesetCommand.mjs",
'''import { renderWorkspaceInit, renderConfigUpdate, renderConfigAutonomySet, renderScopeAdd, renderScopeCommandSet, renderDiscoveryPropose, renderGuideUpdate } from "./renderers.mjs";''',
'''import { renderWorkspaceInit, renderConfigUpdate, renderConfigAutonomySet, renderScopeAdd, renderScopeCommandSet, renderScopeGeneratorSet, renderDiscoveryPropose, renderGuideUpdate } from "./renderers.mjs";''')
replace_once("runtime/src/commands/changesetCommand.mjs",
'''import { generateGuideOutput } from "../lib/guideGeneration.mjs";''',
'''import { generateGuideOutput } from "../lib/guideGeneration.mjs";
import { revisionHash } from "../lib/canonical.mjs";''')
replace_once("runtime/src/commands/changesetCommand.mjs",
'''  if (kind === "discovery.propose") return renderDiscoveryPropose(payload, currentConfig, workspaceRoot, { currentSources, currentScopes, approvalMode });''',
'''  if (kind === "scope.generator.set") {
    const currentScope = currentScopes.find((scope) => scope.id === payload.scopeId);
    return renderScopeGeneratorSet(payload, currentScope, workspaceRoot);
  }
  if (kind === "discovery.propose") return renderDiscoveryPropose(payload, currentConfig, workspaceRoot, { currentSources, currentScopes, approvalMode });''')
replace_once("runtime/src/commands/changesetCommand.mjs",
'''  if (kind === "guide.update" && ["generate", "regenerate"].includes(rawPayload.action) && rawPayload.document === undefined) {
    const config = readCurrentConfig(planningRoot);
    const scope = readConfirmedScopes(planningRoot).find((candidate) => candidate.id === rawPayload.scopeId);
    if (!scope) throw new UsageError(`guide scope not found: ${rawPayload.scopeId}`);
    const generated = generateGuideOutput({ workspaceRoot: path.dirname(planningRoot), scope, guideKind: rawPayload.guideKind, sources: readConfirmedSources(planningRoot), config });
    rawPayload = { ...rawPayload, document: generated.document };
  }''',
'''  if (kind === "guide.update" && ["generate", "regenerate"].includes(rawPayload.action)) {
    if (rawPayload.generationEvidence !== undefined) throw new UsageError("generationEvidence is server-owned");
    if (rawPayload.document === undefined) {
      const config = readCurrentConfig(planningRoot);
      const scope = readConfirmedScopes(planningRoot).find((candidate) => candidate.id === rawPayload.scopeId);
      if (!scope) throw new UsageError(`guide scope not found: ${rawPayload.scopeId}`);
      let generated;
      try {
        generated = generateGuideOutput({ workspaceRoot: path.dirname(planningRoot), scope, guideKind: rawPayload.guideKind, sources: readConfirmedSources(planningRoot), config });
      } catch (error) {
        throw new UsageError(error.message);
      }
      rawPayload = { ...rawPayload, document: generated.document, generationEvidence: generated.evidence };
    } else {
      rawPayload = {
        ...rawPayload,
        generationEvidence: {
          generationMethod: "manual",
          generatorVersion: "shipping-mode:manual-guide-input/1",
          generatorFingerprint: null,
          generationInputHash: revisionHash({ scopeId: rawPayload.scopeId, guideKind: rawPayload.guideKind, document: rawPayload.document }),
          generationOutputHash: revisionHash(rawPayload.document)
        }
      };
    }
  }''')
replace_once("runtime/src/commands/changesetCommand.mjs",
'''  if (kind === "scope.command.set" || kind === "guide.update") {''',
'''  if (kind === "scope.command.set" || kind === "scope.generator.set" || kind === "guide.update") {''')

replace_once("runtime/src/commands/renderers.mjs",
'''import { confineScopePath } from "../lib/paths.mjs";''',
'''import { confineScopePath, confineUnder } from "../lib/paths.mjs";''')
replace_once("runtime/src/commands/renderers.mjs",
'''export function renderScopeCommandSet({ operationId, scopeId, role, command, requiresEnvironment, requiresSecrets, declaredBy, declaredAt }, currentScope) {
  if (!currentScope || currentScope.id !== scopeId) {
    throw new Error(`scope not found for scope.command.set: ${scopeId}`);
  }
  const nextScope = setCommand(currentScope, role, {
    command,
    method: "declared",
    declaredBy,
    declaredAt,
    declaredOperationId: operationId,
    requiresEnvironment,
    requiresSecrets,
    alternatives: []
  });
  return new Map([[`scopes/${scopeId}/scope.yml`, stringifyYaml(nextScope)]]);
}
''',
'''export function renderScopeCommandSet({ operationId, scopeId, role, command, requiresEnvironment, requiresSecrets, declaredBy, declaredAt }, currentScope) {
  if (!currentScope || currentScope.id !== scopeId) {
    throw new Error(`scope not found for scope.command.set: ${scopeId}`);
  }
  const nextScope = setCommand(currentScope, role, {
    command,
    method: "declared",
    declaredBy,
    declaredAt,
    declaredOperationId: operationId,
    requiresEnvironment,
    requiresSecrets,
    alternatives: []
  });
  return new Map([[`scopes/${scopeId}/scope.yml`, stringifyYaml(nextScope)]]);
}

export function renderScopeGeneratorSet({ scopeId, guideKind, generator }, currentScope, workspaceRoot) {
  if (!currentScope || currentScope.id !== scopeId) throw new Error(`scope not found for scope.generator.set: ${scopeId}`);
  if (!["task", "test"].includes(guideKind)) throw new Error("scope.generator.set guideKind must be task or test");
  const customGenerators = { ...(currentScope.customGenerators || {}) };
  if (generator === null) {
    delete customGenerators[guideKind];
  } else {
    const executable = confineUnder(workspaceRoot, generator.executable);
    if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw new Error("generator executable must resolve to an existing workspace file");
    if (generator.cwd) {
      const cwd = confineUnder(workspaceRoot, generator.cwd);
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("generator cwd must resolve to an existing workspace directory");
    }
    customGenerators[guideKind] = generator;
  }
  const nextScope = { ...currentScope, customGenerators };
  if (Object.keys(customGenerators).length === 0) delete nextScope.customGenerators;
  const result = validate("scope", nextScope);
  if (!result.valid) throw new Error(`scope.generator.set produced invalid scope: ${result.errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`);
  return new Map([[`scopes/${scopeId}/scope.yml`, stringifyYaml(nextScope)]]);
}
''')

replace_once("runtime/src/commands/renderers.mjs",
'''  const provenance = {
    sourceMapRevision: revisionHash({ sourceRefs, sourceFingerprints }),
    generatorVersion: "shipping-mode:guide-generation/1",
    model: null,
    promptVersion: null,
    generatedAt: proposedAt,
    sourceFingerprints,
    generationInputHash: revisionHash(payload.document),
    generationOutputHash: "pending"
  };''',
'''  const evidence = payload.generationEvidence;
  if (!evidence || evidence.generationOutputHash !== revisionHash(payload.document)) throw new Error("guide generation evidence does not match the generated document");
  const provenance = {
    sourceMapRevision: revisionHash({ sourceRefs, sourceFingerprints }),
    generationMethod: evidence.generationMethod,
    generatorVersion: evidence.generatorVersion,
    generatorFingerprint: evidence.generatorFingerprint,
    model: null,
    promptVersion: null,
    generatedAt: proposedAt,
    sourceFingerprints,
    generationInputHash: evidence.generationInputHash,
    generationOutputHash: evidence.generationOutputHash
  };''')
replace_once("runtime/src/commands/renderers.mjs",
'''  provenance.generationOutputHash = revisionHash(withoutRevision);
  const document = { ...withoutRevision, revision: `sha256:${revisionHash(withoutRevision)}` };''',
'''  const document = { ...withoutRevision, revision: `sha256:${revisionHash(withoutRevision)}` };''')

# Event type and public help.
replace_once("runtime/src/lib/changeset.mjs",
'''    "scope.command.set": "scope.command.set",
    "discovery.propose": "discovery.proposed",''',
'''    "scope.command.set": "scope.command.set",
    "scope.generator.set": "scope.generator.set",
    "discovery.propose": "discovery.proposed",''')
replace_once("bin/shipping-mode.mjs",
'''changeset propose --kind <workspace.init|config.update|scope.add|guide.update>''',
'''changeset propose --kind <workspace.init|config.update|scope.add|scope.generator.set|guide.update>''')

# Scope generator requires an explicit version.
scope_path = Path("runtime/src/schemas/scope.schema.json")
scope_schema = json.loads(scope_path.read_text())
generator = scope_schema["$defs"]["generator"]
generator["required"] = ["version", "executable", "args"]
generator["properties"]["version"] = {"type": "string", "minLength": 1}
scope_path.write_text(json.dumps(scope_schema, indent=2) + "\n")

# ChangeSet schema: new kind + server-owned generation evidence.
cs_path = Path("runtime/src/schemas/change-set.schema.json")
cs = json.loads(cs_path.read_text())
if "scope.generator.set" not in cs["properties"]["kind"]["enum"]:
    cs["properties"]["kind"]["enum"].append("scope.generator.set")
for branch in cs["allOf"]:
    const = branch.get("if", {}).get("properties", {}).get("kind", {}).get("const")
    if const == "guide.update":
        payload = branch["then"]["properties"]["payload"]
        payload["properties"]["generationEvidence"] = {
            "type": "object", "additionalProperties": False,
            "required": ["generationMethod", "generatorVersion", "generatorFingerprint", "generationInputHash", "generationOutputHash"],
            "properties": {
                "generationMethod": {"enum": ["generic", "custom", "manual"]},
                "generatorVersion": {"type": "string", "minLength": 1},
                "generatorFingerprint": {"type": ["string", "null"], "pattern": "^[0-9a-f]{64}$"},
                "generationInputHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "generationOutputHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"}
            }
        }
        payload["allOf"][0]["then"]["required"] = ["document", "generationEvidence"]
        payload["allOf"][0]["else"] = {"not": {"anyOf": [{"required": ["document"]}, {"required": ["generationEvidence"]}]}}
        break
else:
    raise SystemExit("guide.update schema branch not found")
cs["allOf"].append({
    "if": {"properties": {"kind": {"const": "scope.generator.set"}}},
    "then": {"properties": {"payload": {
        "type": "object", "additionalProperties": False,
        "required": ["operationId", "scopeId", "guideKind", "generator", "declaredBy", "declaredAt"],
        "properties": {
            "operationId": uuid, "scopeId": uuid, "guideKind": {"enum": ["task", "test"]},
            "generator": {"anyOf": [{"$ref": "https://shipping-mode.dev/schemas/scope.schema.json#/$defs/generator"}, {"type": "null"}]},
            "declaredBy": {"type": "string", "minLength": 1}, "declaredAt": {"type": "string", "minLength": 1}
        }
    }}}
})
cs_path.write_text(json.dumps(cs, indent=2) + "\n")

# Operation enum.
op_path = Path("runtime/src/schemas/operation.schema.json")
op = json.loads(op_path.read_text())
if "scope.generator.set" not in op["properties"]["kind"]["enum"]:
    op["properties"]["kind"]["enum"].append("scope.generator.set")
op_path.write_text(json.dumps(op, indent=2) + "\n")

# --- Tests ---
Path("runtime/src/lib/tests/guide-evaluator.test.mjs").write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateCondition } from "../guideEvaluator.mjs";

const context = {
  item: { kind: "user_story", tags: ["ui", "api"], value: 42, nullable: null, due: { type: "date", value: "2026-07-28" } },
  work_package: { contracts: { api: true } }
};
const regex = { engine: "ecmascript-unicode", timeoutMs: 100, maxPatternBytes: 256, maxInputBytes: 65536 };
const result = await evaluateCondition({ all: [
  { field: "item.kind", op: "equals", value: "user_story" },
  { field: "item.tags", op: "contains", value: "ui" },
  { field: "work_package.contracts.api", op: "exists", value: true }
] }, context);
assert.equal(result.error, null);
assert.equal(result.matched, true);
assert.ok(result.trace.length >= 4);
assert.equal((await evaluateCondition({ field: "item.value", op: "equals", value: "42" }, context)).error.code, "type_mismatch");
assert.equal((await evaluateCondition({ field: "item.missing", op: "equals", value: null }, context)).error.code, "missing_field");
assert.equal((await evaluateCondition({ field: "item.missing", op: "exists", value: true }, context)).matched, false);
assert.equal((await evaluateCondition({ field: "item.nullable", op: "equals", value: null }, context)).matched, true);
assert.equal((await evaluateCondition({ field: "item.due", op: "equals", value: { type: "date", value: "2026-07-28" } }, context)).matched, true);
assert.equal((await evaluateCondition({ field: "__proto__.polluted", op: "exists", value: true }, context)).error.code, "unsafe_field_path");
const shortCircuit = await evaluateCondition({ any: [
  { field: "item.kind", op: "equals", value: "user_story" },
  { field: "item.missing", op: "equals", value: "never" }
] }, context);
assert.equal(shortCircuit.matched, true);
assert.equal(shortCircuit.error, null);
assert.ok(shortCircuit.trace.every((entry) => !entry.path.includes("any[1]")));
assert.equal((await evaluateCondition({ field: "item.kind", op: "matches", value: "^user_", regex }, context)).matched, true);
assert.equal((await evaluateCondition({ field: "item.kind", op: "matches", value: "^user_" }, context)).error.code, "regex_policy_required");
assert.equal((await evaluateCondition({ field: "item.kind", op: "matches", value: "x".repeat(257), regex }, context)).error.code, "regex_pattern_too_large");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "regex-worker-"));
const hangingWorker = path.join(temp, "hang.mjs");
fs.writeFileSync(hangingWorker, "setInterval(() => {}, 1000);\n");
const timeout = await evaluateCondition({ field: "item.kind", op: "matches", value: "user", regex: { ...regex, timeoutMs: 10 } }, context, { regexWorkerUrl: pathToFileURL(hangingWorker) });
assert.equal(timeout.error.code, "regex_timeout");
console.log("guide-evaluator: closed typed AST, explicit regex policy, safe paths, short-circuit trace, and real worker timeout pass");
''')

Path("runtime/src/lib/tests/guide-generation.test.mjs").write_text(r'''import assert from "node:assert/strict";
import { buildGuideGenerationInput, genericGuideOutput } from "../guideGeneration.mjs";

const source = { id: "018f0000-0000-7000-8000-000000000011", family: "technical-sources", kind: "testing", role: "canonical", authority: { standing: "authoritative", force: "normative" }, availability: "implemented", confirmedFingerprint: "a".repeat(64), path: "docs/test.md" };
const scope = { id: "018f0000-0000-7000-8000-000000000021", key: "api", label: "API", kind: "code", path: "src/", commands: { test: { command: "npm test" } } };
const config = { scopeCatalog: { directory: ".planning/scopes", enabled: [scope.id] }, documentation: { source_refs: [source.id] } };
const first = buildGuideGenerationInput({ scope, guideKind: "task", sources: [source], config });
const second = buildGuideGenerationInput({ scope, guideKind: "task", sources: [{ ...source, path: "other.md" }], config });
assert.deepEqual(first.input, second.input, "generator input excludes unneeded source paths");
assert.equal(first.inputHash, second.inputHash);
assert.deepEqual(genericGuideOutput(first.input).automation, { fallback: "markGaps" });
assert.equal(genericGuideOutput(first.input).openGaps[0].category, "generation_incomplete");
assert.throws(() => buildGuideGenerationInput({ scope, guideKind: "task", sources: [source], config: { documentation: { source_refs: [] } } }), /approved Project Context/);
assert.throws(() => buildGuideGenerationInput({ scope, guideKind: "task", sources: [], config }), /do not resolve/);
const secondSource = { ...source, id: "018f0000-0000-7000-8000-000000000012", confirmedFingerprint: "c".repeat(64) };
const twoSourceInput = buildGuideGenerationInput({ scope, guideKind: "task", sources: [source, secondSource], config: { ...config, documentation: { source_refs: [source.id, secondSource.id] } } }).input;
assert.equal(genericGuideOutput(twoSourceInput).openGaps[0].category, "generation_incomplete", "different fingerprints are not automatically a semantic conflict");
console.log("guide-generation: approved refs only, deterministic input hashes, no false fingerprint conflicts, and explicit incomplete-generation gaps pass");
''')

Path("runtime/src/lib/tests/custom-guide-generator.test.mjs").write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runConfiguredGuideGenerator } from "../customGuideGenerator.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "guide-generator-"));
const writeExecutable = (name, source) => { const file = path.join(root, name); fs.writeFileSync(file, `#!/usr/bin/env node\n${source}`); fs.chmodSync(file, 0o755); return file; };
writeExecutable("generator.mjs", "let data=''; process.stdin.on('data', c => data += c).on('end', () => process.stdout.write(JSON.stringify({openGaps: [], sourceRefs: JSON.parse(data).sourceRefs, inheritedSecret: process.env.SHIPPING_MODE_TEST_SECRET || null})));\n");
const input = { sourceRefs: ["018f0000-0000-7000-8000-000000000011"] };
process.env.SHIPPING_MODE_TEST_SECRET = "must-not-leak";
const result = runConfiguredGuideGenerator({ workspaceRoot: root, generator: { version: "1", executable: "generator.mjs", args: [] }, input });
assert.deepEqual(result.output.sourceRefs, input.sourceRefs);
assert.equal(result.output.inheritedSecret, null);
assert.equal(result.inputHash.length, 64);
assert.equal(result.outputHash.length, 64);
assert.throws(() => runConfiguredGuideGenerator({ workspaceRoot: root, generator: { version: "1", executable: "../outside.mjs", args: [] }, input }), /relative workspace path|escapes root/);
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-generator-"));
const outsideFile = path.join(outside, "outside.mjs");
fs.writeFileSync(outsideFile, "#!/usr/bin/env node\nprocess.stdout.write('{}');"); fs.chmodSync(outsideFile, 0o755);
fs.symlinkSync(outsideFile, path.join(root, "escape.mjs"));
assert.throws(() => runConfiguredGuideGenerator({ workspaceRoot: root, generator: { version: "1", executable: "escape.mjs", args: [] }, input }), /symlink escapes root/);
writeExecutable("bad.mjs", "process.stdout.write(JSON.stringify({status:'approved'}));");
assert.throws(() => runConfiguredGuideGenerator({ workspaceRoot: root, generator: { version: "1", executable: "bad.mjs", args: [] }, input }), /server-owned field/);
writeExecutable("slow.mjs", "setTimeout(() => {}, 1000);");
assert.throws(() => runConfiguredGuideGenerator({ workspaceRoot: root, generator: { version: "1", executable: "slow.mjs", args: [] }, input, timeoutMs: 20 }), /timeout/);
writeExecutable("huge.mjs", "process.stdout.write('x'.repeat(20000));");
assert.throws(() => runConfiguredGuideGenerator({ workspaceRoot: root, generator: { version: "1", executable: "huge.mjs", args: [] }, input, maxOutputBytes: 1024 }), /output exceeds limit/);
writeExecutable("malformed.mjs", "process.stdout.write('not-json');");
assert.throws(() => runConfiguredGuideGenerator({ workspaceRoot: root, generator: { version: "1", executable: "malformed.mjs", args: [] }, input }), /not valid JSON/);
writeExecutable("nonzero.mjs", "process.stderr.write('sensitive-output'); process.exit(7);");
assert.throws(() => runConfiguredGuideGenerator({ workspaceRoot: root, generator: { version: "1", executable: "nonzero.mjs", args: [] }, input }), (error) => /exited with code 7/.test(error.message) && !error.message.includes("sensitive-output"));
console.log("custom-guide-generator: confinement, symlink escape, minimal env, bounded output, redacted failures, structured I/O, hashes, and timeout pass");
''')

Path("runtime/src/commands/tests/scope-generator-set.test.mjs").write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../init.mjs";
import { runChangesetPropose, runChangesetValidate, runChangesetApprove, runChangesetApply } from "../changesetCommand.mjs";
import { parseYaml } from "../../lib/yaml.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "scope-generator-set-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
const operationsRoot = path.join(planningRoot, "operations");
function finish(operationId) {
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "reviewer", allowSelfApproval: true });
  assert.equal(runChangesetApply({ planningRoot, operationsRoot, operationId, actor: "reviewer" }).status, "APPLIED");
}
const init = runInit({ planningRoot, args: { name: "generator-config", vcs: "git", actor: "test-user" } }); finish(init.operationId);
const scopeId = "018f0000-0000-7000-8000-000000000021";
const scope = runChangesetPropose({ planningRoot, kind: "scope.add", actor: "test-user", payloadText: JSON.stringify({ id: scopeId, key: "api", label: "API", kind: "code", path: "src/" }) }); finish(scope.operationId);
fs.writeFileSync(path.join(workspace, "guide-generator.mjs"), "#!/usr/bin/env node\nprocess.stdout.write('{}');\n");
fs.chmodSync(path.join(workspace, "guide-generator.mjs"), 0o755);
const set = runChangesetPropose({ planningRoot, kind: "scope.generator.set", actor: "test-user", payloadText: JSON.stringify({ scopeId, guideKind: "task", generator: { version: "1.0.0", executable: "guide-generator.mjs", args: [], timeoutMs: 1000, maxOutputBytes: 4096 } }) });
finish(set.operationId);
let persisted = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(persisted.customGenerators.task.version, "1.0.0");
const remove = runChangesetPropose({ planningRoot, kind: "scope.generator.set", actor: "test-user", payloadText: JSON.stringify({ scopeId, guideKind: "task", generator: null }) });
finish(remove.operationId);
persisted = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(persisted.customGenerators, undefined);
console.log("scope-generator-set: narrow ChangeSet configuration and removal pass");
''')

# Update lifecycle fixtures to include explicit regex policy and provenance fields.
lifecycle = Path("runtime/src/commands/tests/guide-lifecycle.test.mjs")
text = lifecycle.read_text()
text = text.replace('{ field: "item.kind", op: "equals", value: "capability" }', '{ field: "item.kind", op: "equals", value: "capability" }')
# Assertions for real provenance from generic generation.
marker = 'assert.equal(scopeDocument.guides.task.approval, null);\n'
if 'generationMethod, "generic"' not in text:
    text = text.replace(marker, marker + 'assert.equal(scopeDocument.guides.task.provenance.generationMethod, "generic");\nassert.equal(scopeDocument.guides.task.provenance.generatorFingerprint, null);\n')
lifecycle.write_text(text)

# Schema fixtures: make provenance complete and add closure assertions.
fixtures = Path("runtime/src/lib/tests/schema-fixtures.test.mjs")
text = fixtures.read_text()
text = text.replace('provenance: { sourceMapRevision: "a".repeat(64), generatorVersion: "test", generationInputHash:', 'provenance: { sourceMapRevision: "a".repeat(64), generationMethod: "generic", generatorVersion: "test", generatorFingerprint: null, generationInputHash:')
insert = '''\nconst taskGuideFixture = structuredClone(cases.guide.valid);\nconst mixedTaskGuide = { ...taskGuideFixture, commandRefs: [] };\nassert.equal(validate("guide", mixedTaskGuide).valid, false, "task Guide must reject test-only fields");\nconst arbitraryTypedObject = structuredClone(taskGuideFixture);\narbitraryTypedObject.workPackageTypes = [{ id: "x", appliesWhen: { field: "item.when", op: "equals", value: { type: "date", value: "not-a-date" } }, requiredSections: ["x"], requiredGateRefs: ["x"] }];\nassert.equal(validate("guide", arbitraryTypedObject).valid, false, "typed date values must use the closed valid representation");\nconst missingRegexPolicy = structuredClone(taskGuideFixture);\nmissingRegexPolicy.workPackageTypes = [{ id: "x", appliesWhen: { field: "item.kind", op: "matches", value: "^x" }, requiredSections: ["x"], requiredGateRefs: ["x"] }];\nassert.equal(validate("guide", missingRegexPolicy).valid, false, "matches must declare its execution policy");\n'''
anchor = 'for (const [schemaName, { valid, invalid }] of Object.entries(cases)) {'
if insert.strip() not in text:
    text = text.replace(anchor, insert + '\n' + anchor)
fixtures.write_text(text)

# Documentation traceability.
plan = Path("docs/superpowers/plans/2026-07-28-corte-1-plan-2-generation-projections-generators.md")
text = plan.read_text()
append = '''\n## Post-review integrity corrections\n\n- Generation evidence is server-owned and carries the actual approved-input hash, normalized output hash, generator version, and executable fingerprint through the persisted ChangeSet into Guide provenance.\n- Generation resolves only `documentation.source_refs` approved by Project Context; an empty or dangling approved source set fails closed and never falls back to every discovered source.\n- Metadata-only generic generation records an explicit incomplete-generation gap and no longer treats different source fingerprints as proof of semantic conflict.\n- `scope.generator.set` is the narrow ChangeSet mutation for adding/removing custom generator configuration; direct `scope.yml` edits are not required.\n- Task/test schemas are fully discriminated, typed date/datetime values are closed, and `matches` requires an explicit engine/timeout/input-pattern bound policy.\n- Generator tests cover symlink escape, minimal environment, output limits, malformed/non-zero output, timeout, and redacted failure messages.\n'''
if '## Post-review integrity corrections' not in text:
    text += append
plan.write_text(text)

print("PR19 review corrections applied")
