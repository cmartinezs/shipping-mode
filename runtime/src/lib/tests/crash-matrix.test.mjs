import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, applyOperation } from "../changeset.mjs";
import { recoverWorkspace } from "../mutation.mjs";
import { setFaultCheckpoint, clearFaultCheckpoint, SimulatedCrashError } from "../faultInjection.mjs";
import { renderWorkspaceInit } from "../../commands/renderers.mjs";
import { readOperation, readResult } from "../operationStore.mjs";
import { RecoveryRequiredError } from "../journal.mjs";

function freshApprovedOperation() {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "crash-"));
  const operationsRoot = path.join(planningRoot, "operations");
  const payload = { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` };
  const operationId = propose({
    operationsRoot, planningRoot, kind: "workspace.init", target: {},
    payload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"], actor: "carlos"
  });
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true });
  return { planningRoot, operationsRoot, operationId };
}

function crashAt(boundary, planningRoot, operationsRoot, operationId) {
  setFaultCheckpoint(boundary);
  assert.throws(
    () => applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" }),
    SimulatedCrashError,
    `${boundary} must simulate a crash`
  );
  clearFaultCheckpoint();
}

const preApplyingBoundaries = ["AFTER_BEFORE", "AFTER_STAGED", "AFTER_MANIFEST"];
const postApplyingBoundaries = ["AFTER_APPLYING", "AFTER_FIRST_RENAME", "AFTER_ALL_RENAMES", "AFTER_RESULT", "AFTER_FIRST_EVENT", "AFTER_ALL_EVENTS", "BEFORE_APPLIED"];

for (const boundary of preApplyingBoundaries) {
  const { planningRoot, operationsRoot, operationId } = freshApprovedOperation();
  // captured before any crash -- reserved at propose time, long before this test runs
  const reservedEventId = readOperation(operationsRoot, operationId).reservedEvents[0].eventId;
  crashAt(boundary, planningRoot, operationsRoot, operationId);

  const crashedOperation = readOperation(operationsRoot, operationId);
  assert.equal(crashedOperation.status, "APPROVED", `${boundary}: status must still be APPROVED, recovery has nothing to do yet`);
  const persistedManifest = boundary === "AFTER_MANIFEST"
    ? structuredClone(crashedOperation.expectedEvents[0])
    : null;

  const outcome = applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
  assert.equal(outcome.status, "APPLIED", `${boundary}: a plain retry must complete normally`);
  const finalOperation = readOperation(operationsRoot, operationId);
  assert.equal(finalOperation.status, "APPLIED");
  assert.equal(finalOperation.expectedEvents[0].eventId, reservedEventId, `${boundary}: the event id reserved at propose must survive a crash+retry unchanged`);
  if (boundary === "AFTER_MANIFEST") {
    assert.deepEqual(finalOperation.expectedEvents[0], persistedManifest, "AFTER_MANIFEST: retry must reuse the full persisted expectedEvent verbatim, not rebuild timestamp/actor/payload/hash");
    assert.equal(finalOperation.expectedEvents[0].contentHash, persistedManifest.contentHash);
    assert.equal(finalOperation.expectedEvents[0].document.occurredAt, persistedManifest.document.occurredAt);
    assert.equal(finalOperation.expectedEvents[0].document.actor, persistedManifest.document.actor);
    assert.deepEqual(finalOperation.expectedEvents[0].document.payload, persistedManifest.document.payload);
    assert.equal(finalOperation.expectedEvents[0].document.idempotencyKey, persistedManifest.document.idempotencyKey);
    const eventPath = path.join(planningRoot, "events", finalOperation.expectedEvents[0].relativePath);
    const eventFiles = fs.readdirSync(path.dirname(eventPath)).filter((name) => name.endsWith(".json"));
    assert.equal(eventFiles.length, 1, "AFTER_MANIFEST: retry must result in exactly one event file, never a regenerated duplicate");
  }
}

for (const boundary of postApplyingBoundaries) {
  const { planningRoot, operationsRoot, operationId } = freshApprovedOperation();
  crashAt(boundary, planningRoot, operationsRoot, operationId);

  assert.equal(readOperation(operationsRoot, operationId).status, "APPLYING", `${boundary}: status must have reached APPLYING before the simulated crash`);

  const outcomes = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(outcomes.find((o) => o.operationId === operationId)?.outcome, "COMPLETED", `${boundary}: recovery must complete idempotently`);
  assert.equal(readOperation(operationsRoot, operationId).status, "APPLIED", `${boundary}: final status must be APPLIED`);

  const result = readResult(operationsRoot, operationId);
  assert.equal(result.files.length, 3, `${boundary}: result.json must list all 3 files, never duplicated`);

  const operation = readOperation(operationsRoot, operationId);
  assert.equal(operation.expectedEvents.length, 1, `${boundary}: exactly one expected event, never duplicated`);
  assert.ok(fs.existsSync(path.join(planningRoot, "events", operation.expectedEvents[0].relativePath)));

  const secondPass = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(secondPass.find((o) => o.operationId === operationId)?.outcome, "NOT_APPLICABLE", `${boundary}: a second recovery pass must find nothing left to do`);
}

// divergent modification after the crash: canonical file holds content
// recovery never staged -> RECOVERY_REQUIRED, never overwritten
{
  const { planningRoot, operationsRoot, operationId } = freshApprovedOperation();
  crashAt("AFTER_APPLYING", planningRoot, operationsRoot, operationId);

  fs.mkdirSync(planningRoot, { recursive: true });
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "not what recovery expects\n");

  const outcomes = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(outcomes.find((o) => o.operationId === operationId)?.outcome, "RECOVERY_REQUIRED");
  const operation = readOperation(operationsRoot, operationId);
  assert.equal(operation.status, "RECOVERY_REQUIRED");
  assert.ok(operation.conflict);
  assert.equal(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"), "not what recovery expects\n", "divergent content must never be overwritten");
}

// event written but operation.yml not yet updated -- recovery must reuse the
// exact persisted document, never mint a different one. Note this on-disk
// state is produced by the crash itself (via the real writeEventIdempotent
// call inside applyOperation), never hand-rolled in the test.
{
  const { planningRoot, operationsRoot, operationId } = freshApprovedOperation();
  crashAt("AFTER_FIRST_EVENT", planningRoot, operationsRoot, operationId);

  const beforeRecoveryOperation = readOperation(operationsRoot, operationId);
  const expectedEvent = beforeRecoveryOperation.expectedEvents[0];
  const eventPath = path.join(planningRoot, "events", expectedEvent.relativePath);
  const bytesBeforeRecovery = fs.readFileSync(eventPath, "utf8");

  recoverWorkspace({ planningRoot, operationsRoot });

  const bytesAfterRecovery = fs.readFileSync(eventPath, "utf8");
  assert.equal(bytesAfterRecovery, bytesBeforeRecovery, "recovery must not rewrite an already-correct event file");
  assert.equal(JSON.parse(bytesAfterRecovery).eventId, expectedEvent.eventId);
}

// cleanup of leftover .runtime/operations/<id> for an already-APPLIED operation
{
  const { planningRoot, operationsRoot, operationId } = freshApprovedOperation();
  applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
  const residueDir = path.join(planningRoot, ".runtime", "operations", operationId);
  fs.mkdirSync(residueDir, { recursive: true });
  fs.writeFileSync(path.join(residueDir, "leftover.txt"), "stale staging artifact\n");

  const outcomes = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(outcomes.find((o) => o.operationId === operationId)?.outcome, "CLEANED_UP");
  assert.equal(fs.existsSync(residueDir), false, "leftover staging residue for an already-APPLIED operation must be cleaned up");
}

// an unresolved RECOVERY_REQUIRED operation must block every subsequent
// mutating command -- withWorkspaceMutation (Task 13) refuses to even run
// the callback while any operation needs manual recovery (Revision 3 note 4)
{
  const { planningRoot, operationsRoot, operationId } = freshApprovedOperation();
  crashAt("AFTER_APPLYING", planningRoot, operationsRoot, operationId);
  fs.mkdirSync(planningRoot, { recursive: true });
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "divergent content that recovery never staged\n");

  assert.throws(
    () => propose({
      operationsRoot, planningRoot, kind: "config.update", target: {},
      payload: { name: "attempted-while-blocked" }, targetFiles: ["config.yml"], actor: "carlos"
    }),
    RecoveryRequiredError,
    "a fresh propose must refuse to run while an unresolved RECOVERY_REQUIRED operation exists"
  );
  assert.equal(readOperation(operationsRoot, operationId).status, "RECOVERY_REQUIRED", "the blocking propose attempt itself ran recovery, which is what discovered the conflict");

  const remainingOperationDirs = fs.readdirSync(operationsRoot);
  assert.equal(remainingOperationDirs.length, 1, "the blocked propose must never have created a second operation");
}

console.log("crash-matrix: all 10 durable boundaries recover correctly, plus divergence, blocking, and cleanup");
