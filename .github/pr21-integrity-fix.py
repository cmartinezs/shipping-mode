from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_exact(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"expected snippet not found in {relative_path}")
    path.write_text(text.replace(old, new, 1))


release_create_module = '''import { revisionHash } from "./canonical.mjs";
import { isReleaseDisplayIdForUuid } from "./releaseIdentity.mjs";

export function releaseCreateRequestHash({ actor, title, objective, laneId, policyMode, slug }) {
  return revisionHash({
    actor,
    title,
    objective,
    laneId: laneId ?? null,
    policyMode: policyMode ?? null,
    slug: slug ?? null
  });
}

function isCanonicalTrimmedString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

export function releaseCreateInvariantFindings(changeSet, operation = null) {
  const findings = [];
  const payload = changeSet.payload;

  if (payload.operationId !== changeSet.operationId) {
    findings.push(`release.create payload.operationId ${payload.operationId} does not match ChangeSet operationId ${changeSet.operationId}`);
  }

  const targetKeys = Object.keys(changeSet.target || {}).sort();
  if (targetKeys.length !== 1 || targetKeys[0] !== "releaseId" || changeSet.target.releaseId !== payload.id) {
    findings.push("release.create target must contain exactly releaseId equal to payload.id");
  }

  if (!isReleaseDisplayIdForUuid(payload.id, payload.displayId)) {
    findings.push(`release.create displayId ${payload.displayId} is not derived from release UUIDv7 ${payload.id}`);
  }

  for (const field of ["title", "objective", "laneId", "idempotencyKey"]) {
    if (!isCanonicalTrimmedString(payload[field])) {
      findings.push(`release.create payload.${field} must be a canonical non-blank trimmed string`);
    }
  }

  const expectedRequestHash = releaseCreateRequestHash({
    actor: payload.createdBy,
    title: payload.title,
    objective: payload.objective,
    laneId: payload.laneId,
    policyMode: payload.policyMode,
    slug: payload.slug
  });
  if (payload.idempotencyRequestHash !== expectedRequestHash) {
    findings.push("release.create idempotencyRequestHash does not match the normalized request snapshot");
  }

  if (payload.createdAt !== payload.updatedAt) {
    findings.push("release.create createdAt and updatedAt must be identical at creation");
  }
  if (payload.createdBy !== payload.updatedBy) {
    findings.push("release.create createdBy and updatedBy must be identical at creation");
  }

  if (operation) {
    if (operation.id !== changeSet.operationId) {
      findings.push(`release.create operation.id ${operation.id} does not match ChangeSet operationId ${changeSet.operationId}`);
    }
    if (payload.createdAt !== operation.proposedAt || payload.updatedAt !== operation.proposedAt) {
      findings.push("release.create timestamps must match the server-owned operation proposedAt value");
    }
    if (payload.createdBy !== operation.proposedBy || payload.updatedBy !== operation.proposedBy) {
      findings.push("release.create actors must match the server-owned operation proposedBy value");
    }
  }

  return findings;
}
'''
(ROOT / "runtime/src/lib/releaseCreate.mjs").write_text(release_create_module)

replace_exact(
    "runtime/src/commands/proposalPreparation.mjs",
    'import { revisionHash } from "../lib/canonical.mjs";\n',
    'import { releaseCreateRequestHash } from "../lib/releaseCreate.mjs";\n'
)
replace_exact(
    "runtime/src/commands/proposalPreparation.mjs",
    '    const idempotencyRequestHash = revisionHash({ actor, title, objective, laneId: laneId ?? null, policyMode: policyMode ?? null, slug });',
    '    const idempotencyRequestHash = releaseCreateRequestHash({ actor, title, objective, laneId, policyMode, slug });'
)

replace_exact(
    "runtime/src/lib/changeset.mjs",
    'import { DIRECTORY_CONTENT_HASH, isDirectoryRenderEntry } from "./bootstrapTopology.mjs";\n',
    'import { DIRECTORY_CONTENT_HASH, isDirectoryRenderEntry } from "./bootstrapTopology.mjs";\nimport { releaseCreateInvariantFindings } from "./releaseCreate.mjs";\n'
)

