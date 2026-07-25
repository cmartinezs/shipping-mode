import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lock-concurrency-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });

const workerPath = path.join(here, "lock-concurrency-worker.mjs");

function runWorker() {
  return new Promise((resolve) => {
    const child = fork(workerPath, [planningRoot], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("exit", () => resolve(JSON.parse(stdout.trim())));
  });
}

const [a, b] = await Promise.all([runWorker(), runWorker()]);
const successes = [a, b].filter((o) => o.status === "ACQUIRED");
const failures = [a, b].filter((o) => o.status === "LOCK_HELD");

assert.equal(successes.length, 1, "exactly one concurrent acquire must succeed");
assert.equal(failures.length, 1, "exactly one concurrent acquire must fail with LOCK_HELD, never both succeeding");

console.log("lock-concurrency: exactly one of two concurrent acquires wins, no corruption");
