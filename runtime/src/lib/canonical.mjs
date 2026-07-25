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

function sha256Hex(bytesOrString) {
  return crypto.createHash("sha256").update(bytesOrString).digest("hex");
}

export function revisionHash(value) {
  return sha256Hex(canonicalJson(value));
}

export function contentHash(bytesOrString) {
  return sha256Hex(bytesOrString);
}

export const ABSENT = "ABSENT";
