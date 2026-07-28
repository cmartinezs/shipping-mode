import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { revisionHash } from "../canonical.mjs";
import { deriveUniqueReleaseDisplayId, isReleaseDisplayId, releaseDisplayIdForUuid } from "../releaseIdentity.mjs";
import { resolveReleaseReference } from "../releaseStore.mjs";

function releaseDocument(id, displayId) {
  const withoutRevision = {
    schemaVersion: 1, id, displayId, displayIdStatus: "ACTIVE", slug: "decorative", title: "Core", objective: "Create release core", status: "DRAFT",
    lane: { id: "main" }, policy: { mode: "strict_sequence", previousReleaseRefs: [], dependencyRefs: [] }, scopeRefs: [], itemRefs: [], blockers: [], risks: [], deploymentEvents: [],
    finalization: { completed: false, completedAt: null, completedBy: null, retrospectiveStatus: "not_started" },
    audit: { createdAt: "2026-07-28T00:00:00.000Z", createdBy: "carlos", updatedAt: "2026-07-28T00:00:00.000Z", updatedBy: "carlos", operationId: id }
  };
  return { ...withoutRevision, audit: { ...withoutRevision.audit, revision: `sha256:${revisionHash(withoutRevision)}` } };
}

const releaseId = "018f0000-0000-7000-8000-000000000123";
const sameTimestampPrefixId = "018f0000-0000-7000-8000-000000000124";
const displayId = releaseDisplayIdForUuid(releaseId);
assert.match(displayId, /^REL-[0-9A-HJKMNP-TV-Z]{8}$/);
assert.notEqual(displayId, "REL-018F0000", "display ID must hash the UUID instead of exposing UUIDv7 timestamp bits");
assert.notEqual(displayId, releaseDisplayIdForUuid(sameTimestampPrefixId), "UUIDv7 values sharing timestamp bits must still get distinct compact display IDs");
assert.equal(isReleaseDisplayId(displayId), true);
assert.equal(isReleaseDisplayId("draft-slug"), false);
assert.deepEqual(deriveUniqueReleaseDisplayId(releaseId, []), { displayId, length: 8, collisionResolved: false });
assert.equal(deriveUniqueReleaseDisplayId(releaseId, [{ id: sameTimestampPrefixId, displayId }]).displayId, releaseDisplayIdForUuid(releaseId, 12));

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-resolve-"));
const releaseDir = path.join(planningRoot, "releases", releaseId);
fs.mkdirSync(releaseDir, { recursive: true });
fs.writeFileSync(path.join(releaseDir, "release.yml"), stringifyYaml(releaseDocument(releaseId, displayId)));
assert.equal(resolveReleaseReference(planningRoot, releaseId).status, "FOUND");
assert.equal(resolveReleaseReference(planningRoot, displayId).status, "FOUND");
assert.equal(resolveReleaseReference(planningRoot, "decorative").status, "NOT_FOUND", "slug must not resolve as an identity");

const secondId = sameTimestampPrefixId;
const secondDir = path.join(planningRoot, "releases", secondId);
fs.mkdirSync(secondDir, { recursive: true });
fs.writeFileSync(path.join(secondDir, "release.yml"), stringifyYaml(releaseDocument(secondId, displayId)));
assert.equal(resolveReleaseReference(planningRoot, displayId).status, "AMBIGUOUS", "ambiguous display ID must fail closed before selecting a release");
fs.rmSync(secondDir, { recursive: true, force: true });

const tampered = releaseDocument(releaseId, releaseDisplayIdForUuid(secondId));
fs.writeFileSync(path.join(releaseDir, "release.yml"), stringifyYaml(tampered));
assert.equal(resolveReleaseReference(planningRoot, releaseId).status, "INVALID", "valid-looking but non-derived display IDs must fail aggregate integrity");

console.log("release-identity: hashed Crockford IDs, collision extension, safe resolution and integrity checks pass");
