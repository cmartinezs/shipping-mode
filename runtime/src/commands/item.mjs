import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "../lib/ids.mjs";
import { propose } from "../lib/changeset.mjs";
import { readChangeSet, readOperation } from "../lib/operationStore.mjs";
import { normalizeReleaseItemCreateRequest, prepareReleaseItemCreate } from "../lib/releaseItemCreate.mjs";
import { resolveReleaseReference } from "../lib/releaseStore.mjs";
import { resolveReleaseItemReference, evaluateReleaseItemHealth } from "../lib/releaseItemStore.mjs";
import { pendingRecovery } from "./release.mjs";

export function proposeReleaseItemCreate({ planningRoot, releaseRef, rawPayload, actor, itemId = null }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const candidateOperationId = generateUuidV7();
  const proposedAt = new Date().toISOString();
  const itemRequest = normalizeReleaseItemCreateRequest(rawPayload, { actor, defaultIdempotencyKey: candidateOperationId });
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
      itemId
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
