import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkSchema } from "../check.mjs";
import { propose, validateOperation, approveOperation, __prepareApplyForTests } from "../../lib/changeset.mjs";
import { acquireWorkspaceLock } from "../../lib/lock.mjs";
import { renderConfigUpdate } from "../renderers.mjs";
import { parseYaml, stringifyYaml } from "../../lib/yaml.mjs";

function writeValidBaseFiles(planningRoot) {
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
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), stringifyYaml({
    schemaVersion: 1,
    pluginVersion: "1.0.0",
    templatePackFingerprint: `sha256:${"a".repeat(64)}`,
    plugin: {
      version: "1.0.0",
      schemaVersion: 1,
      templatePack: {
        id: "default",
        version: "1.0.0",
        fingerprint: `sha256:${"a".repeat(64)}`,
        vendorSnapshot: `.planning/vendor/template-packs/sha256-${"a".repeat(64)}`
      }
    }
  }));
}

// Git compatibility fields and branch promotion relationships are enforced without mutation.
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-git-policy-drift-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.baseBranch = "develop";
  config.git = {
    enabled: true,
    provider: "github",
    branches: { work_base: "develop", integration: "develop", production: "master" },
    pull_requests: { enabled: true, work_target: "master", draft_by_default: true, merge_strategy: "provider_default", promotion: { source: "develop", target: "master" } }
  };
  fs.writeFileSync(configPath, stringifyYaml(config));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.includes("work_target")));
}

// Work Source IDs and provider/transport relations are checked independently from Documentation Sources.
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-work-sources-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.work_sources = [
    { id: "local-backlog", provider: "local_repository", enabled: true, roots: ["docs/backlog/"], source_policy: "import_snapshot", sync_mode: "import_only" },
    { id: "local-backlog", provider: "local_repository", enabled: false, roots: ["docs/requirements/"], source_policy: "import_snapshot", sync_mode: "import_only" }
  ];
  fs.writeFileSync(configPath, stringifyYaml(config));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.includes("duplicate work source id")));
}

// Work Source roots cannot escape the workspace or use an incompatible transport.
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-work-source-safety-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.work_sources = [{ id: "jira-gradeops", provider: "jira", enabled: false, transport: "filesystem", roots: ["../outside"], source_policy: "external_authoritative", sync_mode: "pull" }];
  fs.writeFileSync(configPath, stringifyYaml(config));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.includes("inside the workspace")));
  assert.ok(result.findings.some((finding) => finding.includes("filesystem transport")));
}

function ensureBaseTopology(planningRoot) {
  for (const relativeDirectory of [
    "events",
    "operations",
    ".runtime",
    "scopes",
    "sources",
    "concerns",
    "gates",
    "gate-profiles",
    "execution-contexts",
    "environments",
    "decisions",
    "releases",
    "vendor/template-packs"
  ]) {
    fs.mkdirSync(path.join(planningRoot, relativeDirectory), { recursive: true });
  }
}

// trunk-based Git is valid: work, integration and production may intentionally be the same branch.
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-trunk-policy-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.baseBranch = "main";
  config.git = {
    enabled: true,
    provider: "github",
    branches: { work_base: "main", integration: "main", production: "main" },
    pull_requests: { enabled: true, work_target: "main", draft_by_default: true, merge_strategy: "provider_default", promotion: { source: "main", target: "main" } }
  };
  fs.writeFileSync(configPath, stringifyYaml(config));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "PASS", `trunk-based topology must be valid: ${JSON.stringify(result.findings)}`);
}

// uninitialized workspace
{
  const planningRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "check-uninit-")), ".planning");
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "NOT_INITIALIZED");
  assert.ok(result.findings.length > 0);
}

// initialized but missing plugin.lock.yml -- must be a finding, not a silent PASS
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-missing-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("plugin.lock.yml")));
}

// fully valid workspace -- PASS, and check schema never writes anything
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-valid-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const beforeMtime = fs.statSync(path.join(planningRoot, "config.yml")).mtimeMs;
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.findings, []);
  assert.equal(fs.statSync(path.join(planningRoot, "config.yml")).mtimeMs, beforeMtime, "check schema must never write to config.yml");
}

// canonical/compatibility Project Context fields must not silently diverge.
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-context-drift-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.project.name = "different-name";
  fs.writeFileSync(configPath, stringifyYaml(config));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.includes("project.name")));
}

// scopeCatalog.enabled contains primary ids and cannot point at an unknown scope ref.
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-enabled-scope-drift-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.scopeCatalog.enabled = ["018f0000-0000-7000-8000-000000000123"];
  fs.writeFileSync(configPath, stringifyYaml(config));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.includes("scopeCatalog.enabled") && finding.includes("unknown scope id")));
}

