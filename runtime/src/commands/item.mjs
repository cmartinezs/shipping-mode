import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "../lib/ids.mjs";
import { propose } from "../lib/changeset.mjs";
import { readChangeSet, readOperation } from "../lib/operationStore.mjs";
import { normalizeReleaseItemCreateRequest, prepareReleaseItemCreate } from "../lib/releaseItemCreate.mjs";
import { resolveReleaseReference } from "../lib/releaseStore.mjs";
import { resolveReleaseItemReference, evaluateReleaseItemHealth } from "../lib/releaseItemStore.mjs";
import { normalizeWorkPackageCreateRequest, prepareWorkPackageCreate } from "../lib/workPackageCreate.mjs";
import { resolveWorkPackageReference, evaluateWorkPackageHealth } from "../lib/workPackageStore.mjs";
import { parseSourceRef, prepareWorkSourceImport } from "../lib/workSourceImport.mjs";
import { pendingRecovery } from "./release.mjs";
import { proposeWorkSourceRefresh } from "../lib/workSourceRefresh.mjs";

export function proposeReleaseItemCreate({ planningRoot, releaseRef, rawPayload, actor, itemId = null }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const candidateOperationId = generateUuidV7();
  const proposedAt = new Date().toISOString();
  const releaseResolution = resolveReleaseReference(planningRoot, releaseRef);
  if (releaseResolution.status !== "FOUND") throw new Error(`release reference failed: ${releaseResolution.status}: ${releaseResolution.findings.join("; ")}`);
  const canonicalReleaseId = releaseResolution.release.id;
  const itemRequest = normalizeReleaseItemCreateRequest(rawPayload, { actor, defaultIdempotencyKey: candidateOperationId, releaseId: canonicalReleaseId });
  const persistedOperationId = propose({
    operationsRoot,
    planningRoot,
    kind: "release-item.create",
    target: null,
    payload: null,
    targetFiles: null,
    actor,
    operationId: candidateOperationId,
    proposedAt,
    idempotency: { key: itemRequest.idempotencyKey, requestHash: itemRequest.idempotencyRequestHash },
    prepareUnderLock: () => prepareReleaseItemCreate(rawPayload, {
      planningRoot,
      operationsRoot,
      operationId: candidateOperationId,
      actor,
      proposedAt,
      releaseRef,
      itemRequest,
      itemId,
      expectedReleaseId: canonicalReleaseId
    })
  });
  const persistedChangeSet = readChangeSet(operationsRoot, persistedOperationId);
  const operation = readOperation(operationsRoot, persistedOperationId);
  return {
    operationId: persistedOperationId,
    releaseId: persistedChangeSet.payload.releaseId,
    itemId: persistedChangeSet.payload.id,
    displayId: persistedChangeSet.payload.displayId,
    operationStatus: operation.status,
    idempotent: persistedOperationId !== candidateOperationId
  };
}

function commonPayload(args) {
  const payload = {
    kind: args.kind,
    title: args.title,
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.dependencyRefs !== undefined ? { dependencyRefs: args.dependencyRefs } : {}),
    ...(args.slug !== undefined ? { slug: args.slug } : {}),
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
  };
  for (const field of [
    "actor", "need", "value", "acceptanceCriteria", "outcome", "behavior",
    "observedBehavior", "expectedBehavior", "reproduction", "severity",
    "technicalOutcome", "unlockedCapabilities", "question", "timebox",
    "expectedDecision", "obligation", "authority", "deadline", "evidence",
    "sourceState", "targetState", "rollback", "procedure", "owner"
  ]) {
    if (args[field] !== undefined) payload[field] = args[field];
  }
  return payload;
}

export function runItemCreate({ planningRoot, releaseRef, args }) {
  return proposeReleaseItemCreate({
    planningRoot,
    releaseRef,
    rawPayload: commonPayload(args),
    actor: args.commandActor
  });
}

