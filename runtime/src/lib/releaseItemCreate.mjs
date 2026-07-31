import { generateUuidV7, isUuidV7 } from "./ids.mjs";
import { revisionHash } from "./canonical.mjs";
import { validate } from "./schema.mjs";
import { resolveReleaseReference, readReleaseFile } from "./releaseStore.mjs";
import { deriveUniqueReleaseItemDisplayId, isReleaseItemDisplayIdForUuid } from "./releaseItemIdentity.mjs";
import { listReleaseItemDocuments, listReservedReleaseItemDocuments, releaseItemCatalogFindings, releaseItemReadmeRelativePath, releaseItemYamlRelativePath, assertReleaseParentCanAcceptItem, updateReleaseItemRevision } from "./releaseItemStore.mjs";

export const RELEASE_ITEM_KINDS = Object.freeze(["user_story", "capability", "defect", "enabler", "spike", "compliance", "migration", "operational"]);
const SERVER_OWNED = new Set(["id", "displayId", "displayIdStatus", "releaseId", "releaseRefResolved", "operationId", "createdAt", "updatedAt", "createdBy", "updatedBy", "audit", "status", "revision", "findings", "readiness", "completion", "resolution", "approval", "childIndexes", "workPackageRefs", "sourceRefs", "eventId", "targetPaths", "parentRevision"]);
const COMMON_ALLOWED = new Set(["kind", "title", "description", "dependencies", "dependencyRefs", "slug", "idempotencyKey"]);
const KIND_FIELDS = {
  user_story: new Set(["actor", "need", "value", "acceptanceCriteria"]),
  capability: new Set(["outcome", "behavior", "acceptanceCriteria"]),
  defect: new Set(["observedBehavior", "expectedBehavior", "reproduction", "severity"]),
  enabler: new Set(["technicalOutcome", "unlockedCapabilities"]),
  spike: new Set(["question", "timebox", "expectedDecision"]),
  compliance: new Set(["obligation", "authority", "deadline", "evidence"]),
  migration: new Set(["sourceState", "targetState", "rollback"]),
  operational: new Set(["procedure", "owner", "evidence"])
};

function requireObject(rawPayload) {
  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) throw new Error("release-item.create payload must be an object");
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, field);
}

function normalizeSlug(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("slug must be a string or null");
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return slug || null;
}

function normalizeStringArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const normalized = value.map((entry) => requireString(entry, field));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} cannot contain duplicates`);
  return normalized;
}

function normalizeUuidArray(value, field) {
  const values = value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : String(value).split(",");
  const normalized = values.map((entry) => requireString(entry, field));
  for (const entry of normalized) if (!isUuidV7(entry)) throw new Error(`${field} entries must be UUIDv7: ${entry}`);
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length) throw new Error(`${field} cannot contain duplicates`);
  return unique;
}

function normalizeSourceRefs(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("sourceRefs must be an array");
  const allowedFields = new Set(["sourceId", "provider", "role", "mappingVersion", "externalId", "externalUrl", "externalRevision", "path", "contentRevision", "fingerprint"]);
  const normalizedRefs = value.map((ref, index) => {
    if (ref === null || typeof ref !== "object" || Array.isArray(ref)) throw new Error(`sourceRefs[${index}] must be an object`);
    for (const field of Object.keys(ref)) {
      if (field === "importedAt") throw new Error(`sourceRefs[${index}].importedAt is server-owned`);
      if (!allowedFields.has(field)) throw new Error(`sourceRefs[${index}] contains unsupported field: ${field}`);
    }
    const provider = requireString(ref.provider, `sourceRefs[${index}].provider`);
    if (!["local_repository", "jira", "github_issues", "azure_boards", "linear", "custom"].includes(provider)) throw new Error(`sourceRefs[${index}].provider is invalid`);
    const role = requireString(ref.role, `sourceRefs[${index}].role`);
    if (!["primary", "supporting", "derived_from", "supersedes", "related"].includes(role)) throw new Error(`sourceRefs[${index}].role is invalid`);
    const normalized = {
      sourceId: requireString(ref.sourceId, `sourceRefs[${index}].sourceId`),
      provider,
      role,
      mappingVersion: Number(ref.mappingVersion)
    };
    if (!Number.isInteger(normalized.mappingVersion) || normalized.mappingVersion < 1) throw new Error(`sourceRefs[${index}].mappingVersion must be a positive integer`);
    for (const field of ["externalId", "externalUrl", "externalRevision", "path", "contentRevision", "fingerprint"]) {
      if (ref[field] !== undefined && ref[field] !== null && ref[field] !== "") normalized[field] = requireString(ref[field], `sourceRefs[${index}].${field}`);
    }
    const localShape = provider === "local_repository" || (provider === "custom" && Boolean(normalized.path));
    if (localShape) {
      if (!normalized.path) throw new Error(`sourceRefs[${index}] local providers require path`);
      if (normalized.externalId || normalized.externalUrl || normalized.externalRevision) throw new Error(`sourceRefs[${index}] local providers cannot use external locator fields`);
      if (!normalized.contentRevision && !normalized.fingerprint) throw new Error(`sourceRefs[${index}] local providers require contentRevision or fingerprint`);
    } else {
      if (!normalized.externalId) throw new Error(`sourceRefs[${index}] external providers require externalId`);
      if (normalized.path || normalized.contentRevision) throw new Error(`sourceRefs[${index}] external providers cannot use local path/contentRevision fields`);
      if (!normalized.externalRevision && !normalized.fingerprint) throw new Error(`sourceRefs[${index}] external providers require externalRevision or fingerprint`);
    }
    return normalized;
  }).sort((left, right) => `${left.role}:${left.provider}:${left.sourceId}:${left.externalId || left.path}`.localeCompare(`${right.role}:${right.provider}:${right.sourceId}:${right.externalId || right.path}`));
  const identities = normalizedRefs.map((ref) => `${ref.role}:${ref.provider}:${ref.sourceId}:${ref.externalId || ref.path}`);
  if (new Set(identities).size !== identities.length) throw new Error("sourceRefs cannot contain duplicate source identities");
  return normalizedRefs;
}

function rejectServerOwned(rawPayload) {
  for (const field of Object.keys(rawPayload)) {
    if (SERVER_OWNED.has(field)) throw new Error(`release-item.create field is server-owned: ${field}`);
  }
}

function assertAllowedFields(rawPayload, kind) {
  const allowed = new Set([...COMMON_ALLOWED, ...KIND_FIELDS[kind]]);
  for (const field of Object.keys(rawPayload)) {
    if (!allowed.has(field)) throw new Error(`release-item.create contains unsupported field for ${kind}: ${field}`);
  }
}

function normalizeKindSpecific(rawPayload, kind) {
  if (kind === "user_story") return { actor: requireString(rawPayload.actor, "actor"), need: requireString(rawPayload.need, "need"), value: requireString(rawPayload.value, "value"), acceptanceCriteria: normalizeStringArray(rawPayload.acceptanceCriteria, "acceptanceCriteria") };
  if (kind === "capability") return { outcome: requireString(rawPayload.outcome, "outcome"), behavior: requireString(rawPayload.behavior, "behavior"), acceptanceCriteria: normalizeStringArray(rawPayload.acceptanceCriteria, "acceptanceCriteria") };
  if (kind === "defect") return { observedBehavior: requireString(rawPayload.observedBehavior, "observedBehavior"), expectedBehavior: requireString(rawPayload.expectedBehavior, "expectedBehavior"), reproduction: requireString(rawPayload.reproduction, "reproduction"), severity: requireString(rawPayload.severity, "severity") };
  if (kind === "enabler") return { technicalOutcome: requireString(rawPayload.technicalOutcome, "technicalOutcome"), unlockedCapabilities: normalizeStringArray(rawPayload.unlockedCapabilities, "unlockedCapabilities") };
  if (kind === "spike") return { question: requireString(rawPayload.question, "question"), timebox: requireString(rawPayload.timebox, "timebox"), expectedDecision: requireString(rawPayload.expectedDecision, "expectedDecision") };
  if (kind === "compliance") return { obligation: requireString(rawPayload.obligation, "obligation"), authority: requireString(rawPayload.authority, "authority"), deadline: requireString(rawPayload.deadline, "deadline"), evidence: normalizeStringArray(rawPayload.evidence, "evidence") };
  if (kind === "migration") return { sourceState: requireString(rawPayload.sourceState, "sourceState"), targetState: requireString(rawPayload.targetState, "targetState"), rollback: requireString(rawPayload.rollback, "rollback") };
  if (kind === "operational") return { procedure: requireString(rawPayload.procedure, "procedure"), owner: requireString(rawPayload.owner, "owner"), evidence: normalizeStringArray(rawPayload.evidence, "evidence") };
  throw new Error(`unsupported Release Item kind: ${kind}`);
}

export function releaseItemCreateRequestHash({ actor, releaseId, requestSnapshot }) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid Release Item parent release id: ${releaseId}`);
  return revisionHash({ actor, releaseId, ...requestSnapshot });
}

