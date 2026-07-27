import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { contentHash } from "../src/lib/canonical.mjs";
import { parseYaml } from "../src/lib/yaml.mjs";
import { isUuidV7 } from "../src/lib/ids.mjs";
import { readChangeSet, readOperation } from "../src/lib/operationStore.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "bin", "shipping-mode.mjs");
const testBundle = path.join(root, "runtime", "dist", "shipping-mode.test-bundle.mjs");

function run(args, cwd, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", ...options });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.status, json: JSON.parse(error.stdout) };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${filePath}`);
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

function listEventDocuments(cwd) {
  const eventsRoot = path.join(planningRoot(cwd), "events");
  if (!fs.existsSync(eventsRoot)) return [];
  const docs = [];
  for (const year of fs.readdirSync(eventsRoot)) {
    for (const month of fs.readdirSync(path.join(eventsRoot, year))) {
      for (const file of fs.readdirSync(path.join(eventsRoot, year, month))) {
        if (file.endsWith(".json")) {
          docs.push(JSON.parse(fs.readFileSync(path.join(eventsRoot, year, month, file), "utf8")));
        }
      }
    }
  }
  return docs;
}

function snapshot(cwd, operationId) {
  function hashIfExists(relativePath) {
    const absolutePath = path.join(planningRoot(cwd), relativePath);
    return fs.existsSync(absolutePath) ? contentHash(fs.readFileSync(absolutePath)) : "ABSENT";
  }
  const config = readConfig(cwd);
  const sourceIds = fs.existsSync(path.join(planningRoot(cwd), "sources"))
    ? fs.readdirSync(path.join(planningRoot(cwd), "sources")).filter(isUuidV7).sort()
    : [];
  const scopeIds = fs.existsSync(path.join(planningRoot(cwd), "scopes"))
    ? fs.readdirSync(path.join(planningRoot(cwd), "scopes")).filter(isUuidV7).sort()
    : [];
  return {
    config,
    sources: sourceIds.map((id) => readSource(cwd, id)),
    scopes: scopeIds.map((id) => readScope(cwd, id)),
    operation: hashIfExists(path.join("operations", operationId, "operation.yml")),
    result: hashIfExists(path.join("operations", operationId, "result.json")),
    events: listEventDocuments(cwd).map((event) => ({ eventId: event.eventId, operationId: event.operationId, type: event.type })).sort((a, b) => a.eventId.localeCompare(b.eventId))
  };
}

function initWorkspace(cwd) {
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  assert.equal(init.code, 0);
  assert.equal(run(["changeset", "validate", init.json.operationId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", init.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  assert.equal(run(["changeset", "apply", init.json.operationId, "--actor", "carlos"], cwd).code, 0);
}

function scan(cwd) {
  const scanned = run(["discover", "scan", "--max-source-bytes", "1048576"], cwd);
  assert.equal(scanned.code, 0);
  return scanned.json;
}

function proposeDiscovery(cwd, proposal) {
  const proposalFile = path.join(cwd, `proposal-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(proposalFile, JSON.stringify(proposal));
  const proposed = run(["discover", "propose", "--file", proposalFile, "--actor", "carlos"], cwd);
  fs.rmSync(proposalFile, { force: true });
  assert.equal(proposed.code, 0, JSON.stringify(proposed.json));
  return proposed.json.operationId;
}

function packageCandidate(scanResult, relativePath) {
  const candidate = scanResult.sourceCandidates.find((entry) => entry.path === relativePath);
  assert.ok(candidate, `scan must find ${relativePath}`);
  return candidate;
}

function readmeCandidate(scanResult) {
  const candidate = scanResult.sourceCandidates.find((entry) => entry.path === "README.md");
  assert.ok(candidate, "scan must find README.md");
  return candidate;
}

function initialProposal(scanResult) {
  const api = packageCandidate(scanResult, "api/package.json");
  return {
    schemaVersion: 1,
    scanId: scanResult.scanId,
    baseRevision: scanResult.baseRevision,
    scanParameters: scanResult.scanParameters,
    scopes: [{ key: "api", label: "API", kind: "code", path: "api/", owner: null }],
    sources: [{
      action: "add",
      path: api.path,
      family: "project-module-manifests",
      kind: "repository-map",
      role: "evidence",
      authority: { standing: "supporting", force: "informational" },
      availability: "implemented",
      observedFingerprint: api.observedFingerprint,
      observedContentHash: api.observedContentHash
    }],
    scopeCommands: [],
    diagnostics: []
  };
}

function multiMutationProposal(scanResult, { apiSourceId, apiScopeId }) {
  const knownApi = scanResult.knownSources.find((entry) => entry.sourceId === apiSourceId);
  assert.ok(knownApi);
  const web = packageCandidate(scanResult, "web/package.json");
  const readme = readmeCandidate(scanResult);
  return {
    schemaVersion: 1,
    scanId: scanResult.scanId,
    baseRevision: scanResult.baseRevision,
    scanParameters: scanResult.scanParameters,
    scopes: [{ key: "web", label: "Web", kind: "code", path: "web/", owner: null }],
    sources: [{
      action: "update",
      sourceId: apiSourceId,
      observedFingerprint: knownApi.observedFingerprint,
      observedContentHash: knownApi.observedContentHash
    }, {
      action: "add",
      path: web.path,
      family: "project-module-manifests",
      kind: "repository-map",
      role: "evidence",
      authority: { standing: "supporting", force: "informational" },
      availability: "implemented",
      observedFingerprint: web.observedFingerprint,
      observedContentHash: web.observedContentHash
    }, {
      action: "add",
      path: readme.path,
      family: "agent-repository-instructions",
      kind: "agent-instructions",
      role: "evidence",
      authority: { standing: "supporting", force: "informational" },
      availability: "implemented",
      observedFingerprint: readme.observedFingerprint,
      observedContentHash: readme.observedContentHash
    }],
    scopeCommands: [{
      scopeId: apiScopeId,
      role: "test",
      command: "npm test",
      method: "reviewed",
      confidence: "high",
      sourceRefs: [apiSourceId],
      sourceFingerprintAtSelection: { [apiSourceId]: knownApi.confirmedFingerprint },
      requiresEnvironment: false,
      requiresSecrets: false,
      alternatives: []
    }],
    diagnostics: []
  };
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-real-crash-e2e-"));
initWorkspace(cwd);
fs.mkdirSync(path.join(cwd, "api"), { recursive: true });
fs.writeFileSync(path.join(cwd, "api", "package.json"), "{}\n");

const initialOperationId = proposeDiscovery(cwd, initialProposal(scan(cwd)));
assert.equal(run(["changeset", "validate", initialOperationId], cwd).code, 0);
assert.equal(run(["changeset", "approve", initialOperationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
assert.equal(run(["changeset", "apply", initialOperationId, "--actor", "carlos"], cwd).code, 0);
const initialChangeSet = readChangeSet(operationsRoot(cwd), initialOperationId);
const apiSourceId = initialChangeSet.payload.sourceIdAssignments[0].sourceId;
const apiScopeId = initialChangeSet.payload.scopeIdAssignments[0].scopeId;

fs.mkdirSync(path.join(cwd, "web"), { recursive: true });
fs.writeFileSync(path.join(cwd, "web", "package.json"), "{\"name\":\"web\"}\n");
fs.writeFileSync(path.join(cwd, "README.md"), "# Demo\n");

const operationId = proposeDiscovery(cwd, multiMutationProposal(scan(cwd), { apiSourceId, apiScopeId }));
assert.equal(run(["changeset", "validate", operationId], cwd).code, 0);
assert.equal(run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);

const crashMarker = path.join(os.tmpdir(), `shipping-mode-crash-${process.pid}-${Date.now()}.json`);
const crashScript = `
  import { dispatch } from ${JSON.stringify(testBundle)};
  dispatch("changeset", ["apply", ${JSON.stringify(operationId)}, "--actor", "carlos"], ${JSON.stringify(cwd)});
`;
const child = spawn(process.execPath, ["--input-type=module", "-e", crashScript], {
  cwd,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    SHIPPING_MODE_FAULT_CHECKPOINT: "AFTER_FIRST_RENAME",
    SHIPPING_MODE_FAULT_MODE: "wait-for-kill",
    SHIPPING_MODE_FAULT_MARKER: crashMarker
  }
});

const marker = await waitForFile(crashMarker);
assert.equal(marker.checkpoint, "AFTER_FIRST_RENAME");
assert.equal(marker.pid, child.pid);
process.kill(child.pid, "SIGKILL");
const exit = await new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
assert.equal(exit.signal, "SIGKILL", "parent test must kill the apply process from outside");
fs.rmSync(crashMarker, { force: true });

const lockDir = path.join(planningRoot(cwd), ".runtime", "workspace.lock");
assert.equal(fs.existsSync(path.join(lockDir, "lock.json")), true, "killed process must leave a dead lock");

const crashedOperation = readOperation(operationsRoot(cwd), operationId);
assert.equal(crashedOperation.status, "APPLYING");
assert.ok(crashedOperation.filePlan.length >= 5, "Discovery crash fixture must have multiple file mutations");
assert.equal(contentHash(fs.readFileSync(path.join(planningRoot(cwd), crashedOperation.filePlan[0].target))), crashedOperation.filePlan[0].stagedContentHash, "first canonical mutation must have happened before the kill");
assert.equal(fs.existsSync(path.join(operationsRoot(cwd), operationId, "result.json")), false, "result must not be written before recovery");
assert.equal(listEventDocuments(cwd).filter((event) => event.operationId === operationId).length, 0, "event must not be published before recovery");
assert.equal(fs.existsSync(path.join(planningRoot(cwd), ".runtime", "operations", operationId, "staged")), true, "staged recovery data must exist after the crash");

const checkAfterCrash = run(["check", "schema"], cwd);
assert.equal(checkAfterCrash.code, 0);
assert.ok(checkAfterCrash.json.pendingOperations.some((entry) => entry.operationId === operationId && entry.status === "APPLYING"), "mixed catalog must be reported with a pending operation");

const blockedByDeadLock = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
assert.equal(blockedByDeadLock.code, 1);
assert.match(blockedByDeadLock.json.error, /dead process/);
assert.equal(fs.existsSync(path.join(lockDir, "lock.json")), true, "dead lock requires manual resolution");

fs.rmSync(lockDir, { recursive: true, force: true });
const recoveredRetry = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
assert.equal(recoveredRetry.code, 1, "recovery completes before retry observes APPLIED");
assert.match(recoveredRetry.json.error, /status APPLIED/);

const checkAfterRecovery = run(["check", "schema"], cwd);
assert.equal(checkAfterRecovery.code, 0);
assert.equal(checkAfterRecovery.json.status, "PASS");
assert.deepEqual(checkAfterRecovery.json.pendingOperations, []);

const recoveredOperation = readOperation(operationsRoot(cwd), operationId);
assert.equal(recoveredOperation.status, "APPLIED");
assert.equal(recoveredOperation.history.at(-1).actor, "system:recovery");
const result = JSON.parse(fs.readFileSync(path.join(operationsRoot(cwd), operationId, "result.json"), "utf8"));
assert.equal(result.files.length, recoveredOperation.filePlan.length);
assert.equal(listEventDocuments(cwd).filter((event) => event.operationId === operationId).length, 1);

const config = readConfig(cwd);
const webScopeRef = config.scopeRefs.find((entry) => entry.key === "web");
assert.ok(webScopeRef);
assert.equal(readScope(cwd, apiScopeId).commands.test.sourceRefs[0], apiSourceId);
assert.equal(readScope(cwd, apiScopeId).commands.test.method, "reviewed");
assert.equal(readSource(cwd, apiSourceId).provenance.confirmedOperationId, operationId);
const addedSourceIds = readChangeSet(operationsRoot(cwd), operationId).payload.sourceIdAssignments.map((entry) => entry.sourceId);
assert.equal(addedSourceIds.length, 2);
for (const sourceId of addedSourceIds) {
  const source = readSource(cwd, sourceId);
  assert.equal(source.provenance.confirmedOperationId, operationId);
  assert.equal(source.confirmedFingerprint, source.confirmedContentHash);
}

const beforeSecondRecovery = snapshot(cwd, operationId);
const secondRecovery = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
assert.equal(secondRecovery.code, 1);
assert.match(secondRecovery.json.error, /status APPLIED/);
assert.deepEqual(snapshot(cwd, operationId), beforeSecondRecovery, "second recovery pass must be semantically idempotent");

console.log("discovery-real-crash-e2e: real SIGKILL during Discovery apply recovers fully and idempotently");
