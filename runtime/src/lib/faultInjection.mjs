export class SimulatedCrashError extends Error {}

let activeCheckpoint = null;
let hardExitOnCheckpoint = false;
if (globalThis.__SHIPPING_MODE_TEST_BUILD__) {
  activeCheckpoint = process.env.SHIPPING_MODE_FAULT_CHECKPOINT || null;
  hardExitOnCheckpoint = process.env.SHIPPING_MODE_FAULT_MODE === "exit";
}

export function setFaultCheckpoint(name) {
  activeCheckpoint = name;
  hardExitOnCheckpoint = false;
}

export function clearFaultCheckpoint() {
  activeCheckpoint = null;
  hardExitOnCheckpoint = false;
}

export function checkpoint(name) {
  if (activeCheckpoint === name) {
    const triggered = activeCheckpoint;
    activeCheckpoint = null;
    if (hardExitOnCheckpoint) process.exit(97);
    throw new SimulatedCrashError(triggered);
  }
}