export function normalizeReleaseItemCreateRequest(rawPayload, { actor, defaultIdempotencyKey, releaseId }) {
  requireObject(rawPayload);
  rejectServerOwned(rawPayload);
  const kind = requireString(rawPayload.kind, "kind");
  if (!RELEASE_ITEM_KINDS.includes(kind)) throw new Error(`unsupported Release Item kind: ${kind}`);
  assertAllowedFields(rawPayload, kind);
  if (typeof actor !== "string" || actor.trim().length === 0) throw new Error("release-item.create requires non-blank actor");
  const dependencies = normalizeUuidArray(rawPayload.dependencies ?? rawPayload.dependencyRefs, "dependencies");
  const requestSnapshot = {
    kind,
    title: requireString(rawPayload.title, "title"),
    description: optionalString(rawPayload.description, "description"),
    slug: normalizeSlug(rawPayload.slug),
    dependencies,
    sourceRefs: [],
    ...normalizeKindSpecific(rawPayload, kind)
  };
  const idempotencyKey = rawPayload.idempotencyKey === undefined ? requireString(defaultIdempotencyKey, "idempotencyKey") : requireString(rawPayload.idempotencyKey, "idempotencyKey");
  return { requestSnapshot, idempotencyKey, idempotencyRequestHash: releaseItemCreateRequestHash({ actor, releaseId, requestSnapshot }) };
}

