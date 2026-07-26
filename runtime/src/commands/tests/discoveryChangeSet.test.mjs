import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareDiscoveryChangeSet, runDiscoveryPropose } from "../discoveryChangeSet.mjs";
import { runInit } from "../init.mjs";
import { runChangesetValidate, runChangesetApprove, runChangesetApply } from "../changesetCommand.mjs";
import { renderDiscoveryPropose } from "../renderers.mjs";
import { __prepareApplyForTests } from "../../lib/changeset.mjs";
import { runDiscoverScan, readConfirmedSources, readConfirmedScopes } from "../../lib/discoverScan.mjs";
import { recoverWorkspace } from "../../lib/mutation.mjs";
import { readChangeSet, readOperation, readResult, writeChangeSet } from "../../lib/operationStore.mjs";
import { isUuidV7 } from "../../lib/ids.mjs";
import { parseYaml } from "../../lib/yaml.mjs";
import { StaleError } from "../../lib/errors.mjs";
import { checkSchema } from "../check.mjs";

function buildWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-changeset-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(workspaceRoot, "api"), { recursive: true });
  fs.mkdirSync(planningRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "api", "package.json"), "{}\n");
  return { workspaceRoot, planningRoot };
}

function applyInit(planningRoot) {
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "demo", vcs: "git", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos" });
  return operationsRoot;
}

function buildProposal(planningRoot, workspaceRoot) {
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1048576 });
  const candidate = scan.sourceCandidates.find((entry) => entry.path === "api/package.json");
  assert.ok(candidate);
  return {
    schemaVersion: 1,
    scanId: scan.scanId,
    baseRevision: scan.baseRevision,
    scanParameters: scan.scanParameters,
    scopes: [{ key: "api", label: "API", kind: "code", path: "api/", owner: null }],
    sources: [{
      action: "add",
      path: candidate.path,
      family: "project-module-manifests",
      kind: "repository-map",
      role: "evidence",
      authority: { standing: "supporting", force: "informational" },
      availability: "implemented",
      observedFingerprint: candidate.observedFingerprint,
      observedContentHash: candidate.observedContentHash
    }],
    scopeCommands: [],
    diagnostics: []
  };
}

function buildRemoveProposal(planningRoot, workspaceRoot, sourceId) {
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1048576 });
  return {
    schemaVersion: 1,
    scanId: scan.scanId,
    baseRevision: scan.baseRevision,
    scanParameters: scan.scanParameters,
    scopes: [],
    sources: [{ action: "remove", sourceId }],
    scopeCommands: [],
    diagnostics: []
  };
}

function buildCommandProposal(planningRoot, workspaceRoot, sourceId, scopeId) {
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1048576 });
  const known = scan.knownSources.find((entry) => entry.sourceId === sourceId);
  assert.ok(known);
  return {
    schemaVersion: 1,
    scanId: scan.scanId,
    baseRevision: scan.baseRevision,
    scanParameters: scan.scanParameters,
    scopes: [],
    sources: [{ action: "update", sourceId, observedFingerprint: known.observedFingerprint, observedContentHash: known.observedContentHash }],
    scopeCommands: [{
      scopeId,
      role: "test",
      command: "npm test",
      method: "reviewed",
      confidence: "high",
      sourceRefs: [sourceId],
      sourceFingerprintAtSelection: { [sourceId]: known.confirmedFingerprint },
      requiresEnvironment: false,
      requiresSecrets: false,
      alternatives: []
    }],
    diagnostics: []
  };
}

function renderDiscoveryFor(planningRoot, workspaceRoot) {
  return (payload) => renderDiscoveryPropose(payload, parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")), workspaceRoot, {
    currentSources: readConfirmedSources(planningRoot),
    currentScopes: readConfirmedScopes(planningRoot)
  });
}

