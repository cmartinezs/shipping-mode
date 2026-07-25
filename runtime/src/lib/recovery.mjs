export function runRecovery({ operationsRoot, planningRoot, lock }) {
  if (!lock || typeof lock.token !== "string") {
    throw new Error("runRecovery requires an acquired workspace lock");
  }
  // Nothing can be stuck in APPLYING yet -- Task 17 is what first makes that
  // state reachable. "Nothing to recover" is the genuinely correct answer
  // here, not a placeholder. Task 19 adds the classification/replay logic
  // this function needs once APPLYING operations can actually exist.
  return [];
}
