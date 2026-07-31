import fs from "node:fs";
import path from "node:path";
import { generateUuidV7, isUuidV7 } from "./ids.mjs";
import { revisionHash } from "./canonical.mjs";
import { validate } from "./schema.mjs";
import { confineRuntimeWritePath, confineScopePath, confineWritePath } from "./paths.mjs";
import { resolveReleaseReference, readReleaseFile } from "./releaseStore.mjs";
import { deriveUniqueReleaseItemDisplayId, isReleaseItemDisplayIdForUuid } from "./releaseItemIdentity.mjs";
import { releaseItemCreateRequestHash, renderReleaseItemCreate } from "./releaseItemCreate.mjs";
import { assertReleaseParentCanAcceptItem, listReleaseItemDocuments, listReservedReleaseItemDocuments, releaseItemCatalogFindings, releaseItemReadmeRelativePath, releaseItemYamlRelativePath } from "./releaseItemStore.mjs";
import { buildWorkSourceRegistry, WORK_SOURCE_CAPABILITIES } from "./workSourceProvider.mjs";
import { LocalRepositoryWorkSource } from "./localRepositoryWorkSource.mjs";
import { JiraMcpWorkSource } from "./jiraMcpWorkSource.mjs";
import { HostWorkSourceTransport } from "./hostWorkSourceTransport.mjs";
import { parseYaml } from "./yaml.mjs";
import { assertProjectContextConsistency } from "./projectContextValidation.mjs";

const SECRET_KEY_PATTERN = /(token|secret|password|cookie|credential|authorization|auth|api[-_]?key|refresh)/i;
const SUPPORTED_MAPPINGS = new Set([1]);
const SUPPORTED_KINDS = new Set(["user_story", "capability", "defect", "enabler", "spike", "compliance", "migration", "operational"]);
const JIRA_READ_CAPABILITIES = new Set(["discover", "search", "get"]);
const JIRA_REQUIRED_FIELDS_BY_KIND = {
  user_story: ["actor", "need", "value", "acceptanceCriteria"],
  capability: ["outcome", "behavior", "acceptanceCriteria"],
  defect: ["observedBehavior", "expectedBehavior", "reproduction", "severity"],
  enabler: ["technicalOutcome", "unlockedCapabilities"],
  spike: ["question", "timebox", "expectedDecision"],
  compliance: ["obligation", "authority", "deadline", "evidence"],
  migration: ["sourceState", "targetState", "rollback"],
  operational: ["procedure", "owner", "evidence"]
};

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

export function readValidatedWorkSourceConfig(planningRoot) {
  const configPath = confineRuntimeWritePath(planningRoot, "config.yml");
  if (!fs.existsSync(configPath)) throw new Error("workspace config.yml not found");
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("config.yml must be a real file");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  const schema = validate("config", config);
  if (!schema.valid) throw new Error(`config.yml is schema-invalid: ${schema.errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`);
  assertProjectContextConsistency(config);
  return config;
}

function normalizeCapabilityList(value, field) {
  const capabilities = value === undefined ? [] : value;
  if (!Array.isArray(capabilities)) throw new Error(`${field} must be an array`);
  const seen = new Set();
  for (const capability of capabilities) {
    if (!WORK_SOURCE_CAPABILITIES.includes(capability)) throw new Error(`${field} contains unknown capability ${capability}`);
    if (seen.has(capability)) throw new Error(`${field} contains duplicate capability ${capability}`);
    seen.add(capability);
  }
  return [...seen];
}

function normalizeRoot(workspaceRoot, sourceId, root, { enabled }) {
  const normalized = requireString(root, `work source ${sourceId} root`).replaceAll("\\", "/").replace(/\/+$/g, "");
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`work source ${sourceId} root must remain inside the workspace`);
  }
  confineWritePath(workspaceRoot, normalized);
  const absolutePath = confineScopePath(workspaceRoot, normalized);
  if (!fs.existsSync(absolutePath)) {
    if (!enabled) return { relativePath: normalized, absolutePath };
    throw new Error(`work source ${sourceId} root is unavailable: ${normalized}`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`work source ${sourceId} root must be a real directory: ${normalized}`);
  return { relativePath: normalized, absolutePath };
}

function normalizeLocalOptions(value, sourceId) {
  const options = value === undefined ? {} : value;
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error(`work source ${sourceId} options must be an object`);
  const allowed = new Set(["file_globs", "max_item_bytes"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(`work source ${sourceId} options contains unsupported field ${key}`);
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`work source ${sourceId} options must not contain secrets`);
  }
  return {
    ...(options.file_globs === undefined ? {} : { file_globs: normalizeStringArray(options.file_globs, `work source ${sourceId} options.file_globs`) }),
    ...(options.max_item_bytes === undefined ? {} : { max_item_bytes: normalizePositiveInteger(options.max_item_bytes, `work source ${sourceId} options.max_item_bytes`) })
  };
}

