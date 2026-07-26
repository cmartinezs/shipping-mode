// runtime/src/lib/tests/discovery-proposal-drift-reconciliation.test.mjs
import assert from "node:assert/strict";
import { checkDriftReconciliation } from "../discoveryProposal.mjs";

const srcA = "018f4d1e-0000-7000-8000-000000000001";
const scopeId = "018f4d1e-0000-7000-8000-000000000002";

// unchanged source, current command evidence -> nothing to reconcile, ok even with an empty proposal
{
  const freshScan = {
    knownSources: [{ sourceId: srcA, driftState: "unchanged" }],
    knownCommandsEvidence: [{ scopeId, role: "build", evidenceState: "current" }]
  };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, true);
}

// not-evidence-backed (declared) command never needs reconciliation, regardless of anything else
{
  const freshScan = {
    knownSources: [],
    knownCommandsEvidence: [{ scopeId, role: "test", evidenceState: "not-evidence-backed" }]
  };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, true);
}

// changed source, unaddressed -> rejected
{
  const freshScan = { knownSources: [{ sourceId: srcA, driftState: "changed" }], knownCommandsEvidence: [] };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unreconciled_source_drift" && e.sourceId === srcA));
}

// changed source, addressed via an update action -> ok
{
  const freshScan = { knownSources: [{ sourceId: srcA, driftState: "changed" }], knownCommandsEvidence: [] };
  const proposal = { sources: [{ action: "update", sourceId: srcA, observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }], scopeCommands: [] };
  const result = checkDriftReconciliation({ proposal, freshScan });
  assert.equal(result.ok, true);
}

// missing source, addressed via remove -> ok
{
  const freshScan = { knownSources: [{ sourceId: srcA, driftState: "missing" }], knownCommandsEvidence: [] };
  const proposal = { sources: [{ action: "remove", sourceId: srcA }], scopeCommands: [] };
  const result = checkDriftReconciliation({ proposal, freshScan });
  assert.equal(result.ok, true);
}

// moved source, unaddressed -> rejected
{
  const freshScan = { knownSources: [{ sourceId: srcA, driftState: "moved", observedAtPath: "docs/new/" }], knownCommandsEvidence: [] };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unreconciled_source_drift" && e.sourceId === srcA));
}

// evidence-drifted command, unaddressed -> rejected
{
  const freshScan = { knownSources: [], knownCommandsEvidence: [{ scopeId, role: "build", evidenceState: "evidence-drifted" }] };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unreconciled_command_evidence" && e.scopeId === scopeId && e.role === "build"));
}

// evidence-updated command, addressed by re-selecting it in scopeCommands -> ok
{
  const freshScan = { knownSources: [], knownCommandsEvidence: [{ scopeId, role: "build", evidenceState: "evidence-updated" }] };
  const proposal = {
    sources: [],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  };
  const result = checkDriftReconciliation({ proposal, freshScan });
  assert.equal(result.ok, true);
}

// an evidenceState this code has never seen before (not one of the six discoverScan.mjs
// actually emits) must still block by default -- this is a fail-closed check, not an allowlist
// of known-bad states that a future addition could silently slip past
{
  const freshScan = { knownSources: [], knownCommandsEvidence: [{ scopeId, role: "build", evidenceState: "some-future-evidence-state" }] };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unreconciled_command_evidence" && e.evidenceState === "some-future-evidence-state"));
}

console.log("discovery-proposal-drift-reconciliation: unaddressed source/command drift is rejected, addressed drift and not-evidence-backed commands pass, and an unrecognized evidenceState fails closed rather than silently passing");
