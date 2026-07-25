import fs from "node:fs";
import path from "node:path";

export class PathConfinementError extends Error {
  constructor(message) {
    super(message);
    this.name = "PathConfinementError";
  }
}

function isWithin(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function lexicalTarget(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new PathConfinementError("path must be a non-empty relative string");
  }
  if (path.isAbsolute(relativePath)) {
    throw new PathConfinementError(`absolute path rejected: ${relativePath}`);
  }
  const target = path.resolve(root, relativePath);
  if (!isWithin(target, root)) {
    throw new PathConfinementError(`path escapes root: ${relativePath}`);
  }
  return target;
}

export function confineUnder(root, relativePath) {
  const normalizedTarget = lexicalTarget(root, relativePath);
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  let currentPath = root;
  let currentReal = fs.realpathSync.native(root);
  let resolvedCount = 0;

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    let stat;
    try {
      stat = fs.lstatSync(currentPath);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const real = fs.realpathSync.native(currentPath);
      if (!isWithin(real, currentReal)) {
        throw new PathConfinementError(`symlink escapes root: ${currentPath}`);
      }
      currentReal = real;
    } else {
      currentReal = fs.realpathSync.native(currentPath);
    }
    resolvedCount += 1;
  }

  const remainingSegments = segments.slice(resolvedCount);
  return remainingSegments.length > 0 ? path.join(currentReal, ...remainingSegments) : currentReal;
}

// Mutation paths are stricter than read-only references: no existing path
// component may be a symlink, even when it resolves back inside the root.
// This prevents aliases such as .runtime/operations -> another in-workspace
// directory from redirecting staging, snapshots, temporaries, or canonical
// writes to a location the caller did not name.
export function confineWritePath(root, relativePath) {
  const normalizedTarget = lexicalTarget(root, relativePath);
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new PathConfinementError(`${root} must be a real directory`);
  }

  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new PathConfinementError(`symlink component rejected for mutation path: ${current}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new PathConfinementError(`non-directory path component rejected: ${current}`);
    }
  }
  return normalizedTarget;
}

export function ensureDirectoryTree(root, relativeDirectory = "") {
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new PathConfinementError(`${root} must be a real directory`);
  }
  if (!relativeDirectory || relativeDirectory === ".") return root;

  lexicalTarget(root, relativeDirectory);
  let current = root;
  for (const segment of relativeDirectory.split(/[\\/]+/).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      fs.mkdirSync(current);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new PathConfinementError(`directory component must be a real directory: ${current}`);
    }
  }
  return current;
}

export function confineRuntimePath(planningRoot, relativePath) {
  return confineUnder(planningRoot, relativePath);
}

export function confineRuntimeWritePath(planningRoot, relativePath) {
  return confineWritePath(planningRoot, relativePath);
}

export function confineScopePath(workspaceRoot, relativePath) {
  const resolved = confineUnder(workspaceRoot, relativePath);
  const planningRoot = path.resolve(workspaceRoot, ".planning");
  if (isWithin(resolved, planningRoot)) {
    throw new PathConfinementError("scope path must not point inside .planning/");
  }
  return resolved;
}

function assertTrustedRoot(parentDir, name) {
  const candidate = path.join(parentDir, name);
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new PathConfinementError(`${candidate} must not be a symlink`);
  }
  if (!stat.isDirectory()) {
    throw new PathConfinementError(`${candidate} must be a directory`);
  }
  const real = fs.realpathSync.native(candidate);
  const realParent = fs.realpathSync.native(parentDir);
  if (!isWithin(real, realParent)) {
    throw new PathConfinementError(`${candidate} resolves outside ${parentDir}`);
  }
}

export function assertTrustedRoots(planningRoot) {
  const workspaceRoot = path.dirname(planningRoot);
  assertTrustedRoot(workspaceRoot, path.basename(planningRoot));
  try {
    fs.lstatSync(planningRoot);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const name of ["operations", "events", ".runtime", "scopes", "sources"]) {
    assertTrustedRoot(planningRoot, name);
  }

  const runtimeRoot = path.join(planningRoot, ".runtime");
  try {
    fs.lstatSync(runtimeRoot);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  assertTrustedRoot(runtimeRoot, "operations");
}
