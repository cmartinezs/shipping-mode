import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, computePersistedChangeSetHash } from "../changeset.mjs";
import { readOperation, writeOperation } from "../operationStore.mjs";
import { StateError, StaleError } from "../errors.mjs";
import { RecoveryRequiredError } from "../journal.mjs";
import { renderWorkspaceInit, renderConfigUpdate, renderScopeAdd } from "../../commands/renderers.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES } from "../bootstrapTopology.mjs";

const INIT_TARGET_FILES = ["config.yml", "plugin.lock.yml", ".gitignore", ...BOOTSTRAP_CANONICAL_DIRECTORIES];

function freshPlanningRoot() {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "validate-"));
  return { planningRoot, operationsRoot: path.join(planningRoot, "operations") };
}

function proposeWorkspaceInit(planningRoot, operationsRoot) {
  return propose({
    operationsRoot, planningRoot, kind: "workspace.init", target: {},
    payload: { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` },
    targetFiles: INIT_TARGET_FILES, actor: "carlos"
  });
}

// valid workspace.init payload -> VALIDATED (change-set shape ok, staleness ok, rendered config.yml + plugin.lock.yml both valid)
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  assert.equal(readOperation(operationsRoot, operationId).status, "VALIDATED");
}

// change-set shape invalid for this kind (workspace.init requires pluginVersion/templatePackFingerprint) -> INVALID
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = propose({
    operationsRoot, planningRoot, kind: "workspace.init", target: {},
    payload: { name: "demo", vcs: "git" }, // missing pluginVersion, templatePackFingerprint
    targetFiles: INIT_TARGET_FILES, actor: "carlos"
  });
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.some((e) => e.includes("change-set")), "the change-set schema rejection must be traceable to the change-set itself");
}

// change-set shape valid (config.update only requires payload.name), but the *rendered* document is
// invalid because config.yml doesn't exist yet (currentConfig is null, so the merged result is
// missing required fields) -> INVALID, and this is a genuinely different failure than the one above
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = propose({
    operationsRoot, planningRoot, kind: "config.update", target: {},
    payload: { name: "demo" },
    targetFiles: ["config.yml"], actor: "carlos"
  });
  const render = (payload) => renderConfigUpdate(payload, null);
  validateOperation({ operationsRoot, planningRoot, operationId, render });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.some((e) => e.includes("config.yml")), "the rendered-document rejection must be traceable to the rendered file");
}

// scope.add's new scope.yml must have been recorded ABSENT at propose time --
// a baseRevisions entry claiming otherwise must be rejected, even if it's
// internally consistent (this simulates a UUID collision or tampered manifest)
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const scopeId = "018f0000-0000-7000-8000-000000000002";
  const operationId = propose({
    operationsRoot, planningRoot, kind: "scope.add", target: { scopeId }, actor: "carlos",
    payload: { id: scopeId, key: "backend", label: "Backend", kind: "code", path: "api/", owner: null, guideGapId: "018f0000-0000-7000-8000-000000000004" },
    targetFiles: ["config.yml", `scopes/${scopeId}/scope.yml`]
  });

  const changeSetPath = path.join(operationsRoot, operationId, "change-set.json");
  const changeSet = JSON.parse(fs.readFileSync(changeSetPath, "utf8"));
  changeSet.baseRevisions[`scopes/${scopeId}/scope.yml`] = { revisionHash: "not-absent", contentHash: "not-absent" };
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  fs.writeFileSync(changeSetPath, JSON.stringify(changeSet, null, 2));

  const currentConfig = { schemaVersion: 1, name: "demo", baseBranch: null, vcs: "git", scopeRefs: [] };
  const render = (payload) => renderScopeAdd(payload, currentConfig, path.dirname(planningRoot));
  validateOperation({ operationsRoot, planningRoot, operationId, render });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.some((e) => e.toLowerCase().includes("absent")), "the ABSENT invariant violation must be traceable in the errors");
}

// file changed after propose -> STALE
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "name: tampered\n");
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  assert.equal(readOperation(operationsRoot, operationId).status, "STALE");
}

// workspace.init requires config.yml, plugin.lock.yml, AND .gitignore to all
// be ABSENT at propose time -- init must never be usable to reset an
// already-initialized workspace (config set exists for that)
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: existing\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  fs.writeFileSync(path.join(planningRoot, ".gitignore"), ".runtime/\n");

  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.some((e) => e.toLowerCase().includes("absent")), "a second workspace.init against an already-initialized workspace must be rejected");
}

// baseRevisions must exactly match the rendered file set: removing an entry (workspace.init)
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  const changeSetPath = path.join(operationsRoot, operationId, "change-set.json");
  const changeSet = JSON.parse(fs.readFileSync(changeSetPath, "utf8"));
  delete changeSet.baseRevisions["plugin.lock.yml"];
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  fs.writeFileSync(changeSetPath, JSON.stringify(changeSet, null, 2));

  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.some((e) => e.includes("plugin.lock.yml")));
}

// baseRevisions must exactly match the rendered file set: removing an entry (scope.add)
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const scopeId = "018f0000-0000-7000-8000-000000000003";
  const operationId = propose({
    operationsRoot, planningRoot, kind: "scope.add", target: { scopeId }, actor: "carlos",
    payload: { id: scopeId, key: "backend", label: "Backend", kind: "code", path: "api/", owner: null, guideGapId: "018f0000-0000-7000-8000-000000000004" },
    targetFiles: ["config.yml", `scopes/${scopeId}/scope.yml`]
  });
  const changeSetPath = path.join(operationsRoot, operationId, "change-set.json");
  const changeSet = JSON.parse(fs.readFileSync(changeSetPath, "utf8"));
  delete changeSet.baseRevisions["config.yml"];
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  fs.writeFileSync(changeSetPath, JSON.stringify(changeSet, null, 2));

  const currentConfig = { schemaVersion: 1, name: "demo", baseBranch: null, vcs: "git", scopeRefs: [] };
  const render = (payload) => renderScopeAdd(payload, currentConfig, path.dirname(planningRoot));
  validateOperation({ operationsRoot, planningRoot, operationId, render });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.some((e) => e.includes("config.yml")));
}

// baseRevisions must exactly match the rendered file set: an extra, unrendered path
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  const changeSetPath = path.join(operationsRoot, operationId, "change-set.json");
  const changeSet = JSON.parse(fs.readFileSync(changeSetPath, "utf8"));
  changeSet.baseRevisions["unrelated-extra-file.yml"] = { revisionHash: "ABSENT", contentHash: "ABSENT" };
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  fs.writeFileSync(changeSetPath, JSON.stringify(changeSet, null, 2));

  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.some((e) => e.includes("unrelated-extra-file.yml")));
}

// relational invariant: change-set.json's operationId must match the
// operation directory it lives in
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  const changeSetPath = path.join(operationsRoot, operationId, "change-set.json");
  const changeSet = JSON.parse(fs.readFileSync(changeSetPath, "utf8"));
  changeSet.operationId = "018f0000-0000-7000-8000-0000000000ff";
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  fs.writeFileSync(changeSetPath, JSON.stringify(changeSet, null, 2));

  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.some((e) => e.includes("operationId")));
}

// tampering: payload changed without updating hash -> the hash recompute at
// the very start of validate must catch it
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  const changeSetPath = path.join(operationsRoot, operationId, "change-set.json");
  const tampered = JSON.parse(fs.readFileSync(changeSetPath, "utf8"));
  tampered.payload.name = "tampered-without-rehash";
  fs.writeFileSync(changeSetPath, JSON.stringify(tampered, null, 2)); // hash left stale on purpose

  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.some((e) => e.toLowerCase().includes("hash")), "a hash mismatch must be reported as such");
}

// tampering: change-set rewritten (payload + a matching new hash) after
// validate, before approve -- internally consistent, but different from what
// validate actually checked, so approve must refuse
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  assert.equal(readOperation(operationsRoot, operationId).status, "VALIDATED");

  const changeSetPath = path.join(operationsRoot, operationId, "change-set.json");
  const changeSet = JSON.parse(fs.readFileSync(changeSetPath, "utf8"));
  changeSet.payload.name = "renamed-after-validate";
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  fs.writeFileSync(changeSetPath, JSON.stringify(changeSet, null, 2));

  assert.throws(() => approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true }), StaleError, "a change-set edited after validate must never be approvable, even if it's internally self-consistent");
  const staleOp = readOperation(operationsRoot, operationId);
  assert.equal(staleOp.status, "STALE", "the operation must be durably marked STALE, never left stuck as VALIDATED");
  assert.equal(staleOp.history.at(-1).actor, "system:validator");
}

// approve requires VALIDATED, rejects self-approval unless explicit
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  assert.throws(() => approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: false }), StateError);
  approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "APPROVED");
  assert.equal(op.approval.selfApproval, true);
  assert.ok(op.approval.changeSetHash);
}

// invalid state transitions: validate only legal from PROPOSED, approve only from VALIDATED
{
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit }); // -> VALIDATED
  assert.throws(() => validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit }), StateError, "validate must refuse to run twice against an already-VALIDATED operation");

  approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true }); // -> APPROVED
  assert.throws(() => validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit }), StateError, "validate must never retreat an APPROVED operation back to VALIDATED");
  assert.throws(() => approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true }), StateError, "approve must refuse to run twice against an already-APPROVED operation");
}

for (const terminalStatus of ["INVALID", "STALE", "RECOVERY_REQUIRED", "APPLYING", "APPLIED"]) {
  const { planningRoot, operationsRoot } = freshPlanningRoot();
  const operationId = proposeWorkspaceInit(planningRoot, operationsRoot);
  const operation = readOperation(operationsRoot, operationId);
  writeOperation(operationsRoot, operationId, { ...operation, status: terminalStatus });
  // RECOVERY_REQUIRED/APPLYING/APPLIED are special: now that Task 19 makes
  // recovery detection real, withWorkspaceMutation's recovery sweep (Task 13)
  // inspects every operation before the mutation runs -- and this synthetic
  // operation (status forced directly via writeOperation, never actually
  // validated/approved/applied) fails operation.schema.json's per-status
  // invariants for these three statuses (missing validation/approval
  // content, filePlan/expectedEvents, conflict, etc.), so recovery reports
  // it RECOVERY_REQUIRED and withWorkspaceMutation blocks the mutation
  // before validateOperation/approveOperation's own status check ever runs.
  // This is the correct, intended behavior (an unresolved/untrustworthy
  // operation blocks every mutating command uniformly), not a regression --
  // INVALID/STALE aren't covered by any per-status schema requirement, so
  // they still reach the real status check and throw StateError as before.
  const expectedError = ["RECOVERY_REQUIRED", "APPLYING", "APPLIED"].includes(terminalStatus) ? RecoveryRequiredError : StateError;
  assert.throws(() => validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit }), expectedError, `validate must refuse to run against an operation in ${terminalStatus}`);
  assert.throws(() => approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true }), expectedError, `approve must refuse to run against an operation in ${terminalStatus}`);
}

console.log("changeset-validate-approve: all tests passed");
