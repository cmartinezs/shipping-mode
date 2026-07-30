import assert from "node:assert/strict";
import { validate } from "../schema.mjs";
import { updateWorkPackageRevision, workPackageCatalogFindings, workPackageIntegrityFindings } from "../workPackageStore.mjs";

function validPackage() {
  return updateWorkPackageRevision({
    schemaVersion: 1,
    id: "018f0000-0000-7000-8000-000000000300",
    displayId: "WP-MF6A7HSW",
    displayIdStatus: "ACTIVE",
    releaseId: "018f0000-0000-7000-8000-000000000301",
    releaseItemId: "018f0000-0000-7000-8000-000000000302",
    scopeId: "018f0000-0000-7000-8000-000000000303",
    title: "Package",
    description: null,
    status: "DRAFT",
    commitment: "required",
    design: "Design",
    interfaces: [{ id: "api", summary: "API", detail: null }],
    contracts: [{ id: "schema", summary: "Schema", detail: "closed" }],
    dependencies: [],
    guideRefs: [
      { scopeId: "018f0000-0000-7000-8000-000000000303", kind: "task", id: "018f0000-0000-7000-8000-000000000304", revision: `sha256:${"a".repeat(64)}`, contentHash: "b".repeat(64), state: "approved_current", usable: true, capturedAt: "2026-07-29T00:00:00.000Z" },
      { scopeId: "018f0000-0000-7000-8000-000000000303", kind: "test", id: "018f0000-0000-7000-8000-000000000305", revision: `sha256:${"c".repeat(64)}`, contentHash: "d".repeat(64), state: "approved_current", usable: true, capturedAt: "2026-07-29T00:00:00.000Z" }
    ],
    gateRequirements: [{ id: "unit", required: true, applicability: "declared", source: { type: "guide", scopeId: "018f0000-0000-7000-8000-000000000303", guideKind: "task", guideId: "018f0000-0000-7000-8000-000000000304", revision: `sha256:${"a".repeat(64)}` } }],
    risks: [{ id: "018f0000-0000-7000-8000-000000000306", level: "medium", summary: "Risk", createdAt: "2026-07-29T00:00:00.000Z", createdBy: "carlos" }],
    blockers: [{ id: "018f0000-0000-7000-8000-000000000307", severity: "high", summary: "Blocker", createdAt: "2026-07-29T00:00:00.000Z", createdBy: "carlos", resolvedAt: null, resolvedBy: null }],
    resolution: null,
    audit: { createdAt: "2026-07-29T00:00:00.000Z", createdBy: "carlos", updatedAt: "2026-07-29T00:00:00.000Z", updatedBy: "carlos", operationId: "018f0000-0000-7000-8000-000000000300" }
  });
}

assert.equal(validate("work-package", validPackage()).valid, true);

for (const mutate of [
  (pkg) => { pkg.unknown = true; },
  (pkg) => { pkg.interfaces[0].extra = true; },
  (pkg) => { pkg.id = "not-a-uuid"; },
  (pkg) => { pkg.displayId = "ITEM-1234"; },
  (pkg) => { pkg.commitment = "maybe"; },
  (pkg) => { pkg.dependencies = ["018f0000-0000-7000-8000-000000000309", "018f0000-0000-7000-8000-000000000309"]; },
  (pkg) => { pkg.guideRefs[0].revision = "main"; },
  (pkg) => { pkg.gateRequirements[0].result = "PASS"; },
  (pkg) => { pkg.blockers[0].note = "unknown"; },
  (pkg) => { pkg.status = "DONE"; pkg.resolution = null; }
]) {
  const pkg = validPackage();
  mutate(pkg);
  assert.equal(validate("work-package", pkg).valid, false);
}

const done = validPackage();
done.status = "DONE";
done.resolution = {
  type: "DONE",
  reason: "Completed",
  approvedBy: "reviewer",
  approvedAt: "2026-07-29T00:00:00.000Z",
  riskAccepted: false,
  replacementId: null,
  operationId: "018f0000-0000-7000-8000-000000000300",
  evidence: [{ id: "review", summary: "Reviewed", detail: null }]
};
assert.equal(validate("work-package", updateWorkPackageRevision(done)).valid, true);

const duplicateSemanticIds = validPackage();
duplicateSemanticIds.risks.push({ ...duplicateSemanticIds.risks[0], summary: "Second risk with same ID" });
const duplicateIntegrity = workPackageIntegrityFindings(updateWorkPackageRevision(duplicateSemanticIds));
assert.ok(duplicateIntegrity.findings.some((finding) => finding.includes("risks contains duplicate identity")));

const mismatchedGateSource = validPackage();
mismatchedGateSource.gateRequirements[0].source.guideId = "018f0000-0000-7000-8000-000000000399";
const gateIntegrity = workPackageIntegrityFindings(updateWorkPackageRevision(mismatchedGateSource));
assert.ok(gateIntegrity.findings.some((finding) => finding.includes("source does not match the captured")));

const duplicatePackage = updateWorkPackageRevision({ ...validPackage(), releaseItemId: "018f0000-0000-7000-8000-000000000398", title: "Duplicate physical identity" });
assert.ok(workPackageCatalogFindings([validPackage(), duplicatePackage], { releaseId: duplicatePackage.releaseId }).some((finding) => finding.code === "WORK_PACKAGE_ID_DUPLICATE"));

console.log("work-package-schema: closed schema, status/resolution and nested tamper cases pass");