old_idempotency = '''function findIdempotentOperation(operationsRoot, { kind, key, requestHash }) {
  if (!key || !fs.existsSync(operationsRoot)) return null;
  for (const candidateId of fs.readdirSync(operationsRoot).sort()) {
    let operation;
    let changeSet;
    try {
      operation = readOperation(operationsRoot, candidateId);
      if (operation.kind !== kind || ["INVALID", "STALE"].includes(operation.status)) continue;
      changeSet = readChangeSet(operationsRoot, candidateId);
    } catch {
      continue;
    }
    if (changeSet.payload?.idempotencyKey !== key) continue;
    if (changeSet.payload?.idempotencyRequestHash !== requestHash) {
      throw new StateError(`idempotency key ${key} was already used for a different ${kind} request`);
    }
    return candidateId;
  }
  return null;
}
'''
new_idempotency = '''function findIdempotentOperation(operationsRoot, { kind, key, requestHash }) {
  if (!key || !fs.existsSync(operationsRoot)) return null;
  let matchingOperationId = null;
  for (const candidateId of fs.readdirSync(operationsRoot).sort()) {
    let operation;
    try {
      operation = readOperation(operationsRoot, candidateId);
    } catch (error) {
      throw new StateError(`cannot establish ${kind} idempotency because operation ${candidateId} is unreadable: ${error.message}`);
    }
    if (operation.kind !== kind) continue;

    let changeSet;
    try {
      changeSet = readChangeSet(operationsRoot, candidateId);
    } catch (error) {
      throw new StateError(`cannot establish ${kind} idempotency because ChangeSet ${candidateId} is unreadable: ${error.message}`);
    }
    if (changeSet.kind !== kind || changeSet.operationId !== candidateId) {
      throw new StateError(`cannot establish ${kind} idempotency because operation ${candidateId} is internally inconsistent`);
    }
    if (changeSet.payload?.idempotencyKey !== key) continue;
    if (changeSet.payload?.idempotencyRequestHash !== requestHash) {
      throw new StateError(`idempotency key ${key} was already used for a different ${kind} request`);
    }
    if (matchingOperationId && matchingOperationId !== candidateId) {
      throw new StateError(`idempotency key ${key} is bound to multiple ${kind} operations`);
    }
    matchingOperationId = candidateId;
  }
  return matchingOperationId;
}
'''
replace_exact("runtime/src/lib/changeset.mjs", old_idempotency, new_idempotency)
replace_exact(
    "runtime/src/lib/changeset.mjs",
    'function checkKindInvariants(changeSet) {',
    'function checkKindInvariants(changeSet, operation = null) {'
)
replace_exact(
    "runtime/src/lib/changeset.mjs",
    '  if (changeSet.kind === "release.create") {\n    const releasePath = `releases/${changeSet.payload.id}/release.yml`;',
    '  if (changeSet.kind === "release.create") {\n    errors.push(...releaseCreateInvariantFindings(changeSet, operation));\n    const releasePath = `releases/${changeSet.payload.id}/release.yml`;'
)
replace_exact(
    "runtime/src/lib/changeset.mjs",
    'function revalidateChangeSet({ operationsRoot, planningRoot, operationId, render }) {',
    'function revalidateChangeSet({ operationsRoot, planningRoot, operationId, render, operation = null }) {'
)
replace_exact(
    "runtime/src/lib/changeset.mjs",
    '  const invariantErrors = checkKindInvariants(changeSet);',
    '  const invariantErrors = checkKindInvariants(changeSet, operation);'
)
replace_exact(
    "runtime/src/lib/changeset.mjs",
    '    const result = revalidateChangeSet({ operationsRoot, planningRoot, operationId, render });',
    '    const result = revalidateChangeSet({ operationsRoot, planningRoot, operationId, render, operation });'
)
replace_exact(
    "runtime/src/lib/changeset.mjs",
    '  const revalidation = revalidateChangeSet({ operationsRoot, planningRoot, operationId, render });',
    '  const revalidation = revalidateChangeSet({ operationsRoot, planningRoot, operationId, render, operation });'
)

integrity_test = '''import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../commands/init.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../../commands/changesetCommand.mjs";
import { runReleaseNew } from "../../commands/release.mjs";
import { computePersistedChangeSetHash } from "../changeset.mjs";
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

console.log("release-create-integrity: relational server fields and permanent idempotency bindings pass");
'''
(ROOT / "runtime/src/lib/tests/release-create-integrity.test.mjs").write_text(integrity_test)

replace_exact(
    "docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md",
    '- directory UUID and `release.id` must match.\n',
    '- directory UUID and `release.id` must match;\n- validate/apply must rebind `payload.operationId`, `target.releaseId`, actor and timestamps to the persisted Operation, and verify that `displayId` is derived from `release.id`;\n- the normalized idempotency request hash is recomputed during validation rather than trusted from editable ChangeSet content.\n'
)
replace_exact(
    "docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md",
    'Base revisions for both files must be `ABSENT`.\n',
    'Base revisions for both files must be `ABSENT`. Idempotency keys remain permanently bound to their first normalized request and Operation, including terminal `INVALID` or `STALE` outcomes; unreadable or multiply-bound records fail closed.\n'
)
