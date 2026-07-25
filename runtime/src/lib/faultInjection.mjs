export class SimulatedCrashError extends Error {}

// Reading globalThis.__SHIPPING_MODE_TEST_BUILD__ (a property access, never a
// bare identifier reference) is safe in every context: unbundled, it's simply
// undefined/falsy; bundled by esbuild with `define`, the exact expression
// "globalThis.__SHIPPING_MODE_TEST_BUILD__" gets replaced with the literal
// `true` or `false`, and esbuild's dead-code elimination removes this whole
// branch (and the process.env read inside it) from the production bundle
// entirely -- verified textually by Task 24's bundle test.
let activeCheckpoint = null;
if (globalThis.__SHIPPING_MODE_TEST_BUILD__ && process.env.SHIPPING_MODE_FAULT_CHECKPOINT) {
  activeCheckpoint = process.env.SHIPPING_MODE_FAULT_CHECKPOINT;
}

export function setFaultCheckpoint(name) {
  activeCheckpoint = name;
}

export function clearFaultCheckpoint() {
  activeCheckpoint = null;
}

export function checkpoint(name) {
  if (activeCheckpoint === name) {
    const triggered = activeCheckpoint;
    activeCheckpoint = null; // one-shot: fires once, then disarms itself
    throw new SimulatedCrashError(triggered);
  }
}
