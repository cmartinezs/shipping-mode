import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedDslOperators, canonicalJson, canonicalPath, isUuidV7, sha256 } from "../canonical.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "spikes/canonical-core/fixtures/canonical.json"), "utf8"));
assert.equal(canonicalJson(fixture.inputA), canonicalJson(fixture.inputB), "canonical-order");
assert.equal(sha256(fixture.inputA), sha256(fixture.inputB), "reproducible-hash");
assert.equal(isUuidV7(fixture.uuidv7), true);
assert.equal(isUuidV7(fixture.invalidUuid), false);
assert.equal(canonicalPath("releases", fixture.uuidv7), `releases/${fixture.uuidv7}/`);
assert.throws(() => canonicalPath("releases", fixture.invalidUuid), /UUIDv7/);
assert.deepEqual([...allowedDslOperators].sort(), ["all", "any", "contains", "equals", "exists", "in", "matches", "not", "not_equals"]);
console.log("canonical-core tests: UUIDv7 identity, reproducible hash, path isolation and DSL operators passed");
