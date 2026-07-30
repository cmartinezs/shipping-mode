import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../commands/init.mjs";
import { runReleaseNew } from "../../commands/release.mjs";
import { runItemCreate } from "../../commands/item.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../../commands/changesetCommand.mjs";
import { renderReleaseItemCreateChangeSet } from "../../commands/renderers.mjs";
import { applyOperation } from "../changeset.mjs";
import { recoverWorkspace } from "../mutation.mjs";
import { setFaultCheckpoint, clearFaultCheckpoint, SimulatedCrashError } from "../faultInjection.mjs";
import { readOperation } from "../operationStore.mjs";

function approvedItemOperation() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-item-crash-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "items", vcs: "git", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos" });
  const release = runReleaseNew({ planningRoot, args: { title: "Release", objective: "Crash item", idempotencyKey: "release", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: release.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: release.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: release.operationId, actor: "carlos" });
  const item = runItemCreate({ planningRoot, releaseRef: release.releaseId, args: { kind: "spike", title: "Crash item", question: "Q", timebox: "1d", expectedDecision: "D", idempotencyKey: "item", commandActor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: item.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: item.operationId, actor: "carlos", allowSelfApproval: true });
  return { planningRoot, operationsRoot, operationId: item.operationId, releaseId: release.releaseId, itemId: item.itemId };
}

function crashAt(boundary, planningRoot, operationsRoot, operationId) {
  setFaultCheckpoint(boundary);
  assert.throws(
    () => applyOperation({ operationsRoot, planningRoot, operationId, render: (payload) => renderReleaseItemCreateChangeSet(payload, planningRoot), actor: "carlos" }),
    SimulatedCrashError
  );
  clearFaultCheckpoint();
}

{
  const { planningRoot, operationsRoot, operationId, releaseId, itemId } = approvedItemOperation();
  const reservedEventId = readOperation(operationsRoot, operationId).reservedEvents[0].eventId;
  crashAt("AFTER_MANIFEST", planningRoot, operationsRoot, operationId);
  assert.equal(readOperation(operationsRoot, operationId).status, "APPROVED");
  const retry = applyOperation({ operationsRoot, planningRoot, operationId, render: (payload) => renderReleaseItemCreateChangeSet(payload, planningRoot), actor: "carlos" });
  assert.equal(retry.status, "APPLIED");
  assert.equal(readOperation(operationsRoot, operationId).expectedEvents[0].eventId, reservedEventId);
  assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseId, "items", itemId, "release-item.yml")), true);
}

for (const boundary of ["AFTER_FIRST_RENAME", "AFTER_FIRST_EVENT"]) {
  const { planningRoot, operationsRoot, operationId, releaseId, itemId } = approvedItemOperation();
  crashAt(boundary, planningRoot, operationsRoot, operationId);
  const outcomes = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(outcomes.find((entry) => entry.operationId === operationId)?.outcome, "COMPLETED");
  const operation = readOperation(operationsRoot, operationId);
  assert.equal(operation.status, "APPLIED");
  assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseId, "items", itemId, "release-item.yml")), true);
  const eventPath = path.join(planningRoot, "events", operation.expectedEvents[0].relativePath);
  assert.equal(fs.existsSync(eventPath), true);
  const eventBefore = fs.readFileSync(eventPath, "utf8");
  const secondPass = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(secondPass.find((entry) => entry.operationId === operationId)?.outcome, "NOT_APPLICABLE");
  assert.equal(fs.readFileSync(eventPath, "utf8"), eventBefore, "recovery must not duplicate or rewrite release-item.created events");
}

console.log("release-item-crash-recovery: release-item.create retries and recovers without duplicate item or event");