function applyDiscoveryProposal({ planningRoot, workspaceRoot, operationsRoot, proposal, actor = "carlos" }) {
  const result = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(proposal), actor });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: result.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: result.operationId, actor, allowSelfApproval: true });
  const outcome = runChangesetApply({ planningRoot, operationsRoot, operationId: result.operationId, actor });
  return { result, outcome, changeSet: readChangeSet(operationsRoot, result.operationId) };
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  const invalid = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify({ schemaVersion: 1 }), actor: "carlos" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, "INVALID");
  assert.equal(fs.existsSync(path.join(planningRoot, "operations")), false, "invalid discovery proposals must not create operations");
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  applyInit(planningRoot);
  const proposal = buildProposal(planningRoot, workspaceRoot);
  const prepared = prepareDiscoveryChangeSet({
    planningRoot,
    workspaceRoot,
    proposalText: JSON.stringify(proposal),
    actor: "carlos",
    operationId: "018f0000-0000-7000-8000-000000000123",
    confirmedAt: "2026-07-26T00:00:00.000Z"
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.kind, "discovery.propose");
  assert.equal(prepared.preconditions.discoveryWorkspace.workspaceHash, proposal.baseRevision.workspaceHash);
  assert.deepEqual(prepared.preconditions.discoveryWorkspace.scanParameters, proposal.scanParameters);
  assert.equal(prepared.payload.confirmedBy, "carlos");
  assert.equal(prepared.payload.confirmedAt, "2026-07-26T00:00:00.000Z");
  assert.equal(prepared.payload.operationId, "018f0000-0000-7000-8000-000000000123");
  assert.equal(prepared.payload.sourceIdAssignments.length, 1);
  assert.ok(isUuidV7(prepared.payload.sourceIdAssignments[0].sourceId));
  assert.equal(prepared.payload.scopeIdAssignments.length, 1);
  assert.ok(isUuidV7(prepared.payload.scopeIdAssignments[0].scopeId));
  assert.ok(prepared.targetFiles.includes("config.yml"));
  assert.ok(prepared.targetFiles.some((entry) => entry.startsWith("sources/")));
  assert.ok(prepared.targetFiles.some((entry) => entry.startsWith("scopes/")));
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  applyInit(planningRoot);
  const proposal = buildProposal(planningRoot, workspaceRoot);
  const result = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(proposal), actor: "carlos" });
  assert.ok(isUuidV7(result.operationId));
  const changeSet = readChangeSet(path.join(planningRoot, "operations"), result.operationId);
  assert.equal(changeSet.kind, "discovery.propose");
  assert.equal(changeSet.payload.operationId, result.operationId);
  assert.equal(changeSet.payload.confirmedBy, "carlos");
  assert.equal(changeSet.preconditions.discoveryWorkspace.workspaceHash, proposal.baseRevision.workspaceHash);
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  const operationsRoot = applyInit(planningRoot);
  const proposal = buildProposal(planningRoot, workspaceRoot);
  const result = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(proposal), actor: "carlos" });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: result.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: result.operationId, actor: "carlos", allowSelfApproval: true });
  const outcome = runChangesetApply({ planningRoot, operationsRoot, operationId: result.operationId, actor: "carlos" });

  assert.equal(outcome.status, "APPLIED");
  const changeSet = readChangeSet(operationsRoot, result.operationId);
  const sourceId = changeSet.payload.sourceIdAssignments[0].sourceId;
  const scopeId = changeSet.payload.scopeIdAssignments[0].scopeId;
  const source = parseYaml(fs.readFileSync(path.join(planningRoot, "sources", sourceId, "source.yml"), "utf8"));
  const scope = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
  const config = parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"));

  assert.equal(source.id, sourceId);
  assert.equal(source.provenance.discoveredBy, "discovery.propose");
  assert.equal(source.provenance.confirmedBy, "carlos");
  assert.equal(source.provenance.confirmedOperationId, result.operationId);
  assert.equal(scope.id, scopeId);
  assert.ok(config.scopeRefs.some((ref) => ref.id === scopeId && ref.key === "api"));
  assert.equal(proposal.sources[0].sourceId, undefined, "proposal-local source ids must not be introduced for adds");
  assert.equal(proposal.scopes[0].id, undefined, "proposal-local scope ids must not be introduced for adds");
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  const operationsRoot = applyInit(planningRoot);
  const configBefore = fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8");
  const proposal = buildProposal(planningRoot, workspaceRoot);
  const result = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(proposal), actor: "carlos" });
  const changeSet = readChangeSet(operationsRoot, result.operationId);
  const sourceId = changeSet.payload.sourceIdAssignments[0].sourceId;
  const scopeId = changeSet.payload.scopeIdAssignments[0].scopeId;

  runChangesetValidate({ planningRoot, operationsRoot, operationId: result.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: result.operationId, actor: "carlos", allowSelfApproval: true });
  fs.writeFileSync(path.join(workspaceRoot, "api", "package.json"), "{\"changed\":true}\n");

  assert.throws(
    () => runChangesetApply({ planningRoot, operationsRoot, operationId: result.operationId, actor: "carlos" }),
    StaleError,
    "apply must re-scan immediately before mutation and reject a stale discovery workspace"
  );
  assert.equal(readOperation(operationsRoot, result.operationId).status, "STALE");
  assert.equal(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"), configBefore, "stale discovery apply must not partially rewrite config.yml");
  assert.equal(fs.existsSync(path.join(planningRoot, "sources", sourceId, "source.yml")), false, "stale discovery apply must not create source.yml");
  assert.equal(fs.existsSync(path.join(planningRoot, "scopes", scopeId, "scope.yml")), false, "stale discovery apply must not create scope.yml");
  assert.equal(fs.existsSync(path.join(planningRoot, ".runtime", "operations", result.operationId)), false, "stale discovery apply must stop before staging");

  const refreshed = buildProposal(planningRoot, workspaceRoot);
  const retry = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(refreshed), actor: "carlos" });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: retry.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: retry.operationId, actor: "carlos", allowSelfApproval: true });
  assert.equal(runChangesetApply({ planningRoot, operationsRoot, operationId: retry.operationId, actor: "carlos" }).status, "APPLIED");
  assert.equal(readOperation(operationsRoot, result.operationId).status, "STALE", "stale recovery must use a new operation, not resurrect the stale one");
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  const operationsRoot = applyInit(planningRoot);
  const added = applyDiscoveryProposal({ planningRoot, workspaceRoot, operationsRoot, proposal: buildProposal(planningRoot, workspaceRoot) });
  const sourceId = added.changeSet.payload.sourceIdAssignments[0].sourceId;
  const scopeId = added.changeSet.payload.scopeIdAssignments[0].scopeId;

  const commandProposal = buildCommandProposal(planningRoot, workspaceRoot, sourceId, scopeId);
  const command = applyDiscoveryProposal({ planningRoot, workspaceRoot, operationsRoot, proposal: commandProposal });
  const scope = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
  assert.equal(scope.commands.test.method, "reviewed");
  assert.deepEqual(scope.commands.test.sourceRefs, [sourceId]);
  assert.equal(command.changeSet.payload.proposal.sources[0].action, "update", "source refs may resolve through a same-proposal update");
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  const operationsRoot = applyInit(planningRoot);
  const added = applyDiscoveryProposal({ planningRoot, workspaceRoot, operationsRoot, proposal: buildProposal(planningRoot, workspaceRoot) });
  const sourceId = added.changeSet.payload.sourceIdAssignments[0].sourceId;
  const sourceRelative = `sources/${sourceId}/source.yml`;
  assert.equal(fs.existsSync(path.join(planningRoot, sourceRelative)), true);

  const removed = applyDiscoveryProposal({ planningRoot, workspaceRoot, operationsRoot, proposal: buildRemoveProposal(planningRoot, workspaceRoot, sourceId) });
  assert.equal(removed.outcome.status, "APPLIED");
  assert.equal(fs.existsSync(path.join(planningRoot, sourceRelative)), false, "remove source action must delete source.yml through ChangeSet apply");
  assert.equal(fs.existsSync(path.join(planningRoot, "sources", sourceId)), false, "remove source action must prune the now-empty source directory");
  assert.deepEqual(readResult(operationsRoot, removed.result.operationId).files, [{ target: sourceRelative, action: "delete", contentHash: "ABSENT" }]);
  assert.equal(checkSchema({ planningRoot }).status, "PASS", "a successful source remove must leave the catalog schema-valid");
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  const operationsRoot = applyInit(planningRoot);
  const added = applyDiscoveryProposal({ planningRoot, workspaceRoot, operationsRoot, proposal: buildProposal(planningRoot, workspaceRoot) });
  const sourceId = added.changeSet.payload.sourceIdAssignments[0].sourceId;
  const sourceRelative = `sources/${sourceId}/source.yml`;
  const removeProposal = buildRemoveProposal(planningRoot, workspaceRoot, sourceId);
  const remove = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(removeProposal), actor: "carlos" });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: remove.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: remove.operationId, actor: "carlos", allowSelfApproval: true });

  const { filePlan } = __prepareApplyForTests({
    planningRoot,
    operationsRoot,
    operationId: remove.operationId,
    render: renderDiscoveryFor(planningRoot, workspaceRoot),
    actor: "carlos"
  });
  assert.deepEqual(filePlan, [{
    target: sourceRelative,
    action: "delete",
    expectedBefore: "PRESENT",
    beforeContentHash: filePlan[0].beforeContentHash,
    beforeRevisionHash: filePlan[0].beforeRevisionHash,
    stagedContentHash: "ABSENT",
    stagedRevisionHash: "ABSENT"
  }]);
  assert.equal(fs.existsSync(path.join(planningRoot, sourceRelative)), true, "prepareApply must not perform the delete");

  const outcomes = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(outcomes.find((entry) => entry.operationId === remove.operationId)?.outcome, "COMPLETED");
  assert.equal(readOperation(operationsRoot, remove.operationId).status, "APPLIED");
  assert.equal(fs.existsSync(path.join(planningRoot, sourceRelative)), false, "recovery must replay pending deletes");
  assert.equal(fs.existsSync(path.join(planningRoot, "sources", sourceId)), false, "recovery must also prune the empty source directory");
  assert.deepEqual(readResult(operationsRoot, remove.operationId).files, [{ target: sourceRelative, action: "delete", contentHash: "ABSENT" }]);
  assert.equal(checkSchema({ planningRoot }).status, "PASS", "recovered source removal must leave the catalog schema-valid");
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  applyInit(planningRoot);
  const proposal = buildProposal(planningRoot, workspaceRoot);
  proposal.sources[0].provenance = { confirmedBy: "caller" };
  const invalid = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(proposal), actor: "carlos" });
  assert.equal(invalid.ok, false, "caller-supplied provenance-like fields must not enter a discovery ChangeSet");
  assert.equal(invalid.status, "INVALID");
}

