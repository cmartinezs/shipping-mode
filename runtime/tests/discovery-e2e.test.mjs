import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../src/lib/yaml.mjs";
import { isUuidV7 } from "../src/lib/ids.mjs";
import { readChangeSet, readOperation } from "../src/lib/operationStore.mjs";
import { runChangesetApprove } from "../src/commands/changesetCommand.mjs";
import { AUTONOMOUS_APPROVAL_CAPABILITY, REASON_CODES } from "../src/lib/autonomy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "bin", "shipping-mode.mjs");
const TRUSTED_AUTOMATION_CONTEXT = { capabilities: [AUTONOMOUS_APPROVAL_CAPABILITY] };

function run(args, cwd, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", ...options });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.status, json: JSON.parse(error.stdout) };
  }
}

function freshWorkspace(prefix = "discovery-e2e-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function planningRoot(cwd) {
  return path.join(cwd, ".planning");
}

function operationsRoot(cwd) {
  return path.join(planningRoot(cwd), "operations");
}

function readConfig(cwd) {
  return parseYaml(fs.readFileSync(path.join(planningRoot(cwd), "config.yml"), "utf8"));
}

function readScope(cwd, scopeId) {
  return parseYaml(fs.readFileSync(path.join(planningRoot(cwd), "scopes", scopeId, "scope.yml"), "utf8"));
}

function readSource(cwd, sourceId) {
  return parseYaml(fs.readFileSync(path.join(planningRoot(cwd), "sources", sourceId, "source.yml"), "utf8"));
}

function readResult(cwd, operationId) {
  return JSON.parse(fs.readFileSync(path.join(operationsRoot(cwd), operationId, "result.json"), "utf8"));
}

