import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateReleaseHealth } from "../releaseHealth.mjs";
import { generateUuidV7 } from "../ids.mjs";
import { updateReleaseRevision } from "../releaseMutations.mjs";
import { renderReleaseReadme } from "../releaseProjection.mjs";
import { releaseDisplayIdForUuid } from "../releaseIdentity.mjs";
import { stringifyYaml } from "../yaml.mjs";

function writeConfig(planningRoot) {
  fs.writeFileSync(path.join(planningRoot, "config.yml"), stringifyYaml({
    schemaVersion: 1,
    name: "demo",
    baseBranch: null,
    vcs: "git",
    git: { enabled: true, provider: "none", branches: { work_base: null, integration: null, production: null } },
    work_sources: [],
    project: { name: "demo", type: "software" },
    plugin: { schemaVersion: 1, launcher: "shipping-mode" },
    policies: {
      release: { mode: "strict_sequence", defaultLane: "main", lanes: [{ id: "main", label: "Main" }] },
      workSources: { defaultSyncMode: "import_only", defaultSourcePolicy: "import_snapshot", externalWrites: "approval_required" },
      paths: { workspaceBoundary: "current_directory" }
    },
    scopeCatalog: { directory: ".planning/scopes", enabled: [] },
    runtime: {
      eventStore: ".planning/events",
      operationStore: ".planning/operations",
      runtimeStore: ".planning/.runtime",
      templateVendor: ".planning/vendor/template-packs",
      operationRetentionDays: 7,
      retainFailedOperations: true,
      retainBeforeSnapshots: false,
      eventRetention: "permanent"
    },
    scopeRefs: [],
    documentation: { source_refs: [], gaps: [] }
  }));
}

function releaseFixture(overrides = {}) {
  const releaseId = overrides.id || generateUuidV7();
  const withoutRevision = {
    schemaVersion: 1,
    id: releaseId,
    displayId: overrides.displayId || releaseDisplayIdForUuid(releaseId),
    displayIdStatus: "ACTIVE",
    slug: null,
    title: "Release",
    objective: "Evaluate release health",
    status: "DRAFT",
    lane: { id: "main" },
    policy: { mode: "strict_sequence", previousReleaseRefs: [], dependencyRefs: [] },
    scopeRefs: [],
    executionContextRefs: [],
    environmentRefs: [],
    itemRefs: [],
    blockers: [],
    risks: [],
    deploymentEvents: [],
    finalization: { completed: false, completedAt: null, completedBy: null, retrospectiveStatus: "not_started" },
    audit: {
      createdAt: "2026-07-29T00:00:00.000Z",
      createdBy: "carlos",
      updatedAt: "2026-07-29T00:00:00.000Z",
      updatedBy: "carlos",
      operationId: generateUuidV7()
    },
    ...overrides
  };
  return updateReleaseRevision(withoutRevision);
}

function writeRelease(planningRoot, release) {
  const releaseRoot = path.join(planningRoot, "releases", release.id);
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.writeFileSync(path.join(releaseRoot, "release.yml"), stringifyYaml(release));
  fs.writeFileSync(path.join(releaseRoot, "README.md"), renderReleaseReadme(release));
}

{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-health-"));
  for (const dir of ["releases", "scopes", "execution-contexts", "environments"]) fs.mkdirSync(path.join(planningRoot, dir), { recursive: true });
  writeConfig(planningRoot);
  const release = releaseFixture();
  writeRelease(planningRoot, release);
  const health = evaluateReleaseHealth({ planningRoot, release, directoryId: release.id });
  assert.equal(health.aggregate.status, "failed");
  assert.equal(health.completion.status, "unavailable");
  assert.equal(health.completion.complete, false, "empty itemRefs must not produce completion");
  assert.ok(health.findings.some((finding) => finding.code === "DEPLOYMENT_EVIDENCE_MISSING"));
  assert.ok(health.findings.some((finding) => finding.code === "CAPABILITY_UNAVAILABLE"));
  assert.deepEqual(
    evaluateReleaseHealth({ planningRoot, release, directoryId: release.id }),
    health,
    "release health must be deterministic across repeated query-only evaluation"
  );
}

{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-health-drift-"));
  for (const dir of ["releases", "scopes", "execution-contexts", "environments"]) fs.mkdirSync(path.join(planningRoot, dir), { recursive: true });
  writeConfig(planningRoot);
  const release = releaseFixture();
  writeRelease(planningRoot, release);
  fs.writeFileSync(path.join(planningRoot, "releases", release.id, "README.md"), "manual edit\n");
  const health = evaluateReleaseHealth({ planningRoot, release, directoryId: release.id });
  assert.ok(health.findings.some((finding) => finding.code === "RELEASE_PROJECTION_DRIFT"));
}

console.log("release-health: all tests passed");
