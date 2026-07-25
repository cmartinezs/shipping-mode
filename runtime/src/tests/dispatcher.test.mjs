import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatch, UsageError } from "../index.mjs";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dispatcher-"));

const initResult = dispatch("init", ["--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
assert.ok(initResult.operationId);

const outOfScope = dispatch("release", ["--name", "R1"], cwd);
assert.equal(outOfScope.status, "NOT_IMPLEMENTED");
assert.equal(outOfScope.corte, "0");

const outOfScopeChangeset = dispatch("changeset", ["propose", "--kind", "task.create", "--payload-file", "-"], cwd);
assert.equal(outOfScopeChangeset.status, "NOT_IMPLEMENTED");

const checkResult = dispatch("check", ["schema"], cwd);
assert.ok(["NOT_INITIALIZED", "PASS", "FAIL"].includes(checkResult.status));

assert.throws(() => dispatch("changeset", ["validate", "not-a-uuid"], cwd), UsageError, "a malformed operation id must be rejected before any file access");
assert.throws(() => dispatch("init", ["--vcs", "git", "--actor", "carlos"], cwd), UsageError, "missing --name must be rejected");

// changeset propose --payload-file <realfile>
const payloadFile = path.join(cwd, "payload.json");
fs.writeFileSync(payloadFile, JSON.stringify({ name: "from-file" }));
const proposeFromFile = dispatch("changeset", ["propose", "--kind", "config.update", "--payload-file", payloadFile, "--actor", "carlos"], cwd);
assert.ok(proposeFromFile.operationId);

assert.throws(() => dispatch("changeset", ["propose", "--kind", "config.update", "--payload-file", path.join(cwd, "missing.json"), "--actor", "carlos"], cwd), UsageError);

console.log("dispatcher: all tests passed");
