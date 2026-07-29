import { generateUuidV7 } from "../lib/ids.mjs";
import { UsageError } from "../lib/errors.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES } from "../lib/bootstrapTopology.mjs";
import { deriveUniqueReleaseDisplayId } from "../lib/releaseIdentity.mjs";
import { releaseReadmeRelativePath, releaseYamlRelativePath } from "../lib/releaseStore.mjs";
import { releaseCreateRequestHash } from "../lib/releaseCreate.mjs";

const SUPPORTED_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set", "scope.generator.set", "guide.update", "release.create"]);
const RELEASE_CREATE_ALLOWED_FIELDS = new Set(["title", "objective", "laneId", "policyMode", "slug", "idempotencyKey"]);
const RELEASE_CREATE_SERVER_FIELDS = new Set(["id", "displayId", "displayIdStatus", "status", "createdAt", "createdBy", "updatedAt", "updatedBy", "audit", "completion", "readiness", "canonicalPath", "approval", "scopeRefs", "itemRefs", "blockers", "risks", "deploymentEvents", "finalization", "requestSnapshot", "idempotencyRequestHash"]);

function requireObjectPayload(rawPayload) {
  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new UsageError("changeset payload must be a mapping/object");
  }
  return rawPayload;
}

function requireExplicitBoolean(rawPayload, field) {
  if (typeof rawPayload[field] !== "boolean") {
    throw new UsageError(`scope.command.set ${field} must be an explicit boolean`);
  }
  return rawPayload[field];
}

function assertOnlyAllowedReleaseCreateFields(rawPayload) {
  for (const field of Object.keys(rawPayload)) {
    if (RELEASE_CREATE_SERVER_FIELDS.has(field)) throw new UsageError(`release.create field is server-owned: ${field}`);
    if (!RELEASE_CREATE_ALLOWED_FIELDS.has(field)) throw new UsageError(`release.create contains unsupported field: ${field}`);
  }
}

function requireTrimmedString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new UsageError(`release.create requires non-blank ${field}`);
  return value.trim();
}

function normalizeOptionalString(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new UsageError(`release.create ${field} must be a non-blank string`);
  return value.trim();
}

function normalizeSlug(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new UsageError("release.create slug must be a string or null");
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return slug || null;
}

export function normalizeReleaseCreateRequest(rawPayload, { actor, defaultIdempotencyKey }) {
  requireObjectPayload(rawPayload);
  assertOnlyAllowedReleaseCreateFields(rawPayload);
  if (typeof actor !== "string" || actor.trim().length === 0) throw new UsageError("release.create requires non-blank actor");
  const title = requireTrimmedString(rawPayload.title, "title");
  const objective = requireTrimmedString(rawPayload.objective, "objective");
  const requestedLaneId = normalizeOptionalString(rawPayload.laneId, "laneId") ?? null;
  const requestedPolicyMode = normalizeOptionalString(rawPayload.policyMode, "policyMode") ?? null;
  if (requestedPolicyMode !== null && !["strict_sequence", "dependency_graph"].includes(requestedPolicyMode)) {
    throw new UsageError(`unsupported release policy mode: ${requestedPolicyMode}`);
  }
  const slug = normalizeSlug(rawPayload.slug);
  const idempotencyKey = rawPayload.idempotencyKey === undefined
    ? requireTrimmedString(defaultIdempotencyKey, "idempotencyKey")
    : requireTrimmedString(rawPayload.idempotencyKey, "idempotencyKey");
  const requestSnapshot = { title, objective, laneId: requestedLaneId, policyMode: requestedPolicyMode, slug };
  return {
    requestSnapshot,
    idempotencyKey,
    idempotencyRequestHash: releaseCreateRequestHash({ actor, requestSnapshot })
  };
}

