import { acquireWorkspaceLock } from "./lock.mjs";
import { runRecovery } from "./recovery.mjs";
import { RecoveryRequiredError } from "./journal.mjs";
import { assertTrustedRoots } from "./paths.mjs";

export function withWorkspaceMutation({ planningRoot, operationsRoot, operationId = null }, callback) {
  assertTrustedRoots(planningRoot);
  const lock = acquireWorkspaceLock(planningRoot, operationId);
  try {
    const outcomes = runRecovery({ operationsRoot, planningRoot, lock });
    const conflict = outcomes.find((outcome) => outcome.outcome === "RECOVERY_REQUIRED");
    if (conflict) {
      throw new RecoveryRequiredError(`operation ${conflict.operationId} requires manual recovery before any further mutation can proceed`);
    }
    return callback();
  } finally {
    lock.release();
  }
}

export function recoverWorkspace({ planningRoot, operationsRoot }) {
  assertTrustedRoots(planningRoot);
  const lock = acquireWorkspaceLock(planningRoot, null);
  try {
    return runRecovery({ operationsRoot, planningRoot, lock });
  } finally {
    lock.release();
  }
}
