import assert from "node:assert/strict";
import { validateProposalStructure } from "../discoveryProposal.mjs";

const scopeId = "018f4d1e-0000-7000-8000-000000000001";
const srcA = "018f4d1e-0000-7000-8000-000000000002";
const srcB = "018f4d1e-0000-7000-8000-000000000003";

function baseProposal(overrides = {}) {
  return {
    schemaVersion: 1,
    scanId: "018f4d1e-0000-7000-8000-000000000000",
    baseRevision: { vcsRevision: "git:" + "a".repeat(40), workspaceHash: "b".repeat(64) },
    scanParameters: { maxSourceBytes: 536870912 },
    scopes: [],
    sources: [],
    scopeCommands: [],
    diagnostics: [],
    ...overrides
  };
}

// schema-invalid proposal -> rejected with a schema_invalid error
{
  const result = validateProposalStructure({ ...baseProposal(), extraField: "not allowed" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "schema_invalid"));
}

// scanParameters out of range -> rejected
{
  const result = validateProposalStructure(baseProposal({ scanParameters: { maxSourceBytes: 100 } }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "scan_parameters_out_of_range"));
}
{
  const result = validateProposalStructure(baseProposal({ scanParameters: { maxSourceBytes: 3 * 1024 * 1024 * 1024 } }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "scan_parameters_out_of_range"));
}

// duplicate sourceId across two sources[] entries -> rejected
{
  const result = validateProposalStructure(baseProposal({
    sources: [
      { action: "update", sourceId: srcA, observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) },
      { action: "remove", sourceId: srcA }
    ]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "duplicate_source_action" && e.sourceId === srcA));
}

// duplicate (scopeId, role) across two scopeCommands[] entries -> rejected
{
  const entry = {
    scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
    sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64) },
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  };
  const result = validateProposalStructure(baseProposal({ scopeCommands: [entry, { ...entry, command: "./y" }] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "duplicate_scope_command" && e.scopeId === scopeId && e.role === "build"));
}

// sourceFingerprintAtSelection/sourceRefs key mismatch (reuses findCommandFingerprintKeyMismatches) -> rejected
{
  const result = validateProposalStructure(baseProposal({
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64), [srcB]: "d".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "fingerprint_key_mismatch"));
}

// fully valid, structurally complete proposal -> ok
{
  const result = validateProposalStructure(baseProposal({
    sources: [{ action: "update", sourceId: srcA, observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  }));
  assert.deepEqual(result, { ok: true });
}

console.log("discovery-proposal-structure: schema errors, scanParameters range, duplicate detection, and fingerprint-key mismatch all pass, collecting every error rather than stopping at the first");