function normalizeFieldSelector(value, field) {
  const selector = requireString(value, field);
  if (!/^(summary|description|status|priority|labels|parent|epic|links|assignee|customfield_[0-9]{1,10})$/.test(selector)) {
    throw new Error(`${field} must be a closed Jira field selector`);
  }
  return selector;
}

function normalizeJiraOptions(value, sourceId) {
  const options = value === undefined ? {} : value;
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error(`work source ${sourceId} options must be an object`);
  const allowed = new Set(["project_keys", "query_scope", "allowed_issue_types", "field_map"]);
  for (const key of Object.keys(options)) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`work source ${sourceId} options must not contain secrets`);
    if (!allowed.has(key)) throw new Error(`work source ${sourceId} options contains unsupported field ${key}`);
  }
  const projectKeys = normalizeStringArray(options.project_keys, `work source ${sourceId} options.project_keys`);
  for (const key of projectKeys) {
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(key)) throw new Error(`work source ${sourceId} project key is invalid: ${key}`);
  }
  const queryScope = options.query_scope;
  if (!queryScope || typeof queryScope !== "object" || Array.isArray(queryScope)) throw new Error(`work source ${sourceId} options.query_scope must be an object`);
  for (const key of Object.keys(queryScope)) {
    if (!["mode", "max_results"].includes(key)) throw new Error(`work source ${sourceId} query_scope contains unsupported field ${key}`);
  }
  if (queryScope.mode !== "project_keys_and_text") throw new Error(`work source ${sourceId} query_scope.mode must be project_keys_and_text`);
  const maxResults = normalizePositiveInteger(queryScope.max_results, `work source ${sourceId} query_scope.max_results`);
  if (maxResults > 100) throw new Error(`work source ${sourceId} query_scope.max_results exceeds limit`);
  const allowedIssueTypes = normalizeStringArray(options.allowed_issue_types, `work source ${sourceId} options.allowed_issue_types`);
  for (const type of allowedIssueTypes) {
    if (!["Story", "Bug", "Epic", "Spike"].includes(type)) throw new Error(`work source ${sourceId} issue type is not allowed: ${type}`);
  }
  const fieldMap = options.field_map;
  if (!fieldMap || typeof fieldMap !== "object" || Array.isArray(fieldMap)) throw new Error(`work source ${sourceId} options.field_map must be an object`);
  const normalizedFieldMap = {};
  for (const issueType of allowedIssueTypes) {
    const mapping = fieldMap[issueType];
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error(`work source ${sourceId} field_map missing issue type ${issueType}`);
    const kind = requireString(mapping.kind, `work source ${sourceId} field_map.${issueType}.kind`);
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`work source ${sourceId} field_map.${issueType}.kind is unsupported: ${kind}`);
    const normalizedMapping = { kind };
    for (const [field, selector] of Object.entries(mapping)) {
      if (field === "kind") continue;
      if (SECRET_KEY_PATTERN.test(field)) throw new Error(`work source ${sourceId} field_map must not contain secrets`);
      normalizedMapping[field] = normalizeFieldSelector(selector, `work source ${sourceId} field_map.${issueType}.${field}`);
    }
    for (const field of JIRA_REQUIRED_FIELDS_BY_KIND[kind] || []) {
      if (!normalizedMapping[field]) throw new Error(`work source ${sourceId} field_map.${issueType} missing required field ${field}`);
    }
    normalizedFieldMap[issueType] = normalizedMapping;
  }
  for (const issueType of Object.keys(fieldMap)) {
    if (!allowedIssueTypes.includes(issueType)) throw new Error(`work source ${sourceId} field_map contains undeclared issue type ${issueType}`);
  }
  return {
    project_keys: projectKeys.sort(),
    query_scope: { mode: "project_keys_and_text", max_results: maxResults },
    allowed_issue_types: allowedIssueTypes.sort(),
    field_map: Object.fromEntries(Object.entries(normalizedFieldMap).sort(([left], [right]) => left.localeCompare(right)))
  };
}

function normalizeStringArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const normalized = value.map((entry) => requireString(entry, field));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} cannot contain duplicates`);
  return normalized;
}

function normalizePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}

export function workSourceConfigSnapshot(source) {
  return {
    id: source.id,
    provider: source.provider,
    ...(source.transport ? { transport: source.transport } : {}),
    ...(source.connectionRef ? { connectionRef: source.connectionRef } : {}),
    enabled: source.enabled,
    roots: source.roots.map((root) => root.relativePath),
    mappingVersion: source.mappingVersion,
    ...(source.mappingProfile ? { mappingProfile: source.mappingProfile } : {}),
    importPolicy: source.importPolicy,
    syncMode: source.syncMode,
    capabilities: [...source.capabilities],
    options: structuredClone(source.options)
  };
}

export function workSourceConfigHash(source) {
  return revisionHash(workSourceConfigSnapshot(source));
}

export function normalizeWorkSourceConfig({ config, workspaceRoot }) {
  const sourceIds = new Set();
  return (config.work_sources || []).map((source) => {
    const id = requireString(source.id, "work source id");
    if (sourceIds.has(id)) throw new Error(`duplicate Work Source id: ${id}`);
    sourceIds.add(id);
    const provider = requireString(source.provider, `work source ${id} provider`);
    const mappingVersion = normalizePositiveInteger(source.mapping_version ?? source.mappingVersion, `work source ${id} mapping_version`);
    if (!SUPPORTED_MAPPINGS.has(mappingVersion)) throw new Error(`unsupported mapping version ${mappingVersion} for Work Source ${id}`);
    const importPolicy = requireString(source.import_policy ?? source.source_policy, `work source ${id} import_policy`);
    const syncMode = requireString(source.sync_mode, `work source ${id} sync_mode`);
    const enabled = source.enabled === true;
    if (provider === "local_repository" && importPolicy !== "import_snapshot") throw new Error(`local_repository Work Source ${id} requires import_snapshot policy`);
    if (provider === "local_repository" && syncMode !== "import_only") throw new Error(`local_repository Work Source ${id} requires sync mode import_only`);
    if (provider === "jira" && importPolicy !== "external_authoritative") throw new Error(`jira Work Source ${id} requires external_authoritative policy`);
    if (provider === "jira" && syncMode !== "pull") throw new Error(`jira Work Source ${id} requires sync mode pull`);
    if (provider !== "jira" && source.transport !== undefined) throw new Error(`work source ${id} transport is only supported for external Jira MCP`);
    if (provider === "jira" && source.transport !== "mcp") throw new Error(`jira Work Source ${id} requires transport mcp`);
    if (provider === "jira" && source.roots !== undefined) throw new Error(`jira Work Source ${id} must not declare roots`);
    const roots = provider === "jira" ? [] : (source.roots || []).map((root) => normalizeRoot(workspaceRoot, id, root, { enabled }));
    if (provider === "local_repository" && roots.length === 0) throw new Error(`local_repository Work Source ${id} requires at least one root`);
    const capabilities = normalizeCapabilityList(source.capabilities || (provider === "local_repository" ? ["discover", "search", "get"] : []), `work source ${id} capabilities`);
    if (provider === "jira") {
      for (const capability of capabilities) {
        if (!JIRA_READ_CAPABILITIES.has(capability)) throw new Error(`jira Work Source ${id} declares mutating capability ${capability}`);
      }
    }
    return {
      id,
      provider,
      ...(provider === "jira" ? { transport: "mcp", connectionRef: requireString(source.connection_ref ?? source.connectionRef, `work source ${id} connection_ref`) } : {}),
      enabled,
      roots,
      mappingVersion,
      ...(provider === "jira" ? { mappingProfile: requireString(source.mapping_profile ?? source.mappingProfile, `work source ${id} mapping_profile`) } : {}),
      importPolicy,
      syncMode,
      capabilities,
      options: provider === "jira" ? normalizeJiraOptions(source.options, id) : normalizeLocalOptions(source.options, id)
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function defaultWorkSourceRegistry({ planningRoot, runtimeContext = null }) {
  const workspaceRoot = path.dirname(planningRoot);
  const config = readValidatedWorkSourceConfig(planningRoot);
  const sources = normalizeWorkSourceConfig({ config, workspaceRoot });
  const hostTransport = runtimeContext?.workSourceTransport?.execute
    ? runtimeContext.workSourceTransport
    : runtimeContext?.workSourceTransport?.kind === "host-bridge"
      ? new HostWorkSourceTransport({ projectRoot: workspaceRoot, pluginDataDir: runtimeContext.workSourceTransport.pluginDataDir, sessionId: runtimeContext.workSourceTransport.sessionId })
      : null;
  return buildWorkSourceRegistry({
    providerFactories: [() => new LocalRepositoryWorkSource({ workspaceRoot }), () => new JiraMcpWorkSource({ transport: hostTransport })],
    sources
  });
}

export function assertSafeMetadata(value, { depth = 0, measuredBytes = null } = {}) {
  if (measuredBytes === null) {
    let serialized;
    try {
      serialized = JSON.stringify(value ?? null);
    } catch {
      throw new Error("metadata must be JSON-safe");
    }
    if (Buffer.byteLength(serialized, "utf8") > 8192) throw new Error("metadata exceeds safe size limit");
    measuredBytes = Buffer.byteLength(serialized, "utf8");
  }
  if (depth > 4) throw new Error("metadata exceeds safe depth limit");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > 32) throw new Error("metadata array exceeds safe length limit");
    for (const entry of value) assertSafeMetadata(entry, { depth: depth + 1, measuredBytes });
    return;
  }
  if (typeof value !== "object") throw new Error("metadata must be JSON-safe");
  const keys = Object.keys(value);
  if (keys.length > 32) throw new Error("metadata object exceeds safe key limit");
  for (const key of keys) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`metadata key is not allowed: ${key}`);
    assertSafeMetadata(value[key], { depth: depth + 1, measuredBytes });
  }
}

export function validateNormalizedWorkSourceItem(item) {
  const errors = [];
  const result = validate("normalized-work-source-item", item);
  if (!result.valid) errors.push(...result.errors.map((error) => `${error.path} ${error.message}`));
  try {
    assertSafeMetadata(item.metadata || {});
  } catch (error) {
    errors.push(error.message);
  }
  if (item?.trace?.kind === "external") {
    try {
      assertSafeMetadata(item.trace.evidence || {});
    } catch (error) {
      errors.push(`trace.evidence ${error.message}`);
    }
  }
  for (const [field, keyFn] of [
    ["acceptanceCriteria", (entry) => entry.id],
    ["relationships", (entry) => `${entry.type}:${entry.target}`],
    ["dependencies", (entry) => `${entry.type}:${entry.target}`]
  ]) {
    const values = Array.isArray(item[field]) ? item[field].map(keyFn) : [];
    if (new Set(values).size !== values.length) errors.push(`${field} contains duplicate semantic identities`);
  }
  return { valid: errors.length === 0, errors };
}

export function parseSourceRef(value) {
  const sourceRef = requireString(value, "source").trim();
  const separator = sourceRef.indexOf(":");
  if (separator <= 0 || separator === sourceRef.length - 1) throw new Error("--source must be <source-id>:<item-id-or-path>");
  return { sourceId: sourceRef.slice(0, separator), itemRef: sourceRef.slice(separator + 1) };
}

function normalizeImportIntent(rawPayload, { actor, defaultIdempotencyKey, releaseId, source, normalizedItem, role = "primary" }) {
  const configHash = workSourceConfigHash(source);
  const callerIntent = { sourceRef: `${source.id}:${normalizedItem.itemId}`, role };
  const requestSnapshot = {
    actor,
    releaseId,
    sourceId: source.id,
    provider: source.provider,
    itemId: normalizedItem.itemId,
    mappingVersion: source.mappingVersion,
    sourceConfigHash: configHash,
    sourceRevision: normalizedItem.revision.contentRevision || normalizedItem.revision.externalRevision || normalizedItem.revision.fingerprint,
    role,
    callerIntent
  };
  const idempotencyKey = rawPayload.idempotencyKey === undefined ? requireString(defaultIdempotencyKey, "idempotencyKey") : requireString(rawPayload.idempotencyKey, "idempotencyKey");
  return {
    requestSnapshot,
    idempotencyKey,
    idempotencyRequestHash: workSourceImportRequestHash({
      actor,
      releaseId,
      sourceId: source.id,
      provider: source.provider,
      itemId: normalizedItem.itemId,
      mappingVersion: source.mappingVersion,
      sourceConfigHash: configHash,
      observedRevision: requestSnapshot.sourceRevision,
      role
    })
  };
}

function mappedReleaseItemSnapshot(normalizedItem, sourceRef) {
  if (!SUPPORTED_KINDS.has(normalizedItem.type)) throw new Error(`unsupported Work Source item type: ${normalizedItem.type}`);
  const base = {
    kind: normalizedItem.type,
    title: normalizedItem.title,
    description: normalizedItem.description?.text ?? null,
    slug: null,
    dependencies: [],
    sourceRefs: [sourceRef]
  };
  const criteria = normalizedItem.acceptanceCriteria.map((entry) => entry.text);
  const fields = normalizedItem.fields;
  if (normalizedItem.type === "user_story") return { ...base, actor: fields.actor, need: fields.need, value: fields.value, acceptanceCriteria: criteria };
  if (normalizedItem.type === "capability") return { ...base, outcome: fields.outcome, behavior: fields.behavior, acceptanceCriteria: criteria };
  if (normalizedItem.type === "defect") return { ...base, observedBehavior: fields.observedBehavior, expectedBehavior: fields.expectedBehavior, reproduction: fields.reproduction, severity: fields.severity };
  if (normalizedItem.type === "enabler") return { ...base, technicalOutcome: fields.technicalOutcome, unlockedCapabilities: fields.unlockedCapabilities };
  if (normalizedItem.type === "spike") return { ...base, question: fields.question, timebox: fields.timebox, expectedDecision: fields.expectedDecision };
  if (normalizedItem.type === "compliance") return { ...base, obligation: fields.obligation, authority: fields.authority, deadline: fields.deadline, evidence: fields.evidence };
  if (normalizedItem.type === "migration") return { ...base, sourceState: fields.sourceState, targetState: fields.targetState, rollback: fields.rollback };
  if (normalizedItem.type === "operational") return { ...base, procedure: fields.procedure, owner: fields.owner, evidence: fields.evidence };
  throw new Error(`unsupported Work Source item type: ${normalizedItem.type}`);
}

export const MANAGED_FIELDS_BY_KIND = {
  user_story: ["/kind", "/title", "/description", "/actor", "/need", "/value", "/acceptanceCriteria"],
  capability: ["/kind", "/title", "/description", "/outcome", "/behavior", "/acceptanceCriteria"],
  defect: ["/kind", "/title", "/description", "/observedBehavior", "/expectedBehavior", "/reproduction", "/severity"],
  enabler: ["/kind", "/title", "/description", "/technicalOutcome", "/unlockedCapabilities"],
  spike: ["/kind", "/title", "/description", "/question", "/timebox", "/expectedDecision"],
  compliance: ["/kind", "/title", "/description", "/obligation", "/authority", "/deadline", "/evidence"],
  migration: ["/kind", "/title", "/description", "/sourceState", "/targetState", "/rollback"],
  operational: ["/kind", "/title", "/description", "/procedure", "/owner", "/evidence"]
};

export function managedSnapshotFromReleaseSnapshot(snapshot, managedFields) {
  return Object.fromEntries(managedFields.map((pointer) => [pointer.slice(1), snapshot[pointer.slice(1)] ?? null]));
}

function sourceRefIdentityHash(sourceRef) {
  return `sha256:${revisionHash(sourceRef)}`;
}

function sourceRevisionFromRef(sourceRef) {
  return sourceRef.externalRevision || sourceRef.contentRevision || sourceRef.fingerprint;
}

function locatorFromSourceRef(sourceRef) {
  if (sourceRef.provider === "local_repository") return { itemId: sourceRef.itemId, path: sourceRef.path };
  return { externalId: sourceRef.externalId };
}

export function buildSourceSync({ source, sourceRef, requestSnapshot, proposedAt, actor }) {
  const managedFields = MANAGED_FIELDS_BY_KIND[requestSnapshot.kind];
  const managedSnapshot = managedSnapshotFromReleaseSnapshot(requestSnapshot, managedFields);
  return {
    schemaVersion: 1,
    baselines: [{
      baselineId: generateUuidV7(),
      sourceRefIdentityHash: sourceRefIdentityHash(sourceRef),
      role: "primary",
      sourceId: source.id,
      provider: source.provider,
      locator: locatorFromSourceRef(sourceRef),
      sourceRevision: sourceRevisionFromRef(sourceRef),
      mappingVersion: source.mappingVersion,
      mappingProfile: source.mappingProfile || `${source.provider}-v${source.mappingVersion}`,
      configHash: `sha256:${workSourceConfigHash(source)}`,
      managedFields,
      managedSnapshot,
      managedSnapshotHash: `sha256:${revisionHash(managedSnapshot)}`,
      aggregateRevisionAtSync: `sha256:${revisionHash({ ...requestSnapshot, sourceSync: null })}`,
      syncedAt: proposedAt,
      syncedBy: actor
    }]
  };
}

export function deriveSourceRef({ source, normalizedItem, importedAt, role = "primary" }) {
  if (source.provider === "local_repository") {
    return {
      sourceId: source.id,
      provider: source.provider,
      role,
      itemId: normalizedItem.itemId,
      path: normalizedItem.path,
      contentRevision: normalizedItem.revision.contentRevision,
      fingerprint: normalizedItem.revision.fingerprint,
      mappingVersion: source.mappingVersion,
      importedAt
    };
  }
  return {
    sourceId: source.id,
    provider: source.provider,
    role,
    externalId: normalizedItem.itemId,
    externalUrl: normalizedItem.url || undefined,
    externalRevision: normalizedItem.revision.externalRevision,
    fingerprint: normalizedItem.revision.fingerprint,
    mappingVersion: source.mappingVersion,
    importedAt
  };
}

function existingPrimarySourceItem(planningRoot, operationsRoot, { releaseId, sourceId, provider, normalizedItem, excludeItemId = null }) {
  const current = listReleaseItemDocuments(planningRoot, { releaseId });
  const reserved = listReservedReleaseItemDocuments(operationsRoot).filter((item) => item.releaseId === releaseId);
  for (const item of [...current, ...reserved]) {
    if (excludeItemId && item.id === excludeItemId) continue;
    for (const ref of item.sourceRefs || []) {
      if (ref.role !== "primary" || ref.provider !== provider || ref.sourceId !== sourceId) continue;
      if ((ref.itemId && ref.itemId === normalizedItem.itemId) || (ref.externalId && ref.externalId === normalizedItem.itemId) || (ref.path && ref.path === normalizedItem.path)) return item;
    }
  }
  return null;
}

export function prepareWorkSourceImport(rawPayload, {
  planningRoot,
  operationsRoot,
  operationId,
  actor,
  proposedAt,
  releaseRef,
  importRequest = null,
  itemId = null,
  expectedReleaseId = null,
  skipDuplicatePrimaryCheck = false,
  runtimeContext = null,
  resolvedSourceItem = null
}) {
  const resolution = resolveReleaseReference(planningRoot, releaseRef);
  if (resolution.status !== "FOUND") throw new Error(`release reference failed: ${resolution.status}: ${resolution.findings.join("; ")}`);
  const release = resolution.release;
  if (expectedReleaseId && release.id !== expectedReleaseId) {
    const error = new Error(`REFERENCE_STALE: Release reference resolved to ${release.id}, expected ${expectedReleaseId}`);
    error.code = "STALE";
    throw error;
  }
  assertReleaseParentCanAcceptItem(release);
  const registry = defaultWorkSourceRegistry({ planningRoot, runtimeContext });
  const sourceRef = parseSourceRef(rawPayload.sourceRef || rawPayload.source);
  const source = registry.getSource(sourceRef.sourceId);
  const normalizedItem = resolvedSourceItem
    ? structuredClone(resolvedSourceItem)
    : (() => {
        const provider = registry.resolve(source.id, "get");
        const fetched = provider.get({ source, itemRef: sourceRef.itemRef });
        if (fetched.status !== "FOUND") throw new Error(`${fetched.status}: ${fetched.findings.map((finding) => `${finding.code}: ${finding.message}`).join("; ")}`);
        return fetched.item;
      })();
  const normalizedCheck = validateNormalizedWorkSourceItem(normalizedItem);
  if (!normalizedCheck.valid) throw new Error(`NormalizedWorkSourceItem invalid: ${normalizedCheck.errors.join("; ")}`);
  const sourceRevision = normalizedItem.revision.contentRevision || normalizedItem.revision.externalRevision || normalizedItem.revision.fingerprint;
  if (!sourceRevision) throw new Error("NormalizedWorkSourceItem requires a revision");
  const importedAt = proposedAt;
  const sourceRefObject = deriveSourceRef({ source, normalizedItem, importedAt, role: "primary" });
  if (!skipDuplicatePrimaryCheck) {
    const existing = existingPrimarySourceItem(planningRoot, operationsRoot, { releaseId: release.id, sourceId: source.id, provider: source.provider, normalizedItem });
    if (existing) throw new Error(`Work Source item ${source.id}:${normalizedItem.itemId} is already imported as primary Release Item ${existing.id}`);
  }
  const normalized = importRequest ?? normalizeImportIntent(rawPayload, { actor, defaultIdempotencyKey: operationId, releaseId: release.id, source, normalizedItem, role: "primary" });
  const expectedIntent = normalizeImportIntent(rawPayload, { actor, defaultIdempotencyKey: operationId, releaseId: release.id, source, normalizedItem, role: "primary" });
  if (normalized.idempotencyRequestHash !== expectedIntent.idempotencyRequestHash) throw new Error("work-source.import request binding does not match source resolution");
  const currentParent = readReleaseFile(planningRoot, release.id).release;
  if (currentParent.audit.revision !== release.audit.revision) {
    const error = new Error("REFERENCE_STALE: release.yml changed during Work Source import proposal");
    error.code = "STALE";
    throw error;
  }
  const existingItems = [
    ...listReleaseItemDocuments(planningRoot),
    ...listReservedReleaseItemDocuments(operationsRoot)
  ];
  const id = itemId ?? generateUuidV7();
  const display = deriveUniqueReleaseItemDisplayId(id, existingItems);
  const mappedSnapshot = mappedReleaseItemSnapshot(normalizedItem, sourceRefObject);
  const requestSnapshot = {
    ...mappedSnapshot,
    sourceSync: buildSourceSync({ source, sourceRef: sourceRefObject, requestSnapshot: mappedSnapshot, proposedAt, actor })
  };
  const prospective = {
    schemaVersion: 1,
    id,
    displayId: display.displayId,
    displayIdStatus: "ACTIVE",
    releaseId: release.id,
    slug: requestSnapshot.slug,
    title: requestSnapshot.title,
    description: requestSnapshot.description,
    kind: requestSnapshot.kind,
    status: "DRAFT",
    dependencies: [],
    sourceRefs: requestSnapshot.sourceRefs,
    resolution: null,
    audit: { createdAt: proposedAt, createdBy: actor, updatedAt: proposedAt, updatedBy: actor, operationId },
    ...Object.fromEntries(Object.entries(requestSnapshot).filter(([key]) => !["kind", "title", "description", "slug", "dependencies", "sourceRefs"].includes(key)))
  };
  const item = renderReleaseItemCreate({
    id,
    displayId: display.displayId,
    displayIdStatus: "ACTIVE",
    releaseId: release.id,
    parentRevision: release.audit.revision,
    proposedAt,
    actor,
    operationId,
    requestSnapshot,
    idempotencyKey: normalized.idempotencyKey,
    idempotencyRequestHash: releaseItemCreateRequestHash({ actor, releaseId: release.id, requestSnapshot })
  }, { planningRoot });
  const schema = validate("release-item", item);
  if (!schema.valid) throw new Error(`work-source.import produced invalid Release Item: ${schema.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  const graphFindings = releaseItemCatalogFindings([...listReleaseItemDocuments(planningRoot, { releaseId: release.id }), item], { releaseId: release.id });
  if (graphFindings.length > 0) throw new Error(graphFindings.map((finding) => `${finding.code}: ${finding.message}`).join("; "));
  return {
    target: { releaseId: release.id, itemId: id },
    payload: {
      operationId,
      id,
      displayId: display.displayId,
      displayIdStatus: "ACTIVE",
      releaseId: release.id,
      parentRevision: release.audit.revision,
      proposedAt,
      actor,
      source: {
        sourceId: source.id,
        provider: source.provider,
        itemRef: sourceRef.itemRef,
        itemId: normalizedItem.itemId,
        path: normalizedItem.path || null,
        observedRevision: sourceRevision,
        mappingVersion: source.mappingVersion,
        configHash: workSourceConfigHash(source),
        role: "primary"
      },
      normalizedItem,
      requestSnapshot,
      idempotencyKey: normalized.idempotencyKey,
      idempotencyRequestHash: normalized.idempotencyRequestHash,
      targetPaths: [releaseItemYamlRelativePath(release.id, id), releaseItemReadmeRelativePath(release.id, id)]
    },
    targetFiles: [releaseItemYamlRelativePath(release.id, id), releaseItemReadmeRelativePath(release.id, id)],
    normalized
  };
}