export function proposeWorkSourceImport({ planningRoot, releaseRef, rawPayload, actor, itemId = null, runtimeContext = null }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const candidateOperationId = generateUuidV7();
  const proposedAt = new Date().toISOString();
  const releaseResolution = resolveReleaseReference(planningRoot, releaseRef);
  if (releaseResolution.status !== "FOUND") throw new Error(`release reference failed: ${releaseResolution.status}: ${releaseResolution.findings.join("; ")}`);
  const canonicalReleaseId = releaseResolution.release.id;
  const preparedForIdempotency = prepareWorkSourceImport(rawPayload, {
    planningRoot,
    operationsRoot,
    operationId: candidateOperationId,
    actor,
    proposedAt,
    releaseRef,
    itemId,
    expectedReleaseId: canonicalReleaseId,
    skipDuplicatePrimaryCheck: true,
    runtimeContext
  });
  const persistedOperationId = propose({
    operationsRoot,
    planningRoot,
    kind: "work-source.import",
    target: null,
    payload: null,
    targetFiles: null,
    actor,
    operationId: candidateOperationId,
    proposedAt,
    idempotency: { key: preparedForIdempotency.normalized.idempotencyKey, requestHash: preparedForIdempotency.normalized.idempotencyRequestHash },
    prepareUnderLock: () => prepareWorkSourceImport(rawPayload, {
      planningRoot,
      operationsRoot,
      operationId: candidateOperationId,
      actor,
      proposedAt,
      releaseRef,
      importRequest: preparedForIdempotency.normalized,
      itemId,
      expectedReleaseId: canonicalReleaseId,
      runtimeContext,
      ...(runtimeContext?.workSourceTransport ? { resolvedSourceItem: preparedForIdempotency.payload.normalizedItem } : {})
    })
  });
  const persistedChangeSet = readChangeSet(operationsRoot, persistedOperationId);
  const operation = readOperation(operationsRoot, persistedOperationId);
  return {
    operationId: persistedOperationId,
    releaseId: persistedChangeSet.payload.releaseId,
    itemId: persistedChangeSet.payload.id,
    displayId: persistedChangeSet.payload.displayId,
    operationStatus: operation.status,
    idempotent: persistedOperationId !== candidateOperationId
  };
}

export function runItemImport({ planningRoot, releaseRef, args, runtimeContext = null }) {
  parseSourceRef(args.sourceRef);
  return proposeWorkSourceImport({
    planningRoot,
    releaseRef,
    rawPayload: {
      sourceRef: args.sourceRef,
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
    },
    actor: args.commandActor,
    runtimeContext
  });
}

export function runItemRefresh({ planningRoot, releaseRef, itemRef, args, runtimeContext = null }) {
  return proposeWorkSourceRefresh({ planningRoot, releaseRef, itemRef, actor: args.commandActor, idempotencyKey: args.idempotencyKey || null, runtimeContext });
}

export function proposeWorkPackageCreate({ planningRoot, releaseRef, itemRef, rawPayload, actor, packageId = null }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const candidateOperationId = generateUuidV7();
  const proposedAt = new Date().toISOString();
  const releaseResolution = resolveReleaseReference(planningRoot, releaseRef);
  if (releaseResolution.status !== "FOUND") throw new Error(`release reference failed: ${releaseResolution.status}: ${releaseResolution.findings.join("; ")}`);
  const canonicalReleaseId = releaseResolution.release.id;
  const itemResolution = resolveReleaseItemReference(planningRoot, canonicalReleaseId, itemRef);
  if (itemResolution.status !== "FOUND") throw new Error(`release item reference failed: ${itemResolution.status}: ${itemResolution.findings.join("; ")}`);
  const canonicalItemId = itemResolution.item.id;
  const canonicalScopeId = rawPayload.scopeId;
  const packageRequest = normalizeWorkPackageCreateRequest(rawPayload, { actor, defaultIdempotencyKey: candidateOperationId, releaseId: canonicalReleaseId, releaseItemId: canonicalItemId, scopeId: canonicalScopeId });
  const persistedOperationId = propose({
    operationsRoot,
    planningRoot,
    kind: "work-package.create",
    target: null,
    payload: null,
    targetFiles: null,
    actor,
    operationId: candidateOperationId,
    proposedAt,
    idempotency: { key: packageRequest.idempotencyKey, requestHash: packageRequest.idempotencyRequestHash },
    prepareUnderLock: () => prepareWorkPackageCreate(rawPayload, {
      planningRoot,
      operationsRoot,
      operationId: candidateOperationId,
      actor,
      proposedAt,
      releaseRef,
      itemRef,
      packageRequest,
      packageId,
      expectedReleaseId: canonicalReleaseId,
      expectedReleaseItemId: canonicalItemId,
      expectedScopeId: canonicalScopeId
    })
  });
  const persistedChangeSet = readChangeSet(operationsRoot, persistedOperationId);
  const operation = readOperation(operationsRoot, persistedOperationId);
  return {
    operationId: persistedOperationId,
    releaseId: persistedChangeSet.payload.releaseId,
    itemId: persistedChangeSet.payload.releaseItemId,
    packageId: persistedChangeSet.payload.id,
    displayId: persistedChangeSet.payload.displayId,
    operationStatus: operation.status,
    idempotent: persistedOperationId !== candidateOperationId
  };
}

