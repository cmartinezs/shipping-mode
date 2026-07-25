import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, computePersistedChangeSetHash } from "../changeset.mjs";
import { readOperation, readChangeSet } from "../operationStore.mjs";
import { isUuidV7 } from "../ids.mjs";

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "propose-"));
const operationsRoot = path.join(planningRoot, "operations");

const operationId = propose({
  operationsRoot,
  planningRoot,
  kind: "workspace.init",
  target: {},
  payload: { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` },
  targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"],
  actor: "carlos"
});

const operation = readOperation(operationsRoot, operationId);
assert.equal(operation.status, "PROPOSED");
assert.equal(operation.proposedBy, "carlos");
assert.equal(operation.history.length, 1);
assert.equal(operation.history[0].to, "PROPOSED");

assert.equal(operation.reservedEvents.length, 1, "propose must reserve exactly one event id for this Corte 0 operation");
assert.ok(isUuidV7(operation.reservedEvents[0].eventId), "the reserved event id must already be a real UUIDv7");
assert.equal(operation.reservedEvents[0].type, "workspace.initialized");

const changeSet = readChangeSet(operationsRoot, operationId);
assert.equal(changeSet.operationId, operationId);
assert.equal(changeSet.baseRevisions["config.yml"].revisionHash, "ABSENT");
assert.equal(changeSet.baseRevisions["config.yml"].contentHash, "ABSENT");
assert.ok(changeSet.hash);
assert.equal(computePersistedChangeSetHash(changeSet), changeSet.hash, "recomputing the hash from the persisted change-set (hash field included, stripped internally) must reproduce the same value");

console.log("changeset-propose: all tests passed");
