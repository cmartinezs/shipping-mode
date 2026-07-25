import fs from "node:fs";
import path from "node:path";
import { contentHash as sha256Hex } from "./canonical.mjs";

export class FingerprintError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FingerprintError";
    this.code = code;
    this.details = details;
  }
}

function asFingerprintObservationError(error, absolutePath, operation) {
  if (error instanceof FingerprintError) return error;
  const details = { path: absolutePath, operation, causeCode: error?.code ?? null };
  let wrapped;
  if (error?.code === "EACCES" || error?.code === "EPERM") {
    wrapped = new FingerprintError("unreadable", `unreadable during ${operation}: ${absolutePath}`, details);
  } else if (error?.code === "ENOENT") {
    wrapped = new FingerprintError("observation_race", `path changed during ${operation}: ${absolutePath}`, details);
  } else {
    wrapped = new FingerprintError("observation_failed", `filesystem observation failed during ${operation}: ${absolutePath}`, details);
  }
  wrapped.cause = error;
  return wrapped;
}

export function computeFileFingerprint(absolutePath, { maxBytes, statFn = fs.statSync, readFn = fs.readFileSync } = {}) {
  let stat;
  try {
    stat = statFn(absolutePath);
  } catch (error) {
    throw asFingerprintObservationError(error, absolutePath, "stat");
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
    throw asFingerprintObservationError(error, absolutePath, "read");
  }
  const hash = sha256Hex(bytes);
  return { fingerprint: hash, contentHash: hash };
}

function isValidUtf8Buffer(buf) {
  return Buffer.from(buf.toString("utf8"), "utf8").equals(buf);
}

