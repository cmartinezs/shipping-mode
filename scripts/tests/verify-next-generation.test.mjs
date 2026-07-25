import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(".");
const gatePath = path.join(root, "scripts/verify-next-generation.sh");
const gate = fs.readFileSync(gatePath, "utf8");

assert.match(gate, /npm run --silent verify:artifacts/);
assert.match(gate, /npm run --silent test:real-crash-e2e/);
assert.match(gate, /npm run --silent test:security-e2e/);
assert.match(gate, /scan-next-generation-docs\.mjs/);
assert.match(gate, /node hooks\/tests\/protect-planning-state\.test\.mjs/);
assert.match(gate, /node spikes\/verify-corte-1\.2\.mjs --structure-only/);
assert.match(gate, /NEXT_GENERATION_DOCS_ROOT/);
assert.doesNotMatch(gate, /\brg\b/, "verification must not silently depend on optional ripgrep");
assert.doesNotMatch(gate, /npm run --silent build:runtime/, "verification must compare the committed production bundle before any in-place rebuild can hide staleness");

const contaminatedDocs = fs.mkdtempSync(path.join(os.tmpdir(), "next-generation-docs-"));
fs.writeFileSync(path.join(contaminatedDocs, "forbidden.md"), "Use scripts/verify-plugin.sh as the next-generation gate.\n");

assert.throws(
  () => execFileSync("/bin/bash", [gatePath], {
    cwd: root,
    env: {
      ...process.env,
      NEXT_GENERATION_DOCS_ROOT: contaminatedDocs,
      VERIFY_NEXT_GENERATION_SKIP_TESTS: "1"
    },
    stdio: "pipe"
  }),
  (error) => error.status === 1 && String(error.stderr).includes("v3 verifier"),
  "v3-verifier-reference-detected"
);

console.log("next-generation verifier tests: portable docs scan, artifact freshness, real crash, and regression gates are wired");
