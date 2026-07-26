import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { confineWritePath, ensureDirectoryTree, PathConfinementError } from "./paths.mjs";

function parentRelative(relativePath) {
  const parent = path.dirname(relativePath);
  return parent === "." ? "" : parent;
}

function removeTemporary(tempPath) {
  try {
    fs.rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; the random temp name cannot alias a canonical
    // path and a later mutation will not trust a symlink at this location.
  }
}

export function writeFileAtomic(root, relativePath, contents) {
  ensureDirectoryTree(root, parentRelative(relativePath));
  const targetPath = confineWritePath(root, relativePath);
  const tempRelativePath = `${relativePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const tempPath = confineWritePath(root, tempRelativePath);

  try {
    fs.writeFileSync(tempPath, contents, { flag: "wx" });
    // Re-check the target immediately before replacement. An existing symlink
    // is never replaced because that would make the mutation path ambiguous.
    confineWritePath(root, relativePath);
    fs.renameSync(tempPath, targetPath);
  } finally {
    removeTemporary(tempPath);
  }
}

export function createFileAtomic(root, relativePath, contents) {
  ensureDirectoryTree(root, parentRelative(relativePath));
  const targetPath = confineWritePath(root, relativePath);
  const tempRelativePath = `${relativePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const tempPath = confineWritePath(root, tempRelativePath);

  try {
    fs.writeFileSync(tempPath, contents, { flag: "wx" });
    // link() is an atomic no-clobber publication: EEXIST means another writer
    // already published the target, while the target never observes partial
    // bytes from the temporary file.
    fs.linkSync(tempPath, targetPath);
  } finally {
    removeTemporary(tempPath);
  }
}

export function renameWithinRoot(root, fromRelativePath, toRelativePath) {
  ensureDirectoryTree(root, parentRelative(toRelativePath));
  const fromPath = confineWritePath(root, fromRelativePath);
  const toPath = confineWritePath(root, toRelativePath);
  fs.renameSync(fromPath, toPath);
}

export function deleteWithinRoot(root, relativePath) {
  const targetPath = confineWritePath(root, relativePath);
  fs.rmSync(targetPath, { force: true });
}

export function copyFileAtomic(root, sourceRelativePath, targetRelativePath) {
  const sourcePath = confineWritePath(root, sourceRelativePath);
  const contents = fs.readFileSync(sourcePath);
  writeFileAtomic(root, targetRelativePath, contents);
}

export function assertDistinctMutationTargets(root, relativePaths) {
  const seen = new Set();
  for (const relativePath of relativePaths) {
    const normalized = path.normalize(confineWritePath(root, relativePath));
    if (seen.has(normalized)) {
      throw new PathConfinementError(`duplicate or aliased mutation target: ${relativePath}`);
    }
    seen.add(normalized);
  }
}
