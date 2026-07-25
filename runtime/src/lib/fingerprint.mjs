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
    const names = readdirFn(currentAbs, { encoding: "buffer" });
    for (const nameBuf of names) {
      if (!isValidUtf8Buffer(nameBuf)) {
        throw new FingerprintError("invalid_utf8", `path is not valid UTF-8 under ${currentAbs}`, { path: currentAbs });
      }
      const name = nameBuf.toString("utf8");
      if (name === ".git") continue; // never part of any source's content, per the design spec
      const absChild = path.join(currentAbs, name);
      const relSegments = [...currentRelSegments, name];
      const stat = lstatFn(absChild);
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

  // Collision detection is about the RAW relative path used to walk the tree (needed so
  // renames/reorganizations are detected as fingerprint changes) -- it is NOT about
  // normalizing symlink targets, which are opaque data, not paths being compared to each
  // other for identity within this scan (see the symlink-handling loop below).
  const byNormalized = new Map();
  for (const entry of entries) {
    const rawRelPath = entry.relSegments.join("/");
    const normalizedRelPath = entry.relSegments.map((segment) => segment.normalize("NFC")).join("/");
    entry.relPath = rawRelPath;
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
    totalBytes += lstatFn(entry.absPath).size;
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
        if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${entry.absPath}`, { path: entry.absPath });
        throw error;
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
        if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${entry.absPath}`, { path: entry.absPath });
        throw error;
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
    if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${absolutePath}`, { path: absolutePath });
    throw error;
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