// Byte-wise UTF-8 comparison, per the design spec ("sorted lexicographic, byte-wise UTF-8") --
// NOT JavaScript's default string comparison, which compares UTF-16 code units and can
// disagree with byte order for characters outside the BMP or in specific Unicode ranges.
function compareUtf8Bytes(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function collectEntries(absoluteRoot, { readdirFn, lstatFn }) {
  const entries = [];
  function walk(currentAbs, currentRelSegments) {
    let names;
    try {
      names = readdirFn(currentAbs, { encoding: "buffer" });
    } catch (error) {
      throw asFingerprintObservationError(error, currentAbs, "readdir");
    }
    for (const nameBuf of names) {
      if (!isValidUtf8Buffer(nameBuf)) {
        throw new FingerprintError("invalid_utf8", `path is not valid UTF-8 under ${currentAbs}`, { path: currentAbs });
      }
      const name = nameBuf.toString("utf8");
      if (name === ".git") continue; // never part of any source's content, per the design spec
      const absChild = path.join(currentAbs, name);
      const relSegments = [...currentRelSegments, name];
      let stat;
      try {
        stat = lstatFn(absChild);
      } catch (error) {
        throw asFingerprintObservationError(error, absChild, "lstat");
      }
      if (stat.isSymbolicLink()) {
        entries.push({ relSegments, absPath: absChild, isSymlink: true });
      } else if (stat.isDirectory()) {
        walk(absChild, relSegments);
      } else if (stat.isFile()) {
        entries.push({ relSegments, absPath: absChild, isSymlink: false });
      }
      // sockets/fifos/devices are neither files, directories, nor symlinks: skipped, not content.
    }
  }
  walk(absoluteRoot, []);
  return entries;
}

export function computeDirectoryFingerprint(absoluteRoot, {
  maxBytes,
  readdirFn = fs.readdirSync,
  lstatFn = fs.lstatSync,
  readFileFn = fs.readFileSync,
  readlinkFn = fs.readlinkSync
} = {}) {
  const entries = collectEntries(absoluteRoot, { readdirFn, lstatFn });

  // Detect distinct raw paths that collapse to the same canonical path. Once validated,
  // the canonical POSIX+NFC representation is the path used for sorting and hashing.
  const byNormalized = new Map();
  for (const entry of entries) {
    const rawRelPath = entry.relSegments.join("/");
    const normalizedRelPath = entry.relSegments.map((segment) => segment.normalize("NFC")).join("/");
    entry.relPath = normalizedRelPath;
    const existing = byNormalized.get(normalizedRelPath);
    if (existing !== undefined && existing !== rawRelPath) {
      throw new FingerprintError("normalized_path_collision", `normalized path collision under ${absoluteRoot}: ${normalizedRelPath}`, {
        normalizedPath: normalizedRelPath,
        originalPaths: [existing, rawRelPath]
      });
    }
    byNormalized.set(normalizedRelPath, rawRelPath);
  }

  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.isSymlink) continue;
    try {
      totalBytes += lstatFn(entry.absPath).size;
    } catch (error) {
      throw asFingerprintObservationError(error, entry.absPath, "preflight-lstat");
    }
  }
  if (totalBytes > maxBytes) {
    throw new FingerprintError("source_too_large", `source exceeds size limit: ${absoluteRoot}`, {
      path: absoluteRoot,
      limitBytes: maxBytes,
      observedBytes: totalBytes
    });
  }

  entries.sort((a, b) => compareUtf8Bytes(a.relPath, b.relPath));

  const fingerprintLines = [];
  const contentLines = [];
  for (const entry of entries) {
    if (entry.isSymlink) {
      let targetBuf;
      try {
        targetBuf = readlinkFn(entry.absPath, "buffer");
      } catch (error) {
        throw asFingerprintObservationError(error, entry.absPath, "readlink");
      }
      if (!isValidUtf8Buffer(targetBuf)) {
        throw new FingerprintError("invalid_utf8", `symlink target is not valid UTF-8: ${entry.absPath}`, { path: entry.absPath });
      }
      // Deliberately NOT NFC-normalized: the target is opaque data being hashed for
      // content-identity, not a path compared against other paths for collision purposes.
      // Normalizing it here (without an equivalent collision check) would silently collapse
      // two textually-different targets into the same hash -- exactly the kind of unhandled
      // collision the path-normalization block above exists to catch, not create.
      const relHash = sha256Hex(Buffer.from(entry.relPath, "utf8"));
      const targetHash = sha256Hex(targetBuf);
      fingerprintLines.push(`symlink\0${relHash}\0${targetHash}\n`);
      contentLines.push(`symlink\0${targetHash}\n`);
    } else {
      let bytes;
      try {
        bytes = readFileFn(entry.absPath);
      } catch (error) {
        throw asFingerprintObservationError(error, entry.absPath, "read");
      }
      const fileHash = sha256Hex(bytes);
      const relHash = sha256Hex(Buffer.from(entry.relPath, "utf8"));
      fingerprintLines.push(`file\0${relHash}\0${fileHash}\n`);
      contentLines.push(`file\0${fileHash}\n`);
    }
  }
  contentLines.sort();

  return {
    fingerprint: sha256Hex(Buffer.from(fingerprintLines.join(""), "utf8")),
    contentHash: sha256Hex(Buffer.from(contentLines.join(""), "utf8"))
  };
}

export function computeSourceFingerprint(absolutePath, options = {}) {
  const { lstatFn = fs.lstatSync } = options;
  let stat;
  try {
    stat = lstatFn(absolutePath);
  } catch (error) {
    throw asFingerprintObservationError(error, absolutePath, "lstat");
  }
  if (stat.isDirectory()) return computeDirectoryFingerprint(absolutePath, options);
  if (stat.isFile()) return computeFileFingerprint(absolutePath, options);
  throw new FingerprintError("unreadable", `not a regular file or directory: ${absolutePath}`, { path: absolutePath });
}

export function detectMoved(missingSources, newCandidates) {
  return missingSources.map((missing) => {
    const matches = newCandidates.filter((candidate) => candidate.observedContentHash === missing.confirmedContentHash);
    return matches.length === 1
      ? { sourceId: missing.sourceId, driftState: "moved", observedAtPath: matches[0].path }
      : { sourceId: missing.sourceId, driftState: "missing", observedAtPath: null };
  });
}
