import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const distFile = path.join(root, "runtime", "dist", "shipping-mode.mjs");
assert.ok(fs.existsSync(distFile), "runtime/dist/shipping-mode.mjs must exist (run npm run build:runtime)");

const bundleSource = fs.readFileSync(distFile, "utf8");
assert.doesNotMatch(bundleSource, /from\s+["']yaml["']/, "the yaml package must be inlined, not imported at runtime");
assert.doesNotMatch(bundleSource, /from\s+["']ajv["']/, "ajv must not be imported at runtime");
assert.doesNotMatch(bundleSource, /ajv\/dist\/runtime/, "no reference to ajv's internal runtime path may remain in the final bundle");
assert.doesNotMatch(bundleSource, /SHIPPING_MODE_FAULT_CHECKPOINT/, "fault injection must be compiled out of the production bundle entirely");

const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-isolated-"));
fs.copyFileSync(distFile, path.join(isolated, "shipping-mode.mjs"));
const output = execFileSync("node", ["--input-type=module", "-e", `
  import { dispatch, UsageError } from "${path.join(isolated, "shipping-mode.mjs")}";
  console.log(JSON.stringify({ dispatch: typeof dispatch, UsageError: typeof UsageError }));
`], { cwd: isolated });
assert.deepEqual(JSON.parse(output.toString().trim()), { dispatch: "function", UsageError: "function" });

console.log("bundle-self-contained: no external imports, runs without node_modules");