export function prepareProposal(kind, rawPayload, {
  operationId = null,
  actor = null,
  proposedAt = null,
  existingReleases = [],
  currentConfig = null,
  releaseRequest = null,
  releaseId = null
} = {}) {
  if (!SUPPORTED_KINDS.has(kind)) throw new UsageError(`unsupported changeset kind: ${kind}`);
  requireObjectPayload(rawPayload);

  if (kind === "workspace.init") {
    return { payload: rawPayload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore", ...BOOTSTRAP_CANONICAL_DIRECTORIES] };
  }
  if (kind === "config.update") {
    return { payload: rawPayload, targetFiles: ["config.yml"] };
  }
  if (kind === "config.autonomy.set") {
    return { payload: rawPayload, targetFiles: ["config.yml"] };
  }

  if (kind === "scope.command.set") {
    if (!operationId || !actor || !proposedAt) {
      throw new UsageError("scope.command.set requires runtime operationId, actor, and proposedAt");
    }
    const payload = {
      operationId,
      scopeId: rawPayload.scopeId,
      role: rawPayload.role,
      command: rawPayload.command,
      requiresEnvironment: requireExplicitBoolean(rawPayload, "requiresEnvironment"),
      requiresSecrets: requireExplicitBoolean(rawPayload, "requiresSecrets"),
      declaredBy: actor,
      declaredAt: proposedAt
    };
    return { payload, targetFiles: [`scopes/${payload.scopeId}/scope.yml`] };
  }

  if (kind === "scope.generator.set") {
    if (!operationId || !actor || !proposedAt) throw new UsageError("scope.generator.set requires runtime operationId, actor, and proposedAt");
    const payload = {
      operationId,
      scopeId: rawPayload.scopeId,
      guideKind: rawPayload.guideKind,
      generator: rawPayload.generator ?? null,
      declaredBy: actor,
      declaredAt: proposedAt
    };
    return { payload, targetFiles: [`scopes/${payload.scopeId}/scope.yml`] };
  }

  if (kind === "guide.update") {
    if (!rawPayload.scopeId || !rawPayload.guideKind || !rawPayload.action) {
      throw new UsageError("guide.update requires scopeId, guideKind, and action");
    }
    if (!operationId || !actor || !proposedAt) throw new UsageError("guide.update requires runtime operationId, actor, and proposedAt");
    const payload = {
      ...rawPayload,
      operationId,
      proposedAt,
      guideId: generateUuidV7()
    };
    return {
      payload,
      targetFiles: ["config.yml", `scopes/${payload.scopeId}/scope.yml`, `scopes/${payload.scopeId}/${payload.guideKind}-guide.yml`, ...(["generate", "regenerate"].includes(payload.action) ? [`scopes/${payload.scopeId}/${payload.guideKind}-guide.md`] : [])]
    };
  }

  if (kind === "release.create") {
    if (!operationId || !actor || !proposedAt) throw new UsageError("release.create requires runtime operationId, actor, and proposedAt");
    if (!currentConfig?.policies?.release) throw new UsageError("release.create requires initialized Project Context release policy");
    const normalized = releaseRequest ?? normalizeReleaseCreateRequest(rawPayload, { actor, defaultIdempotencyKey: operationId });
    const { requestSnapshot, idempotencyKey, idempotencyRequestHash } = normalized;
    const laneId = requestSnapshot.laneId
      ?? requireTrimmedString(currentConfig.policies.release.defaultLane, "Project Context policies.release.defaultLane");
    const policyMode = requestSnapshot.policyMode
      ?? requireTrimmedString(currentConfig.policies.release.mode, "Project Context policies.release.mode");
    if (!["strict_sequence", "dependency_graph"].includes(policyMode)) throw new UsageError(`unsupported release policy mode: ${policyMode}`);
    const id = releaseId ?? generateUuidV7();
    const display = deriveUniqueReleaseDisplayId(id, existingReleases);
    const payload = {
      operationId,
      id,
      displayId: display.displayId,
      displayIdStatus: "ACTIVE",
      title: requestSnapshot.title,
      objective: requestSnapshot.objective,
      laneId,
      policyMode,
      slug: requestSnapshot.slug,
      status: "DRAFT",
      createdAt: proposedAt,
      createdBy: actor,
      updatedAt: proposedAt,
      updatedBy: actor,
      requestSnapshot,
      idempotencyKey,
      idempotencyRequestHash
    };
    return { payload, targetFiles: [releaseYamlRelativePath(id), releaseReadmeRelativePath(id)] };
  }

  const payload = {
    ...(rawPayload.id ? rawPayload : { ...rawPayload, id: generateUuidV7() }),
    guideGapId: generateUuidV7()
  };
  return { payload, targetFiles: ["config.yml", `scopes/${payload.id}/scope.yml`] };
}
