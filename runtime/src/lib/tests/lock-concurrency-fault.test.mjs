import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireWorkspaceLock, LockHeldError } from "../lock.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lock-fault-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
const lockDir = path.join(planningRoot, ".runtime", "workspace.lock");
const metadataPath = path.join(lockDir, "lock.json");

const originalWriteFileSync = fs.writeFileSync;
fs.writeFileSync = function (target, ...rest) {
  if (target === metadataPath) {
    const error = new Error("simulated metadata commit failure");
    error.code = "EIO";
    throw error;
  }
  return originalWriteFileSync.call(fs, target, ...rest);
};
let failure;
try {
  acquireWorkspaceLock(planningRoot, "op");
} catch (error) {
  failure = error;
} finally {
  fs.writeFileSync = originalWriteFileSync;
}
assert.ok(failure instanceof LockHeldError);
assert.equal(fs.existsSync(lockDir), true, "failed metadata commit must leave a fail-closed lock directory");
assert.equal(fs.existsSync(metadataPath), false);
assert.throws(() => acquireWorkspaceLock(planningRoot, "op-2"), /without readable metadata/);

console.log("lock-concurrency-fault: mkdir/write crash window fails closed and requires manual resolution");