// structured plugin lock metadata must agree with the temporary compatibility fields.
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-plugin-lock-drift-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const lockPath = path.join(planningRoot, "plugin.lock.yml");
  const pluginLock = parseYaml(fs.readFileSync(lockPath, "utf8"));
  pluginLock.plugin.version = "9.9.9";
  fs.writeFileSync(lockPath, stringifyYaml(pluginLock));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.includes("plugin.version")));
}

// missing required bootstrap topology -- FAIL, and check schema remains query-only
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-topology-missing-"));
  writeValidBaseFiles(planningRoot);
  fs.mkdirSync(path.join(planningRoot, "events"), { recursive: true });
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("scopes") && f.includes("required directory is missing")));
  assert.equal(fs.existsSync(path.join(planningRoot, "scopes")), false, "check schema must not create missing topology");
}

// unsafe required bootstrap topology entries -- symlinks/files are findings, never followed
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-topology-unsafe-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  fs.rmSync(path.join(planningRoot, "gates"), { recursive: true, force: true });
  fs.writeFileSync(path.join(planningRoot, "gates"), "not a directory\n");
  fs.rmSync(path.join(planningRoot, "concerns"), { recursive: true, force: true });
  fs.symlinkSync(os.tmpdir(), path.join(planningRoot, "concerns"));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("gates") && f.includes("must be a directory")));
  assert.ok(result.findings.some((f) => f.includes("concerns") && f.includes("symlink")));
}

// invalid config.yml -- FAIL with a finding
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-invalid-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: \"\"\nvcs: git\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.length > 0);
}

// malformed YAML -- FAIL with an explicit finding, exit 1 via the normal
// data-driven status mapping, never an uncaught parse exception (exit 2)
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-malformed-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "name: demo\nname: duplicate-key-is-a-parse-error\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("config.yml") && f.toLowerCase().includes("parse")));
}

// a symlink under scopes/ must be reported, never followed or silently ignored
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-scope-symlink-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const scopesRoot = path.join(planningRoot, "scopes");
  fs.mkdirSync(scopesRoot, { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "check-scope-outside-"));
  const scopeId = "018f0000-0000-7000-8000-000000000003";
  fs.symlinkSync(outside, path.join(scopesRoot, scopeId));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes(scopeId) && f.toLowerCase().includes("symlink")));
}

// an invalid (non-UUIDv7) entry under scopes/ must be reported, not silently skipped
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-scope-invalid-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  fs.mkdirSync(path.join(planningRoot, "scopes", "not-a-uuid"), { recursive: true });
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("not-a-uuid")));
}

// reports pending operations without touching them
//
// Built via the real propose/validate/approve/prepareApply pipeline rather
// than a hand-rolled operation object: operation.schema.json's per-status
// invariants (Task 6) require APPLYING operations to carry populated
// validation/approval/filePlan/expectedEvents, which a minimal hand-built
// fixture can't satisfy -- checkSchema correctly treats a schema-invalid
// operation as a finding, not a pending operation, so a fixture that isn't
// genuinely schema-valid would never exercise this path.
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-pending-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const operationsRoot = path.join(planningRoot, "operations");

  const currentConfig = parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"));
  const render = (payload) => renderConfigUpdate(payload, currentConfig);
  const operationId = propose({
    operationsRoot, planningRoot, kind: "config.update", target: {},
    payload: { name: "renamed" }, targetFiles: ["config.yml"], actor: "carlos"
  });
  validateOperation({ operationsRoot, planningRoot, operationId, render });
  approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true });
  const lock = acquireWorkspaceLock(planningRoot, operationId);
  __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render, actor: "carlos" });
  lock.release();

  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "RECOVERY_REQUIRED", "pending canonical mutation must never be reported as PASS");
  assert.equal(result.pendingOperations.length, 1);
  assert.equal(result.pendingOperations[0].status, "APPLYING");
  assert.equal(result.pendingOperations[0].operationId, operationId);

  const rawAfter = fs.readFileSync(path.join(operationsRoot, operationId, "operation.yml"), "utf8");
  assert.ok(rawAfter.includes("APPLYING"), "checkSchema must never mutate the operation while inspecting it");
}

// corrupt operation.yml must be reported as a finding, never silently
// skipped and never rewritten (Revision 4 note 6)
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-corrupt-op-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const operationsRoot = path.join(planningRoot, "operations");
  const corruptId = "018f0000-0000-7000-8000-000000000006";
  fs.mkdirSync(path.join(operationsRoot, corruptId), { recursive: true });
  fs.writeFileSync(path.join(operationsRoot, corruptId, "operation.yml"), "not: [valid, yaml, at all\n");
  const rawBefore = fs.readFileSync(path.join(operationsRoot, corruptId, "operation.yml"), "utf8");

  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes(corruptId)), "corrupt operation metadata must be reported as a finding, not silently skipped");
  const rawAfter = fs.readFileSync(path.join(operationsRoot, corruptId, "operation.yml"), "utf8");
  assert.equal(rawAfter, rawBefore, "check schema must never rewrite operation.yml, corrupt or not");
}

