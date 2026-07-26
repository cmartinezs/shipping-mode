import assert from "node:assert/strict";
import { validateProposalStructure } from "../discoveryProposal.mjs";

const scopeId = "018f4d1e-0000-7000-8000-000000000001";
const srcA = "018f4d1e-0000-7000-8000-000000000002";
const srcB = "018f4d1e-0000-7000-8000-000000000003";
const srcC = "018f4d1e-0000-7000-8000-000000000004";

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

// schema-invalid proposal -> rejected with a schema_invalid error whose location is reported as
// "pointer" (a JSON pointer into the document), never "path" -- "path" is reserved elsewhere in
// this errors[] array for filesystem paths, and the two must never be confused
{
  const result = validateProposalStructure({ ...baseProposal(), extraField: "not allowed" });
  assert.equal(result.ok, false);
  const schemaError = result.errors.find((e) => e.code === "schema_invalid");
  assert.ok(schemaError);
  assert.equal(typeof schemaError.pointer, "string");
  assert.equal("path" in schemaError, false);
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

// regression: two scopeCommands[] entries sharing the same (scopeId, role) -- already flagged
// by duplicate_scope_command -- must NOT let the later entry shadow the earlier one when
// checking fingerprint-key mismatches. Both entries have their own, distinct mismatch (extra
// srcB on the first, extra srcC on the second), so both must be reported.
{
  const result = validateProposalStructure(baseProposal({
    scopeCommands: [
      {
        scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
        sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64), [srcB]: "d".repeat(64) },
        requiresEnvironment: false, requiresSecrets: false, alternatives: []
      },
      {
        scopeId, role: "build", command: "./y", method: "reviewed", confidence: "high",
        sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64), [srcC]: "d".repeat(64) },
        requiresEnvironment: false, requiresSecrets: false, alternatives: []
      }
    ]
  }));
  assert.equal(result.ok, false);
  const mismatches = result.errors.filter((e) => e.code === "fingerprint_key_mismatch");
  assert.equal(mismatches.length, 2);
  assert.ok(mismatches.some((e) => e.extra.includes(srcB)));
  assert.ok(mismatches.some((e) => e.extra.includes(srcC)));
}

// duplicate key across two scopes[] entries -> rejected
{
  const scopeEntry = { key: "api", label: "API", kind: "code", path: "api/", owner: null };
  const result = validateProposalStructure(baseProposal({ scopes: [scopeEntry, { ...scopeEntry, label: "API again" }] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "duplicate_scope_key" && e.key === "api"));
}

// an alternative whose (command, sourceRefs) matches the SELECTED command -> rejected
{
  const result = validateProposalStructure(baseProposal({
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false,
      alternatives: [{ command: "./x", sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64) }, confidence: "medium", requiresEnvironment: false, requiresSecrets: false }]
    }]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "duplicate_alternative_key" && e.scopeId === scopeId && e.role === "build"));
}

// two alternatives sharing (command, sourceRefs) with each other (not with the selected command) -> rejected
{
  const result = validateProposalStructure(baseProposal({
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false,
      alternatives: [
        { command: "./alt", sourceRefs: [srcB], sourceFingerprintAtSelection: { [srcB]: "c".repeat(64) }, confidence: "medium", requiresEnvironment: false, requiresSecrets: false },
        { command: "./alt", sourceRefs: [srcB], sourceFingerprintAtSelection: { [srcB]: "c".repeat(64) }, confidence: "low", requiresEnvironment: false, requiresSecrets: false }
      ]
    }]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "duplicate_alternative_key" && e.scopeId === scopeId && e.role === "build"));
}

// an alternative whose sourceRefs are the SAME SET as the selected command's but listed in a
// different order is still the same identity -> rejected (order must never matter)
{
  const result = validateProposalStructure(baseProposal({
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA, srcB], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64), [srcB]: "d".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false,
      alternatives: [{ command: "./x", sourceRefs: [srcB, srcA], sourceFingerprintAtSelection: { [srcB]: "d".repeat(64), [srcA]: "c".repeat(64) }, confidence: "medium", requiresEnvironment: false, requiresSecrets: false }]
    }]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "duplicate_alternative_key" && e.scopeId === scopeId && e.role === "build"));
}

// an alternative with the same command string but DIFFERENT sourceRefs as the selected command
// (or another alternative) is a genuinely distinct choice, not a collision -> ok
{
  const result = validateProposalStructure(baseProposal({
    sources: [{ action: "update", sourceId: srcA, observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false,
      alternatives: [{ command: "./x", sourceRefs: [srcB], sourceFingerprintAtSelection: { [srcB]: "c".repeat(64) }, confidence: "medium", requiresEnvironment: false, requiresSecrets: false }]
    }]
  }));
  assert.deepEqual(result, { ok: true });
}

// multiple simultaneous DIFFERENT relational violations -> both codes come back together,
// proving "collects everything" isn't just true by inspection of a single-violation case
{
  const result = validateProposalStructure(baseProposal({
    scanParameters: { maxSourceBytes: 100 },
    sources: [
      { action: "update", sourceId: srcA, observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) },
      { action: "remove", sourceId: srcA }
    ]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "scan_parameters_out_of_range"));
  assert.ok(result.errors.some((e) => e.code === "duplicate_source_action" && e.sourceId === srcA));
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

console.log("discovery-proposal-structure: schema errors, scanParameters range, duplicate detection (sources, scopeCommands, scope keys, alternative keys), and fingerprint-key mismatch all pass, collecting every error rather than stopping at the first");
