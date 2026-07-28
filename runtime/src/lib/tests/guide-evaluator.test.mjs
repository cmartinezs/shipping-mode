import assert from "node:assert/strict";
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
