import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "bin", "shipping-mode.mjs");

function run(args, cwd, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", ...options });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.status, json: JSON.parse(error.stdout) };
  }
}

function fullyInit(cwd) {
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  run(["changeset", "validate", init.json.operationId], cwd);
  run(["changeset", "approve", init.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  const applied = run(["changeset", "apply", init.json.operationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 0);
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "payload-null-e2e-"));
  const payloadFile = path.join(cwd, "empty.yml");
  fs.writeFileSync(payloadFile, "---\n");
  const result = run(["changeset", "propose", "--kind", "scope.add", "--payload-file", payloadFile, "--actor", "carlos"], cwd);
  assert.equal(result.code, 1);
  assert.match(result.json.error, /mapping\/object/);
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-link-e2e-"));
  fullyInit(cwd);
  const proposed = run(["config", "set", "--name", "renamed", "--actor", "carlos"], cwd);
  run(["changeset", "validate", proposed.json.operationId], cwd);
  run(["changeset", "approve", proposed.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);

  const configPath = path.join(cwd, ".planning", "config.yml");
  const outside = path.join(cwd, "outside-config.yml");
  const outsideBytes = "schemaVersion: 1\nname: external\nvcs: git\nbaseBranch: null\nscopeRefs: []\n";
  fs.writeFileSync(outside, outsideBytes);
  fs.rmSync(configPath);
  fs.symlinkSync(outside, configPath);

  const result = run(["changeset", "apply", proposed.json.operationId, "--actor", "carlos"], cwd);
  assert.equal(result.code, 1);
  assert.match(result.json.error, /symlink component rejected/);
  assert.equal(fs.readFileSync(outside, "utf8"), outsideBytes);
}

console.log("security-e2e: null payloads are typed rejections and canonical symlinks never redirect writes");
