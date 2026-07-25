import assert from "node:assert/strict";
import { setFaultCheckpoint, clearFaultCheckpoint, checkpoint, SimulatedCrashError } from "../faultInjection.mjs";

// no checkpoint armed: a no-op
checkpoint("ANYTHING");

setFaultCheckpoint("AFTER_STAGED");
assert.throws(() => checkpoint("AFTER_STAGED"), SimulatedCrashError);

// one-shot: firing once disarms it, so code that re-enters the same
// checkpoint during a later retry doesn't loop forever
checkpoint("AFTER_STAGED");

setFaultCheckpoint("AFTER_APPLYING");
checkpoint("AFTER_STAGED"); // different name, must not fire
clearFaultCheckpoint();
checkpoint("AFTER_APPLYING"); // cleared, must not fire either

console.log("faultInjection: all tests passed");
