import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "../lib/ids.mjs";
import { propose } from "../lib/changeset.mjs";
import { normalizeReleaseCreateRequest, prepareProposal } from "./proposalPreparation.mjs";
import { listReleaseDocuments, listReservedReleaseDocuments, resolveReleaseReference, releaseReadmeRelativePath } from "../lib/releaseStore.mjs";
import { readChangeSet, readOperation } from "../lib/operationStore.mjs";
import { compareReleaseReadme } from "../lib/releaseProjection.mjs";
import { confineWritePath } from "../lib/paths.mjs";
import { validate } from "../lib/schema.mjs";
import { parseYaml } from "../lib/yaml.mjs";

function readCurrentConfig(planningRoot) {
  const configPath = confineWritePath(planningRoot, "config.yml");
  if (!fs.existsSync(configPath)) throw new Error("release.create requires initialized Project Context");
  return parseYaml(fs.readFileSync(configPath, "utf8"));
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

export function proposeReleaseCreate({ planningRoot, rawPayload, actor, releaseId = null }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const candidateOperationId = generateUuidV7();
  const proposedAt = new Date().toISOString();
  const releaseRequest = normalizeReleaseCreateRequest(rawPayload, { actor, defaultIdempotencyKey: candidateOperationId });
  const persistedOperationId = propose({
    operationsRoot,
    planningRoot,
    kind: "release.create",
    target: null,
    payload: null,
    targetFiles: null,
    actor,
    operationId: candidateOperationId,
    proposedAt,
    idempotency: { key: releaseRequest.idempotencyKey, requestHash: releaseRequest.idempotencyRequestHash },
    prepareUnderLock: () => {
      const existingReleases = [
        ...listReleaseDocuments(planningRoot),
        ...listReservedReleaseDocuments(operationsRoot)
      ];
      const prepared = prepareProposal("release.create", rawPayload, {
        operationId: candidateOperationId,
        actor,
        proposedAt,
        existingReleases,
        currentConfig: readCurrentConfig(planningRoot),
        releaseRequest,
        releaseId
      });
      return { target: { releaseId: prepared.payload.id }, payload: prepared.payload, targetFiles: prepared.targetFiles };
    }
  });
  const persistedChangeSet = readChangeSet(operationsRoot, persistedOperationId);
  const operation = readOperation(operationsRoot, persistedOperationId);
  return {
    operationId: persistedOperationId,
    releaseId: persistedChangeSet.payload.id,
    displayId: persistedChangeSet.payload.displayId,
    operationStatus: operation.status,
    idempotent: persistedOperationId !== candidateOperationId
  };
}

export function runReleaseNew({ planningRoot, args }) {
  const rawPayload = {
    title: args.title,
    objective: args.objective,
    ...(args.laneId ? { laneId: args.laneId } : {}),
    ...(args.policyMode ? { policyMode: args.policyMode } : {}),
    ...(args.slug !== undefined ? { slug: args.slug } : {}),
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
  };
  return proposeReleaseCreate({ planningRoot, rawPayload, actor: args.actor });
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
  if (stat.isSymbolicLink() || !stat.isFile()) return { status: "UNSAFE", findings: [`${relativePath}: projection must be a real file`] };
  const current = fs.readFileSync(filePath, "utf8");
  const comparison = compareReleaseReadme(release, current);
  return comparison.equal ? { status: "MATCH", findings: [] } : { status: "DRIFT", findings: [`${relativePath}: projection drift`] };
}

export function runReleaseStatus({ planningRoot, reference }) {
  const pending = pendingRecovery(planningRoot);
  if (pending.length > 0) return { status: "RECOVERY_REQUIRED", release: null, derivedHealth: null, refs: null, findings: ["workspace has pending or recovery-required operations"], pendingOperations: pending };
  if (!fs.existsSync(planningRoot)) return { status: "NOT_FOUND", release: null, derivedHealth: null, refs: null, findings: ["workspace is not initialized: .planning/ does not exist"] };
  const resolution = resolveReleaseReference(planningRoot, reference);
  if (resolution.status !== "FOUND") return { status: resolution.status, release: null, derivedHealth: null, refs: null, findings: resolution.findings, matches: resolution.matches || [] };
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
      objective: release.objective,
      laneId: release.lane.id,
      policyMode: release.policy.mode
    },
    derivedHealth: {
      schemaValid: schemaResult.valid,
      projection: projection.status,
      readiness: { available: false, releasable: false, unavailableDependencies: ["release_items", "work_packages", "gates"] }
    },
    refs: {
      scopeRefs: release.scopeRefs,
      itemRefs: release.itemRefs,
      previousReleaseRefs: release.policy.previousReleaseRefs,
      dependencyRefs: release.policy.dependencyRefs
    },
    findings
  };
}
