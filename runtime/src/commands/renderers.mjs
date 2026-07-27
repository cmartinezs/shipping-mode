import { stringifyYaml } from "../lib/yaml.mjs";
import { confineScopePath } from "../lib/paths.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES, DIRECTORY_RENDER_ENTRY } from "../lib/bootstrapTopology.mjs";

function toKebabCase(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}

export function renderWorkspaceInit({ name, baseBranch = null, vcs, pluginVersion, templatePackFingerprint }) {
  const templatePackVendorSnapshot = `.planning/vendor/template-packs/${templatePackFingerprint.replace(":", "-")}`;
  const config = {
    schemaVersion: 1,
    name,
    baseBranch,
    vcs,
    project: { name, type: "software" },
    plugin: { schemaVersion: 1, launcher: "shipping-mode" },
    policies: {
      release: { mode: "strict_sequence", defaultLane: "main" },
      workSources: {
        defaultSyncMode: "import_only",
        defaultSourcePolicy: "import_snapshot",
        externalWrites: "approval_required"
      },
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
  const pluginLock = {
    schemaVersion: 1,
    pluginVersion,
    templatePackFingerprint,
    plugin: {
      version: pluginVersion,
      schemaVersion: 1,
      templatePack: {
        id: "default",
        version: pluginVersion,
        fingerprint: templatePackFingerprint,
        vendorSnapshot: templatePackVendorSnapshot
      }
    }
  };
  return new Map([
    ["config.yml", stringifyYaml(config)],
    ["plugin.lock.yml", stringifyYaml(pluginLock)],
    [".gitignore", ".runtime/\n"],
    ...BOOTSTRAP_CANONICAL_DIRECTORIES.map((relativeDirectory) => [relativeDirectory, DIRECTORY_RENDER_ENTRY])
  ]);
}

export function renderConfigUpdate({ name }, currentConfig) {
  const baseConfig = currentConfig || {};
  const nextConfig = { ...baseConfig, name, project: { ...(baseConfig.project || {}), name } };
  return new Map([["config.yml", stringifyYaml(nextConfig)]]);
}

export function renderConfigAutonomySet({ discovery }, currentConfig) {
  const nextConfig = { ...currentConfig, autonomy: { discovery } };
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

function setCommand(scope, role, entry) {
  const next = { ...scope, commands: { ...(scope.commands || {}) } };
  if (role.startsWith("custom.")) {
    next.commands.custom = { ...(next.commands.custom || {}), [role.slice("custom.".length)]: entry };
  } else {
    next.commands[role] = entry;
  }
  return next;
}

function renderInferredCommand(entry, approvalMode = "human") {
  return {
    command: entry.command,
    method: approvalMode === "autonomous" ? "inferred" : "reviewed",
    confidence: entry.confidence,
    sourceRefs: entry.sourceRefs,
    sourceFingerprintAtSelection: entry.sourceFingerprintAtSelection,
    requiresEnvironment: entry.requiresEnvironment,
    requiresSecrets: entry.requiresSecrets,
    alternatives: entry.alternatives || []
  };
}

export function renderScopeCommandSet({ operationId, scopeId, role, command, requiresEnvironment, requiresSecrets, declaredBy, declaredAt }, currentScope) {
  if (!currentScope || currentScope.id !== scopeId) {
    throw new Error(`scope not found for scope.command.set: ${scopeId}`);
  }
  const nextScope = setCommand(currentScope, role, {
    command,
    method: "declared",
    declaredBy,
    declaredAt,
    declaredOperationId: operationId,
    requiresEnvironment,
    requiresSecrets,
    alternatives: []
  });
  return new Map([[`scopes/${scopeId}/scope.yml`, stringifyYaml(nextScope)]]);
}

function sourceIdForAction(index, entry, assignments) {
  if (entry.action === "add") {
    const assigned = assignments.find((candidate) => candidate.sourceActionIndex === index);
    if (!assigned) throw new Error(`missing source id assignment for sources[${index}]`);
    return assigned.sourceId;
  }
  return entry.sourceId;
}

function scopeIdForProposal(index, assignments) {
  const assigned = assignments.find((candidate) => candidate.scopeIndex === index);
  if (!assigned) throw new Error(`missing scope id assignment for scopes[${index}]`);
  return assigned.scopeId;
}

function renderSource(entry, existing, { id, operationId, confirmedBy, confirmedAt }) {
  if (entry.action === "remove") return null;
  const next = {
    ...(existing || {}),
    schemaVersion: 1,
    id,
    path: entry.path || existing?.path,
    family: entry.family || existing?.family,
    kind: entry.kind || existing?.kind,
    role: entry.role || existing?.role,
    authority: entry.authority || existing?.authority,
    availability: entry.availability || existing?.availability,
    confirmedFingerprint: entry.observedFingerprint,
    confirmedContentHash: entry.observedContentHash,
    provenance: {
      discoveredBy: "discovery.propose",
      confirmedBy,
      confirmedAt,
      confirmedOperationId: operationId
    }
  };
  return next;
}

export function renderDiscoveryPropose({ operationId, proposal, sourceIdAssignments, scopeIdAssignments, confirmedBy, confirmedAt }, currentConfig, workspaceRoot, { currentSources = [], currentScopes = [], approvalMode = "human" } = {}) {
  const rendered = new Map();
  const sourcesById = new Map(currentSources.map((source) => [source.id, source]));
  const scopesById = new Map(currentScopes.map((scope) => [scope.id, scope]));

  for (const [index, entry] of (proposal.sources || []).entries()) {
    const sourceId = sourceIdForAction(index, entry, sourceIdAssignments);
    const existing = sourcesById.get(sourceId);
    const nextSource = renderSource(entry, existing, { id: sourceId, operationId, confirmedBy, confirmedAt });
    rendered.set(`sources/${sourceId}/source.yml`, nextSource === null ? null : stringifyYaml(nextSource));
  }

  let nextConfig = currentConfig;
  for (const [index, entry] of (proposal.scopes || []).entries()) {
    confineScopePath(workspaceRoot, entry.path);
    const scopeId = scopeIdForProposal(index, scopeIdAssignments);
    const scope = {
      schemaVersion: 1,
      id: scopeId,
      key: toKebabCase(entry.key),
      label: entry.label,
      kind: entry.kind,
      path: entry.path,
      owner: entry.owner ?? null
    };
    rendered.set(`scopes/${scopeId}/scope.yml`, stringifyYaml(scope));
    nextConfig = {
      ...nextConfig,
      scopeRefs: [...(nextConfig.scopeRefs || []), { id: scopeId, key: scope.key }]
    };
  }
  if ((proposal.scopes || []).length > 0) rendered.set("config.yml", stringifyYaml(nextConfig));

  for (const entry of proposal.scopeCommands || []) {
    const currentScope = scopesById.get(entry.scopeId);
    if (!currentScope) throw new Error(`scope not found for discovery command: ${entry.scopeId}`);
    const nextScope = setCommand(currentScope, entry.role, renderInferredCommand(entry, approvalMode));
    rendered.set(`scopes/${entry.scopeId}/scope.yml`, stringifyYaml(nextScope));
    scopesById.set(entry.scopeId, nextScope);
  }

  return rendered;
}
