import { generateUuidV7 } from "../lib/ids.mjs";
import { UsageError } from "../lib/errors.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES } from "../lib/bootstrapTopology.mjs";

const SUPPORTED_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set"]);

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

export function prepareProposal(kind, rawPayload, { operationId = null, actor = null, proposedAt = null } = {}) {
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

  const payload = rawPayload.id ? rawPayload : { ...rawPayload, id: generateUuidV7() };
  return { payload, targetFiles: ["config.yml", `scopes/${payload.id}/scope.yml`] };
}
