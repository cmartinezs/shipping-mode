import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const scopeId = "018f4d1e-0000-7000-8000-000000000001";
const srcAdd = "018f4d1e-0000-7000-8000-000000000002"; // used only in comments; add entries never carry sourceId
const srcUpdate = "018f4d1e-0000-7000-8000-000000000003";
const srcMove = "018f4d1e-0000-7000-8000-000000000004";
const srcRemove = "018f4d1e-0000-7000-8000-000000000005";

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

assert.equal(validate("discovery-proposal", baseProposal()).valid, true, "an empty-but-structurally-complete proposal must be valid");

// scopes[]
assert.equal(validate("discovery-proposal", baseProposal({
  scopes: [{ key: "api", label: "API", kind: "code", path: "api/", owner: null }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  scopes: [{ key: "api", label: "API", kind: "code" }] // missing required path
})).valid, false);

// sources[]: add
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{
    action: "add", path: "docs/adr/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64)
  }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "add", sourceId: srcAdd, path: "docs/adr/", family: "decision-sources", kind: "decision", role: "decision", authority: { standing: "authoritative", force: "normative" }, availability: "implemented", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, false, "add must never carry a sourceId -- one doesn't exist yet");

// sources[]: update -- classification fields optional, path forbidden entirely (move's job)
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "update", sourceId: srcUpdate, observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, true, "update with only a fingerprint refresh, no reclassification, must be valid");
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "update", sourceId: srcUpdate, family: "decision-sources", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, true, "update may optionally reclassify");
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "update", sourceId: srcUpdate, path: "docs/new/", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, false, "update must never carry path -- that is move's job exclusively");

// sources[]: move
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "move", sourceId: srcMove, fromPath: "docs/old/", path: "docs/new/", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "move", sourceId: srcMove, path: "docs/new/", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }] // missing fromPath
})).valid, false);

// sources[]: remove
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "remove", sourceId: srcRemove }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "remove", sourceId: srcRemove, path: "docs/x/" }] // remove carries nothing but sourceId
})).valid, false);

// scopeCommands[]: always inferred|reviewed, never declared
assert.equal(validate("discovery-proposal", baseProposal({
  scopeCommands: [{
    scopeId, role: "build", command: "./mvnw package", method: "reviewed", confidence: "high",
    sourceRefs: [srcUpdate], sourceFingerprintAtSelection: { [srcUpdate]: "c".repeat(64) },
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  scopeCommands: [{
    scopeId, role: "build", command: "./mvnw package", method: "declared",
    declaredBy: "carlos", declaredAt: "2026-07-25T10:00:00Z", declaredOperationId: srcUpdate,
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  }]
})).valid, false, "declared commands never belong in a DiscoveryProposal");
assert.equal(validate("discovery-proposal", baseProposal({
  scopeCommands: [{
    scopeId, role: "custom.e2e", command: "npm run e2e", method: "inferred", confidence: "medium",
    sourceRefs: [srcUpdate], sourceFingerprintAtSelection: { [srcUpdate]: "c".repeat(64) },
    requiresEnvironment: true, requiresSecrets: false, alternatives: []
  }]
})).valid, true, "custom.<name> roles are accepted");
assert.equal(validate("discovery-proposal", baseProposal({
  scopeCommands: [{
    scopeId, role: "not-a-real-role", command: "x", method: "inferred", confidence: "high",
    sourceRefs: [srcUpdate], sourceFingerprintAtSelection: { [srcUpdate]: "c".repeat(64) },
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  }]
})).valid, false);

console.log("discovery-proposal-schema: envelope, 4-way source action union, and inferred|reviewed-only scopeCommands all pass");
