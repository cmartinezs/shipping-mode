import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lock-dead-race-"));
const planningRoot = path.join(workspace, ".planning");
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
assert.equal(a.status, "LOCK_HELD");
assert.equal(b.status, "LOCK_HELD");
assert.deepEqual(JSON.parse(fs.readFileSync(metadataPath, "utf8")), deadMetadata);
assert.equal(fs.readdirSync(path.dirname(lockDir)).filter((name) => name.includes("quarantine")).length, 0);

console.log("lock-dead-race: all contenders fail closed; dead lock is never vacated or quarantined automatically");
