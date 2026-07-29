import fs from "node:fs";
import path from "node:path";
import { stringifyYaml, parseYaml } from "../lib/yaml.mjs";
import { confineScopePath, confineUnder } from "../lib/paths.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES, DIRECTORY_RENDER_ENTRY } from "../lib/bootstrapTopology.mjs";
import { assertProjectContextConsistency } from "../lib/projectContextValidation.mjs";
import { revisionHash, contentHash } from "../lib/canonical.mjs";
import { renderGuideMarkdown } from "../lib/guideProjection.mjs";
import { renderReleaseReadme } from "../lib/releaseProjection.mjs";
import { validate } from "../lib/schema.mjs";
import { generateUuidV7 } from "../lib/ids.mjs";
import { releaseReadmeRelativePath, releaseYamlRelativePath } from "../lib/releaseStore.mjs";

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

function withReleaseRevision(releaseWithoutRevision) {
  const revision = `sha256:${revisionHash(releaseWithoutRevision)}`;
  return {
    ...releaseWithoutRevision,
    audit: { ...releaseWithoutRevision.audit, revision }
  };
}

export function renderReleaseCreate(payload) {
  const policyMode = payload.policyMode;
  if (!["strict_sequence", "dependency_graph"].includes(policyMode)) throw new Error(`unsupported release policy mode: ${policyMode}`);
  const laneId = payload.laneId;
  if (typeof laneId !== "string" || laneId.length === 0) throw new Error("release.create payload requires resolved laneId");
  const withoutRevision = {
    schemaVersion: 1,
    id: payload.id,
    displayId: payload.displayId,
    displayIdStatus: payload.displayIdStatus,
    slug: payload.slug ?? null,
    title: payload.title,
    objective: payload.objective,
    status: "DRAFT",
    lane: { id: laneId },
    policy: { mode: policyMode, previousReleaseRefs: [], dependencyRefs: [] },
    scopeRefs: [],
    itemRefs: [],
    blockers: [],
    risks: [],
    deploymentEvents: [],
    finalization: { completed: false, completedAt: null, completedBy: null, retrospectiveStatus: "not_started" },
    audit: {
      createdAt: payload.createdAt,
      createdBy: payload.createdBy,
      updatedAt: payload.updatedAt,
      updatedBy: payload.updatedBy,
      operationId: payload.operationId
    }
  };
  const release = withReleaseRevision(withoutRevision);
  const result = validate("release", release);
  if (!result.valid) throw new Error(`release.create produced invalid release: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  return new Map([
    [releaseYamlRelativePath(payload.id), stringifyYaml(release)],
    [releaseReadmeRelativePath(payload.id), renderReleaseReadme(release)]
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

export function renderScopeGeneratorSet({ scopeId, guideKind, generator }, currentScope, workspaceRoot) {
  if (!currentScope || currentScope.id !== scopeId) throw new Error(`scope not found for scope.generator.set: ${scopeId}`);
  if (!["task", "test"].includes(guideKind)) throw new Error("scope.generator.set guideKind must be task or test");
  const customGenerators = { ...(currentScope.customGenerators || {}) };
  if (generator === null) {
    delete customGenerators[guideKind];
  } else {
    const executable = confineUnder(workspaceRoot, generator.executable);
    if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw new Error("generator executable must resolve to an existing workspace file");
    if (generator.cwd) {
      const cwd = confineUnder(workspaceRoot, generator.cwd);
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("generator cwd must resolve to an existing workspace directory");
    }
    customGenerators[guideKind] = generator;
  }
  const nextScope = { ...currentScope, customGenerators };
  if (Object.keys(customGenerators).length === 0) delete nextScope.customGenerators;
  const result = validate("scope", nextScope);
  if (!result.valid) throw new Error(`scope.generator.set produced invalid scope: ${result.errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`);
  return new Map([[`scopes/${scopeId}/scope.yml`, stringifyYaml(nextScope)]]);
}

const GUIDE_KINDS = new Set(["task", "test"]);
const GUIDE_ACTIONS = new Set(["generate", "submit_review", "approve", "reject", "mark_stale", "regenerate"]);

function guideFileName(kind) {
  return `${kind}-guide.yml`;
}

function guideProjectionName(kind) {
  return `${kind}-guide.md`;
}

function readScopeForGuide(planningRoot, scopeId) {
  const scopePath = path.join(planningRoot, "scopes", scopeId, "scope.yml");
  if (!fs.existsSync(scopePath)) throw new Error(`scope not found for guide.update: ${scopeId}`);
  const scope = parseYaml(fs.readFileSync(scopePath, "utf8"));
  const scopeResult = validate("scope", scope);
  if (!scopeResult.valid) throw new Error(`existing scope is invalid: ${scopeResult.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  if (scope.id !== scopeId) throw new Error(`scope id does not match its directory: ${scopeId}`);
  return scope;
}

function assertClosedGuideInput(document) {
  const allowed = new Set([
    "sourceRefs", "openGaps", "workPackageTypes", "taskTypes", "requiredSections",
    "requiredGateRefs", "templateRefs", "decompositionRules", "automation",
    "gatesByWorkPackageType", "gatesByTaskType", "commandRefs", "evidenceRequirements",
    "testData", "executionContexts", "environments"
  ]);
  for (const key of Object.keys(document || {})) {
    if (!allowed.has(key)) throw new Error(`guide document contains unsupported field: ${key}`);
  }
  if (!Array.isArray(document?.sourceRefs) || document.sourceRefs.length === 0) throw new Error("guide document requires at least one sourceRefs entry");
  if (!Array.isArray(document.openGaps)) throw new Error("guide document requires openGaps array");
}

function buildGuideDocument({ payload, scopeId, guideKind, guideId, proposedAt, currentSources, planningRoot }) {
  assertClosedGuideInput(payload.document);
  const sourceById = new Map(currentSources.map((source) => [source.id, source]));
  const sourceRefs = [...new Set(payload.document.sourceRefs)];
  const sourceFingerprints = {};
  for (const sourceId of sourceRefs) {
    const source = sourceById.get(sourceId);
    if (!source) throw new Error(`guide sourceRef does not resolve: ${sourceId}`);
    if (!source.confirmedFingerprint) throw new Error(`guide sourceRef has no confirmed fingerprint: ${sourceId}`);
    sourceFingerprints[sourceId] = source.confirmedFingerprint;
  }
  const evidence = payload.generationEvidence;
  if (!evidence || evidence.generationOutputHash !== revisionHash(payload.document)) throw new Error("guide generation evidence does not match the generated document");
  const provenance = {
    sourceMapRevision: revisionHash({ sourceRefs, sourceFingerprints }),
    generationMethod: evidence.generationMethod,
    generatorVersion: evidence.generatorVersion,
    generatorFingerprint: evidence.generatorFingerprint,
    model: null,
    promptVersion: null,
    generatedAt: proposedAt,
    sourceFingerprints,
    generationInputHash: evidence.generationInputHash,
    generationOutputHash: evidence.generationOutputHash
  };
  const common = {
    schemaVersion: 1,
    dslVersion: 1,
    id: guideId,
    scopeId,
    kind: guideKind,
    sourceRefs,
    provenance,
    openGaps: payload.document.openGaps
  };
  const withoutRevision = guideKind === "task" ? {
    ...common,
    workPackageTypes: payload.document.workPackageTypes,
    taskTypes: payload.document.taskTypes,
    requiredSections: payload.document.requiredSections,
    requiredGateRefs: payload.document.requiredGateRefs,
    templateRefs: payload.document.templateRefs,
    decompositionRules: payload.document.decompositionRules,
    automation: payload.document.automation
  } : {
    ...common,
    gatesByWorkPackageType: payload.document.gatesByWorkPackageType,
    gatesByTaskType: payload.document.gatesByTaskType,
    commandRefs: payload.document.commandRefs,
    evidenceRequirements: payload.document.evidenceRequirements,
    testData: payload.document.testData,
    executionContexts: payload.document.executionContexts,
    environments: payload.document.environments
  };
  if (guideKind === "test") {
    const scope = readScopeForGuide(planningRoot, scopeId);
    const commandRefs = new Set(Object.keys(scope.commands || {}).filter((key) => key !== "custom"));
    for (const ref of payload.document.commandRefs) {
      if (ref.startsWith("custom.")) {
        if (!scope.commands?.custom?.[ref.slice("custom.".length)]) throw new Error(`guide commandRef does not resolve: ${ref}`);
      } else if (!commandRefs.has(ref)) throw new Error(`guide commandRef does not resolve: ${ref}`);
    }
  }
  const document = { ...withoutRevision, revision: `sha256:${revisionHash(withoutRevision)}` };
  const schemaResult = validate("guide", document);
  if (!schemaResult.valid) throw new Error(schemaResult.errors.map((error) => `guide${error.path}: ${error.message}`).join("; "));
  return document;
}

function guideMetadata(document, status, scopeId, content, approval = null) {
  return {
    id: document.id,
    scopeId,
    kind: document.kind,
    status,
    path: guideFileName(document.kind),
    projection: guideProjectionName(document.kind),
    revision: document.revision,
    contentHash: contentHash(content),
    sourceRefs: document.sourceRefs,
    provenance: document.provenance,
    approval
  };
}

function sameCanonicalValue(left, right) {
  return revisionHash(left) === revisionHash(right);
}

function assertGuideAggregateIntegrity({ document, metadata, scopeId, guideKind, guideContent, currentSources }) {
  const result = validate("guide", document);
  if (!result.valid) throw new Error(`existing guide is invalid: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  if (document.id !== metadata.id || document.scopeId !== scopeId || document.kind !== guideKind) {
    throw new Error("guide metadata does not match canonical guide document");
  }
  const { revision, ...withoutRevision } = document;
  const expectedRevision = `sha256:${revisionHash(withoutRevision)}`;
  if (revision !== expectedRevision) throw new Error("guide revision does not match canonical guide content");
  const fingerprintKeys = Object.keys(document.provenance?.sourceFingerprints || {}).sort();
  const sourceRefKeys = [...document.sourceRefs].sort();
  if (!sameCanonicalValue(fingerprintKeys, sourceRefKeys)) throw new Error("guide provenance sourceFingerprints keys do not match sourceRefs");
  const expectedSourceMapRevision = revisionHash({ sourceRefs: document.sourceRefs, sourceFingerprints: document.provenance.sourceFingerprints });
  if (document.provenance.sourceMapRevision !== expectedSourceMapRevision) throw new Error("guide provenance sourceMapRevision does not match its source fingerprint map");
  const knownSourceIds = new Set(currentSources.map((source) => source.id));
  for (const sourceId of document.sourceRefs) {
    if (!knownSourceIds.has(sourceId)) throw new Error(`guide sourceRef does not resolve: ${sourceId}`);
  }
  const actualContentHash = contentHash(guideContent);
  if (metadata.revision !== document.revision || metadata.contentHash !== actualContentHash || !sameCanonicalValue(metadata.sourceRefs, document.sourceRefs) || !sameCanonicalValue(metadata.provenance, document.provenance)) {
    throw new Error("guide metadata revision/content/provenance does not match canonical guide document");
  }
  if (metadata.status === "approved") {
    if (!metadata.approval || metadata.approval.revision !== document.revision || metadata.approval.contentHash !== actualContentHash) {
      throw new Error("approved guide metadata is not bound to the canonical guide revision/content hash");
    }
  } else if (metadata.approval !== null) {
    throw new Error("non-approved guide metadata must not retain approval binding");
  }
}

function readExistingGuide({ planningRoot, scopeId, guideKind, metadata, currentSources }) {
  const relativePath = `scopes/${scopeId}/${guideFileName(guideKind)}`;
  const absolutePath = path.join(planningRoot, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`guide does not exist for ${guideKind}/${scopeId}`);
  const guideContent = fs.readFileSync(absolutePath, "utf8");
  const document = parseYaml(guideContent);
  assertGuideAggregateIntegrity({ document, metadata, scopeId, guideKind, guideContent, currentSources });
  return { document, guideContent };
}

function updateGuideGap(config, scopeId, guides) {
  const bothApproved = ["task", "test"].every((kind) => guides[kind]?.status === "approved");
  const documentation = config.documentation || { source_refs: [], gaps: [] };
  const gaps = documentation.gaps || [];
  const isMissingGuideGap = (gap) => gap.concern === "guides" && gap.status === "missing" && gap.scope_ref === scopeId;
  return {
    ...config,
    documentation: {
      ...documentation,
      gaps: bothApproved
        ? gaps.filter((gap) => !isMissingGuideGap(gap))
        : gaps.some(isMissingGuideGap)
          ? gaps
          : [...gaps, { id: generateUuidV7(), concern: "guides", status: "missing", description: `scope ${scopeId} has no approved task and test guides`, scope_ref: scopeId }]
    }
  };
}

export function renderGuideUpdate(payload, currentConfig, planningRoot, { currentSources = [], proposedAt, approval = null } = {}) {
  if (!GUIDE_KINDS.has(payload.guideKind) || !GUIDE_ACTIONS.has(payload.action)) throw new Error("guide.update has an unsupported kind or action");
  const scope = readScopeForGuide(planningRoot, payload.scopeId);
  const currentMetadata = scope.guides?.[payload.guideKind] || null;
  const guideRelativePath = `scopes/${payload.scopeId}/${guideFileName(payload.guideKind)}`;

  // A Guide aggregate transition may depend on the other Guide when deciding
  // whether the Corte 0 missing-guide gap can be resolved. Validate every
  // existing canonical Guide before deriving the new aggregate state.
  const existingGuides = {};
  for (const kind of ["task", "test"]) {
    const metadata = scope.guides?.[kind];
    if (!metadata) continue;
    existingGuides[kind] = readExistingGuide({ planningRoot, scopeId: payload.scopeId, guideKind: kind, metadata, currentSources });
  }

  let document = null;
  let guideContent = null;
  if (["generate", "regenerate"].includes(payload.action)) {
    const guideId = payload.action === "regenerate" ? currentMetadata?.id : payload.guideId;
    if (!guideId) throw new Error("guide generation requires a server-owned guide id");
    document = buildGuideDocument({ payload, scopeId: payload.scopeId, guideKind: payload.guideKind, guideId, proposedAt, currentSources, planningRoot });
    guideContent = stringifyYaml(document);
  } else {
    if (!currentMetadata || !existingGuides[payload.guideKind]) throw new Error(`guide does not exist for ${payload.guideKind}/${payload.scopeId}`);
    ({ document, guideContent } = existingGuides[payload.guideKind]);
  }

  const currentStatus = currentMetadata?.status || null;
  const allowedTransitions = {
    generate: [null],
    regenerate: ["stale", "rejected"],
    submit_review: ["generated"],
    approve: ["reviewed"],
    reject: ["generated", "reviewed"],
    mark_stale: ["approved"]
  };
  if (!allowedTransitions[payload.action].includes(currentStatus)) throw new Error(`invalid guide transition ${currentStatus || "absent"} -> ${payload.action}`);
  const nextStatus = payload.action === "approve" ? (approval ? "approved" : "reviewed")
    : payload.action === "generate" || payload.action === "regenerate" ? "generated"
      : payload.action === "submit_review" ? "reviewed"
        : payload.action === "reject" ? "rejected" : "stale";
  const nextApproval = nextStatus === "approved" ? {
    actor: approval.actor,
    approvedAt: approval.approvedAt,
    changeSetHash: approval.changeSetHash,
    revision: document.revision,
    contentHash: contentHash(guideContent)
  } : null;
  const nextScope = {
    ...scope,
    guides: {
      ...(scope.guides || {}),
      [payload.guideKind]: guideMetadata(document, nextStatus, payload.scopeId, guideContent, nextApproval)
    }
  };
  const nextConfig = updateGuideGap(currentConfig, payload.scopeId, nextScope.guides);
  const rendered = new Map([
    [`scopes/${payload.scopeId}/scope.yml`, stringifyYaml(nextScope)],
    ["config.yml", stringifyYaml(nextConfig)],
    [guideRelativePath, guideContent]
  ]);
  if (["generate", "regenerate"].includes(payload.action)) rendered.set(`scopes/${payload.scopeId}/${guideProjectionName(payload.guideKind)}`, renderGuideMarkdown(document));
  return rendered;
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
