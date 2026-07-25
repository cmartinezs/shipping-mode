import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireWorkspaceLock, LockHeldError } from "../lock.mjs";

// Verify error.name is set correctly (required for CLI exit code mapping)
assert.equal(new LockHeldError("x").name, "LockHeldError");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });

const lock = acquireWorkspaceLock(planningRoot, "op-1");
assert.ok(lock.token);

assert.throws(() => acquireWorkspaceLock(planningRoot, "op-2"), LockHeldError, "a live process holding the lock must block a second acquire");

lock.release();
const lock2 = acquireWorkspaceLock(planningRoot, "op-3");
assert.ok(lock2.token !== lock.token, "releasing must allow a fresh acquire with a new token");
lock2.release();

// simulate an abandoned lock from a dead pid on this host
const lockDir = path.join(planningRoot, ".runtime", "workspace.lock");
fs.rmSync(lockDir, { recursive: true, force: true });
fs.mkdirSync(lockDir, { recursive: true });
fs.writeFileSync(path.join(lockDir, "lock.json"), JSON.stringify({
  token: "stale", pid: 999999, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId: null
}));
const stolen = acquireWorkspaceLock(planningRoot, "op-4");
assert.ok(stolen.token !== "stale", "a lock held by a dead pid on the same host must be safely stolen");
stolen.release();

// a lock directory with unreadable/missing metadata must never be auto-broken
fs.mkdirSync(lockDir, { recursive: true });
assert.throws(() => acquireWorkspaceLock(planningRoot, "op-5"), LockHeldError, "a lock with no readable metadata requires manual resolution");
fs.rmSync(lockDir, { recursive: true, force: true });

console.log("lock: all tests passed");
