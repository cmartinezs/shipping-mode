import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseYaml } from "../../lib/yaml.mjs";
import { PathConfinementError } from "../../lib/paths.mjs";
import { renderWorkspaceInit, renderConfigUpdate, renderScopeAdd } from "../renderers.mjs";

const init = renderWorkspaceInit({ name: "demo", baseBranch: "main", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` });
assert.ok(init.has("config.yml"));
assert.ok(init.has("plugin.lock.yml"));
assert.ok(init.has(".gitignore"));
assert.equal(init.get(".gitignore"), ".runtime/\n");
const parsedConfig = parseYaml(init.get("config.yml"));
assert.equal(parsedConfig.name, "demo");
assert.deepEqual(parsedConfig.scopeRefs, []);

const updated = renderConfigUpdate({ name: "renamed" }, parsedConfig);
const parsedUpdated = parseYaml(updated.get("config.yml"));
assert.equal(parsedUpdated.name, "renamed");
assert.equal(parsedUpdated.vcs, "git", "fields not touched by config set must be preserved");

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

assert.throws(() => renderScopeAdd({ id: scopeId, key: "backend", label: "Backend", kind: "code", path: "/etc/passwd", owner: null }, parsedConfig, workspace), PathConfinementError);
assert.throws(() => renderScopeAdd({ id: scopeId, key: "backend", label: "Backend", kind: "code", path: "../outside", owner: null }, parsedConfig, workspace), PathConfinementError);

const configWithExistingScope = { ...parsedConfig, scopeRefs: [{ id: scopeId, key: "backend-service" }] };
assert.throws(() => renderScopeAdd({ id: "018f0000-0000-7000-8000-000000000001", key: "Backend-Service", label: "Dup", kind: "code", path: "api/", owner: null }, configWithExistingScope, workspace), /already exists/i, "key uniqueness must be case-insensitive");

console.log("renderers: all tests passed");
