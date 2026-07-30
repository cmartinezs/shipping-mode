import fs from "node:fs";
import path from "node:path";
import { generateUuidV7, isUuidV7 } from "./ids.mjs";
import { revisionHash } from "./canonical.mjs";
import { validate } from "./schema.mjs";
import { confineScopePath } from "./paths.mjs";
import { resolveReleaseReference, readReleaseFile } from "./releaseStore.mjs";
import { deriveUniqueReleaseItemDisplayId, isReleaseItemDisplayIdForUuid } from "./releaseItemIdentity.mjs";
import { releaseItemCreateRequestHash, renderReleaseItemCreate } from "./releaseItemCreate.mjs";
import { assertReleaseParentCanAcceptItem, listReleaseItemDocuments, listReservedReleaseItemDocuments, releaseItemCatalogFindings, releaseItemReadmeRelativePath, releaseItemYamlRelativePath } from "./releaseItemStore.mjs";
import { buildWorkSourceRegistry, WORK_SOURCE_CAPABILITIES } from "./workSourceProvider.mjs";
import { LocalRepositoryWorkSource } from "./localRepositoryWorkSource.mjs";
import { parseYaml } from "./yaml.mjs";

const SECRET_KEY_PATTERN = /(token|secret|password|cookie|credential|authorization|auth|api[-_]?key|refresh)/i;
const SUPPORTED_MAPPINGS = new Set([1]);
const SUPPORTED_KINDS = new Set(["user_story", "capability", "defect", "enabler", "spike", "compliance", "migration", "operational"]);

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function readConfig(planningRoot) {
  const configPath = path.join(planningRoot, "config.yml");
  if (!fs.existsSync(configPath)) throw new Error("workspace config.yml not found");
  return parseYaml(fs.readFileSync(configPath, "utf8"));
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
  const absolutePath = confineScopePath(workspaceRoot, normalized);
  if (!fs.existsSync(absolutePath)) {
    if (!enabled) return { relativePath: normalized, absolutePath };
    throw new Error(`work source ${sourceId} root is unavailable: ${normalized}`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`work source ${sourceId} root must be a real directory: ${normalized}`);
  return { relativePath: normalized, absolutePath };
}

function normalizeOptions(value, sourceId) {
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
    if (importPolicy !== "import_snapshot") throw new Error(`unsupported import policy ${importPolicy} for Work Source ${id}`);
    const syncMode = requireString(source.sync_mode, `work source ${id} sync_mode`);
    if (syncMode !== "import_only") throw new Error(`unsupported sync mode ${syncMode} for Work Source ${id}`);
    const enabled = source.enabled === true;
    const roots = (source.roots || []).map((root) => normalizeRoot(workspaceRoot, id, root, { enabled }));
    if (provider === "local_repository" && roots.length === 0) throw new Error(`local_repository Work Source ${id} requires at least one root`);
    return {
      id,
      provider,
      enabled,
      roots,
      mappingVersion,
      importPolicy,
      syncMode,
      capabilities: normalizeCapabilityList(source.capabilities || (provider === "local_repository" ? ["discover", "search", "get"] : []), `work source ${id} capabilities`),
      options: normalizeOptions(source.options, id)
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function defaultWorkSourceRegistry({ planningRoot }) {
  const workspaceRoot = path.dirname(planningRoot);
  const config = readConfig(planningRoot);
  const sources = normalizeWorkSourceConfig({ config, workspaceRoot });
  return buildWorkSourceRegistry({
    providerFactories: [() => new LocalRepositoryWorkSource({ workspaceRoot })],
    sources
  });
}

export function assertSafeMetadata(value, { depth = 0, bytes = { value: 0 } } = {}) {
  bytes.value += Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  if (bytes.value > 8192) throw new Error("metadata exceeds safe size limit");
  if (depth > 4) throw new Error("metadata exceeds safe depth limit");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > 32) throw new Error("metadata array exceeds safe length limit");
    for (const entry of value) assertSafeMetadata(entry, { depth: depth + 1, bytes });
    return;
  }
  if (typeof value !== "object") throw new Error("metadata must be JSON-safe");
  const keys = Object.keys(value);
  if (keys.length > 32) throw new Error("metadata object exceeds safe key limit");
  for (const key of keys) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`metadata key is not allowed: ${key}`);
    assertSafeMetadata(value[key], { depth: depth + 1, bytes });
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
  const callerIntent = {
    sourceRef: `${source.id}:${normalizedItem.itemId}`,
    role
  };
  const requestSnapshot = {
    actor,
    releaseId,
    sourceId: source.id,
    provider: source.provider,
    itemId: normalizedItem.itemId,
    mappingVersion: source.mappingVersion,
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
    description: normalizedItem.description.text,
    slug: null,
    dependencies: [],
    sourceRefs: [sourceRef]
  };
  const criteria = normalizedItem.acceptanceCriteria.map((entry) => entry.text);
  if (normalizedItem.type === "user_story") return { ...base, actor: normalizedItem.assignee || normalizedItem.owner || "user", need: normalizedItem.description.text, value: normalizedItem.title, acceptanceCriteria: criteria };
  if (normalizedItem.type === "capability") return { ...base, outcome: normalizedItem.title, behavior: normalizedItem.description.text, acceptanceCriteria: criteria };
  if (normalizedItem.type === "defect") return { ...base, observedBehavior: normalizedItem.description.text, expectedBehavior: normalizedItem.title, reproduction: normalizedItem.description.text, severity: normalizedItem.priority.normalized === "critical" ? "critical" : normalizedItem.priority.normalized === "high" ? "high" : "medium" };
  if (normalizedItem.type === "enabler") return { ...base, technicalOutcome: normalizedItem.description.text, unlockedCapabilities: [normalizedItem.title] };
  if (normalizedItem.type === "spike") return { ...base, question: normalizedItem.title, timebox: "unspecified", expectedDecision: normalizedItem.description.text };
  if (normalizedItem.type === "compliance") return { ...base, obligation: normalizedItem.description.text, authority: normalizedItem.owner || "unspecified", deadline: "unspecified", evidence: criteria };
  if (normalizedItem.type === "migration") return { ...base, sourceState: normalizedItem.description.text, targetState: normalizedItem.title, rollback: "unspecified" };
  if (normalizedItem.type === "operational") return { ...base, procedure: normalizedItem.description.text, owner: normalizedItem.owner || "unspecified", evidence: criteria };
  throw new Error(`unsupported Work Source item type: ${normalizedItem.type}`);
}

