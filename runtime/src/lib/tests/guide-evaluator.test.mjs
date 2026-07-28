import assert from "node:assert/strict";
import { evaluateCondition } from "../guideEvaluator.mjs";

const context = {
  item: { kind: "user_story", tags: ["ui", "api"], value: 42, nullable: null },
  work_package: { contracts: { api: true } }
};

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
assert.equal((await evaluateCondition({ field: "__proto__.polluted", op: "exists", value: true }, context)).error.code, "unsafe_field_path");

const shortCircuit = await evaluateCondition({ any: [
  { field: "item.kind", op: "equals", value: "user_story" },
  { field: "item.missing", op: "equals", value: "never" }
] }, context);
assert.equal(shortCircuit.matched, true);
assert.equal(shortCircuit.error, null);
assert.ok(shortCircuit.trace.every((entry) => !entry.path.includes("any[1]")));

const regex = await evaluateCondition({ field: "item.kind", op: "matches", value: "^user_" }, context);
assert.equal(regex.matched, true);
assert.equal(regex.error, null);
const oversized = await evaluateCondition({ field: "item.kind", op: "matches", value: "x".repeat(257) }, context);
assert.equal(oversized.error.code, "regex_pattern_too_large");

console.log("guide-evaluator: typed AST, safe paths, missing/null, short-circuit trace, and bounded regex pass");
