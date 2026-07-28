import { generateUuidV7 } from "../lib/ids.mjs";
import { UsageError } from "../lib/errors.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES } from "../lib/bootstrapTopology.mjs";
import { deriveUniqueReleaseDisplayId } from "../lib/releaseIdentity.mjs";
import { releaseReadmeRelativePath, releaseYamlRelativePath } from "../lib/releaseStore.mjs";

const SUPPORTED_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set", "scope.generator.set", "guide.update", "release.create"]);
const RELEASE_CREATE_ALLOWED_FIELDS = new Set(["title", "objective", "laneId", "policyMode", "slug", "idempotencyKey"]);
const RELEASE_CREATE_SERVER_FIELDS = new Set(["id", "displayId", "displayIdStatus", "status", "createdAt", "createdBy", "updatedAt", "updatedBy", "audit", "completion", "readiness", "canonicalPath", "approval", "scopeRefs", "itemRefs", "blockers", "risks", "deploymentEvents", "finalization"]);

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

function normalizeSlug(value) {
  if (value === undefined || value === null || value === "") return null;
  const slug = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  if (!slug) return null;
  return slug;
}

export function prepareProposal(kind, rawPayload, { operationId = null, actor = null, proposedAt = null, existingReleases = [] } = {}) {
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
    assertOnlyAllowedReleaseCreateFields(rawPayload);
    if (!rawPayload.title || !rawPayload.objective) throw new UsageError("release.create requires title and objective");
    const id = generateUuidV7();
    const display = deriveUniqueReleaseDisplayId(id, existingReleases);
    const payload = {
      operationId,
      id,
      displayId: display.displayId,
      displayIdStatus: "ACTIVE",
      title: rawPayload.title,
      objective: rawPayload.objective,
      laneId: rawPayload.laneId,
      policyMode: rawPayload.policyMode,
      slug: normalizeSlug(rawPayload.slug),
      status: "DRAFT",
      createdAt: proposedAt,
      createdBy: actor,
      updatedAt: proposedAt,
      updatedBy: actor,
      idempotencyKey: rawPayload.idempotencyKey || operationId
    };
    return { payload, targetFiles: [releaseYamlRelativePath(id), releaseReadmeRelativePath(id)] };
  }

  const payload = {
    ...(rawPayload.id ? rawPayload : { ...rawPayload, id: generateUuidV7() }),
    guideGapId: generateUuidV7()
  };
  return { payload, targetFiles: ["config.yml", `scopes/${payload.id}/scope.yml`] };
}
