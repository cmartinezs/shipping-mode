import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { workPackageDisplayIdForUuid, deriveUniqueWorkPackageDisplayId, isWorkPackageDisplayId } from "../workPackageIdentity.mjs";
import { resolveWorkPackageReference, updateWorkPackageRevision } from "../workPackageStore.mjs";

function packageDocument(releaseId, itemId, id, displayId) {
  return updateWorkPackageRevision({
    schemaVersion: 1,
    id,
    displayId,
    displayIdStatus: "ACTIVE",
    releaseId,
    releaseItemId: itemId,
    scopeId: "018f0000-0000-7000-8000-000000000200",
    title: "Package",
    description: null,
    status: "DRAFT",
    commitment: "required",
    design: null,
    interfaces: [],
    contracts: [],
    dependencies: [],
    guideRefs: [
      { scopeId: "018f0000-0000-7000-8000-000000000200", kind: "task", id: "018f0000-0000-7000-8000-000000000201", revision: `sha256:${"a".repeat(64)}`, contentHash: "b".repeat(64), state: "approved_current", usable: true, capturedAt: "2026-07-29T00:00:00.000Z" },
      { scopeId: "018f0000-0000-7000-8000-000000000200", kind: "test", id: "018f0000-0000-7000-8000-000000000202", revision: `sha256:${"c".repeat(64)}`, contentHash: "d".repeat(64), state: "approved_current", usable: true, capturedAt: "2026-07-29T00:00:00.000Z" }
    ],
    gateRequirements: [],
    risks: [],
    blockers: [],
    resolution: null,
    audit: { createdAt: "2026-07-29T00:00:00.000Z", createdBy: "carlos", updatedAt: "2026-07-29T00:00:00.000Z", updatedBy: "carlos", operationId: id }
  });
}

const releaseId = "018f0000-0000-7000-8000-000000000100";
const itemId = "018f0000-0000-7000-8000-000000000101";
const packageId = "018f0000-0000-7000-8000-000000000102";
const collisionId = "018f0000-0000-7000-8000-000000000103";
const displayId = workPackageDisplayIdForUuid(packageId);
assert.match(displayId, /^WP-[0-9A-HJKMNP-TV-Z]{8}$/);
assert.equal(isWorkPackageDisplayId(displayId), true);
assert.equal(isWorkPackageDisplayId("work-package-slug"), false);
assert.deepEqual(deriveUniqueWorkPackageDisplayId(packageId, []), { displayId, length: 8, collisionResolved: false });
assert.equal(deriveUniqueWorkPackageDisplayId(packageId, [{ id: collisionId, displayId }]).displayId, workPackageDisplayIdForUuid(packageId, 12));

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "work-package-resolve-"));
const packageDir = path.join(planningRoot, "releases", releaseId, "items", itemId, "work-packages", packageId);
fs.mkdirSync(packageDir, { recursive: true });
fs.writeFileSync(path.join(packageDir, "work-package.yml"), stringifyYaml(packageDocument(releaseId, itemId, packageId, displayId)));
assert.equal(resolveWorkPackageReference(planningRoot, releaseId, itemId, packageId).status, "FOUND");
assert.equal(resolveWorkPackageReference(planningRoot, releaseId, itemId, displayId).status, "FOUND");
assert.equal(resolveWorkPackageReference(planningRoot, releaseId, itemId, "decorative").status, "NOT_FOUND");

const collisionDir = path.join(planningRoot, "releases", releaseId, "items", itemId, "work-packages", collisionId);
fs.mkdirSync(collisionDir, { recursive: true });
fs.writeFileSync(path.join(collisionDir, "work-package.yml"), stringifyYaml(packageDocument(releaseId, itemId, collisionId, displayId)));
assert.equal(resolveWorkPackageReference(planningRoot, releaseId, itemId, displayId).status, "AMBIGUOUS");

console.log("work-package-identity: WP display IDs, collision extension and safe resolution pass");
