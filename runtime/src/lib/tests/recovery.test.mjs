import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, __prepareApplyForTests } from "../changeset.mjs";
import { acquireWorkspaceLock } from "../lock.mjs";
import { runRecovery } from "../recovery.mjs";
import { renderWorkspaceInit } from "../../commands/renderers.mjs";
import { readOperation, writeOperation } from "../operationStore.mjs";
import { RecoveryRequiredError } from "../journal.mjs";

function stuckApplyingOperation() {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-"));
  const operationsRoot = path.join(planningRoot, "operations");
  const payload = { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` };
  const operationId = propose({
    operationsRoot, planningRoot, kind: "workspace.init", target: {},
    payload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"], actor: "carlos"
  });
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true });
  const lock = acquireWorkspaceLock(planningRoot, operationId);
  const { filePlan } = __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
  lock.release();
  return { planningRoot, operationsRoot, operationId, filePlan };
}

// nothing renamed yet: recovery must apply every file from staged/
{
  const { planningRoot, operationsRoot, operationId, filePlan } = stuckApplyingOperation();
  const lock = acquireWorkspaceLock(planningRoot, null);
  const outcomes = runRecovery({ operationsRoot, planningRoot, lock });
  lock.release();
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "COMPLETED");
  assert.equal(readOperation(operationsRoot, operationId).status, "APPLIED");
  for (const entry of filePlan) assert.ok(fs.existsSync(path.join(planningRoot, entry.target)));
  assert.equal(fs.existsSync(path.join(planningRoot, ".runtime", "operations", operationId)), false);
}

// one file already renamed (staged/ for it is gone), the rest pending -- recovery
// must classify per-file against the persisted filePlan, not against staged/'s
// current contents
{
  const { planningRoot, operationsRoot, operationId, filePlan } = stuckApplyingOperation();
  const first = filePlan[0];
  fs.renameSync(
    path.join(planningRoot, ".runtime", "operations", operationId, "staged", first.stagedRelativePath),
    path.join(planningRoot, first.target)
  );
  const lock = acquireWorkspaceLock(planningRoot, null);
  const outcomes = runRecovery({ operationsRoot, planningRoot, lock });
  lock.release();
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "COMPLETED");
  for (const entry of filePlan) assert.ok(fs.existsSync(path.join(planningRoot, entry.target)));
}

// divergent modification: canonical file holds content recovery never staged -> RECOVERY_REQUIRED, never overwritten
{
  const { planningRoot, operationsRoot, operationId, filePlan } = stuckApplyingOperation();
  const first = filePlan[0];
  fs.mkdirSync(path.dirname(path.join(planningRoot, first.target)), { recursive: true });
  fs.writeFileSync(path.join(planningRoot, first.target), "not what recovery expects\n");
  const lock = acquireWorkspaceLock(planningRoot, null);
  const outcomes = runRecovery({ operationsRoot, planningRoot, lock });
  lock.release();
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "RECOVERY_REQUIRED");
  const operation = readOperation(operationsRoot, operationId);
  assert.equal(operation.status, "RECOVERY_REQUIRED");
  assert.ok(operation.conflict);
  assert.equal(fs.readFileSync(path.join(planningRoot, first.target), "utf8"), "not what recovery expects\n");

  // The persisted conflict must remain globally blocking on every later
  // mutation, not just in the recovery sweep that first discovered it.
  const dirsBeforeBlockedAttempts = fs.readdirSync(operationsRoot).sort();
  for (const attemptedName of ["blocked-first", "blocked-second"]) {
    assert.throws(
      () => propose({
        operationsRoot, planningRoot, kind: "config.update", target: {},
        payload: { name: attemptedName }, targetFiles: ["config.yml"], actor: "carlos"
      }),
      RecoveryRequiredError,
      "a persisted RECOVERY_REQUIRED operation must block every subsequent mutation"
    );
  }
  assert.deepEqual(fs.readdirSync(operationsRoot).sort(), dirsBeforeBlockedAttempts, "blocked mutation attempts must not create new operations");
  assert.equal(readOperation(operationsRoot, operationId).status, "RECOVERY_REQUIRED", "the conflict remains blocking until manually resolved");
}

// an APPLIED operation with leftover staging residue gets it cleaned up
{
  const { planningRoot, operationsRoot, operationId } = stuckApplyingOperation();
  const lock1 = acquireWorkspaceLock(planningRoot, null);
  runRecovery({ operationsRoot, planningRoot, lock: lock1 }); // drive it to APPLIED first
  lock1.release();
  const residueDir = path.join(planningRoot, ".runtime", "operations", operationId);
  fs.mkdirSync(residueDir, { recursive: true });
  fs.writeFileSync(path.join(residueDir, "leftover.txt"), "stale\n");

  const lock2 = acquireWorkspaceLock(planningRoot, null);
  const outcomes = runRecovery({ operationsRoot, planningRoot, lock: lock2 });
  lock2.release();
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "CLEANED_UP");
  assert.equal(fs.existsSync(residueDir), false);
}

// a directory name under operations/ that isn't a valid UUIDv7 must be ignored, never trusted
{
  const { planningRoot, operationsRoot } = stuckApplyingOperation();
  fs.mkdirSync(path.join(operationsRoot, "not-a-uuid"), { recursive: true });
  const lock = acquireWorkspaceLock(planningRoot, null);
  assert.doesNotThrow(() => runRecovery({ operationsRoot, planningRoot, lock }));
  lock.release();
}

// a result.json that already exists but doesn't match what filePlan says it
// should be must never be silently accepted -- RECOVERY_REQUIRED instead
{
  const { planningRoot, operationsRoot, operationId } = stuckApplyingOperation();
  const resultPath = path.join(operationsRoot, operationId, "result.json");
  fs.writeFileSync(resultPath, JSON.stringify({ operationId, files: [{ target: "config.yml", contentHash: "tampered" }] }, null, 2));

  const lock = acquireWorkspaceLock(planningRoot, null);
  const outcomes = runRecovery({ operationsRoot, planningRoot, lock });
  lock.release();
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "RECOVERY_REQUIRED");
  assert.equal(readOperation(operationsRoot, operationId).status, "RECOVERY_REQUIRED");
}

// a corrupt operation.yml elsewhere in operations/ must block any new
// mutation, never be silently skipped or rewritten (Revision 4 note 6)
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-corrupt-"));
  const operationsRoot = path.join(planningRoot, "operations");
  const corruptId = "018f0000-0000-7000-8000-000000000005";
  fs.mkdirSync(path.join(operationsRoot, corruptId), { recursive: true });
  fs.writeFileSync(path.join(operationsRoot, corruptId, "operation.yml"), "not: [valid, yaml, at all\n");

  assert.throws(
    () => propose({
      operationsRoot, planningRoot, kind: "config.update", target: {},
      payload: { name: "attempted" }, targetFiles: ["config.yml"], actor: "carlos"
    }),
    RecoveryRequiredError,
    "a corrupt operation.yml elsewhere in operations/ must block any new mutation"
  );

  const remainingDirs = fs.readdirSync(operationsRoot);
  assert.equal(remainingDirs.length, 1, "no new operation must have been created while blocked");
  assert.equal(remainingDirs[0], corruptId);
}

// an operation stuck in APPLYING without a filePlan (schema-invalid for that
// status per operation.schema.json's per-status invariants) must never reach
// APPLIED -- flagged RECOVERY_REQUIRED, and left untouched since we don't
// trust it enough to rewrite (Revision 4 notes 5-6)
{
  const { planningRoot, operationsRoot, operationId } = stuckApplyingOperation();
  const operation = readOperation(operationsRoot, operationId);
  delete operation.filePlan;
  delete operation.expectedEvents;
  writeOperation(operationsRoot, operationId, operation);

  const lock = acquireWorkspaceLock(planningRoot, null);
  const outcomes = runRecovery({ operationsRoot, planningRoot, lock });
  lock.release();
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "RECOVERY_REQUIRED");
  assert.equal(readOperation(operationsRoot, operationId).status, "APPLYING", "a schema-invalid operation.yml is reported, never rewritten");
}

console.log("recovery: all tests passed");
