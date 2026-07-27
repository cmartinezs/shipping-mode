import fs from "node:fs";

export class SimulatedCrashError extends Error {}

let activeCheckpoint = null;
let faultMode = null;
if (globalThis.__SHIPPING_MODE_TEST_BUILD__) {
  activeCheckpoint = process.env.SHIPPING_MODE_FAULT_CHECKPOINT || null;
  faultMode = process.env.SHIPPING_MODE_FAULT_MODE || null;
}

export function setFaultCheckpoint(name) {
  activeCheckpoint = name;
  faultMode = null;
}

export function clearFaultCheckpoint() {
  activeCheckpoint = null;
  faultMode = null;
}

export function checkpoint(name) {
  if (activeCheckpoint === name) {
    const triggered = activeCheckpoint;
    activeCheckpoint = null;
    if (faultMode === "exit") process.exit(97);
    if (faultMode === "wait-for-kill") {
      if (process.env.SHIPPING_MODE_FAULT_MARKER) {
        fs.writeFileSync(process.env.SHIPPING_MODE_FAULT_MARKER, JSON.stringify({ checkpoint: triggered, pid: process.pid }));
      }
      const blocker = new Int32Array(new SharedArrayBuffer(4));
      while (true) Atomics.wait(blocker, 0, 0, 1000);
    }
    throw new SimulatedCrashError(triggered);
  }
}