export function runItemPackageAdd({ planningRoot, releaseRef, itemRef, args }) {
  return proposeWorkPackageCreate({
    planningRoot,
    releaseRef,
    itemRef,
    rawPayload: {
      scopeId: args.scopeId,
      title: args.title,
      ...(args.description !== undefined ? { description: args.description } : {}),
      commitment: args.commitment,
      ...(args.design !== undefined ? { design: args.design } : {}),
      ...(args.dependencyRefs !== undefined ? { dependencyRefs: args.dependencyRefs } : {}),
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
    },
    actor: args.commandActor
  });
}

export function runItemStatus({ planningRoot, releaseRef, itemRef }) {
  const pending = pendingRecovery(planningRoot);
  if (pending.length > 0) return { status: "RECOVERY_REQUIRED", release: null, item: null, derivedHealth: null, findings: ["workspace has pending or recovery-required operations"], pendingOperations: pending };
  if (!fs.existsSync(planningRoot)) return { status: "NOT_FOUND", release: null, item: null, derivedHealth: null, findings: ["workspace is not initialized: .planning/ does not exist"] };
  const releaseResolution = resolveReleaseReference(planningRoot, releaseRef);
  if (releaseResolution.status !== "FOUND") return { status: releaseResolution.status, release: null, item: null, derivedHealth: null, findings: releaseResolution.findings, matches: releaseResolution.matches || [] };
  const itemResolution = resolveReleaseItemReference(planningRoot, releaseResolution.release.id, itemRef);
  if (itemResolution.status !== "FOUND") return { status: itemResolution.status, release: { id: releaseResolution.release.id, displayId: releaseResolution.release.displayId }, item: null, derivedHealth: null, findings: itemResolution.findings, matches: itemResolution.matches || [] };
  const item = itemResolution.item;
  const health = evaluateReleaseItemHealth({ planningRoot, release: releaseResolution.release, item, directoryId: item.id });
  return {
    status: "FOUND",
    release: { id: releaseResolution.release.id, displayId: releaseResolution.release.displayId, lifecycle: releaseResolution.release.status },
    item: { id: item.id, displayId: item.displayId, releaseId: item.releaseId, kind: item.kind, status: item.status, title: item.title, slug: item.slug },
    derivedHealth: health,
    completion: health.completion,
    readiness: health.readiness,
    findings: health.findings.map((finding) => `${finding.code}: ${finding.message}`)
  };
}

