import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseYaml } from "../../lib/yaml.mjs";
import { PathConfinementError } from "../../lib/paths.mjs";
import { renderWorkspaceInit, renderConfigUpdate, renderScopeAdd, renderScopeCommandSet, renderDiscoveryPropose } from "../renderers.mjs";

const init = renderWorkspaceInit({ name: "demo", baseBranch: "main", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` });
assert.ok(init.has("config.yml"));
assert.ok(init.has("plugin.lock.yml"));
assert.ok(init.has(".gitignore"));
for (const requiredDirectory of [
  "scopes",
  "sources",
  "concerns",
  "gates",
  "gate-profiles",
  "execution-contexts",
  "environments",
  "decisions",
  "releases",
  "vendor",
  "vendor/template-packs"
]) {
  assert.ok(init.has(requiredDirectory), `workspace.init must render ${requiredDirectory} as a directory target`);
  assert.equal(init.get(requiredDirectory).kind, "directory");
}
assert.equal(init.get(".gitignore"), ".runtime/\n");
const parsedConfig = parseYaml(init.get("config.yml"));
assert.equal(parsedConfig.name, "demo");
assert.deepEqual(parsedConfig.git, { enabled: true, provider: "none", branches: { work_base: "main", integration: null, production: null } });
assert.deepEqual(parsedConfig.work_sources, []);
assert.equal(parsedConfig.project.name, "demo");
assert.equal(parsedConfig.project.type, "unknown");
const explicitTypeConfig = parseYaml(renderWorkspaceInit({ name: "mixed-demo", projectType: "mixed", baseBranch: null, vcs: "none", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` }).get("config.yml"));
assert.equal(explicitTypeConfig.project.type, "mixed");
assert.equal(parsedConfig.plugin.schemaVersion, 1);
assert.equal(parsedConfig.plugin.launcher, "shipping-mode");
assert.deepEqual(parsedConfig.scopeCatalog, { directory: ".planning/scopes", enabled: [] });
assert.equal(parsedConfig.policies.release.mode, "strict_sequence");
assert.equal(parsedConfig.policies.workSources.defaultSyncMode, "import_only");
assert.equal(parsedConfig.policies.paths.workspaceBoundary, "current_directory");
assert.equal(parsedConfig.runtime.eventStore, ".planning/events");
assert.equal(parsedConfig.runtime.templateVendor, ".planning/vendor/template-packs");
assert.deepEqual(parsedConfig.scopeRefs, []);
const parsedPluginLock = parseYaml(init.get("plugin.lock.yml"));
assert.equal(parsedPluginLock.plugin.version, "1.0.0");
assert.equal(parsedPluginLock.plugin.schemaVersion, 1);
assert.equal(parsedPluginLock.plugin.templatePack.id, "default");
assert.equal(parsedPluginLock.plugin.templatePack.version, "1.0.0");
assert.equal(parsedPluginLock.plugin.templatePack.fingerprint, `sha256:${"a".repeat(64)}`);
assert.equal(parsedPluginLock.plugin.templatePack.vendorSnapshot, `.planning/vendor/template-packs/sha256-${"a".repeat(64)}`);

