import { generateUuidV7 } from "../lib/ids.mjs";
import { UsageError } from "../lib/errors.mjs";

const SUPPORTED_KINDS = new Set(["workspace.init", "config.update", "scope.add"]);

function requireObjectPayload(rawPayload) {
  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new UsageError("changeset payload must be a mapping/object");
  }
  return rawPayload;
}

export function prepareProposal(kind, rawPayload) {
  if (!SUPPORTED_KINDS.has(kind)) throw new UsageError(`unsupported changeset kind: ${kind}`);
  requireObjectPayload(rawPayload);

  if (kind === "workspace.init") {
    return { payload: rawPayload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"] };
  }
  if (kind === "config.update") {
    return { payload: rawPayload, targetFiles: ["config.yml"] };
  }

  const payload = rawPayload.id ? rawPayload : { ...rawPayload, id: generateUuidV7() };
  return { payload, targetFiles: ["config.yml", `scopes/${payload.id}/scope.yml`] };
}
