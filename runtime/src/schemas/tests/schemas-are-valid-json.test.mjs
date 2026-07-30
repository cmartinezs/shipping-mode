import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const schemasDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expected = ["config", "plugin-lock", "scope", "source", "guide", "release-item", "execution-context", "environment", "change-set", "operation", "event", "result"];

for (const name of expected) {
  const file = path.join(schemasDir, `${name}.schema.json`);
  assert.ok(fs.existsSync(file), `${name}.schema.json must exist`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(parsed.type, "object", `${name} schema must describe an object`);
  assert.equal(parsed.additionalProperties, false, `${name} schema must reject unknown properties`);
}

const changeSet = JSON.parse(fs.readFileSync(path.join(schemasDir, "change-set.schema.json"), "utf8"));
const conditionalKinds = new Set(changeSet.allOf.map((entry) => entry.if?.properties?.kind?.const).filter(Boolean));
assert.deepEqual(conditionalKinds, new Set(changeSet.properties.kind.enum), "change-set schema must conditionally validate payload shape for every public kind");

const operation = JSON.parse(fs.readFileSync(path.join(schemasDir, "operation.schema.json"), "utf8"));
assert.ok(operation.required.includes("reservedEvents"), "operation schema must require reservedEvents from PROPOSED onward");
assert.ok(Array.isArray(operation.allOf) && operation.allOf.length >= 5, "operation schema must carry per-status invariants");

console.log(`schemas: all ${expected.length} files present and structurally sane`);
