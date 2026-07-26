// runtime/src/lib/tests/discovery-proposal-removal-integrity.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { checkRemovalReferentialIntegrity } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-removal-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "scopes"), { recursive: true });
  return { planningRoot };
}

function writeConfirmedScope(planningRoot, scopeId, commands) {
  const dir = path.join(planningRoot, "scopes", scopeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "scope.yml"), stringifyYaml({
    schemaVersion: 1, id: scopeId, key: "api", label: "API", kind: "code", path: "api/", owner: null, commands
  }));
}

const scopeId = "018f4d1e-0000-7000-8000-000000000001";
const removedId = "018f4d1e-0000-7000-8000-000000000002";
const unrelatedId = "018f4d1e-0000-7000-8000-000000000003";

function confirmedCommand(sourceId) {
  return {
    build: {
      command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [sourceId], sourceFingerprintAtSelection: { [sourceId]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }
  };
}

// remove with no references anywhere -> ok
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedScope(planningRoot, scopeId, confirmedCommand(unrelatedId));
  const proposal = { sources: [{ action: "remove", sourceId: removedId }], scopeCommands: [] };
  assert.equal(checkRemovalReferentialIntegrity({ proposal, planningRoot }).ok, true);
}

// remove referenced by the CONFIRMED catalog, untouched by this proposal -> rejected
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedScope(planningRoot, scopeId, confirmedCommand(removedId));
  const proposal = { sources: [{ action: "remove", sourceId: removedId }], scopeCommands: [] };
  const result = checkRemovalReferentialIntegrity({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "remove_still_referenced" && e.sourceId === removedId));
}

// remove referenced by the confirmed catalog, BUT the same proposal also updates that command
// away from the removed source -> ok (the proposal reconciles it in the same batch)
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedScope(planningRoot, scopeId, confirmedCommand(removedId));
  const proposal = {
    sources: [{ action: "remove", sourceId: removedId }],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [unrelatedId], sourceFingerprintAtSelection: { [unrelatedId]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  };
  assert.equal(checkRemovalReferentialIntegrity({ proposal, planningRoot }).ok, true);
}

// remove referenced by this proposal's OWN scopeCommands[] -- self-contradictory, rejected
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "remove", sourceId: removedId }],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [removedId], sourceFingerprintAtSelection: { [removedId]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  };
  const result = checkRemovalReferentialIntegrity({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "remove_still_referenced" && e.sourceId === removedId));
}

// remove referenced only inside an alternatives[] entry (not the selected command) -- still caught
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "remove", sourceId: removedId }],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [unrelatedId], sourceFingerprintAtSelection: { [unrelatedId]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false,
      alternatives: [{ command: "./alt", sourceRefs: [removedId], sourceFingerprintAtSelection: { [removedId]: "a".repeat(64) }, confidence: "medium", requiresEnvironment: false, requiresSecrets: false }]
    }]
  };
  const result = checkRemovalReferentialIntegrity({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "remove_still_referenced" && e.sourceId === removedId));
}

console.log("discovery-proposal-removal-integrity: unreferenced removes pass, references in the confirmed catalog or the proposal's own commands (including alternatives) are rejected unless reconciled in the same proposal");
