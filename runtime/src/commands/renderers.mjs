import { stringifyYaml } from "../lib/yaml.mjs";
import { confineScopePath } from "../lib/paths.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES, DIRECTORY_RENDER_ENTRY } from "../lib/bootstrapTopology.mjs";
import { assertProjectContextConsistency } from "../lib/projectContextValidation.mjs";

function toKebabCase(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}

function withEnabledScope(config, scopeId) {
  const currentCatalog = config.scopeCatalog || { directory: ".planning/scopes", enabled: [] };
  return {
    ...config,
    scopeCatalog: {
      ...currentCatalog,
      enabled: [...new Set([...(currentCatalog.enabled || []), scopeId])]
    }
  };
}

export function renderWorkspaceInit({ name, baseBranch = null, vcs, projectType = "unknown", pluginVersion, templatePackFingerprint }) {
  const templatePackVendorSnapshot = `.planning/vendor/template-packs/${templatePackFingerprint.replace(":", "-")}`;
  const config = {
    schemaVersion: 1,
    name,
    baseBranch,
    vcs,
    project: { name, type: projectType },
    plugin: { schemaVersion: 1, launcher: "shipping-mode" },
    git: {
      enabled: vcs === "git",
      provider: vcs === "git" ? "none" : "none",
      ...(vcs === "git" ? { branches: { work_base: baseBranch, integration: null, production: null } } : {})
    },
    work_sources: [],
    documentation: { source_refs: [], gaps: [] },
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

export function renderConfigUpdate(payload, currentConfig, { knownSourceIds = [] } = {}) {
  const baseConfig = currentConfig || {};
  const nextConfig = { ...baseConfig };
  if (payload.name !== undefined) {
    nextConfig.name = payload.name;
    nextConfig.project = { ...(baseConfig.project || {}), name: payload.name };
  }
  if (payload.git !== undefined) {
    nextConfig.git = payload.git;
    nextConfig.vcs = payload.git.enabled ? "git" : "none";
    nextConfig.baseBranch = payload.git.enabled ? (payload.git.branches?.work_base ?? null) : null;
  }
  if (payload.work_sources !== undefined) nextConfig.work_sources = payload.work_sources;
  if (payload.documentation !== undefined) nextConfig.documentation = payload.documentation;
  assertProjectContextConsistency(nextConfig, { knownSourceIds });
  return new Map([["config.yml", stringifyYaml(nextConfig)]]);
}

export function renderConfigAutonomySet({ discovery }, currentConfig) {
  const nextConfig = { ...currentConfig, autonomy: { discovery } };
  return new Map([["config.yml", stringifyYaml(nextConfig)]]);
}

export function renderScopeAdd({ id, key, label, kind, path: scopePath, owner = null, guideGapId = id }, currentConfig, workspaceRoot) {
  confineScopePath(workspaceRoot, scopePath); // throws PathConfinementError on violation; read-only check

  const normalizedKey = toKebabCase(key);
  const existingKeys = new Set((currentConfig.scopeRefs || []).map((ref) => ref.key.toLowerCase()));
  if (existingKeys.has(normalizedKey)) {
    throw new Error(`scope key already exists: ${normalizedKey}`);
  }

  const documentation = currentConfig.documentation || { source_refs: [], gaps: [] };
  const nextConfig = withEnabledScope({
    ...currentConfig,
    scopeRefs: [...(currentConfig.scopeRefs || []), { id, key: normalizedKey }],
    documentation: {
      ...documentation,
      gaps: [...(documentation.gaps || []), {
        id: guideGapId,
        concern: "guides",
        status: "missing",
        description: `scope ${normalizedKey} has no approved guide`,
        scope_ref: id
      }]
    }
  }, id);
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

function scopeAssignmentForProposal(index, assignments) {
  const assigned = assignments.find((candidate) => candidate.scopeIndex === index);
  if (!assigned) throw new Error(`missing scope id assignment for scopes[${index}]`);
  return assigned;
}

function referencedDocumentationSourceIds(config) {
  return new Set([
    ...(config.documentation?.source_refs || []),
    ...(config.documentation?.gaps || []).flatMap((gap) => gap.source_refs || [])
  ]);
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
  const protectedDocumentationSourceIds = referencedDocumentationSourceIds(currentConfig);

  for (const [index, entry] of (proposal.sources || []).entries()) {
    const sourceId = sourceIdForAction(index, entry, sourceIdAssignments);
    if (entry.action === "remove" && protectedDocumentationSourceIds.has(sourceId)) {
      throw new Error(`cannot remove Documentation Source ${sourceId}: Project Context still references it; remove the approved reference with config.update first`);
    }
    const existing = sourcesById.get(sourceId);
    const nextSource = renderSource(entry, existing, { id: sourceId, operationId, confirmedBy, confirmedAt });
    rendered.set(`sources/${sourceId}/source.yml`, nextSource === null ? null : stringifyYaml(nextSource));
  }

  let nextConfig = currentConfig;
  for (const [index, entry] of (proposal.scopes || []).entries()) {
    confineScopePath(workspaceRoot, entry.path);
    const scopeAssignment = scopeAssignmentForProposal(index, scopeIdAssignments);
    const scopeId = scopeAssignment.scopeId;
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
    nextConfig = withEnabledScope({
      ...nextConfig,
      scopeRefs: [...(nextConfig.scopeRefs || []), { id: scopeId, key: scope.key }],
      documentation: {
        ...(nextConfig.documentation || { source_refs: [], gaps: [] }),
        gaps: [...(nextConfig.documentation?.gaps || []), {
          id: scopeAssignment.guideGapId,
          concern: "guides",
          status: "missing",
          description: `scope ${scope.key} has no approved guide`,
          scope_ref: scopeId
        }]
      }
    }, scopeId);
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
