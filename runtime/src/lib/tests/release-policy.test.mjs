import assert from "node:assert/strict";
import { releasePolicyFindings, laneConfigFindings } from "../releasePolicy.mjs";
import { revisionHash } from "../canonical.mjs";
import { releaseDisplayIdForUuid } from "../releaseIdentity.mjs";

function release(id, { lane = "main", mode = "strict_sequence", previous = [], dependencies = [], status = "DRAFT" } = {}) {
  const withoutRevision = {
    schemaVersion: 1,
    id,
    displayId: releaseDisplayIdForUuid(id),
    displayIdStatus: "ACTIVE",
    slug: null,
    title: id,
    objective: id,
    status,
    lane: { id: lane },
    policy: { mode, previousReleaseRefs: previous, dependencyRefs: dependencies },
    scopeRefs: [],
    executionContextRefs: [],
    environmentRefs: [],
    itemRefs: [],
    blockers: [],
    risks: [],
    deploymentEvents: [],
    finalization: { completed: false, completedAt: null, completedBy: null, retrospectiveStatus: "not_started" },
    audit: { createdAt: "t", createdBy: "a", updatedAt: "t", updatedBy: "a", operationId: id }
  };
  return { ...withoutRevision, audit: { ...withoutRevision.audit, revision: `sha256:${revisionHash(withoutRevision)}` } };
}

const a = "018f0000-0000-7000-8000-000000000001";
const b = "018f0000-0000-7000-8000-000000000002";
const c = "018f0000-0000-7000-8000-000000000003";

assert.deepEqual(laneConfigFindings({ policies: { release: { defaultLane: "main", lanes: [{ id: "main" }] } } }, "main"), []);
assert.equal(laneConfigFindings({ policies: { release: { defaultLane: "main", lanes: [{ id: "main" }] } } }, "hotfix")[0].code, "LANE_INVALID");

assert.equal(releasePolicyFindings({
  releases: [],
  targetRelease: release(a),
  nextLaneId: "main",
  nextPolicy: { mode: "strict_sequence", previousReleaseRefs: [], dependencyRefs: [] }
}).length, 0, "first strict_sequence release may have no predecessor");

assert.ok(releasePolicyFindings({
  releases: [release(a)],
  targetRelease: release(b),
  nextLaneId: "main",
  nextPolicy: { mode: "strict_sequence", previousReleaseRefs: [], dependencyRefs: [] }
}).some((finding) => finding.code === "POLICY_VIOLATION"), "second strict_sequence release must name one predecessor");

assert.equal(releasePolicyFindings({
  releases: [release(a)],
  targetRelease: release(b),
  nextLaneId: "main",
  nextPolicy: { mode: "strict_sequence", previousReleaseRefs: [a], dependencyRefs: [] }
}).length, 0, "strict_sequence accepts one same-lane non-cancelled predecessor");

assert.ok(releasePolicyFindings({
  releases: [release(a, { status: "CANCELLED" })],
  targetRelease: release(b),
  nextLaneId: "main",
  nextPolicy: { mode: "strict_sequence", previousReleaseRefs: [a], dependencyRefs: [] }
}).some((finding) => finding.message.includes("cancelled")), "cancelled predecessors do not satisfy strict_sequence");

assert.ok(releasePolicyFindings({
  releases: [release(a, { mode: "dependency_graph", dependencies: [b] }), release(b, { mode: "dependency_graph", dependencies: [c] })],
  targetRelease: release(c, { mode: "dependency_graph" }),
  nextLaneId: "main",
  nextPolicy: { mode: "dependency_graph", previousReleaseRefs: [], dependencyRefs: [a] }
}).some((finding) => finding.code === "CYCLE_DETECTED"), "dependency_graph rejects indirect cycles deterministically");

console.log("release-policy: lanes, strict_sequence and dependency_graph invariants pass");
