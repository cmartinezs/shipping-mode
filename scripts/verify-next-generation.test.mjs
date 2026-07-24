import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(".");
const gatePath = path.join(root, "scripts/verify-next-generation.sh");
const gate = fs.readFileSync(gatePath, "utf8");
const forbiddenCases = [
  ["legacy-state-detected", "PARTIALLY_APPLIED"],
  ["ulid-example-detected", "OP-01J"],
  ["hybrid-path-detected", "RI0004"],
  ["move-stage-detected", "item move"],
  ["fallback-namespace-detected", "/arc-init"],
  ["node-version-invalid", "Node.js 20+ is required"]
];
for (const [name, sample] of forbiddenCases) {
  if (name === "move-stage-detected") assert.match(gate, /item\[\[:space:\]\]\+move/);
  else assert.match(gate, new RegExp(sample.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), name);
}

assert.match(gate, /node hooks\/tests\/protect-planning-state\.test\.mjs/);
assert.match(gate, /node spikes\/verify-corte-1\.2\.mjs --structure-only/);
assert.match(gate, /NEXT_GENERATION_DOCS_ROOT/);
assert.match(gate, /verify-plugin\\\.sh/);

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

console.log("next-generation verifier tests: 7 passed");