function listEventDocuments(cwd) {
  const eventsRoot = path.join(planningRoot(cwd), "events");
  if (!fs.existsSync(eventsRoot)) return [];
  const docs = [];
  for (const year of fs.readdirSync(eventsRoot)) {
    for (const month of fs.readdirSync(path.join(eventsRoot, year))) {
      for (const file of fs.readdirSync(path.join(eventsRoot, year, month))) {
        if (!file.endsWith(".json")) continue;
        docs.push(JSON.parse(fs.readFileSync(path.join(eventsRoot, year, month, file), "utf8")));
      }
    }
  }
  return docs.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

function initWorkspace(cwd) {
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  assert.equal(init.code, 0);
  assert.equal(run(["changeset", "validate", init.json.operationId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", init.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  assert.equal(run(["changeset", "apply", init.json.operationId, "--actor", "carlos"], cwd).code, 0);
}

function autoPolicy({ scopeMode = "auto-approve" } = {}) {
  return {
    discovery: {
      default: "pause",
      scopeCommandConfidenceFloor: "high",
      sourceOverrides: [{
        family: "project-module-manifests",
        mode: "auto-approve",
        authorityCeiling: { standing: "supporting", force: "advisory" }
      }],
      scopeCommand: { mode: scopeMode }
    }
  };
}

function applyAutonomy(cwd, policy = autoPolicy()) {
  const payloadFile = path.join(cwd, `autonomy-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(payloadFile, JSON.stringify(policy));
  const proposed = run(["config", "autonomy", "set", "--file", payloadFile, "--actor", "carlos"], cwd);
  assert.equal(proposed.code, 0);
  assert.equal(run(["changeset", "validate", proposed.json.operationId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", proposed.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  assert.equal(run(["changeset", "apply", proposed.json.operationId, "--actor", "carlos"], cwd).code, 0);
  fs.rmSync(payloadFile, { force: true });
  return proposed.json.operationId;
}

function writePackage(cwd, relativeDir, contents = "{}\n") {
  fs.mkdirSync(path.join(cwd, relativeDir), { recursive: true });
  fs.writeFileSync(path.join(cwd, relativeDir, "package.json"), contents);
}

function scan(cwd) {
  const scanned = run(["discover", "scan", "--max-source-bytes", "1048576"], cwd);
  assert.equal(scanned.code, 0);
  return scanned.json;
}

function packageCandidate(scanResult, relativePath) {
  const candidate = scanResult.sourceCandidates.find((entry) => entry.path === relativePath);
  assert.ok(candidate, `scan must find ${relativePath}`);
  return candidate;
}

function knownSource(scanResult, sourceId) {
  const known = scanResult.knownSources.find((entry) => entry.sourceId === sourceId);
  assert.ok(known, `scan must include known source ${sourceId}`);
  return known;
}

function proposeDiscovery(cwd, proposal) {
  const proposalFile = path.join(cwd, `proposal-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(proposalFile, JSON.stringify(proposal));
  const proposed = run(["discover", "propose", "--file", proposalFile, "--actor", "carlos"], cwd);
  fs.rmSync(proposalFile, { force: true });
  assert.equal(proposed.code, 0, JSON.stringify(proposed.json));
  return proposed.json.operationId;
}

function addScopeAndSourceProposal(scanResult, { key, label, scopePath, sourcePath }) {
  const candidate = packageCandidate(scanResult, sourcePath);
  return {
    schemaVersion: 1,
    scanId: scanResult.scanId,
    baseRevision: scanResult.baseRevision,
    scanParameters: scanResult.scanParameters,
    scopes: [{ key, label, kind: "code", path: scopePath, owner: null }],
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

function commandProposal(scanResult, { sourceId, scopeId, alternatives = [] }) {
  const known = knownSource(scanResult, sourceId);
  return {
    schemaVersion: 1,
    scanId: scanResult.scanId,
    baseRevision: scanResult.baseRevision,
    scanParameters: scanResult.scanParameters,
    scopes: [],
    sources: [{
      action: "update",
      sourceId,
      observedFingerprint: known.observedFingerprint,
      observedContentHash: known.observedContentHash
    }],
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
      alternatives
    }],
    diagnostics: []
  };
}

function applyInitialCatalog(cwd) {
  writePackage(cwd, "api");
  const operationId = proposeDiscovery(cwd, addScopeAndSourceProposal(scan(cwd), {
    key: "api",
    label: "API",
    scopePath: "api/",
    sourcePath: "api/package.json"
  }));
  assert.equal(run(["changeset", "validate", operationId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  assert.equal(run(["changeset", "apply", operationId, "--actor", "carlos"], cwd).code, 0);
  const changeSet = readChangeSet(operationsRoot(cwd), operationId);
  return {
    operationId,
    scopeId: changeSet.payload.scopeIdAssignments[0].scopeId,
    sourceId: changeSet.payload.sourceIdAssignments[0].sourceId
  };
}

// Real Discovery E2E with public binary and semantic catalog inspection.
{
  const cwd = freshWorkspace();
  initWorkspace(cwd);
  applyAutonomy(cwd);
  const initial = applyInitialCatalog(cwd);

  const configuredDocumentation = readConfig(cwd).documentation;
  const documentationPayload = path.join(cwd, "documentation-config.json");
  fs.writeFileSync(documentationPayload, JSON.stringify({
    documentation: {
      source_refs: [initial.sourceId],
      gaps: configuredDocumentation.gaps
    }
  }));
  const documentationUpdate = run(["changeset", "propose", "--kind", "config.update", "--payload-file", documentationPayload, "--actor", "carlos"], cwd);
  assert.equal(documentationUpdate.code, 0);
  assert.equal(run(["changeset", "validate", documentationUpdate.json.operationId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", documentationUpdate.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  assert.equal(run(["changeset", "apply", documentationUpdate.json.operationId, "--actor", "carlos"], cwd).code, 0);
  fs.rmSync(documentationPayload, { force: true });
  assert.deepEqual(readConfig(cwd).documentation.source_refs, [initial.sourceId]);
  assert.ok(readConfig(cwd).documentation.gaps.some((gap) => gap.scope_ref === initial.scopeId && gap.status === "missing"));
  assert.equal(run(["check", "schema"], cwd).json.status, "PASS");

  const commandOperationId = proposeDiscovery(cwd, commandProposal(scan(cwd), initial));
  assert.equal(run(["changeset", "validate", commandOperationId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", commandOperationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  const applied = run(["changeset", "apply", commandOperationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 0);
  assert.equal(applied.json.status, "APPLIED");
  assert.equal(run(["check", "schema"], cwd).json.status, "PASS");

  const config = readConfig(cwd);
  assert.ok(config.scopeRefs.some((entry) => entry.id === initial.scopeId && entry.key === "api"));

  const source = readSource(cwd, initial.sourceId);
  assert.equal(source.id, initial.sourceId);
  assert.equal(source.path, "api/package.json");
  assert.equal(source.confirmedFingerprint, source.confirmedContentHash);
  assert.equal(source.provenance.discoveredBy, "discovery.propose");
  assert.equal(source.provenance.confirmedBy, "carlos");
  assert.equal(source.provenance.confirmedOperationId, commandOperationId);

  const scope = readScope(cwd, initial.scopeId);
  assert.equal(scope.id, initial.scopeId);
  assert.equal(scope.commands.test.method, "reviewed");
  assert.deepEqual(scope.commands.test.sourceRefs, [initial.sourceId]);
  assert.equal(scope.commands.test.sourceFingerprintAtSelection[initial.sourceId], source.confirmedFingerprint);

  const operation = readOperation(operationsRoot(cwd), commandOperationId);
  assert.equal(operation.status, "APPLIED");
  assert.equal(operation.approval.mode, "human");
  assert.equal(operation.approval.actor, "carlos");
  assert.equal(operation.autonomyEvaluation.autoApprovable, true);
  assert.equal(operation.filePlan.length, 2, "command proposal rewrites the source and scope manifests");

  const result = readResult(cwd, commandOperationId);
  assert.equal(result.operationId, commandOperationId);
  assert.deepEqual(result.files.map((entry) => entry.target).sort(), operation.filePlan.map((entry) => entry.target).sort());

  const event = listEventDocuments(cwd).find((entry) => entry.operationId === commandOperationId);
  assert.ok(event);
  assert.equal(event.type, "discovery.proposed");
  assert.equal(event.payload.operationId, commandOperationId);
}

// Human approval E2E: blocked autonomy and later policy drift do not block human review.
{
  const cwd = freshWorkspace();
  initWorkspace(cwd);
  applyAutonomy(cwd);
  const initial = applyInitialCatalog(cwd);
  const known = knownSource(scan(cwd), initial.sourceId);
  const blocked = commandProposal(scan(cwd), {
    ...initial,
    alternatives: [{
      command: "npm run test:unit",
      confidence: "medium",
      sourceRefs: [initial.sourceId],
      sourceFingerprintAtSelection: { [initial.sourceId]: known.confirmedFingerprint },
      requiresEnvironment: false,
      requiresSecrets: false
    }]
  });
  const operationId = proposeDiscovery(cwd, blocked);
  assert.equal(run(["changeset", "validate", operationId], cwd).code, 0);
  const operation = readOperation(operationsRoot(cwd), operationId);
  assert.equal(operation.autonomyEvaluation.autoApprovable, false);
  assert.equal(operation.autonomyEvaluation.blockedBy[0].reason, REASON_CODES.ALTERNATIVES_PRESENT);
  const autonomous = run(["changeset", "approve", operationId, "--actor", "discovery-skill", "--mode", "autonomous"], cwd);
  assert.equal(autonomous.code, 1);

  applyAutonomy(cwd, autoPolicy({ scopeMode: "pause" }));
  assert.equal(run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  assert.equal(run(["changeset", "apply", operationId, "--actor", "carlos"], cwd).code, 0);
  assert.equal(readOperation(operationsRoot(cwd), operationId).approval.mode, "human");
  assert.equal(readScope(cwd, initial.scopeId).commands.test.method, "reviewed");
}

// Autonomous approval E2E: public CLI spoof fails; trusted server context succeeds.
{
  const cwd = freshWorkspace();
  initWorkspace(cwd);
  applyAutonomy(cwd);
  const initial = applyInitialCatalog(cwd);
  const operationId = proposeDiscovery(cwd, commandProposal(scan(cwd), initial));
  assert.equal(run(["changeset", "validate", operationId], cwd).code, 0);
  assert.equal(readOperation(operationsRoot(cwd), operationId).autonomyEvaluation.autoApprovable, true);
  const spoof = run(["changeset", "approve", operationId, "--actor", "discovery-skill", "--mode", "autonomous"], cwd);
  assert.equal(spoof.code, 1, "CLI must not be able to fabricate the autonomous capability");

  runChangesetApprove({
    planningRoot: planningRoot(cwd),
    operationsRoot: operationsRoot(cwd),
    operationId,
    actor: "discovery-skill",
    mode: "autonomous",
    authorizationContext: TRUSTED_AUTOMATION_CONTEXT
  });
  assert.equal(readOperation(operationsRoot(cwd), operationId).approval.mode, "autonomous");
  assert.equal(run(["changeset", "apply", operationId, "--actor", "discovery-skill"], cwd).code, 0);
  assert.equal(readScope(cwd, initial.scopeId).commands.test.method, "inferred");
}

// Policy stale E2E: policy drift blocks autonomous approval and does not mutate catalog.
{
  const cwd = freshWorkspace();
  initWorkspace(cwd);
  applyAutonomy(cwd);
  const initial = applyInitialCatalog(cwd);
  const beforeScope = fs.readFileSync(path.join(planningRoot(cwd), "scopes", initial.scopeId, "scope.yml"), "utf8");
  const operationId = proposeDiscovery(cwd, commandProposal(scan(cwd), initial));
  assert.equal(run(["changeset", "validate", operationId], cwd).code, 0);
  applyAutonomy(cwd, autoPolicy({ scopeMode: "pause" }));

  assert.throws(() => runChangesetApprove({
    planningRoot: planningRoot(cwd),
    operationsRoot: operationsRoot(cwd),
    operationId,
    actor: "discovery-skill",
    mode: "autonomous",
    authorizationContext: TRUSTED_AUTOMATION_CONTEXT
  }));
  const stale = readOperation(operationsRoot(cwd), operationId);
  assert.equal(stale.status, "STALE");
  assert.equal(stale.history.at(-1).reason, REASON_CODES.POLICY_CHANGED_SINCE_VALIDATION);
  assert.equal(fs.readFileSync(path.join(planningRoot(cwd), "scopes", initial.scopeId, "scope.yml"), "utf8"), beforeScope);
  assert.equal(run(["check", "schema"], cwd).json.status, "PASS");
}

// Workspace stale E2E: apply precondition stops before staging and requires a new operation.
{
  const cwd = freshWorkspace();
  initWorkspace(cwd);
  applyAutonomy(cwd);
  writePackage(cwd, "web");
  const operationId = proposeDiscovery(cwd, addScopeAndSourceProposal(scan(cwd), {
    key: "web",
    label: "Web",
    scopePath: "web/",
    sourcePath: "web/package.json"
  }));
  const changeSet = readChangeSet(operationsRoot(cwd), operationId);
  const sourceId = changeSet.payload.sourceIdAssignments[0].sourceId;
  const scopeId = changeSet.payload.scopeIdAssignments[0].scopeId;
  assert.equal(run(["changeset", "validate", operationId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  fs.writeFileSync(path.join(cwd, "web", "package.json"), "{\"changed\":true}\n");
  const staleApply = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
  assert.equal(staleApply.code, 1);
  assert.equal(readOperation(operationsRoot(cwd), operationId).status, "STALE");
  assert.equal(fs.existsSync(path.join(planningRoot(cwd), "sources", sourceId, "source.yml")), false);
  assert.equal(fs.existsSync(path.join(planningRoot(cwd), "scopes", scopeId, "scope.yml")), false);
  assert.equal(fs.existsSync(path.join(planningRoot(cwd), ".runtime", "operations", operationId)), false);

  const retryId = proposeDiscovery(cwd, addScopeAndSourceProposal(scan(cwd), {
    key: "web",
    label: "Web",
    scopePath: "web/",
    sourcePath: "web/package.json"
  }));
  assert.notEqual(retryId, operationId);
  assert.equal(run(["changeset", "validate", retryId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", retryId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  assert.equal(run(["changeset", "apply", retryId, "--actor", "carlos"], cwd).code, 0);
  assert.equal(readOperation(operationsRoot(cwd), operationId).status, "STALE");
  assert.equal(run(["check", "schema"], cwd).json.status, "PASS");
}

// Real unreadable-source E2E when the host can enforce POSIX file permissions.
// Root and Windows keep the deterministic injected-EACCES unit coverage instead.
if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0) {
  const cwd = freshWorkspace("discovery-unreadable-e2e-");
  initWorkspace(cwd);
  writePackage(cwd, "api", "{\"name\":\"api\"}\n");
  const unreadablePath = path.join(cwd, "api", "package.json");
  fs.chmodSync(unreadablePath, 0o000);
  try {
    const scanned = run(["discover", "scan", "--max-source-bytes", "1048576"], cwd);
    assert.equal(scanned.code, 0);
    assert.ok(scanned.json.diagnostics.some((entry) => entry.code === "unreadable" && entry.path === "api/package.json"), "real unreadable source must produce a hard diagnostic");
    assert.equal(scanned.json.sourceCandidates.some((entry) => entry.path === "api/package.json"), false, "an unreadable candidate must not be emitted as successfully observed evidence");
  } finally {
    fs.chmodSync(unreadablePath, 0o600);
  }
} else {
  console.log("discovery-e2e: unreadable-source OS-permission case skipped (root/Windows); injected EACCES coverage remains active");
}

console.log("discovery-e2e: public Discovery semantics, human/autonomous approval, stale policy, workspace stale, and unreadable-source paths pass");
