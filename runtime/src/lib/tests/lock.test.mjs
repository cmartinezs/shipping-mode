import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireWorkspaceLock, LockHeldError } from "../lock.mjs";

assert.equal(new LockHeldError("x").name, "LockHeldError");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });

const lock = acquireWorkspaceLock(planningRoot, "op-1");
assert.ok(lock.token);
assert.throws(() => acquireWorkspaceLock(planningRoot, "op-2"), LockHeldError);
lock.release();

const lock2 = acquireWorkspaceLock(planningRoot, "op-3");
assert.notEqual(lock2.token, lock.token);
lock2.release();

const lockDir = path.join(planningRoot, ".runtime", "workspace.lock");
const metadataPath = path.join(lockDir, "lock.json");
fs.mkdirSync(lockDir, { recursive: true });
const deadMetadata = {
  token: "dead-token",
  pid: 999999,
  hostname: os.hostname(),
  startedAt: new Date().toISOString(),
  operationId: null
};
fs.writeFileSync(metadataPath, JSON.stringify(deadMetadata));
assert.throws(
  () => acquireWorkspaceLock(planningRoot, "op-4"),
  (error) => error instanceof LockHeldError && /dead process/.test(error.message) && /manual/.test(error.message),
  "a dead lock must never be auto-reclaimed without fencing"
);
assert.deepEqual(JSON.parse(fs.readFileSync(metadataPath, "utf8")), deadMetadata, "manual-recovery policy must leave dead-lock evidence untouched");
fs.rmSync(lockDir, { recursive: true, force: true });

fs.mkdirSync(lockDir, { recursive: true });
assert.throws(() => acquireWorkspaceLock(planningRoot, "op-5"), LockHeldError, "metadata-less lock requires manual resolution");
fs.rmSync(lockDir, { recursive: true, force: true });

fs.mkdirSync(lockDir, { recursive: true });
fs.writeFileSync(metadataPath, JSON.stringify({ ...deadMetadata, hostname: "other-host" }));
assert.throws(() => acquireWorkspaceLock(planningRoot, "op-6"), /other-host/);

console.log("lock: active, dead, metadata-less, and remote locks all preserve exclusive safety");
