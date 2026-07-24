import fs from "node:fs";
import path from "node:path";

export class PathConfinementError extends Error {}

function isWithin(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function confineUnder(root, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new PathConfinementError(`absolute path rejected: ${relativePath}`);
  }
  const normalizedTarget = path.resolve(root, relativePath);
  if (!isWithin(normalizedTarget, root)) {
    throw new PathConfinementError(`path escapes root: ${relativePath}`);
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  let currentPath = root;
  let currentReal = fs.realpathSync.native(root);
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    let stat;
    try {
      stat = fs.lstatSync(currentPath);
    } catch (error) {
      if (error.code === "ENOENT") break; // rest already validated lexically above
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
  }
  return normalizedTarget;
}

export function confineRuntimePath(planningRoot, relativePath) {
  return confineUnder(planningRoot, relativePath);
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
    if (error.code === "ENOENT") return; // doesn't exist yet -- safe to create later
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
  if (!fs.existsSync(planningRoot)) return; // fresh bootstrap, nothing further to check yet
  for (const name of ["operations", "events", ".runtime", "scopes"]) {
    assertTrustedRoot(planningRoot, name);
  }
}