const updated = renderConfigUpdate({ name: "renamed" }, parsedConfig);
const parsedUpdated = parseYaml(updated.get("config.yml"));
assert.equal(parsedUpdated.name, "renamed");
assert.equal(parsedUpdated.project.name, "renamed");
assert.equal(parsedUpdated.vcs, "git", "fields not touched by config set must be preserved");
const policyUpdate = parseYaml(renderConfigUpdate({
  git: { enabled: false, provider: "none" },
  work_sources: [{ id: "jira-gradeops", provider: "jira", enabled: false, transport: "mcp", source_policy: "external_authoritative", sync_mode: "pull", mcp_connection_ref: "atlassian" }]
}, parsedConfig).get("config.yml"));
assert.equal(policyUpdate.git.enabled, false);
assert.equal(policyUpdate.vcs, "none", "canonical git.enabled must synchronize compatibility vcs");
assert.equal(policyUpdate.baseBranch, null, "disabled Git must clear compatibility baseBranch");
assert.equal(policyUpdate.work_sources[0].mcp_connection_ref, "atlassian");
const enabledPolicyUpdate = parseYaml(renderConfigUpdate({
  git: { enabled: true, provider: "github", branches: { work_base: "develop", integration: "develop", production: "master" } }
}, parsedConfig).get("config.yml"));
assert.equal(enabledPolicyUpdate.vcs, "git");
assert.equal(enabledPolicyUpdate.baseBranch, "develop");
assert.throws(() => renderConfigUpdate({
  git: {
    enabled: true,
    provider: "github",
    branches: { work_base: "main", integration: "main", production: "main" },
    pull_requests: { enabled: true, work_target: "other", draft_by_default: true, merge_strategy: "provider_default", promotion: { source: "main", target: "main" } }
  }
}, parsedConfig), /work_target/);

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "renderers-"));
fs.mkdirSync(path.join(workspace, ".planning"), { recursive: true });
fs.mkdirSync(path.join(workspace, "api"), { recursive: true });

const scopeId = "018f0000-0000-7000-8000-000000000000";
const scopeFiles = renderScopeAdd({ id: scopeId, key: "Backend Service", label: "Backend", kind: "code", path: "api/", owner: null }, parsedConfig, workspace);
assert.ok(scopeFiles.has("config.yml"));
assert.ok(scopeFiles.has(`scopes/${scopeId}/scope.yml`));
const parsedScope = parseYaml(scopeFiles.get(`scopes/${scopeId}/scope.yml`));
assert.equal(parsedScope.key, "backend-service", "key must be normalized to kebab-case");
assert.equal(parsedScope.id, scopeId, "the scope id must be the one already fixed in the payload, never regenerated");
assert.deepEqual(parseYaml(scopeFiles.get("config.yml")).scopeCatalog.enabled, [scopeId], "new scopes must be enabled by canonical UUIDv7 reference");

assert.throws(() => renderScopeAdd({ id: scopeId, key: "backend", label: "Backend", kind: "code", path: "/etc/passwd", owner: null }, parsedConfig, workspace), PathConfinementError);
assert.throws(() => renderScopeAdd({ id: scopeId, key: "backend", label: "Backend", kind: "code", path: "../outside", owner: null }, parsedConfig, workspace), PathConfinementError);

const configWithExistingScope = { ...parsedConfig, scopeRefs: [{ id: scopeId, key: "backend-service" }] };
assert.throws(() => renderScopeAdd({ id: "018f0000-0000-7000-8000-000000000001", key: "Backend-Service", label: "Dup", kind: "code", path: "api/", owner: null }, configWithExistingScope, workspace), /already exists/i, "key uniqueness must be case-insensitive");

const commandSet = renderScopeCommandSet({
  operationId: "018f0000-0000-7000-8000-000000000009",
  scopeId,
  role: "custom.e2e",
  command: "npm run test:e2e",
  requiresEnvironment: true,
  requiresSecrets: false,
  declaredBy: "carlos",
  declaredAt: "2026-07-26T00:00:00.000Z"
}, parsedScope);
const declaredScope = parseYaml(commandSet.get(`scopes/${scopeId}/scope.yml`));
assert.equal(declaredScope.commands.custom.e2e.method, "declared");
assert.equal(declaredScope.commands.custom.e2e.declaredOperationId, "018f0000-0000-7000-8000-000000000009");
assert.deepEqual(declaredScope.commands.custom.e2e.alternatives, []);

