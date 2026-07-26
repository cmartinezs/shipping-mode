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

const discoverResult = dispatch("discover", ["scan"], cwd);
assert.equal(discoverResult.schemaVersion, 1);
assert.equal(discoverResult.scanParameters.maxSourceBytes, 536870912);

const discoverWithFlag = dispatch("discover", ["scan", "--max-source-bytes", "2097152"], cwd);
assert.equal(discoverWithFlag.scanParameters.maxSourceBytes, 2097152);

assert.throws(() => dispatch("discover", ["scan", "--max-source-bytes", "10"], cwd), UsageError, "below the 1 MiB floor must be rejected");

const discoverNotImplemented = dispatch("discover", ["nonsense"], cwd);
assert.equal(discoverNotImplemented.status, "NOT_IMPLEMENTED");
assert.equal(discoverNotImplemented.corte, "0");

const validatePayload = path.join(cwd, "invalid-proposal.json");
fs.writeFileSync(validatePayload, JSON.stringify({ schemaVersion: 1 }));
const validateResult = dispatch("discover", ["validate", "--file", validatePayload], cwd);
assert.equal(validateResult.ok, false);
assert.equal(validateResult.status, "INVALID");
assert.ok(validateResult.errors.some((e) => e.code === "schema_invalid"));

assert.throws(
  () => dispatch("discover", ["validate"], cwd),
  (error) => error instanceof UsageError && error.message === "discover validate requires --file <path> or --stdin",
  "discover validate requires --file or --stdin, not changeset propose's usage message"
);

console.log("dispatcher: all tests passed");
