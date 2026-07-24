import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSupportedNode, preflight } from "../runtime-preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const matrix = JSON.parse(fs.readFileSync(path.join(root, "spikes/runtime-node20/fixtures/platform-matrix.json"), "utf8"));
for (const fixture of matrix) assert.equal(isSupportedNode(fixture.node), fixture.supported, fixture.node);
assert.equal(preflight("18.20.0").supported, false);
assert.equal(preflight("20.0.0").runtime, "self-contained-bundle");
assert.equal(preflight().supported, true);
console.log("runtime-node20 tests: preflight, minimum version, JSON output and path matrix passed");
