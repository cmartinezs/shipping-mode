import assert from "node:assert/strict";
import { UsageError, StateError, StaleError } from "../errors.mjs";

assert.ok(new UsageError("bad flag") instanceof Error);
assert.ok(new StateError("wrong status") instanceof Error);
assert.ok(new StaleError("revision changed") instanceof Error);
assert.notEqual(UsageError, StateError);
assert.notEqual(StateError, StaleError);

// Verify error.name is set correctly (required for CLI exit code mapping)
assert.equal(new UsageError("x").name, "UsageError");
assert.equal(new StateError("x").name, "StateError");
assert.equal(new StaleError("x").name, "StaleError");

console.log("errors: all tests passed");
