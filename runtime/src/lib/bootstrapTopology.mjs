import { contentHash } from "./canonical.mjs";

export const DIRECTORY_RENDER_ENTRY = Object.freeze({ kind: "directory" });
export const DIRECTORY_CONTENT_HASH = contentHash("shipping-mode:directory:v1");

export const BOOTSTRAP_CANONICAL_DIRECTORIES = Object.freeze([
  "scopes",
  "sources",
  "concerns",
  "gates",
  "gate-profiles",
  "execution-contexts",
  "environments",
  "decisions",
  "releases",
  "vendor",
  "vendor/template-packs"
]);

export const REQUIRED_BOOTSTRAP_DIRECTORIES = Object.freeze([
  "events",
  "operations",
  ".runtime",
  ...BOOTSTRAP_CANONICAL_DIRECTORIES
]);

export function isDirectoryRenderEntry(value) {
  return value && typeof value === "object" && value.kind === "directory";
}
