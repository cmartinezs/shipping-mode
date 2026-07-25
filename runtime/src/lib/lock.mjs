import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDirectoryTree, PathConfinementError } from "./paths.mjs";

export class LockHeldError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockHeldError";
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function readMetadata(metadataPath) {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch {
    return null;
  }
}

function writeMetadataExclusive(metadataPath, content) {
  fs.writeFileSync(metadataPath, content, { flag: "wx" });
}

export function acquireWorkspaceLock(planningRoot, operationId = null) {
  const runtimeDir = path.join(planningRoot, ".runtime");
  const lockDir = path.join(runtimeDir, "workspace.lock");
  const metadataPath = path.join(lockDir, "lock.json");

  try {
    fs.mkdirSync(planningRoot);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const planningStat = fs.lstatSync(planningRoot);
  if (planningStat.isSymbolicLink() || !planningStat.isDirectory()) {
    throw new PathConfinementError(`${planningRoot} must be a real directory`);
  }
  ensureDirectoryTree(planningRoot, ".runtime");
  try {
    fs.mkdirSync(lockDir);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;

    const metadata = readMetadata(metadataPath);
    if (!metadata) {
      throw new LockHeldError(
        "workspace lock exists without readable metadata; automatic removal is unsafe and manual resolution is required"
      );
    }
    if (metadata.hostname !== os.hostname()) {
      throw new LockHeldError(`workspace lock held by host ${metadata.hostname}`);
    }
    if (isProcessAlive(metadata.pid)) {
      throw new LockHeldError(`workspace lock held by running process ${metadata.pid}`);
    }

    // Corte 0 intentionally does not auto-reclaim a dead process's lock.
    // mkdir/rename alone cannot provide a fencing guarantee: a stale
    // reclaimer can temporarily vacate the path and allow a second writer to
    // enter while the original holder still executes. Requiring an operator
    // to inspect and remove a dead lock preserves exclusivity at the cost of
    // availability; leases/fencing are deferred to a later corte.
    throw new LockHeldError(
      `workspace lock belongs to dead process ${metadata.pid} on this host; ` +
      `inspect ${metadataPath} and remove ${lockDir} manually only after confirming no writer is active`
    );
  }

  const token = crypto.randomUUID();
  try {
    writeMetadataExclusive(metadataPath, JSON.stringify({
      token,
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
      operationId
    }, null, 2));
  } catch (error) {
    // Do not remove the directory here. A crash or competing external actor
    // may have changed its generation; leaving it blocked is safer than
    // deleting a lock we cannot prove we still own.
    throw new LockHeldError(`workspace lock metadata could not be committed safely: ${error.message}`);
  }

  return {
    token,
    release() {
      const currentMetadata = readMetadata(metadataPath);
      if (!currentMetadata || currentMetadata.token !== token) return;
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  };
}
