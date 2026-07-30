import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { releaseItemDisplayIdForUuid, deriveUniqueReleaseItemDisplayId, isReleaseItemDisplayId } from "../releaseItemIdentity.mjs";
import { resolveReleaseItemReference, updateReleaseItemRevision } from "../releaseItemStore.mjs";

function itemDocument(releaseId, id, displayId) {
  return updateReleaseItemRevision({
    schemaVersion: 1,
    id,
    displayId,
    displayIdStatus: "ACTIVE",
    releaseId,
    slug: "decorative",
    kind: "user_story",
    title: "Story",
    description: null,
    status: "DRAFT",
    actor: "operator",
    need: "create item identity",
    value: "stable references",
    acceptanceCriteria: ["identity resolves by UUID and display ID"],
    dependencies: [],
    sourceRefs: [],
    resolution: null,
    audit: { createdAt: "2026-07-29T00:00:00.000Z", createdBy: "carlos", updatedAt: "2026-07-29T00:00:00.000Z", updatedBy: "carlos", operationId: id }
  });
}

const releaseId = "018f0000-0000-7000-8000-000000000100";
const itemId = "018f0000-0000-7000-8000-000000000101";
const collisionId = "018f0000-0000-7000-8000-000000000102";
const displayId = releaseItemDisplayIdForUuid(itemId);
assert.match(displayId, /^RI-[0-9A-HJKMNP-TV-Z]{8}$/);
assert.equal(isReleaseItemDisplayId(displayId), true);
assert.equal(isReleaseItemDisplayId("ITEM-6041"), false, "legacy ITEM-* counters are not canonical identities");
assert.equal(isReleaseItemDisplayId("story-slug"), false);
assert.deepEqual(deriveUniqueReleaseItemDisplayId(itemId, []), { displayId, length: 8, collisionResolved: false });
assert.equal(deriveUniqueReleaseItemDisplayId(itemId, [{ id: collisionId, displayId }]).displayId, releaseItemDisplayIdForUuid(itemId, 12));

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-item-resolve-"));
const itemDir = path.join(planningRoot, "releases", releaseId, "items", itemId);
fs.mkdirSync(itemDir, { recursive: true });
fs.writeFileSync(path.join(itemDir, "release-item.yml"), stringifyYaml(itemDocument(releaseId, itemId, displayId)));
assert.equal(resolveReleaseItemReference(planningRoot, releaseId, itemId).status, "FOUND");
assert.equal(resolveReleaseItemReference(planningRoot, releaseId, displayId).status, "FOUND");
assert.equal(resolveReleaseItemReference(planningRoot, releaseId, "decorative").status, "NOT_FOUND", "slug must not resolve");

const collisionDir = path.join(planningRoot, "releases", releaseId, "items", collisionId);
fs.mkdirSync(collisionDir, { recursive: true });
fs.writeFileSync(path.join(collisionDir, "release-item.yml"), stringifyYaml(itemDocument(releaseId, collisionId, displayId)));
assert.equal(resolveReleaseItemReference(planningRoot, releaseId, displayId).status, "AMBIGUOUS", "ambiguous display IDs fail closed");

console.log("release-item-identity: RI display IDs, collision extension and safe resolution pass");
