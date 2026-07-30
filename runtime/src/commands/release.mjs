import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "../lib/ids.mjs";
import { propose } from "../lib/changeset.mjs";
import { normalizeReleaseCreateRequest, prepareProposal } from "./proposalPreparation.mjs";
import { listReleaseDocuments, listReservedReleaseDocuments, resolveReleaseReference } from "../lib/releaseStore.mjs";
import { readChangeSet, readOperation } from "../lib/operationStore.mjs";
import { confineWritePath } from "../lib/paths.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { prepareReleaseMutation, normalizeReleaseMutationRequest } from "../lib/releaseMutations.mjs";
import { revisionHash } from "../lib/canonical.mjs";
import { evaluateReleaseHealth } from "../lib/releaseHealth.mjs";
import { listReleaseItemDocuments } from "../lib/releaseItemStore.mjs";

function readCurrentConfig(planningRoot) {
  const configPath = confineWritePath(planningRoot, "config.yml");
  if (!fs.existsSync(configPath)) throw new Error("release.create requires initialized Project Context");
  return parseYaml(fs.readFileSync(configPath, "utf8"));
}

export function pendingRecovery(planningRoot) {
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

export function proposeReleasePlan2Mutation({ planningRoot, rawPayload, actor, kind }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const candidateOperationId = generateUuidV7();
  const proposedAt = new Date().toISOString();
  const releaseRequest = normalizeReleaseMutationRequest(kind, rawPayload, { actor, defaultIdempotencyKey: candidateOperationId });
  const persistedOperationId = propose({
    operationsRoot,
    planningRoot,
    kind,
    target: null,
    payload: null,
    targetFiles: null,
    actor,
    operationId: candidateOperationId,
    proposedAt,
    idempotency: { key: releaseRequest.idempotencyKey, requestHash: releaseRequest.idempotencyRequestHash },
    prepareUnderLock: () => prepareReleaseMutation(kind, rawPayload, {
      planningRoot,
      workspaceRoot: path.dirname(planningRoot),
      operationId: candidateOperationId,
      actor,
      proposedAt,
      releaseRequest
    })
  });
  const persistedChangeSet = readChangeSet(operationsRoot, persistedOperationId);
  const operation = readOperation(operationsRoot, persistedOperationId);
  return {
    operationId: persistedOperationId,
    releaseId: persistedChangeSet.payload.releaseId,
    operationStatus: operation.status,
    idempotent: persistedOperationId !== candidateOperationId
  };
}

export function runReleasePolicyConfigure({ planningRoot, args }) {
  return proposeReleasePlan2Mutation({
    planningRoot,
    kind: "release.policy.configure",
    actor: args.actor,
    rawPayload: {
      releaseRef: args.releaseRef,
      ...(args.laneId ? { laneId: args.laneId } : {}),
      ...(args.policyMode ? { policyMode: args.policyMode } : {}),
      ...(args.previousReleaseRefs !== undefined ? { previousReleaseRefs: args.previousReleaseRefs } : {}),
      ...(args.dependencyRefs !== undefined ? { dependencyRefs: args.dependencyRefs } : {}),
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
    }
  });
}

export function runReleaseScopeSet({ planningRoot, args }) {
  return proposeReleasePlan2Mutation({
    planningRoot,
    kind: "release.scopeRefs.set",
    actor: args.actor,
    rawPayload: {
      releaseRef: args.releaseRef,
      scopeIds: args.scopeIds,
      ...(args.policyMode ? { policyMode: args.policyMode } : {}),
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
    }
  });
}

export function runReleaseRefsSet({ planningRoot, args }) {
  return proposeReleasePlan2Mutation({
    planningRoot,
    kind: "release.operationalRefs.set",
    actor: args.actor,
    rawPayload: {
      releaseRef: args.releaseRef,
      executionContextRefs: args.executionContextRefs,
      environmentRefs: args.environmentRefs,
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
    }
  });
}

export function runReleaseDeploymentRecord({ planningRoot, args }) {
  return proposeReleasePlan2Mutation({
    planningRoot,
    kind: "release.deployment.record",
    actor: args.actor,
    rawPayload: {
      releaseRef: args.releaseRef,
      environmentRef: args.environmentRef,
      ...(args.executionContextRef ? { executionContextRef: args.executionContextRef } : {}),
      status: args.status,
      ...(args.artifactRefs !== undefined ? { artifactRefs: args.artifactRefs } : {}),
      ...(args.evidenceRefs !== undefined ? { evidenceRefs: args.evidenceRefs } : {}),
      ...(args.completedAt ? { completedAt: args.completedAt } : {}),
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
    }
  });
}

export function runReleaseFinalize({ planningRoot, args }) {
  return proposeReleasePlan2Mutation({
    planningRoot,
    kind: "release.finalization.complete",
    actor: args.actor,
    rawPayload: {
      releaseRef: args.releaseRef,
      ...(args.retrospectiveStatus ? { retrospectiveStatus: args.retrospectiveStatus } : {}),
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
    }
  });
}

export function runReleaseStatus({ planningRoot, reference }) {
  const pending = pendingRecovery(planningRoot);
  if (pending.length > 0) return { status: "RECOVERY_REQUIRED", release: null, derivedHealth: null, refs: null, findings: ["workspace has pending or recovery-required operations"], pendingOperations: pending };
  if (!fs.existsSync(planningRoot)) return { status: "NOT_FOUND", release: null, derivedHealth: null, refs: null, findings: ["workspace is not initialized: .planning/ does not exist"] };
  const resolution = resolveReleaseReference(planningRoot, reference);
  if (resolution.status !== "FOUND") return { status: resolution.status, release: null, derivedHealth: null, refs: null, findings: resolution.findings, matches: resolution.matches || [] };
  const release = resolution.release;
  const health = evaluateReleaseHealth({ planningRoot, release, directoryId: release.id });
  const canonicalItems = listReleaseItemDocuments(planningRoot, { releaseId: release.id });
  const findings = health.findings.map((entry) => `${entry.code}: ${entry.message}`);
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
    derivedHealth: health,
    completion: health.completion,
    readiness: health.readiness,
    policy: {
      mode: release.policy.mode,
      previousReleaseRefs: release.policy.previousReleaseRefs,
      dependencyRefs: release.policy.dependencyRefs,
      dimensions: health.dimensions.filter((entry) => ["lane", "policy"].includes(entry.id))
    },
    refs: {
      scopeRefs: release.scopeRefs,
      executionContextRefs: release.executionContextRefs,
      environmentRefs: release.environmentRefs,
      itemRefs: release.itemRefs,
      canonicalItemIds: canonicalItems.map((item) => item.id).sort(),
      previousReleaseRefs: release.policy.previousReleaseRefs,
      dependencyRefs: release.policy.dependencyRefs
    },
    deployment: {
      count: release.deploymentEvents.length,
      events: release.deploymentEvents.map((event) => ({
        id: event.id,
        environmentRef: event.environmentRef,
        executionContextRef: event.executionContextRef,
        status: event.status,
        startedAt: event.startedAt,
        completedAt: event.completedAt
      })),
      summaryRevision: revisionHash(release.deploymentEvents)
    },
    finalization: release.finalization,
    findings
  };
}
