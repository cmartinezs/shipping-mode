#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildScript = path.join(root, "scripts", "build-runtime.mjs");

function buildInto(label) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `shipping-mode-${label}-`));
  const generated = path.join(tempRoot, "generated");
  const bundle = path.join(tempRoot, "shipping-mode.mjs");
  execFileSync(process.execPath, [buildScript, "--out", generated, "--bundle-out", bundle], {
    cwd: root,
    stdio: "pipe"
  });
  return {
    validators: fs.readFileSync(path.join(generated, "validators.mjs")),
    meta: fs.readFileSync(path.join(generated, "build-meta.mjs")),
    bundle: fs.readFileSync(bundle)
  };
}

const committed = {
  validators: fs.readFileSync(path.join(root, "runtime", "src", "generated", "validators.mjs")),
  meta: fs.readFileSync(path.join(root, "runtime", "src", "generated", "build-meta.mjs")),
  bundle: fs.readFileSync(path.join(root, "runtime", "dist", "shipping-mode.mjs"))
};
const first = buildInto("build-a");
const second = buildInto("build-b");

for (const key of ["validators", "meta", "bundle"]) {
  assert.deepEqual(first[key], second[key], `${key} must be byte-identical across two clean builds`);
  assert.deepEqual(first[key], committed[key], `${key} committed artifact is stale; regenerate and commit it`);
}

console.log("generated-artifacts: validators, build metadata, and production bundle are deterministic and committed byte-for-byte");
