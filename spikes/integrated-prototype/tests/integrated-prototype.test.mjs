import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { directWriteIsBlocked, runVerticalSlice } from "../prototype.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "spikes/integrated-prototype/fixtures/vertical-slice.json"), "utf8"));
const { state, steps } = runVerticalSlice();
assert.deepEqual(steps, fixture.steps, "vertical-slice");
assert.equal(state.changesets.length, 1, "changeset-required");
assert.equal(state.events.at(-2).status, "PASSED", "architecture-check");
assert.equal(state.events.at(-1).status, "READY", "report");
assert.equal(state.events.some((event) => event.type === "apply" && event.hash), true, "audit-trail");
assert.equal(directWriteIsBlocked(), true, "hooks-block-direct-writes");
console.log("integrated-prototype tests: vertical slice, ChangeSet, audit trail and direct-write protection passed");
