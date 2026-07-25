import fs from "node:fs";
import path from "node:path";
import { readOperation, writeOperation, writeResult, readResult } from "./operationStore.mjs";
import { writeEventIdempotent, RecoveryRequiredError } from "./journal.mjs";
import { contentHash, ABSENT } from "./canonical.mjs";
import { confineRuntimePath, confineUnder } from "./paths.mjs";
import { isUuidV7 } from "./ids.mjs";
import { validate as validateSchema } from "./schema.mjs";

function currentContentHash(planningRoot, relativePath) {
  const absolutePath = confineRuntimePath(planningRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return ABSENT;
  return contentHash(fs.readFileSync(absolutePath));
}

function classify(entry, actualHash) {
  if (actualHash === entry.stagedContentHash) return "APPLIED";
  if (actualHash === entry.beforeContentHash) return "PENDING";
  return "DIVERGENT";
}

function markRecoveryRequired(operationsRoot, operationId, operation, conflict) {
  const detectedAt = new Date().toISOString();
  writeOperation(operationsRoot, operationId, {
    ...operation, status: "RECOVERY_REQUIRED", conflict: { detectedAt, ...conflict },
    history: [...operation.history, { at: detectedAt, from: "APPLYING", to: "RECOVERY_REQUIRED", actor: "system:recovery", reason: conflict.reason }]
  });
}

export function runRecovery({ operationsRoot, planningRoot, lock }) {
  if (!lock || typeof lock.token !== "string") {
    throw new Error("runRecovery requires an acquired workspace lock");
  }
  if (!fs.existsSync(operationsRoot)) return [];

  const outcomes = [];
  const stagingRoot = path.join(planningRoot, ".runtime", "operations");

  for (const operationId of fs.readdirSync(operationsRoot)) {
    if (!isUuidV7(operationId)) continue; // never trust a directory name that isn't a real operation id

    let operation;
    try {
      operation = readOperation(operationsRoot, operationId);
    } catch (error) {
      // unreadable/unparseable operation.yml is an integrity problem, not
      // something to ignore -- report it and never attempt to rewrite a file
      // we can't trust reading (Revision 4 note 6)
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    const operationSchemaCheck = validateSchema("operation", operation);
    if (!operationSchemaCheck.valid || operation.id !== operationId) {
      // schema-invalid or self-inconsistent (directory name disagrees with
      // the recorded id) -- same treatment: report, never rewrite
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    if (operation.status === "RECOVERY_REQUIRED") {
      // A manual recovery conflict remains globally blocking across
      // invocations until a human resolves it. Never downgrade it to
      // NOT_APPLICABLE on the next recovery sweep.
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    if (operation.status === "APPLIED") {
      const residue = path.join(stagingRoot, operationId);
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
      const actualHash = currentContentHash(planningRoot, entry.target); // confines entry.target internally
      const classification = classify(entry, actualHash);

      if (classification === "DIVERGENT") {
        markRecoveryRequired(operationsRoot, operationId, operation, {
          file: entry.target, expectedBeforeContentHash: entry.beforeContentHash,
          expectedStagedContentHash: entry.stagedContentHash, actualContentHash: actualHash,
          reason: "canonical file diverged from both before and staged expectations"
        });
        divergent = true;
        break;
      }

      if (classification === "PENDING") {
        const stagedDirForOperation = path.join(stagingRoot, operationId, "staged");
        // the staging directory might not exist at all (already cleaned up,
        // or never created if the crash predates it) -- confineUnder throws
        // on a missing root, so existence is checked first (Revision 3 note 6)
        const stagedExists = fs.existsSync(stagedDirForOperation);
        const stagedPath = stagedExists ? confineUnder(stagedDirForOperation, entry.stagedRelativePath) : null;
        if (!stagedExists || !fs.existsSync(stagedPath) || contentHash(fs.readFileSync(stagedPath)) !== entry.stagedContentHash) {
          markRecoveryRequired(operationsRoot, operationId, operation, {
            file: entry.target, expectedBeforeContentHash: entry.beforeContentHash,
            expectedStagedContentHash: entry.stagedContentHash, actualContentHash: actualHash,
            reason: "staged file missing or altered; cannot safely redo the write"
          });
          divergent = true;
          break;
        }
        const canonicalPath = confineRuntimePath(planningRoot, entry.target);
        fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
        fs.renameSync(stagedPath, canonicalPath);
      }
      // classification === "APPLIED": nothing to do for this file
    }
    if (divergent) {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    const expectedResult = {
      operationId,
      files: (operation.filePlan || []).map((entry) => ({ target: entry.target, contentHash: entry.stagedContentHash }))
    };
    const resultPath = path.join(operationsRoot, operationId, "result.json");
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
          file: "result.json", reason: "result.json exists but does not match the outcome expected from filePlan, or is schema-invalid"
        });
        outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
        continue;
      }
    } else {
      writeResult(operationsRoot, operationId, expectedResult);
    }

    let eventDivergent = false;
    for (const expectedEvent of operation.expectedEvents || []) {
      // relational invariants no JSON Schema can express on its own
      // (Revision 4 note 5) -- never trust an expectedEvent enough to write
      // it if these disagree with each other
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
            file: expectedEvent.relativePath, expectedStagedContentHash: expectedEvent.contentHash,
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
      ...current, status: "APPLIED", appliedAt,
      history: [...current.history, { at: appliedAt, from: "APPLYING", to: "APPLIED", actor: "system:recovery", reason: null }]
    });
    fs.rmSync(path.join(stagingRoot, operationId), { recursive: true, force: true });
    outcomes.push({ operationId, outcome: "COMPLETED" });
  }

  return outcomes;
}
