import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const validConfig = {
  schemaVersion: 1,
  name: "demo",
  baseBranch: null,
  vcs: "git",
  git: { enabled: true, provider: "none", branches: { work_base: null, integration: null, production: null } },
  work_sources: [],
  project: { name: "demo", type: "software" },
  plugin: { schemaVersion: 1, launcher: "shipping-mode" },
  policies: {
    release: { mode: "strict_sequence", defaultLane: "main" },
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
};
const result = validate("config", validConfig);
assert.equal(result.valid, true);
assert.deepEqual(result.errors, []);
const withoutCanonicalGit = structuredClone(validConfig);
delete withoutCanonicalGit.git;
assert.equal(validate("config", withoutCanonicalGit).valid, false, "canonical git policy must be required");
const withoutWorkSources = structuredClone(validConfig);
delete withoutWorkSources.work_sources;
assert.equal(validate("config", withoutWorkSources).valid, false, "canonical work_sources must be required");

const scopeId = "018f0000-0000-7000-8000-000000000123";
const configWithEnabledScope = structuredClone(validConfig);
configWithEnabledScope.scopeRefs = [{ id: scopeId, key: "backend" }];
configWithEnabledScope.scopeCatalog.enabled = [scopeId];
assert.equal(validate("config", configWithEnabledScope).valid, true, "scopeCatalog.enabled must accept primary UUIDv7 refs");
const configWithDecorativeEnabledKey = structuredClone(configWithEnabledScope);
configWithDecorativeEnabledKey.scopeCatalog.enabled = ["backend"];
assert.equal(validate("config", configWithDecorativeEnabledKey).valid, false, "scopeCatalog.enabled must not use decorative keys as primary refs");

const invalidConfig = { schemaVersion: 1, name: "demo", vcs: "svn", scopeRefs: [] };
const bad = validate("config", invalidConfig);
assert.equal(bad.valid, false);
assert.ok(bad.errors.length > 0);
assert.ok(bad.errors[0].message, "each error must have a message");
assert.ok(bad.errors[0].path !== undefined, "each error must have a path, even if empty string");

console.log("schema facade: all tests passed");
