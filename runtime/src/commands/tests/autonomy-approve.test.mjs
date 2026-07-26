import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../init.mjs";
import { runDiscoveryPropose } from "../discoveryChangeSet.mjs";
import { runChangesetPropose, runChangesetValidate, runChangesetApprove, runChangesetApply } from "../changesetCommand.mjs";
import { runDiscoverScan } from "../../lib/discoverScan.mjs";
import { readChangeSet, readOperation, writeOperation } from "../../lib/operationStore.mjs";
import { parseYaml } from "../../lib/yaml.mjs";
import { StateError, StaleError } from "../../lib/errors.mjs";
import { REASON_CODES } from "../../lib/autonomy.mjs";

function buildWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-approve-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(workspaceRoot, "api"), { recursive: true });
  fs.mkdirSync(planningRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "api", "package.json"), "{}\n");
  return { workspaceRoot, planningRoot, operationsRoot: path.join(planningRoot, "operations") };
}

function applyInit(planningRoot, operationsRoot) {
  const init = runInit({ planningRoot, args: { name: "demo", vcs: "git", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos" });
}

function autoPolicy({ scopeMode = "auto-approve", sourceMode = "auto-approve" } = {}) {
  return {
    discovery: {
      default: "pause",
      scopeCommandConfidenceFloor: "high",
      sourceOverrides: [
        {
          family: "project-module-manifests",
          mode: sourceMode,
          ...(sourceMode === "auto-approve" ? { authorityCeiling: { standing: "supporting", force: "advisory" } } : {})
        }
      ],
      scopeCommand: { mode: scopeMode }
    }
  };
}

function proposeAutonomyConfig(planningRoot, operationsRoot, policy) {
  const proposed = runChangesetPropose({
    planningRoot,
    kind: "config.autonomy.set",
    actor: "carlos",
    payloadText: JSON.stringify(policy)
  });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: proposed.operationId });
  return proposed.operationId;
}

function applyAutonomyConfig(planningRoot, operationsRoot, policy) {
  const operationId = proposeAutonomyConfig(planningRoot, operationsRoot, policy);
  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId, actor: "carlos" });
  return operationId;
}

function addInitialCatalog(planningRoot, workspaceRoot, operationsRoot) {
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1048576 });
  const candidate = scan.sourceCandidates.find((entry) => entry.path === "api/package.json");
  assert.ok(candidate);
  const proposal = {
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
  const result = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(proposal), actor: "carlos" });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: result.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: result.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: result.operationId, actor: "carlos" });
  const changeSet = readChangeSet(operationsRoot, result.operationId);
  return {
    sourceId: changeSet.payload.sourceIdAssignments[0].sourceId,
    scopeId: changeSet.payload.scopeIdAssignments[0].scopeId
  };
}

function buildCommandProposal(planningRoot, workspaceRoot, sourceId, scopeId, { alternatives = [], withAlternative = false, method = "reviewed" } = {}) {
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1048576 });
  const known = scan.knownSources.find((entry) => entry.sourceId === sourceId);
  assert.ok(known);
  const commandAlternatives = withAlternative
    ? [{
      command: "npm run test:unit",
      confidence: "medium",
      sourceRefs: [sourceId],
      sourceFingerprintAtSelection: { [sourceId]: known.confirmedFingerprint },
      requiresEnvironment: false,
      requiresSecrets: false
    }]
    : alternatives;
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
      method,
      confidence: "high",
      sourceRefs: [sourceId],
      sourceFingerprintAtSelection: { [sourceId]: known.confirmedFingerprint },
      requiresEnvironment: false,
      requiresSecrets: false,
      alternatives: commandAlternatives
    }],
    diagnostics: []
  };
}

function proposeValidatedCommand(planningRoot, workspaceRoot, operationsRoot, sourceId, scopeId, options = {}) {
  const proposal = buildCommandProposal(planningRoot, workspaceRoot, sourceId, scopeId, options);
  const result = runDiscoveryPropose({ planningRoot, workspaceRoot, proposalText: JSON.stringify(proposal), actor: options.actor || "carlos" });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: result.operationId });
  return result.operationId;
}

function prepareReadyWorkspace() {
  const { workspaceRoot, planningRoot, operationsRoot } = buildWorkspace();
  applyInit(planningRoot, operationsRoot);
  const configOperationId = proposeAutonomyConfig(planningRoot, operationsRoot, autoPolicy());
  const configOperation = readOperation(operationsRoot, configOperationId);
  assert.equal(configOperation.autonomyEvaluation.autoApprovable, false);
  assert.deepEqual(configOperation.autonomyEvaluation.blockedBy, [{ itemRef: "changeSet", reason: REASON_CODES.AUTONOMY_CONFIG_CHANGE }]);
  assert.throws(
    () => runChangesetApprove({ planningRoot, operationsRoot, operationId: configOperationId, actor: "discovery-skill", mode: "autonomous" }),
    StateError,
    "config autonomy set must never self-approve autonomously"
  );
  runChangesetApprove({ planningRoot, operationsRoot, operationId: configOperationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: configOperationId, actor: "carlos" });
  const ids = addInitialCatalog(planningRoot, workspaceRoot, operationsRoot);
  return { workspaceRoot, planningRoot, operationsRoot, ...ids };
}

