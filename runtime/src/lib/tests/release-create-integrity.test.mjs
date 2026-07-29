import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../commands/init.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../../commands/changesetCommand.mjs";
import { runReleaseNew } from "../../commands/release.mjs";
import { computePersistedChangeSetHash } from "../changeset.mjs";
import { releaseCreateInvariantFindings } from "../releaseCreate.mjs";
import { generateUuidV7 } from "../ids.mjs";
import { readChangeSet, readOperation, writeChangeSet } from "../operationStore.mjs";
import { releaseDisplayIdForUuid } from "../releaseIdentity.mjs";

function initializedWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-create-integrity-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "integrity", vcs: "git", actor: "carlos" } });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos" });
  return { planningRoot, operationsRoot };
}

function tamperChangeSet(operationsRoot, operationId, mutate) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  mutate(changeSet);
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  writeChangeSet(operationsRoot, operationId, changeSet);
}

{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const proposal = runReleaseNew({ planningRoot, args: { title: "Operation binding", objective: "Reject forged operation identity", idempotencyKey: "operation-binding", actor: "carlos" } });
  tamperChangeSet(operationsRoot, proposal.operationId, (changeSet) => {
    changeSet.payload.operationId = generateUuidV7();
  });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposal.operationId }).status, "INVALID");
  assert.ok(readOperation(operationsRoot, proposal.operationId).validation.errors.some((error) => error.includes("payload.operationId")));
}

{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const proposal = runReleaseNew({ planningRoot, args: { title: "Display binding", objective: "Reject forged display identity", idempotencyKey: "display-binding", actor: "carlos" } });
  tamperChangeSet(operationsRoot, proposal.operationId, (changeSet) => {
    changeSet.payload.displayId = releaseDisplayIdForUuid(generateUuidV7());
  });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposal.operationId }).status, "INVALID");
  assert.ok(readOperation(operationsRoot, proposal.operationId).validation.errors.some((error) => error.includes("is not derived from release UUIDv7")));
}

{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const proposal = runReleaseNew({ planningRoot, args: { title: "Target binding", objective: "Reject forged target identity", idempotencyKey: "target-binding", actor: "carlos" } });
  tamperChangeSet(operationsRoot, proposal.operationId, (changeSet) => {
    changeSet.target.releaseId = generateUuidV7();
  });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposal.operationId }).status, "INVALID");
  assert.ok(readOperation(operationsRoot, proposal.operationId).validation.errors.some((error) => error.includes("target must contain exactly releaseId")));
}

{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const proposal = runReleaseNew({ planningRoot, args: { title: "Collision guard", objective: "Reject a display ID already owned by another Release", idempotencyKey: "collision-guard", actor: "carlos" } });
  const changeSet = readChangeSet(operationsRoot, proposal.operationId);
  const operation = readOperation(operationsRoot, proposal.operationId);
  const findings = releaseCreateInvariantFindings(changeSet, operation, [{ id: generateUuidV7(), displayId: proposal.displayId }]);
  assert.ok(findings.some((finding) => finding.includes("is already owned by release")), "validate/apply invariants must reject a persisted display ID collision");
}

{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const args = { title: "Permanent key", objective: "Preserve idempotency after invalidation", idempotencyKey: "permanent-key", actor: "carlos" };
  const proposal = runReleaseNew({ planningRoot, args });
  tamperChangeSet(operationsRoot, proposal.operationId, (changeSet) => {
    changeSet.payload.displayId = releaseDisplayIdForUuid(generateUuidV7());
  });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposal.operationId }).status, "INVALID");

  const exactRetry = runReleaseNew({ planningRoot, args });
  assert.equal(exactRetry.operationId, proposal.operationId, "an exact retry must return the original INVALID operation");
  assert.equal(exactRetry.operationStatus, "INVALID");
  assert.equal(exactRetry.idempotent, true);
  assert.throws(
    () => runReleaseNew({ planningRoot, args: { ...args, objective: "A different request" } }),
    /idempotency key permanent-key was already used for a different release\.create request/
  );
}

console.log("release-create-integrity: relational server fields, collision guards and permanent idempotency bindings pass");
