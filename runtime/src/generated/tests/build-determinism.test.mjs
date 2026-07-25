import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const committedValidators = fs.readFileSync(path.join(root, "runtime", "src", "generated", "validators.mjs"), "utf8");
const committedMeta = fs.readFileSync(path.join(root, "runtime", "src", "generated", "build-meta.mjs"), "utf8");

const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "build-schemas-"));
execFileSync("node", [path.join(root, "scripts", "build-runtime.mjs"), "--schemas-only", "--out", tmpOut], { cwd: root });
const regeneratedValidators = fs.readFileSync(path.join(tmpOut, "validators.mjs"), "utf8");
const regeneratedMeta = fs.readFileSync(path.join(tmpOut, "build-meta.mjs"), "utf8");

assert.equal(regeneratedValidators, committedValidators, "regenerating validators.mjs must be byte-identical to the committed file");
assert.equal(regeneratedMeta, committedMeta, "regenerating build-meta.mjs must be byte-identical to the committed file");
assert.match(committedMeta, /^export const PLUGIN_VERSION = "[^"]+";\nexport const TEMPLATE_PACK_FINGERPRINT = "sha256:[0-9a-f]{64}";\n$/, "build-meta.mjs must contain a real version and a real sha256 fingerprint, never a placeholder");

console.log("build-determinism: validators.mjs and build-meta.mjs are up to date");
