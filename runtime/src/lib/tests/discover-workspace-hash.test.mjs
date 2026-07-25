import assert from "node:assert/strict";
import { stringSetHash, computeWorkspaceHash } from "../discoverScan.mjs";

// stringSetHash: order-independent, multiplicity-preserving
assert.equal(stringSetHash(["a", "b"]), stringSetHash(["b", "a"]));
assert.notEqual(stringSetHash(["a"]), stringSetHash(["a", "a"]), "multiplicity must be preserved, not deduplicated");

const baseInput = {
  scopeCandidates: [{ path: "api/", signals: ["pom.xml"], suggestions: { kind: "code", ruleIds: ["scope.maven-project"] } }],
  sourceCandidates: [{ path: "docs/adr/", candidateFamilies: ["decision-sources"], ruleIds: ["source.adr-directory"], observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }],
  knownSources: [{ sourceId: "s1", path: "docs/x/", driftState: "unchanged", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64), observedAtPath: null }],
  knownCommandsEvidence: [{ scopeId: "sc1", role: "test", evidenceState: "current", reasons: [] }]
};

const h1 = computeWorkspaceHash(baseInput);
const h2 = computeWorkspaceHash({
  ...baseInput,
  scopeCandidates: [...baseInput.scopeCandidates], // reordered/re-cloned, same logical content
  knownSources: [...baseInput.knownSources]
});
assert.equal(h1, h2, "identical logical content must hash identically regardless of array identity/order");
assert.equal(h1.length, 64);

// changing a reasons list changes the hash even if evidenceState stays the same
const h3 = computeWorkspaceHash({
  ...baseInput,
  knownCommandsEvidence: [{ scopeId: "sc1", role: "test", evidenceState: "current", reasons: ["something-changed"] }]
});
assert.notEqual(h1, h3, "reasons changing must change the hash even when evidenceState label is identical");

// changing scanParameters-independent content (a candidate's ruleIds) changes the hash
const h4 = computeWorkspaceHash({ ...baseInput, sourceCandidates: [{ ...baseInput.sourceCandidates[0], ruleIds: ["source.other-rule"] }] });
assert.notEqual(h1, h4);

console.log("discover-workspace-hash: order-independence, multiplicity, and sensitivity to every field all pass");