// sources/<id>/source.yml is now validated the same way scopes/<id>/scope.yml already is
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-source-valid-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const sourcesRoot = path.join(planningRoot, "sources");
  const id = "018f4d1e-0000-7000-8000-000000000001";
  fs.mkdirSync(path.join(sourcesRoot, id), { recursive: true });
  fs.writeFileSync(path.join(sourcesRoot, id, "source.yml"), stringifyYaml({
    schemaVersion: 1, id, path: "docs/x/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "a".repeat(64), confirmedContentHash: "b".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000002" }
  }));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.findings, []);
}

// source.id not matching its own directory name must be a finding, not silently accepted
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-source-mismatch-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const sourcesRoot = path.join(planningRoot, "sources");
  const id = "018f4d1e-0000-7000-8000-000000000003";
  fs.mkdirSync(path.join(sourcesRoot, id), { recursive: true });
  fs.writeFileSync(path.join(sourcesRoot, id, "source.yml"), stringifyYaml({
    schemaVersion: 1, id: "018f4d1e-0000-7000-8000-000000000099", path: "docs/x/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "a".repeat(64), confirmedContentHash: "b".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000002" }
  }));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("does not match its directory")));
}

// commands.<role>.sourceFingerprintAtSelection keys must exactly match sourceRefs -- an
// extra key (or a missing one) is a finding, even though the schema alone (Task 5) cannot
// express this and therefore accepts it structurally
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-fingerprint-mismatch-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const scopeId = "018f4d1e-0000-7000-8000-000000000010";
  fs.mkdirSync(path.join(planningRoot, "scopes", scopeId), { recursive: true });
  const refA = "018f4d1e-0000-7000-8000-000000000011";
  const refB = "018f4d1e-0000-7000-8000-000000000012";
  fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), stringifyYaml({
    schemaVersion: 1, id: scopeId, key: "api", label: "API", kind: "code", path: "api/", owner: null,
    commands: {
      build: {
        command: "./y", method: "reviewed", confidence: "high",
        sourceRefs: [refA],
        sourceFingerprintAtSelection: { [refA]: "a".repeat(64), [refB]: "b".repeat(64) }, // refB is an extra key
        requiresEnvironment: false, requiresSecrets: false, alternatives: []
      }
    }
  }));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("commands.build") && f.includes("sourceFingerprintAtSelection")));
}

// the same check reaches into alternatives[], not just the selected command
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-fingerprint-mismatch-alt-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const scopeId = "018f4d1e-0000-7000-8000-000000000013";
  fs.mkdirSync(path.join(planningRoot, "scopes", scopeId), { recursive: true });
  const refA = "018f4d1e-0000-7000-8000-000000000014";
  const refC = "018f4d1e-0000-7000-8000-000000000015";
  fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), stringifyYaml({
    schemaVersion: 1, id: scopeId, key: "api", label: "API", kind: "code", path: "api/", owner: null,
    commands: {
      build: {
        command: "./y", method: "reviewed", confidence: "high",
        sourceRefs: [refA], sourceFingerprintAtSelection: { [refA]: "a".repeat(64) },
        requiresEnvironment: false, requiresSecrets: false,
        alternatives: [{
          command: "./z", sourceRefs: [refC], sourceFingerprintAtSelection: {}, // missing refC's key
          confidence: "medium", requiresEnvironment: false, requiresSecrets: false
        }]
      }
    }
  }));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("commands.build.alternatives[0]")));
}

// a declared command (no sourceRefs at all) never triggers this check
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-fingerprint-declared-ok-"));
  writeValidBaseFiles(planningRoot);
  ensureBaseTopology(planningRoot);
  const scopeId = "018f4d1e-0000-7000-8000-000000000016";
  fs.mkdirSync(path.join(planningRoot, "scopes", scopeId), { recursive: true });
  fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), stringifyYaml({
    schemaVersion: 1, id: scopeId, key: "api", label: "API", kind: "code", path: "api/", owner: null,
    commands: {
      test: {
        command: "./mvnw test", method: "declared", declaredBy: "carlos", declaredAt: "2026-07-25T10:00:00Z",
        declaredOperationId: "018f4d1e-0000-7000-8000-000000000017", requiresEnvironment: false, requiresSecrets: false, alternatives: []
      }
    }
  }));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "PASS");
}

console.log("check: all tests passed");
