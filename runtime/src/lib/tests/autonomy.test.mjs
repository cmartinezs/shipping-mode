import assert from "node:assert/strict";
import { evaluateDiscoveryProposalAutonomy, normalizeAutonomyPolicy, policyFingerprint, REASON_CODES, isAutomationCapableActor } from "../autonomy.mjs";

const sourceId = "018f0000-0000-7000-8000-000000000001";
const scopeId = "018f0000-0000-7000-8000-000000000002";

const policy = normalizeAutonomyPolicy({
  discovery: {
    default: "pause",
    scopeCommandConfidenceFloor: "high",
    sourceOverrides: [{
      family: "project-module-manifests",
      mode: "auto-approve",
      authorityCeiling: { standing: "supporting", force: "advisory" }
    }],
    scopeCommand: { mode: "auto-approve" }
  }
});

function addSource(overrides = {}) {
  return {
    action: "add",
    path: "api/package.json",
    family: "project-module-manifests",
    kind: "repository-map",
    role: "evidence",
    authority: { standing: "supporting", force: "advisory" },
    availability: "implemented",
    observedFingerprint: "a".repeat(64),
    observedContentHash: "b".repeat(64),
    ...overrides
  };
}

function confirmedSource(overrides = {}) {
  return {
    schemaVersion: 1,
    id: sourceId,
    path: "api/package.json",
    family: "project-module-manifests",
    kind: "repository-map",
    role: "evidence",
    authority: { standing: "supporting", force: "advisory" },
    availability: "implemented",
    confirmedFingerprint: "a".repeat(64),
    confirmedContentHash: "b".repeat(64),
    provenance: { discoveredBy: "discovery.propose", confirmedBy: "carlos", confirmedAt: "2026-07-26T00:00:00.000Z", confirmedOperationId: "018f0000-0000-7000-8000-000000000099" },
    ...overrides
  };
}

function command(overrides = {}) {
  return {
    scopeId,
    role: "test",
    command: "npm test",
    method: "inferred",
    confidence: "high",
    sourceRefs: [sourceId],
    sourceFingerprintAtSelection: { [sourceId]: "a".repeat(64) },
    requiresEnvironment: false,
    requiresSecrets: false,
    alternatives: [],
    ...overrides
  };
}

function evaluate(proposal, confirmedSources = []) {
  return evaluateDiscoveryProposalAutonomy({ proposal: { scopes: [], sources: [], scopeCommands: [], ...proposal }, policy, confirmedSources });
}

{
  const result = evaluate({ sources: [addSource()] });
  assert.equal(result.autoApprovable, true, "family override at exact authority ceiling is auto-approvable");
  assert.equal(result.policyFingerprint, policyFingerprint(policy));
}

{
  const result = evaluate({ sources: [addSource({ authority: { standing: "authoritative", force: "advisory" } })] });
  assert.equal(result.autoApprovable, false);
  assert.deepEqual(result.blockedBy, [{ itemRef: "sources[0]", reason: REASON_CODES.AUTHORITY_ABOVE_CEILING }]);
}

{
  const result = evaluate({ sources: [addSource({ family: "technical-sources" })] });
  assert.deepEqual(result.blockedBy, [{ itemRef: "sources[0]", reason: REASON_CODES.FAMILY_NOT_ALLOWLISTED }]);
}

{
  const pausePolicy = normalizeAutonomyPolicy({
    discovery: { ...policy.discovery, sourceOverrides: [{ family: "project-module-manifests", mode: "pause" }] }
  });
  const result = evaluateDiscoveryProposalAutonomy({ proposal: { scopes: [], sources: [addSource()], scopeCommands: [] }, policy: pausePolicy, confirmedSources: [] });
  assert.deepEqual(result.blockedBy, [{ itemRef: "sources[0]", reason: REASON_CODES.DEFAULT_PAUSE }]);
}

{
  const result = evaluate({
    sources: [{ action: "update", sourceId, authority: { standing: "supporting", force: "advisory" }, observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }]
  }, [confirmedSource({ authority: { standing: "contextual", force: "informational" } })]);
  assert.ok(result.blockedBy.some((entry) => entry.reason === REASON_CODES.AUTHORITY_ESCALATION));
}

{
  const result = evaluate({
    sources: [{ action: "update", sourceId, family: "technical-sources", observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }]
  }, [confirmedSource()]);
  assert.deepEqual(result.blockedBy, [{ itemRef: "sources[0]", reason: REASON_CODES.FAMILY_NOT_ALLOWLISTED }], "family changes are evaluated against the new family");
}

{
  for (const action of ["move", "remove"]) {
    const entry = action === "move"
      ? { action, sourceId, fromPath: "old", path: "new", observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }
      : { action, sourceId };
    assert.deepEqual(evaluate({ sources: [entry] }).blockedBy, [{ itemRef: "sources[0]", reason: REASON_CODES.DESTRUCTIVE_ACTION }]);
  }
}

{
  assert.deepEqual(evaluate({ scopes: [{ key: "api", label: "API", kind: "code", path: "api/" }] }).blockedBy, [{ itemRef: "scopes[0]", reason: REASON_CODES.NEW_SCOPE_ALWAYS_PAUSES }]);
}

{
  assert.equal(evaluate({ scopeCommands: [command({ confidence: "high" })] }, [confirmedSource()]).autoApprovable, true);
  assert.deepEqual(evaluate({ scopeCommands: [command({ confidence: "medium" })] }, [confirmedSource()]).blockedBy, [{ itemRef: `scopeCommands[${scopeId}].test`, reason: REASON_CODES.LOW_CONFIDENCE }]);
  assert.deepEqual(evaluate({ scopeCommands: [command({ confidence: "low" })] }, [confirmedSource()]).blockedBy, [{ itemRef: `scopeCommands[${scopeId}].test`, reason: REASON_CODES.LOW_CONFIDENCE }]);
}

{
  const result = evaluate({ scopeCommands: [command({ alternatives: [{ command: "npm t", sourceRefs: [sourceId], sourceFingerprintAtSelection: { [sourceId]: "a".repeat(64) }, confidence: "high", requiresEnvironment: false, requiresSecrets: false }] })] }, [confirmedSource()]);
  assert.deepEqual(result.blockedBy, [{ itemRef: `scopeCommands[${scopeId}].test`, reason: REASON_CODES.ALTERNATIVES_PRESENT }]);
}

{
  const result = evaluate({ sources: [addSource()], scopes: [{ key: "api", label: "API", kind: "code", path: "api/" }] });
  assert.equal(result.autoApprovable, false, "one blocked item blocks the whole ChangeSet");
}

{
  assert.equal(isAutomationCapableActor("cualquier-string"), false);
  assert.equal(isAutomationCapableActor("system:automation:discovery"), true);
}

console.log("autonomy: policy fingerprint, effective mode, reason codes, and actor capability pass");
