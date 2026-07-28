import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { deriveUniqueReleaseDisplayId, isReleaseDisplayId, releaseDisplayIdForUuid } from "../releaseIdentity.mjs";
import { resolveReleaseReference } from "../releaseStore.mjs";

const releaseId = "018f0000-0000-7000-8000-000000000123";
assert.equal(releaseDisplayIdForUuid(releaseId), "REL-018F0000");
assert.equal(isReleaseDisplayId("REL-018F0000"), true);
assert.equal(isReleaseDisplayId("draft-slug"), false);

assert.deepEqual(deriveUniqueReleaseDisplayId(releaseId, []), {
  displayId: "REL-018F0000",
  length: 8,
  collisionResolved: false
});
assert.equal(
  deriveUniqueReleaseDisplayId(releaseId, [{ id: "018f0000-0000-7000-8000-000000000999", displayId: "REL-018F0000" }]).displayId,
  "REL-018F00000000",
  "real display ID collisions must extend deterministically before persist"
);

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-resolve-"));
const releaseDir = path.join(planningRoot, "releases", releaseId);
fs.mkdirSync(releaseDir, { recursive: true });
fs.writeFileSync(path.join(releaseDir, "release.yml"), stringifyYaml({
  schemaVersion: 1,
  id: releaseId,
  displayId: "REL-018F0000",
  displayIdStatus: "ACTIVE",
  slug: "decorative",
  title: "Core",
  objective: "Create release core",
  status: "DRAFT",
  lane: { id: "main" },
  policy: { mode: "strict_sequence", previousReleaseRefs: [], dependencyRefs: [] },
  scopeRefs: [],
  itemRefs: [],
  blockers: [],
  risks: [],
  deploymentEvents: [],
  finalization: { completed: false, completedAt: null, completedBy: null, retrospectiveStatus: "not_started" },
  audit: { createdAt: "2026-07-28T00:00:00.000Z", createdBy: "carlos", updatedAt: "2026-07-28T00:00:00.000Z", updatedBy: "carlos", operationId: releaseId, revision: `sha256:${"a".repeat(64)}` }
}));

assert.equal(resolveReleaseReference(planningRoot, releaseId).status, "FOUND");
assert.equal(resolveReleaseReference(planningRoot, "REL-018F0000").status, "FOUND");
assert.equal(resolveReleaseReference(planningRoot, "decorative").status, "NOT_FOUND", "slug must not resolve as an identity");

const secondId = "018f0000-0000-7000-8000-000000000124";
fs.mkdirSync(path.join(planningRoot, "releases", secondId), { recursive: true });
fs.copyFileSync(path.join(releaseDir, "release.yml"), path.join(planningRoot, "releases", secondId, "release.yml"));
assert.equal(resolveReleaseReference(planningRoot, "REL-018F0000").status, "AMBIGUOUS", "ambiguous display ID must fail closed");

console.log("release-identity: all tests passed");
