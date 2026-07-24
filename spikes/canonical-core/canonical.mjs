import crypto from "node:crypto";

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export function isUuidV7(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function canonicalPath(kind, id) {
  if (!isUuidV7(id)) throw new Error("canonical id must be UUIDv7");
  if (!/^(releases|items|work-packages|tasks)$/.test(kind)) throw new Error("unsupported aggregate kind");
  return `${kind}/${id}/`;
}

export const allowedDslOperators = new Set(["equals", "not_equals", "contains", "exists", "all", "any", "not", "in", "matches"]);
