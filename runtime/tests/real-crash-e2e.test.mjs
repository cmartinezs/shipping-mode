import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "bin", "shipping-mode.mjs");
const testBundle = path.join(root, "runtime", "dist", "shipping-mode.test-bundle.mjs");

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.status, json: JSON.parse(error.stdout) };
  }
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "real-crash-e2e-"));
const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
assert.equal(init.code, 0);
const operationId = init.json.operationId;
assert.equal(run(["changeset", "validate", operationId], cwd).code, 0);
assert.equal(run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);

const crashScript = `
  import { dispatch } from ${JSON.stringify(testBundle)};
  dispatch("changeset", ["apply", ${JSON.stringify(operationId)}, "--actor", "carlos"], ${JSON.stringify(cwd)});
`;
const crashed = spawnSync(process.execPath, ["--input-type=module", "-e", crashScript], {
  cwd,
  encoding: "utf8",
  env: {
    ...process.env,
    SHIPPING_MODE_FAULT_CHECKPOINT: "AFTER_APPLYING",
    SHIPPING_MODE_FAULT_MODE: "exit"
  }
});
assert.equal(crashed.status, 97, "fault worker must terminate inside the critical section without executing finally");

const lockDir = path.join(cwd, ".planning", ".runtime", "workspace.lock");
const metadataPath = path.join(lockDir, "lock.json");
assert.equal(fs.existsSync(metadataPath), true, "hard process exit must leave the workspace lock on disk");
const deadMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
assert.equal(typeof deadMetadata.pid, "number");

const blocked = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
assert.equal(blocked.code, 1);
assert.match(blocked.json.error, /dead process/);
assert.match(blocked.json.error, /manual/);
assert.equal(fs.existsSync(metadataPath), true, "runtime must not auto-reclaim a dead lock");

fs.rmSync(lockDir, { recursive: true, force: true });
const retry = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
assert.equal(retry.code, 1, "recovery completes before the retried callback observes APPLIED and rejects re-apply");
assert.match(retry.json.error, /status APPLIED/);

const check = run(["check", "schema"], cwd);
assert.equal(check.code, 0);
assert.equal(check.json.status, "PASS");
assert.deepEqual(check.json.pendingOperations, []);

const operation = fs.readFileSync(path.join(cwd, ".planning", "operations", operationId, "operation.yml"), "utf8");
assert.match(operation, /status: APPLIED/);

const eventsRoot = path.join(cwd, ".planning", "events");
const eventFiles = fs.readdirSync(path.join(eventsRoot, fs.readdirSync(eventsRoot)[0], fs.readdirSync(path.join(eventsRoot, fs.readdirSync(eventsRoot)[0]))[0]));
assert.equal(eventFiles.filter((name) => name.endsWith(".json")).length, 1, "hard-crash recovery must publish exactly one event");

console.log("real-crash-e2e: hard exit leaves a dead lock, manual resolution preserves safety, and recovery completes idempotently");
