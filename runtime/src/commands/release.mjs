import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "../lib/ids.mjs";
import { propose } from "../lib/changeset.mjs";
import { prepareProposal } from "./proposalPreparation.mjs";
import { listReleaseDocuments, resolveReleaseReference, releaseReadmeRelativePath } from "../lib/releaseStore.mjs";
import { readChangeSet, readOperation } from "../lib/operationStore.mjs";
import { compareReleaseReadme } from "../lib/releaseProjection.mjs";
import { confineWritePath } from "../lib/paths.mjs";
import { validate } from "../lib/schema.mjs";

function findExistingIdempotentReleaseCreate(operationsRoot, idempotencyKey) {
  if (!idempotencyKey || !fs.existsSync(operationsRoot)) return null;
  for (const operationId of fs.readdirSync(operationsRoot).sort()) {
    try {
      const operation = readOperation(operationsRoot, operationId);
      if (operation.kind !== "release.create" || ["INVALID", "STALE"].includes(operation.status)) continue;
      const changeSet = readChangeSet(operationsRoot, operationId);
      if (changeSet.payload.idempotencyKey === idempotencyKey) {
        return {
          operationId,
          releaseId: changeSet.payload.id,
          displayId: changeSet.payload.displayId,
          operationStatus: operation.status,
          idempotent: true
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function pendingRecovery(planningRoot) {
  const operationsRoot = path.join(planningRoot, "operations");
  if (!fs.existsSync(operationsRoot)) return [];
  const pending = [];
  for (const operationId of fs.readdirSync(operationsRoot).sort()) {
    try {
      const operation = readOperation(operationsRoot, operationId);
      if (operation.status === "APPLYING" || operation.status === "RECOVERY_REQUIRED") pending.push({ operationId, status: operation.status });
    } catch {
      pending.push({ operationId, status: "RECOVERY_REQUIRED" });
    }
  }
  return pending;
}

export function runReleaseNew({ planningRoot, args }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const existing = findExistingIdempotentReleaseCreate(operationsRoot, args.idempotencyKey || null);
  if (existing) return existing;

  const operationId = generateUuidV7();
  const proposedAt = new Date().toISOString();
  const rawPayload = {
    title: args.title,
    objective: args.objective,
    ...(args.laneId ? { laneId: args.laneId } : {}),
    ...(args.policyMode ? { policyMode: args.policyMode } : {}),
    ...(args.slug !== undefined ? { slug: args.slug } : {}),
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
  };
  const { payload, targetFiles } = prepareProposal("release.create", rawPayload, {
    operationId,
    actor: args.actor,
    proposedAt,
    existingReleases: listReleaseDocuments(planningRoot)
  });
  const persistedOperationId = propose({
    operationsRoot,
    planningRoot,
    kind: "release.create",
    target: { releaseId: payload.id },
    payload,
    targetFiles,
    actor: args.actor,
    operationId,
    proposedAt
  });
  return {
    operationId: persistedOperationId,
    releaseId: payload.id,
    displayId: payload.displayId,
    operationStatus: "PROPOSED",
    idempotent: false
  };
}

function projectionStatus(planningRoot, release) {
  const relativePath = releaseReadmeRelativePath(release.id);
  let filePath;
  try {
    filePath = confineWritePath(planningRoot, relativePath);
  } catch (error) {
    return { status: "UNSAFE", findings: [`${relativePath}: ${error.message}`] };
  }
  if (!fs.existsSync(filePath)) return { status: "MISSING", findings: [`${relativePath}: projection is missing`] };
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) return { status: "UNSAFE", findings: [`${relativePath}: symlink entries are not permitted`] };
  const current = fs.readFileSync(filePath, "utf8");
  const comparison = compareReleaseReadme(release, current);
  return comparison.equal ? { status: "MATCH", findings: [] } : { status: "DRIFT", findings: [`${relativePath}: projection drift`] };
}

export function runReleaseStatus({ planningRoot, reference }) {
  const pending = pendingRecovery(planningRoot);
  if (pending.length > 0) {
    return { status: "RECOVERY_REQUIRED", release: null, derivedHealth: null, refs: null, findings: ["workspace has pending or recovery-required operations"], pendingOperations: pending };
  }
  if (!fs.existsSync(planningRoot)) {
    return { status: "NOT_FOUND", release: null, derivedHealth: null, refs: null, findings: ["workspace is not initialized: .planning/ does not exist"] };
  }
  const resolution = resolveReleaseReference(planningRoot, reference);
  if (resolution.status !== "FOUND") {
    return { status: resolution.status, release: null, derivedHealth: null, refs: null, findings: resolution.findings, matches: resolution.matches || [] };
  }
  const release = resolution.release;
  const schemaResult = validate("release", release);
  const projection = projectionStatus(planningRoot, release);
  const findings = [...resolution.findings, ...projection.findings];
  for (const error of schemaResult.errors) findings.push(`release.yml${error.path}: ${error.message}`);
  return {
    status: "FOUND",
    release: {
      id: release.id,
      displayId: release.displayId,
      lifecycle: release.status,
      title: release.title,
      objective: release.objective
    },
    derivedHealth: {
      schemaValid: schemaResult.valid,
      projection: projection.status,
      readiness: {
        available: false,
        releasable: false,
        unavailableDependencies: ["release_items", "work_packages", "gates"]
      }
    },
    refs: {
      scopeRefs: release.scopeRefs,
      itemRefs: release.itemRefs
    },
    findings
  };
}