{
  const { planningRoot, workspaceRoot } = buildWorkspace();
  const operationsRoot = applyInit(planningRoot);
  const configBefore = fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8");
  const proposal = buildProposal(planningRoot, workspaceRoot);
  const result = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(proposal), actor: "carlos" });
  const changeSet = readChangeSet(operationsRoot, result.operationId);
  const sourceId = changeSet.payload.sourceIdAssignments[0].sourceId;
  const scopeId = changeSet.payload.scopeIdAssignments[0].scopeId;
  runChangesetValidate({ planningRoot, operationsRoot, operationId: result.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: result.operationId, actor: "carlos", allowSelfApproval: true });

  writeChangeSet(operationsRoot, result.operationId, {
    ...changeSet,
    preconditions: {
      discoveryWorkspace: {
        ...changeSet.preconditions.discoveryWorkspace,
        workspaceHash: "f".repeat(64)
      }
    }
  });

  assert.throws(
    () => runChangesetApply({ planningRoot, operationsRoot, operationId: result.operationId, actor: "carlos" }),
    StaleError,
    "tampering persisted preconditions after approval must stale before writes"
  );
  assert.equal(readOperation(operationsRoot, result.operationId).status, "STALE");
  assert.equal(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"), configBefore);
  assert.equal(fs.existsSync(path.join(planningRoot, "sources", sourceId, "source.yml")), false);
  assert.equal(fs.existsSync(path.join(planningRoot, "scopes", scopeId, "scope.yml")), false);
}

console.log("discoveryChangeSet: validation handoff, runtime ids, preconditions, deletes, tamper, and recovery pass");
