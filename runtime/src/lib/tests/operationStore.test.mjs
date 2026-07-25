import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeOperation, readOperation, writeChangeSet, readChangeSet, writeResult, readResult, operationDir
} from "../operationStore.mjs";
import { UsageError } from "../errors.mjs";
import { PathConfinementError } from "../paths.mjs";

const operationsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "operations-"));
const id = "018f0000-0000-7000-8000-000000000000";

const operation = { id, kind: "workspace.init", status: "PROPOSED", proposedBy: "carlos", proposedAt: "2026-07-24T00:00:00.000Z", history: [] };
writeOperation(operationsRoot, id, operation);
assert.deepEqual(readOperation(operationsRoot, id), operation);

const changeSet = { schemaVersion: 1, operationId: id, kind: "workspace.init", target: {}, baseRevisions: {}, payload: {}, hash: "abc" };
writeChangeSet(operationsRoot, id, changeSet);
assert.deepEqual(readChangeSet(operationsRoot, id), changeSet);

const result = { operationId: id, files: [{ target: "config.yml", contentHash: "abc" }] };
writeResult(operationsRoot, id, result);
assert.deepEqual(readResult(operationsRoot, id), result);

assert.ok(fs.existsSync(path.join(operationsRoot, id, "operation.yml")));
assert.ok(fs.existsSync(path.join(operationsRoot, id, "change-set.json")));
assert.ok(fs.existsSync(path.join(operationsRoot, id, "result.json")));

assert.throws(() => operationDir(operationsRoot, "../escape"), UsageError, "a non-UUIDv7 id must never be used to build a path");
assert.throws(() => operationDir(operationsRoot, "not-a-uuid"), UsageError);

// operations/<uuid> being a symlink escaping operationsRoot must be rejected,
// even though the id itself is a syntactically valid UUIDv7
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "operations-outside-"));
const escapingId = "018f0000-0000-7000-8000-000000000001";
fs.symlinkSync(outside, path.join(operationsRoot, escapingId));
assert.throws(
  () => writeOperation(operationsRoot, escapingId, { id: escapingId, kind: "workspace.init", status: "PROPOSED", proposedBy: "carlos", proposedAt: "2026-07-24T00:00:00.000Z", history: [] }),
  PathConfinementError,
  "an operation directory that is a symlink escaping operationsRoot must be rejected"
);

console.log("operationStore: all tests passed");
