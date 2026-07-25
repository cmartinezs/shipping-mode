import { generateUuidV7 } from "../lib/ids.mjs";
import { UsageError } from "../lib/errors.mjs";

const SUPPORTED_KINDS = new Set(["workspace.init", "config.update", "scope.add"]);

export function prepareProposal(kind, rawPayload) {
  if (!SUPPORTED_KINDS.has(kind)) throw new UsageError(`unsupported changeset kind: ${kind}`);

  if (kind === "workspace.init") {
    return { payload: rawPayload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"] };
  }
  if (kind === "config.update") {
    return { payload: rawPayload, targetFiles: ["config.yml"] };
  }

  // scope.add: targetFiles is dynamic -- it depends on the scope's own id,
  // which must exist before propose() can compute baseRevisions for it
  const payload = rawPayload.id ? rawPayload : { ...rawPayload, id: generateUuidV7() };
  return { payload, targetFiles: ["config.yml", `scopes/${payload.id}/scope.yml`] };
}