{
  const { workspaceRoot, planningRoot, operationsRoot, sourceId, scopeId } = prepareReadyWorkspace();
  const operationId = proposeValidatedCommand(planningRoot, workspaceRoot, operationsRoot, sourceId, scopeId);
  const operation = readOperation(operationsRoot, operationId);
  assert.equal(operation.autonomyEvaluation.autoApprovable, true);
  assert.throws(
    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "cualquier-string", mode: "autonomous" }),
    StateError,
    "autonomous approval must require a recognized automation-capable actor"
  );

  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous" });
  assert.equal(readOperation(operationsRoot, operationId).approval.mode, "autonomous");
  runChangesetApply({ planningRoot, operationsRoot, operationId, actor: "discovery-skill" });
  const scope = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
  assert.equal(scope.commands.test.method, "inferred", "persisted discovery method must come from autonomous approval, not caller input");
}

{
  const { workspaceRoot, planningRoot, operationsRoot, sourceId, scopeId } = prepareReadyWorkspace();
  const operationId = proposeValidatedCommand(planningRoot, workspaceRoot, operationsRoot, sourceId, scopeId, {
    withAlternative: true
  });
  assert.equal(readOperation(operationsRoot, operationId).autonomyEvaluation.autoApprovable, false);
  assert.equal(readOperation(operationsRoot, operationId).autonomyEvaluation.blockedBy[0].reason, REASON_CODES.ALTERNATIVES_PRESENT);
  assert.throws(
    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous" }),
    StateError,
    "autoApprovable false must block autonomous approval"
  );
  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "carlos", allowSelfApproval: true });
  assert.equal(readOperation(operationsRoot, operationId).approval.mode, "human", "omitted --mode must default to human");
}

{
  const { workspaceRoot, planningRoot, operationsRoot, sourceId, scopeId } = prepareReadyWorkspace();
  const operationId = proposeValidatedCommand(planningRoot, workspaceRoot, operationsRoot, sourceId, scopeId);
  applyAutonomyConfig(planningRoot, operationsRoot, autoPolicy({ scopeMode: "pause" }));
  assert.throws(
    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous" }),
    StaleError,
    "autonomous approval must stale when the confirmed policy changed after validation"
  );
  const stale = readOperation(operationsRoot, operationId);
  assert.equal(stale.status, "STALE");
  assert.equal(stale.history.at(-1).reason, REASON_CODES.POLICY_CHANGED_SINCE_VALIDATION);
}

{
  const { workspaceRoot, planningRoot, operationsRoot, sourceId, scopeId } = prepareReadyWorkspace();
  const operationId = proposeValidatedCommand(planningRoot, workspaceRoot, operationsRoot, sourceId, scopeId, { method: "reviewed" });
  applyAutonomyConfig(planningRoot, operationsRoot, autoPolicy({ scopeMode: "pause" }));
  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "carlos", allowSelfApproval: true, mode: "human" });
  assert.equal(readOperation(operationsRoot, operationId).approval.mode, "human");
  runChangesetApply({ planningRoot, operationsRoot, operationId, actor: "carlos" });
  const scope = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
  assert.equal(scope.commands.test.method, "reviewed", "human approval must persist reviewed even when the caller proposed another method");
}

{
  const { workspaceRoot, planningRoot, operationsRoot, sourceId, scopeId } = prepareReadyWorkspace();
  const trueOperationId = proposeValidatedCommand(planningRoot, workspaceRoot, operationsRoot, sourceId, scopeId);
  const falseOperationId = proposeValidatedCommand(planningRoot, workspaceRoot, operationsRoot, sourceId, scopeId, {
    withAlternative: true
  });
  const trueOperation = readOperation(operationsRoot, trueOperationId);
  const falseEvaluation = readOperation(operationsRoot, falseOperationId).autonomyEvaluation;
  writeOperation(operationsRoot, trueOperationId, { ...trueOperation, autonomyEvaluation: falseEvaluation });
  assert.throws(
    () => runChangesetApprove({ planningRoot, operationsRoot, operationId: trueOperationId, actor: "discovery-skill", mode: "autonomous" }),
    StateError,
    "an autonomyEvaluation copied from another operation must not authorize this operation"
  );
}

console.log("autonomy-approve: config changesets, approve modes, stale policy, actor capability, tamper, and method ownership pass");
