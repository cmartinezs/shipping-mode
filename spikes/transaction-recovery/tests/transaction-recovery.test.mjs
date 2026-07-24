import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyWithRecovery, recover } from "../transaction.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const matrix = JSON.parse(fs.readFileSync(path.join(root, "spikes/transaction-recovery/fixtures/failure-matrix.json"), "utf8"));
const operation = { id: "op-1", files: { "state.json": "canonical" } };
for (const { failure, expected } of matrix) {
  const result = applyWithRecovery(operation, { files: {}, journal: [] }, failure);
  if (expected === "commit") assert.equal(result.journal.at(-1), "op-1:committed");
  else assert.equal(result.recovered, true);
}
const partial = applyWithRecovery(operation, { files: {}, journal: [] }, "after-apply");
const recovered = recover(partial, operation);
assert.equal(recovered.files["state.json"], "canonical", "verified-recovery");
assert.equal(recover(recovered, operation).replayed, true, "idempotent-retry");
assert.equal(Object.keys(recovered.files).length, 1, "no-corruption");
console.log("transaction-recovery tests: idempotent retry, verified recovery and no corruption passed");
