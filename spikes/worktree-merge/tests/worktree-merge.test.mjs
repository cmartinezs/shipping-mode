import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeAggregates, regenerateIndex } from "../merge-protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "spikes/worktree-merge/fixtures/branches.json"), "utf8"));
const merged = mergeAggregates(fixture.left, fixture.right);
assert.deepEqual(merged.map((entry) => entry.id), ["a", "b"], "no-data-loss");
assert.throws(() => mergeAggregates(fixture.conflictLeft, fixture.conflictRight), /conflict:x/, "no-silent-overwrite");
assert.deepEqual(regenerateIndex(merged), [
  { id: "a", display_id: "REL-001", slug: "first" },
  { id: "b", display_id: "REL-002", slug: "second" }
], "regenerable-index");
console.log("worktree-merge tests: no data loss, no silent overwrite and regenerable indexes passed");
