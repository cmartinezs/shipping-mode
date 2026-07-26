import fs from "node:fs";
import path from "node:path";
import { readOperation, writeOperation, writeResult, readResult } from "./operationStore.mjs";
import { writeEventIdempotent, RecoveryRequiredError } from "./journal.mjs";
import { contentHash, ABSENT } from "./canonical.mjs";
import { confineRuntimeWritePath, confineWritePath } from "./paths.mjs";
import { deleteWithinRoot, renameWithinRoot } from "./safeFs.mjs";
import { isUuidV7 } from "./ids.mjs";
import { validate as validateSchema } from "./schema.mjs";

function currentContentHash(planningRoot, relativePath) {
  const absolutePath = confineRuntimeWritePath(planningRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return ABSENT;
  return contentHash(fs.readFileSync(absolutePath));
}

function classify(entry, actualHash) {
  if (entry.action === "delete") {
    if (actualHash === ABSENT) return "APPLIED";
    if (actualHash === entry.beforeContentHash) return "PENDING";
    return "DIVERGENT";
  }
  if (actualHash === entry.stagedContentHash) return "APPLIED";
  if (actualHash === entry.beforeContentHash) return "PENDING";
  return "DIVERGENT";
}

function markRecoveryRequired(operationsRoot, operationId, operation, conflict) {
  const detectedAt = new Date().toISOString();
  writeOperation(operationsRoot, operationId, {
    ...operation,
    status: "RECOVERY_REQUIRED",
    conflict: { detectedAt, ...conflict },
    history: [...operation.history, { at: detectedAt, from: "APPLYING", to: "RECOVERY_REQUIRED", actor: "system:recovery", reason: conflict.reason }]
  });
}

export function runRecovery({ operationsRoot, planningRoot, lock }) {
  if (!lock || typeof lock.token !== "string") {
    throw new Error("runRecovery requires an acquired workspace lock");
  }
  if (!fs.existsSync(operationsRoot)) return [];

  const outcomes = [];
  const runtimeOperationsRelative = path.join(".runtime", "operations");

  for (const operationId of fs.readdirSync(operationsRoot)) {
    if (!isUuidV7(operationId)) continue;

    let operation;
    try {
      operation = readOperation(operationsRoot, operationId);
    } catch {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    const operationSchemaCheck = validateSchema("operation", operation);
    if (!operationSchemaCheck.valid || operation.id !== operationId) {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    if (operation.status === "RECOVERY_REQUIRED") {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    if (operation.status === "APPLIED") {
      const residueRelative = path.join(runtimeOperationsRelative, operationId);
      const residue = confineRuntimeWritePath(planningRoot, residueRelative);
      if (fs.existsSync(residue)) {
        fs.rmSync(residue, { recursive: true, force: true });
        outcomes.push({ operationId, outcome: "CLEANED_UP" });
      } else {
        outcomes.push({ operationId, outcome: "NOT_APPLICABLE" });
      }
      continue;
    }

    if (operation.status !== "APPLYING") {
      outcomes.push({ operationId, outcome: "NOT_APPLICABLE" });
      continue;
    }

    let divergent = false;
    for (const entry of operation.filePlan || []) {
      const actualHash = currentContentHash(planningRoot, entry.target);
      const classification = classify(entry, actualHash);

      if (classification === "DIVERGENT") {
        markRecoveryRequired(operationsRoot, operationId, operation, {
          file: entry.target,
          expectedBeforeContentHash: entry.beforeContentHash,
          expectedStagedContentHash: entry.stagedContentHash,
          actualContentHash: actualHash,
          reason: "canonical file diverged from both before and staged expectations"
        });
        divergent = true;
        break;
      }

      if (classification === "PENDING") {
        if (entry.action === "delete") {
          deleteWithinRoot(planningRoot, entry.target);
          continue;
        }
        const stagedRelative = path.join(runtimeOperationsRelative, operationId, "staged", entry.stagedRelativePath);
        let stagedPath;
        try {
          stagedPath = confineRuntimeWritePath(planningRoot, stagedRelative);
        } catch (error) {
          markRecoveryRequired(operationsRoot, operationId, operation, {
            file: entry.target,
            expectedBeforeContentHash: entry.beforeContentHash,
            expectedStagedContentHash: entry.stagedContentHash,
            actualContentHash: actualHash,
            reason: `staged path is not trusted: ${error.message}`
          });
          divergent = true;
          break;
        }
        if (!fs.existsSync(stagedPath) || contentHash(fs.readFileSync(stagedPath)) !== entry.stagedContentHash) {
          markRecoveryRequired(operationsRoot, operationId, operation, {
            file: entry.target,
            expectedBeforeContentHash: entry.beforeContentHash,
            expectedStagedContentHash: entry.stagedContentHash,
            actualContentHash: actualHash,
            reason: "staged file missing or altered; cannot safely redo the write"
          });
          divergent = true;
          break;
        }
        renameWithinRoot(planningRoot, stagedRelative, entry.target);
      }
    }
    if (divergent) {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    const expectedResult = {
      operationId,
      files: (operation.filePlan || []).map((entry) => ({ target: entry.target, action: entry.action, contentHash: entry.stagedContentHash }))
    };
    const resultPath = confineWritePath(operationsRoot, path.join(operationId, "result.json"));
    if (fs.existsSync(resultPath)) {
      let existingResult = null;
      try {
        existingResult = readResult(operationsRoot, operationId);
      } catch {
        existingResult = null;
      }
      const existingSchemaOk = existingResult !== null && validateSchema("result", existingResult).valid;
      if (!existingSchemaOk || JSON.stringify(existingResult) !== JSON.stringify(expectedResult)) {
        markRecoveryRequired(operationsRoot, operationId, operation, {
          file: "result.json",
          reason: "result.json exists but does not match the outcome expected from filePlan, or is schema-invalid"
        });
        outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
        continue;
      }
    } else {
      writeResult(operationsRoot, operationId, expectedResult);
    }

    let eventDivergent = false;
    for (const expectedEvent of operation.expectedEvents || []) {
      const relationallyConsistent = expectedEvent.eventId === expectedEvent.document.eventId
        && expectedEvent.document.operationId === operation.id
        && expectedEvent.relativePath.endsWith(`/${expectedEvent.eventId}.json`);
      if (!relationallyConsistent) {
        markRecoveryRequired(operationsRoot, operationId, operation, {
          file: expectedEvent.relativePath,
          reason: "expectedEvent is internally inconsistent (eventId/operationId/relativePath mismatch)"
        });
        eventDivergent = true;
        break;
      }
      try {
        writeEventIdempotent(path.join(planningRoot, "events"), expectedEvent);
      } catch (error) {
        if (error instanceof RecoveryRequiredError) {
          markRecoveryRequired(operationsRoot, operationId, operation, {
            file: expectedEvent.relativePath,
            expectedStagedContentHash: expectedEvent.contentHash,
            reason: "event file exists with unexpected content"
          });
          eventDivergent = true;
          break;
        }
        throw error;
      }
    }
    if (eventDivergent) {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    const appliedAt = new Date().toISOString();
    const current = readOperation(operationsRoot, operationId);
    writeOperation(operationsRoot, operationId, {
      ...current,
      status: "APPLIED",
      appliedAt,
      history: [...current.history, { at: appliedAt, from: "APPLYING", to: "APPLIED", actor: "system:recovery", reason: null }]
    });
    const residue = confineRuntimeWritePath(planningRoot, path.join(runtimeOperationsRelative, operationId));
    fs.rmSync(residue, { recursive: true, force: true });
    outcomes.push({ operationId, outcome: "COMPLETED" });
  }

  return outcomes;
}
