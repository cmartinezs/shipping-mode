import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const distFile = path.join(root, "runtime", "dist", "shipping-mode.mjs");
assert.ok(fs.existsSync(distFile), "runtime/dist/shipping-mode.mjs must exist");

const bundleSource = fs.readFileSync(distFile, "utf8");
assert.doesNotMatch(bundleSource, /from\s+["']yaml["']/);
assert.doesNotMatch(bundleSource, /from\s+["']ajv["']/);
assert.doesNotMatch(bundleSource, /ajv\/dist\/runtime/);
assert.doesNotMatch(bundleSource, /SHIPPING_MODE_FAULT_CHECKPOINT/);
assert.doesNotMatch(bundleSource, /SHIPPING_MODE_FAULT_MODE/);

const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-isolated-"));
const isolatedBundle = path.join(isolated, "shipping-mode.mjs");
fs.copyFileSync(distFile, isolatedBundle);
const workspace = path.join(isolated, "workspace");
fs.mkdirSync(workspace);

const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
  import { dispatch } from ${JSON.stringify(pathToFileURL(isolatedBundle).href)};
  const cwd = ${JSON.stringify(workspace)};
  const proposed = dispatch("init", ["--name", "isolated", "--vcs", "git", "--actor", "tester"], cwd);
  const validated = dispatch("changeset", ["validate", proposed.operationId], cwd);
  const approved = dispatch("changeset", ["approve", proposed.operationId, "--actor", "tester", "--allow-self-approval"], cwd);
  const applied = dispatch("changeset", ["apply", proposed.operationId, "--actor", "tester"], cwd);
  const checked = dispatch("check", ["schema"], cwd);
  console.log(JSON.stringify({ validated, approved, applied, checked }));
`], {
  cwd: isolated,
  encoding: "utf8",
  env: { PATH: process.env.PATH }
});

const result = JSON.parse(output.trim());
assert.equal(result.validated.status, "VALIDATED");
assert.equal(result.approved.status, "APPROVED");
assert.equal(result.applied.status, "APPLIED");
assert.equal(result.checked.status, "PASS");
assert.equal(fs.existsSync(path.join(isolated, "node_modules")), false, "isolated execution must not gain node_modules");

console.log("bundle-self-contained: isolated no-node_modules lifecycle exercises YAML, schemas, journal, and recovery-safe writes");