export function renderWorkSourceImport(payload, { planningRoot }) {
  const registry = defaultWorkSourceRegistry({ planningRoot });
  const source = registry.getSource(payload.source.sourceId);
  if (source.provider !== payload.source.provider || source.mappingVersion !== payload.source.mappingVersion || workSourceConfigHash(source) !== payload.source.configHash) {
    const error = new Error("SOURCE_STALE: Work Source configuration changed since propose");
    error.code = "STALE";
    throw error;
  }
  const provider = registry.resolve(source.id, "get");
  const fetched = provider.get({ source, itemRef: payload.source.itemRef });
  if (fetched.status !== "FOUND") {
    const error = new Error(`${fetched.status}: Work Source item changed since propose`);
    error.code = "STALE";
    throw error;
  }
  const normalizedItem = fetched.item;
  if (revisionHash(normalizedItem) !== revisionHash(payload.normalizedItem)) {
    const error = new Error("SOURCE_STALE: Work Source item changed since propose");
    error.code = "STALE";
    throw error;
  }
  const { release } = readReleaseFile(planningRoot, payload.releaseId);
  if (release.audit.revision !== payload.parentRevision) {
    const error = new Error("REFERENCE_STALE: release.yml changed since propose");
    error.code = "STALE";
    throw error;
  }
  const item = renderReleaseItemCreate({
    id: payload.id,
    displayId: payload.displayId,
    displayIdStatus: payload.displayIdStatus,
    releaseId: payload.releaseId,
    parentRevision: payload.parentRevision,
    proposedAt: payload.proposedAt,
    actor: payload.actor,
    operationId: payload.operationId,
    requestSnapshot: payload.requestSnapshot,
    idempotencyKey: payload.idempotencyKey,
    idempotencyRequestHash: releaseItemCreateRequestHash({ actor: payload.actor, releaseId: payload.releaseId, requestSnapshot: payload.requestSnapshot })
  }, { planningRoot });
  const existing = existingPrimarySourceItem(path.resolve(planningRoot), path.join(planningRoot, "operations"), {
    releaseId: payload.releaseId,
    sourceId: payload.source.sourceId,
    provider: payload.source.provider,
    normalizedItem,
    excludeItemId: payload.id
  });
  if (existing) {
    const error = new Error(`Work Source item ${payload.source.sourceId}:${payload.source.itemId} is already imported as primary Release Item ${existing.id}`);
    error.code = "STALE";
    throw error;
  }
  return item;
}

