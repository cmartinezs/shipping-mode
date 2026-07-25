import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lock-quarantine-race-"));
const planningRoot = path.join(workspace, ".planning");
const lockDir = path.join(planningRoot, ".runtime", "workspace.lock");
fs.mkdirSync(lockDir, { recursive: true });
fs.writeFileSync(path.join(lockDir, "lock.json"), JSON.stringify({
  token: "stale", pid: 999999, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId: null
}));

const workerPath = path.join(here, "lock-quarantine-race-worker.mjs");

function runWorker(label) {
  return new Promise((resolve) => {
    const child = fork(workerPath, [planningRoot, label], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("exit", () => resolve(JSON.parse(stdout.trim())));
  });
}

const [a, b] = await Promise.all([runWorker("a"), runWorker("b")]);

// Both workers may well succeed (one reclaims the abandoned lock, holds it
// briefly, releases; the other then acquires normally) -- that's fine. What
// must never happen is both of them believing they hold the lock *at the same
// time*, or the metadata file ending up corrupted/missing after both finish.
assert.notEqual(a.token, "stale");
assert.notEqual(b.token, "stale");

// Real shared evidence of mutual exclusion, not a self-reported flag: each
// worker, after acquiring the *real* workspace lock, races to exclusively
// create a marker file via the O_EXCL-equivalent "wx" flag. If a worker ever
// observes that marker already present while it itself holds the workspace
// lock, that is direct proof two holders overlapped -- not an inference from
// timestamps, which a scheduling fluke could make look fine by accident.
assert.notEqual(a.status, "DOUBLE_HOLD_DETECTED", "worker a must never observe a concurrent holder while holding the workspace lock");
assert.notEqual(b.status, "DOUBLE_HOLD_DETECTED", "worker b must never observe a concurrent holder while holding the workspace lock");

const remainingLockDir = path.join(planningRoot, ".runtime", "workspace.lock");
assert.equal(fs.existsSync(remainingLockDir), false, "both workers released; no lock directory should remain");

const staleQuarantineDirs = fs.readdirSync(path.join(planningRoot, ".runtime")).filter((name) => name.startsWith("workspace.lock.quarantine-"));
assert.equal(staleQuarantineDirs.length, 0, "quarantine directories must always be cleaned up, win or lose");

console.log("lock-quarantine-race: exactly one process reclaims an abandoned lock at a time, no corruption, proven via shared exclusive-create evidence");
