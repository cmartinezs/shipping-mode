import assert from "node:assert/strict";
import { renderReleaseReadme, compareReleaseReadme } from "../releaseProjection.mjs";

const release = {
  schemaVersion: 1,
  id: "018f0000-0000-7000-8000-000000000123",
  displayId: "REL-018F0000",
  displayIdStatus: "ACTIVE",
  slug: null,
  title: "Release Core",
  objective: "Create release aggregate core",
  status: "DRAFT",
  lane: { id: "main" },
  policy: { mode: "strict_sequence", previousReleaseRefs: [], dependencyRefs: [] },
  scopeRefs: [],
  itemRefs: [],
  blockers: [],
  risks: [],
  deploymentEvents: [],
  finalization: { completed: false, completedAt: null, completedBy: null, retrospectiveStatus: "not_started" },
  audit: { createdAt: "2026-07-28T00:00:00.000Z", createdBy: "carlos", updatedAt: "2026-07-28T00:00:00.000Z", updatedBy: "carlos", operationId: "018f0000-0000-7000-8000-000000000999", revision: `sha256:${"a".repeat(64)}` }
};

const first = renderReleaseReadme(release);
const second = renderReleaseReadme(release);
assert.equal(first, second, "Release README rendering must be deterministic");
assert.equal(compareReleaseReadme(release, first).equal, true);
assert.equal(compareReleaseReadme(release, `${first}\nmanual edit\n`).equal, false, "manual edits must be drift");
assert.match(first, /Status: DRAFT/);
assert.doesNotMatch(first, /releasable: true/);

console.log("release-projection: all tests passed");