const sourceId = "018f0000-0000-7000-8000-000000000010";
const removedSourceId = "018f0000-0000-7000-8000-000000000011";
const commandSourceId = "018f0000-0000-7000-8000-000000000013";
const newScopeId = "018f0000-0000-7000-8000-000000000012";
const discoveryFiles = renderDiscoveryPropose({
  operationId: "018f0000-0000-7000-8000-000000000020",
  confirmedBy: "runtime-actor",
  confirmedAt: "2026-07-26T01:00:00.000Z",
  sourceIdAssignments: [{ sourceActionIndex: 0, sourceId }],
  scopeIdAssignments: [{ scopeIndex: 0, scopeId: newScopeId }],
  proposal: {
    sources: [
      {
        action: "add",
        path: "api/package.json",
        family: "project-module-manifests",
        kind: "repository-map",
        role: "evidence",
        authority: { standing: "supporting", force: "informational" },
        availability: "implemented",
        observedFingerprint: "a".repeat(64),
        observedContentHash: "b".repeat(64)
      },
      { action: "remove", sourceId: removedSourceId }
    ],
    scopes: [{ key: "new api", label: "New API", kind: "code", path: "api/", owner: null }],
    scopeCommands: [{
      scopeId,
      role: "test",
      command: "npm test",
      method: "reviewed",
      confidence: "high",
      sourceRefs: [commandSourceId],
      sourceFingerprintAtSelection: { [commandSourceId]: "c".repeat(64) },
      requiresEnvironment: false,
      requiresSecrets: false,
      alternatives: []
    }, {
      scopeId,
      role: "build",
      command: "npm run build",
      method: "reviewed",
      confidence: "high",
      sourceRefs: [commandSourceId],
      sourceFingerprintAtSelection: { [commandSourceId]: "c".repeat(64) },
      requiresEnvironment: false,
      requiresSecrets: false,
      alternatives: []
    }]
  }
}, parsedConfig, workspace, {
  currentSources: [
    { schemaVersion: 1, id: removedSourceId, path: "old.md", family: "product-sources", kind: "product", role: "canonical", authority: { standing: "authoritative", force: "normative" }, availability: "implemented", confirmedFingerprint: "c".repeat(64), confirmedContentHash: "d".repeat(64), provenance: { discoveredBy: "old", confirmedBy: "old", confirmedAt: "old", confirmedOperationId: "018f0000-0000-7000-8000-000000000099" } },
    { schemaVersion: 1, id: commandSourceId, path: "package.json", family: "project-module-manifests", kind: "repository-map", role: "evidence", authority: { standing: "supporting", force: "informational" }, availability: "implemented", confirmedFingerprint: "c".repeat(64), confirmedContentHash: "e".repeat(64), provenance: { discoveredBy: "old", confirmedBy: "old", confirmedAt: "old", confirmedOperationId: "018f0000-0000-7000-8000-000000000099" } }
  ],
  currentScopes: [parsedScope]
});
const addedSource = parseYaml(discoveryFiles.get(`sources/${sourceId}/source.yml`));
assert.equal(addedSource.id, sourceId);
assert.equal(addedSource.provenance.discoveredBy, "discovery.propose");
assert.equal(addedSource.provenance.confirmedBy, "runtime-actor");
assert.equal(addedSource.provenance.confirmedOperationId, "018f0000-0000-7000-8000-000000000020");
assert.equal(discoveryFiles.get(`sources/${removedSourceId}/source.yml`), null);
const discoveryConfig = parseYaml(discoveryFiles.get("config.yml"));
assert.equal(discoveryConfig.scopeRefs[0].id, newScopeId);
assert.deepEqual(discoveryConfig.scopeCatalog.enabled, [newScopeId], "Discovery-added scopes must update the canonical enabled catalog");
const scopeWithDiscoveryCommands = parseYaml(discoveryFiles.get(`scopes/${scopeId}/scope.yml`));
assert.equal(scopeWithDiscoveryCommands.commands.test.method, "reviewed");
assert.equal(scopeWithDiscoveryCommands.commands.build.method, "reviewed");

console.log("renderers: all tests passed");
