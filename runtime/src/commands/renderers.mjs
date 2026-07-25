import { stringifyYaml } from "../lib/yaml.mjs";
import { confineScopePath } from "../lib/paths.mjs";

function toKebabCase(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}

export function renderWorkspaceInit({ name, baseBranch = null, vcs, pluginVersion, templatePackFingerprint }) {
  const config = { schemaVersion: 1, name, baseBranch, vcs, scopeRefs: [] };
  const pluginLock = { schemaVersion: 1, pluginVersion, templatePackFingerprint };
  return new Map([
    ["config.yml", stringifyYaml(config)],
    ["plugin.lock.yml", stringifyYaml(pluginLock)],
    [".gitignore", ".runtime/\n"]
  ]);
}

export function renderConfigUpdate({ name }, currentConfig) {
  const nextConfig = { ...currentConfig, name };
  return new Map([["config.yml", stringifyYaml(nextConfig)]]);
}

export function renderScopeAdd({ id, key, label, kind, path: scopePath, owner = null }, currentConfig, workspaceRoot) {
  confineScopePath(workspaceRoot, scopePath); // throws PathConfinementError on violation; read-only check

  const normalizedKey = toKebabCase(key);
  const existingKeys = new Set((currentConfig.scopeRefs || []).map((ref) => ref.key.toLowerCase()));
  if (existingKeys.has(normalizedKey)) {
    throw new Error(`scope key already exists: ${normalizedKey}`);
  }

  const nextConfig = {
    ...currentConfig,
    scopeRefs: [...(currentConfig.scopeRefs || []), { id, key: normalizedKey }]
  };
  const scope = { schemaVersion: 1, id, key: normalizedKey, label, kind, path: scopePath, owner };
  return new Map([
    ["config.yml", stringifyYaml(nextConfig)],
    [`scopes/${id}/scope.yml`, stringifyYaml(scope)]
  ]);
}