export function runItemPackageStatus({ planningRoot, releaseRef, itemRef, packageRef }) {
  const pending = pendingRecovery(planningRoot);
  if (pending.length > 0) return { status: "RECOVERY_REQUIRED", release: null, item: null, workPackage: null, derivedHealth: null, findings: ["workspace has pending or recovery-required operations"], pendingOperations: pending };
  if (!fs.existsSync(planningRoot)) return { status: "NOT_FOUND", release: null, item: null, workPackage: null, derivedHealth: null, findings: ["workspace is not initialized: .planning/ does not exist"] };
  const releaseResolution = resolveReleaseReference(planningRoot, releaseRef);
  if (releaseResolution.status !== "FOUND") return { status: releaseResolution.status, release: null, item: null, workPackage: null, derivedHealth: null, findings: releaseResolution.findings, matches: releaseResolution.matches || [] };
  const itemResolution = resolveReleaseItemReference(planningRoot, releaseResolution.release.id, itemRef);
  if (itemResolution.status !== "FOUND") return { status: itemResolution.status, release: { id: releaseResolution.release.id, displayId: releaseResolution.release.displayId }, item: null, workPackage: null, derivedHealth: null, findings: itemResolution.findings, matches: itemResolution.matches || [] };
  const packageResolution = resolveWorkPackageReference(planningRoot, releaseResolution.release.id, itemResolution.item.id, packageRef);
  if (packageResolution.status !== "FOUND") return { status: packageResolution.status, release: { id: releaseResolution.release.id, displayId: releaseResolution.release.displayId }, item: { id: itemResolution.item.id, displayId: itemResolution.item.displayId }, workPackage: null, derivedHealth: null, findings: packageResolution.findings, matches: packageResolution.matches || [] };
  const workPackage = packageResolution.workPackage;
  const health = evaluateWorkPackageHealth({ planningRoot, release: releaseResolution.release, item: itemResolution.item, workPackage, directoryId: workPackage.id });
  return {
    status: "FOUND",
    release: { id: releaseResolution.release.id, displayId: releaseResolution.release.displayId, lifecycle: releaseResolution.release.status },
    item: { id: itemResolution.item.id, displayId: itemResolution.item.displayId, status: itemResolution.item.status, title: itemResolution.item.title },
    workPackage: { id: workPackage.id, displayId: workPackage.displayId, releaseId: workPackage.releaseId, releaseItemId: workPackage.releaseItemId, scopeId: workPackage.scopeId, status: workPackage.status, commitment: workPackage.commitment, title: workPackage.title },
    derivedHealth: health,
    completionContribution: health.completionContribution,
    readiness: health.readiness,
    findings: health.findings.map((finding) => `${finding.code}: ${finding.message}`)
  };
}


export function runCheckItem({ planningRoot, releaseRef, itemRef }) {
  const status = runItemStatus({ planningRoot, releaseRef, itemRef });
  if (status.status !== "FOUND") {
    return { ...status, scope: "single", items: [], pendingOperations: status.pendingOperations || [] };
  }
  const entry = {
    release: status.release,
    item: status.item,
    derivedHealth: status.derivedHealth,
    completion: status.completion,
    readiness: status.readiness,
    findings: status.derivedHealth.findings
  };
  return {
    status: status.derivedHealth.aggregate.valid ? "PASS" : "FAIL",
    scope: "single",
    items: [entry],
    findings: status.derivedHealth.findings.map((finding) => `${finding.code}: ${finding.message}`),
    pendingOperations: []
  };
}

export function runCheckWorkPackage({ planningRoot, releaseRef, itemRef, packageRef }) {
  const status = runItemPackageStatus({ planningRoot, releaseRef, itemRef, packageRef });
  if (status.status !== "FOUND") {
    return { ...status, scope: "single", workPackages: [], pendingOperations: status.pendingOperations || [] };
  }
  const entry = {
    release: status.release,
    item: status.item,
    workPackage: status.workPackage,
    derivedHealth: status.derivedHealth,
    completionContribution: status.completionContribution,
    readiness: status.readiness,
    findings: status.derivedHealth.findings
  };
  return {
    status: status.derivedHealth.aggregate.valid ? "PASS" : "FAIL",
    scope: "single",
    workPackages: [entry],
    findings: status.derivedHealth.findings.map((finding) => `${finding.code}: ${finding.message}`),
    pendingOperations: []
  };
}
