import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const validConfig = {
  schemaVersion: 1,
  name: "demo",
  baseBranch: null,
  vcs: "git",
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
  scopeRefs: []
};
const result = validate("config", validConfig);
assert.equal(result.valid, true);
assert.deepEqual(result.errors, []);

const invalidConfig = { schemaVersion: 1, name: "demo", vcs: "svn", scopeRefs: [] };
const bad = validate("config", invalidConfig);
assert.equal(bad.valid, false);
assert.ok(bad.errors.length > 0);
assert.ok(bad.errors[0].message, "each error must have a message");
assert.ok(bad.errors[0].path !== undefined, "each error must have a path, even if empty string");

console.log("schema facade: all tests passed");