export function prepareReleaseItemCreate(rawPayload, {
  planningRoot,
  operationsRoot,
  operationId,
  actor,
  proposedAt,
  releaseRef,
  itemRequest = null,
  itemId = null,
  expectedReleaseId = null
}) {
  const resolution = resolveReleaseReference(planningRoot, releaseRef);
  if (resolution.status !== "FOUND") throw new Error(`release reference failed: ${resolution.status}: ${resolution.findings.join("; ")}`);
  const release = resolution.release;
  if (expectedReleaseId && release.id !== expectedReleaseId) {
    const error = new Error(`REFERENCE_STALE: Release reference resolved to ${release.id}, expected ${expectedReleaseId}`);
    error.code = "STALE";
    throw error;
  }
  const normalized = itemRequest ?? normalizeReleaseItemCreateRequest(rawPayload, { actor, defaultIdempotencyKey: operationId, releaseId: release.id });
  const expectedRequestHash = releaseItemCreateRequestHash({ actor, releaseId: release.id, requestSnapshot: normalized.requestSnapshot });
  if (normalized.idempotencyRequestHash !== expectedRequestHash) throw new Error("release-item.create request binding does not match the canonical parent Release");
  assertReleaseParentCanAcceptItem(release);
  const currentParent = readReleaseFile(planningRoot, release.id).release;
  if (currentParent.audit.revision !== release.audit.revision) {
    const error = new Error("REFERENCE_STALE: release.yml changed during Release Item proposal");
    error.code = "STALE";
    throw error;
  }
  const existingItems = [
    ...listReleaseItemDocuments(planningRoot),
    ...listReservedReleaseItemDocuments(operationsRoot)
  ];
  const id = itemId ?? generateUuidV7();
  const display = deriveUniqueReleaseItemDisplayId(id, existingItems);
  const dependencies = normalized.requestSnapshot.dependencies;
  for (const dep of dependencies) {
    const target = existingItems.find((item) => item.id === dep && item.releaseId === release.id);
    if (!target) throw new Error(`INVALID_REFERENCE: dependency ${dep} does not resolve to a Release Item in ${release.id}`);
  }
  if (dependencies.includes(id)) throw new Error("INVALID_REFERENCE: Release Item cannot depend on itself");
  const prospective = {
    schemaVersion: 1,
    id,
    displayId: display.displayId,
    displayIdStatus: "ACTIVE",
    releaseId: release.id,
    slug: normalized.requestSnapshot.slug,
    title: normalized.requestSnapshot.title,
    description: normalized.requestSnapshot.description,
    kind: normalized.requestSnapshot.kind,
    status: "DRAFT",
    dependencies,
    sourceRefs: normalized.requestSnapshot.sourceRefs,
    resolution: null,
    audit: {
      createdAt: proposedAt,
      createdBy: actor,
      updatedAt: proposedAt,
      updatedBy: actor,
      operationId
    },
    ...kindFieldsFromSnapshot(normalized.requestSnapshot)
  };
  const item = updateReleaseItemRevision(prospective);
  const schema = validate("release-item", item);
  if (!schema.valid) throw new Error(`release-item.create produced invalid Release Item: ${schema.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
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
      requestSnapshot: normalized.requestSnapshot,
      idempotencyKey: normalized.idempotencyKey,
      idempotencyRequestHash: normalized.idempotencyRequestHash,
      targetPaths: [releaseItemYamlRelativePath(release.id, id), releaseItemReadmeRelativePath(release.id, id)]
    },
    targetFiles: [releaseItemYamlRelativePath(release.id, id), releaseItemReadmeRelativePath(release.id, id)],
    normalized
  };
}

function kindFieldsFromSnapshot(snapshot) {
  const fields = {};
  for (const field of KIND_FIELDS[snapshot.kind]) fields[field] = snapshot[field];
  return fields;
}

export function renderReleaseItemCreate(payload, { planningRoot }) {
  const { release } = readReleaseFile(planningRoot, payload.releaseId);
  if (release.audit.revision !== payload.parentRevision) {
    const error = new Error("REFERENCE_STALE: release.yml changed since propose");
    error.code = "STALE";
    throw error;
  }
  assertReleaseParentCanAcceptItem(release);
  const itemWithoutRevision = {
    schemaVersion: 1,
    id: payload.id,
    displayId: payload.displayId,
    displayIdStatus: payload.displayIdStatus,
    releaseId: payload.releaseId,
    slug: payload.requestSnapshot.slug,
    title: payload.requestSnapshot.title,
    description: payload.requestSnapshot.description,
    kind: payload.requestSnapshot.kind,
    status: "DRAFT",
    dependencies: payload.requestSnapshot.dependencies,
    sourceRefs: payload.requestSnapshot.sourceRefs,
    ...(payload.requestSnapshot.sourceSync ? { sourceSync: payload.requestSnapshot.sourceSync } : {}),
    resolution: null,
    audit: {
      createdAt: payload.proposedAt,
      createdBy: payload.actor,
      updatedAt: payload.proposedAt,
      updatedBy: payload.actor,
      operationId: payload.operationId
    },
    ...kindFieldsFromSnapshot(payload.requestSnapshot)
  };
  const item = updateReleaseItemRevision(itemWithoutRevision);
  const schema = validate("release-item", item);
  if (!schema.valid) throw new Error(`release-item.create produced invalid Release Item: ${schema.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  const graphFindings = releaseItemCatalogFindings([...listReleaseItemDocuments(planningRoot, { releaseId: payload.releaseId }), item], { releaseId: payload.releaseId });
  if (graphFindings.length > 0) {
    const error = new Error(graphFindings.map((finding) => `${finding.code}: ${finding.message}`).join("; "));
    error.code = "STALE";
    throw error;
  }
  return item;
}

export function releaseItemCreateInvariantFindings(changeSet, operation = null, existingItems = []) {
  const findings = [];
  const payload = changeSet.payload || {};
  if (payload.operationId !== changeSet.operationId) findings.push("release-item.create payload.operationId must match ChangeSet operationId");
  const targetKeys = Object.keys(changeSet.target || {}).sort();
  if (targetKeys.length !== 2 || changeSet.target.releaseId !== payload.releaseId || changeSet.target.itemId !== payload.id) findings.push("release-item.create target must contain exactly releaseId and itemId matching payload");
  if (!isReleaseItemDisplayIdForUuid(payload.id, payload.displayId)) findings.push(`release-item.create displayId ${payload.displayId} is not derived from Release Item UUIDv7 ${payload.id}`);
  const displayIdCollision = existingItems.find((item) => item.id !== payload.id && item.displayId === payload.displayId);
  if (displayIdCollision) findings.push(`release-item.create displayId ${payload.displayId} is already owned by Release Item ${displayIdCollision.id}`);
  if (!Array.isArray(payload.targetPaths) || payload.targetPaths.length !== 2 || !payload.targetPaths.includes(releaseItemYamlRelativePath(payload.releaseId, payload.id)) || !payload.targetPaths.includes(releaseItemReadmeRelativePath(payload.releaseId, payload.id))) findings.push("release-item.create targetPaths must be server-owned canonical YAML and README paths");
  if (!payload.requestSnapshot || typeof payload.requestSnapshot !== "object" || Array.isArray(payload.requestSnapshot)) {
    findings.push("release-item.create requestSnapshot must be a normalized object");
  } else {
    const expectedHash = releaseItemCreateRequestHash({ actor: payload.actor, releaseId: payload.releaseId, requestSnapshot: payload.requestSnapshot });
    if (payload.idempotencyRequestHash !== expectedHash) findings.push("release-item.create idempotencyRequestHash does not match normalized caller intent and actor");
  }
  if (operation) {
    if (payload.proposedAt !== operation.proposedAt) findings.push("release-item.create proposedAt must match Operation proposedAt");
    if (payload.actor !== operation.proposedBy) findings.push("release-item.create actor must match Operation proposedBy");
  }
  return findings;
}