export function workSourceImportRequestHash({ actor, releaseId, sourceId, provider, itemId, mappingVersion, sourceConfigHash, observedRevision, role }) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid Work Source import parent release id: ${releaseId}`);
  return revisionHash({ actor, releaseId, sourceId, provider, itemId, mappingVersion, sourceConfigHash, observedRevision, role });
}

export function workSourceImportInvariantFindings(changeSet, operation = null, existingItems = []) {
  const findings = [];
  const payload = changeSet.payload || {};
  if (payload.operationId !== changeSet.operationId) findings.push("work-source.import payload.operationId must match ChangeSet operationId");
  const targetKeys = Object.keys(changeSet.target || {}).sort();
  if (targetKeys.length !== 2 || changeSet.target.releaseId !== payload.releaseId || changeSet.target.itemId !== payload.id) findings.push("work-source.import target must contain exactly releaseId and itemId matching payload");
  if (!isReleaseItemDisplayIdForUuid(payload.id, payload.displayId)) findings.push(`work-source.import displayId ${payload.displayId} is not derived from Release Item UUIDv7 ${payload.id}`);
  const displayIdCollision = existingItems.find((item) => item.id !== payload.id && item.displayId === payload.displayId);
  if (displayIdCollision) findings.push(`work-source.import displayId ${payload.displayId} is already owned by Release Item ${displayIdCollision.id}`);
  if (!Array.isArray(payload.targetPaths) || payload.targetPaths.length !== 2 || !payload.targetPaths.includes(releaseItemYamlRelativePath(payload.releaseId, payload.id)) || !payload.targetPaths.includes(releaseItemReadmeRelativePath(payload.releaseId, payload.id))) findings.push("work-source.import targetPaths must be server-owned canonical YAML and README paths");
  if (!payload.source || typeof payload.source !== "object") findings.push("work-source.import source resolution must be recorded");
  if (!payload.normalizedItem || typeof payload.normalizedItem !== "object") findings.push("work-source.import normalizedItem must be recorded");
  if (!payload.requestSnapshot || typeof payload.requestSnapshot !== "object") findings.push("work-source.import requestSnapshot must be a normalized object");
  else if (!Array.isArray(payload.requestSnapshot.sourceRefs) || payload.requestSnapshot.sourceRefs.length !== 1 || payload.requestSnapshot.sourceRefs[0].role !== "primary") findings.push("work-source.import must derive exactly one primary sourceRef");
  const normalizedValidation = validateNormalizedWorkSourceItem(payload.normalizedItem || {});
  if (!normalizedValidation.valid) findings.push(`work-source.import normalizedItem is invalid: ${normalizedValidation.errors.join("; ")}`);
  const observedRevision = payload.normalizedItem?.revision?.contentRevision || payload.normalizedItem?.revision?.externalRevision || payload.normalizedItem?.revision?.fingerprint;
  if (payload.normalizedItem?.sourceId !== payload.source?.sourceId) findings.push("work-source.import normalizedItem sourceId must match resolved source");
  if (payload.normalizedItem?.provider !== payload.source?.provider) findings.push("work-source.import normalizedItem provider must match resolved provider");
  if (payload.normalizedItem?.itemId !== payload.source?.itemId) findings.push("work-source.import normalizedItem itemId must match resolved item");
  if ((payload.normalizedItem?.path || null) !== (payload.source?.path || null)) findings.push("work-source.import normalizedItem path must match resolved locator");
  if (payload.normalizedItem?.mappingVersion !== payload.source?.mappingVersion) findings.push("work-source.import normalizedItem mappingVersion must match resolved mapping");
  if (observedRevision !== payload.source?.observedRevision) findings.push("work-source.import normalizedItem revision must match observed revision");
  try {
    const expectedSourceRef = deriveSourceRef({ source: { id: payload.source.sourceId, provider: payload.source.provider, mappingVersion: payload.source.mappingVersion }, normalizedItem: payload.normalizedItem, importedAt: payload.proposedAt, role: payload.source.role });
    if (revisionHash(expectedSourceRef) !== revisionHash(payload.requestSnapshot?.sourceRefs?.[0] || null)) findings.push("work-source.import sourceRef must be derived from the normalized source item");
    const expectedMappedSnapshot = mappedReleaseItemSnapshot(payload.normalizedItem, expectedSourceRef);
    const expectedSnapshot = {
      ...expectedMappedSnapshot,
      sourceSync: buildSourceSync({
        source: { id: payload.source.sourceId, provider: payload.source.provider, mappingVersion: payload.source.mappingVersion, mappingProfile: payload.requestSnapshot?.sourceSync?.baselines?.[0]?.mappingProfile, roots: [], capabilities: [], options: {} },
        sourceRef: expectedSourceRef,
        requestSnapshot: expectedMappedSnapshot,
        proposedAt: payload.proposedAt,
        actor: payload.actor
      })
    };
    if (payload.requestSnapshot?.sourceSync?.baselines?.[0]?.baselineId) expectedSnapshot.sourceSync.baselines[0].baselineId = payload.requestSnapshot.sourceSync.baselines[0].baselineId;
    if (payload.requestSnapshot?.sourceSync?.baselines?.[0]?.configHash) expectedSnapshot.sourceSync.baselines[0].configHash = payload.requestSnapshot.sourceSync.baselines[0].configHash;
    if (revisionHash(expectedSnapshot) !== revisionHash(payload.requestSnapshot || null)) findings.push("work-source.import requestSnapshot must be derived from the normalized source item");
  } catch (error) {
    findings.push(`work-source.import cannot derive canonical snapshot: ${error.message}`);
  }
  const expectedHash = workSourceImportRequestHash({
    actor: payload.actor,
    releaseId: payload.releaseId,
    sourceId: payload.source?.sourceId,
    provider: payload.source?.provider,
    itemId: payload.source?.itemId,
    mappingVersion: payload.source?.mappingVersion,
    sourceConfigHash: payload.source?.configHash,
    observedRevision: payload.source?.observedRevision,
    role: payload.source?.role
  });
  if (payload.idempotencyRequestHash !== expectedHash) findings.push("work-source.import idempotencyRequestHash does not match source import intent");
  if (operation) {
    if (payload.proposedAt !== operation.proposedAt) findings.push("work-source.import proposedAt must match Operation proposedAt");
    if (payload.actor !== operation.proposedBy) findings.push("work-source.import actor must match Operation proposedBy");
  }
  return findings;
}
