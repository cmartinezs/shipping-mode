import fs from "node:fs";
import { contentHash as sha256Hex } from "./canonical.mjs";

export class FingerprintError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FingerprintError";
    this.code = code;
    this.details = details;
  }
}

export function computeFileFingerprint(absolutePath, { maxBytes, statFn = fs.statSync, readFn = fs.readFileSync } = {}) {
  let stat;
  try {
    stat = statFn(absolutePath);
  } catch (error) {
    if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${absolutePath}`, { path: absolutePath });
    throw error;
  }
  if (stat.size > maxBytes) {
    throw new FingerprintError("source_too_large", `source exceeds size limit: ${absolutePath}`, {
      path: absolutePath,
      limitBytes: maxBytes,
      observedBytes: stat.size
    });
  }
  let bytes;
  try {
    bytes = readFn(absolutePath);
  } catch (error) {
    if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${absolutePath}`, { path: absolutePath });
    throw error;
  }
  const hash = sha256Hex(bytes);
  return { fingerprint: hash, contentHash: hash };
}