function deriveSourceRef({ source, normalizedItem, importedAt, role = "primary" }) {
  if (source.provider === "local_repository") {
    return {
      sourceId: source.id,
      provider: source.provider,
      role,
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
  const key = `${provider}:${sourceId}:${normalizedItem.itemId}:${normalizedItem.path || ""}`;
  const current = listReleaseItemDocuments(planningRoot, { releaseId });
  const reserved = listReservedReleaseItemDocuments(operationsRoot).filter((item) => item.releaseId === releaseId);
  for (const item of [...current, ...reserved]) {
    if (excludeItemId && item.id === excludeItemId) continue;
    for (const ref of item.sourceRefs || []) {
      if (ref.role !== "primary" || ref.provider !== provider || ref.sourceId !== sourceId) continue;
      const candidateKey = `${ref.provider}:${ref.sourceId}:${normalizedItem.itemId}:${ref.path || ""}`;
      if (candidateKey === key || (ref.path && ref.path === normalizedItem.path)) return item;
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
  skipDuplicatePrimaryCheck = false
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
  const registry = defaultWorkSourceRegistry({ planningRoot });
  const sourceRef = parseSourceRef(rawPayload.sourceRef || rawPayload.source);
  const source = registry.getSource(sourceRef.sourceId);
  const provider = registry.resolve(source.id, "get");
  const fetched = provider.get({ source, itemRef: sourceRef.itemRef });
  if (fetched.status !== "FOUND") throw new Error(`${fetched.status}: ${fetched.findings.map((finding) => `${finding.code}: ${finding.message}`).join("; ")}`);
  const normalizedItem = fetched.item;
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
  const requestSnapshot = mappedReleaseItemSnapshot(normalizedItem, sourceRefObject);
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
  if (source.provider !== payload.source.provider || source.mappingVersion !== payload.source.mappingVersion) {
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

export function workSourceImportRequestHash({ actor, releaseId, sourceId, provider, itemId, mappingVersion, observedRevision, role }) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid Work Source import parent release id: ${releaseId}`);
  return revisionHash({ actor, releaseId, sourceId, provider, itemId, mappingVersion, observedRevision, role });
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
  if (payload.requestSnapshot?.sourceRefs?.[0]?.sourceId !== payload.source?.sourceId) findings.push("work-source.import sourceRef sourceId must match resolved source");
  if (payload.requestSnapshot?.sourceRefs?.[0]?.provider !== payload.source?.provider) findings.push("work-source.import sourceRef provider must match resolved provider");
  if (payload.requestSnapshot?.sourceRefs?.[0]?.mappingVersion !== payload.source?.mappingVersion) findings.push("work-source.import sourceRef mappingVersion must match resolved mapping");
  if (payload.requestSnapshot?.sourceRefs?.[0]?.contentRevision && payload.requestSnapshot.sourceRefs[0].contentRevision !== payload.source?.observedRevision) findings.push("work-source.import sourceRef revision must match observed revision");
  if (revisionHash(payload.normalizedItem || {}) !== revisionHash(payload.normalizedItem || {})) findings.push("work-source.import normalizedItem is not canonical");
  const expectedHash = workSourceImportRequestHash({
    actor: payload.actor,
    releaseId: payload.releaseId,
    sourceId: payload.source?.sourceId,
    provider: payload.source?.provider,
    itemId: payload.source?.itemId,
    mappingVersion: payload.source?.mappingVersion,
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
