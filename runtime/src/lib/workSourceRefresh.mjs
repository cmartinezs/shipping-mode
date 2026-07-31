import path from "node:path";
import { generateUuidV7 } from "./ids.mjs";
import { revisionHash } from "./canonical.mjs";
import { stringifyYaml } from "./yaml.mjs";
import { readChangeSet, readOperation } from "./operationStore.mjs";
import { propose } from "./changeset.mjs";
import { resolveReleaseReference } from "./releaseStore.mjs";
import { readReleaseItemFile, resolveReleaseItemReference, releaseItemReadmeRelativePath, releaseItemYamlRelativePath, updateReleaseItemRevision } from "./releaseItemStore.mjs";
import { renderReleaseItemReadme } from "./releaseItemProjection.mjs";
import { defaultWorkSourceRegistry, deriveSourceRef, managedSnapshotFromReleaseSnapshot, MANAGED_FIELDS_BY_KIND, workSourceConfigHash } from "./workSourceImport.mjs";
import { evaluateManagedFieldDrift } from "./workSourceDrift.mjs";
import { sourceSyncAggregateRevision } from "./sourceSyncRevision.mjs";

function primaryRef(item) {
  const refs = (item.sourceRefs || []).filter((ref) => ref.role === "primary");
  if (refs.length !== 1) {
    const error = new Error("primary Work Source reference is missing or ambiguous");
    error.code = "AMBIGUOUS_SOURCE";
    throw error;
  }
  return refs[0];
}

function sourceItemRef(ref) {
  return ref.provider === "local_repository" ? (ref.path || ref.itemId) : (ref.externalId || ref.itemId);
}

function sourceSnapshot(item, fields) {
  return managedSnapshotFromReleaseSnapshot(item, fields);
}

function mappedReleaseSnapshot(normalizedItem) {
  return {
    kind: normalizedItem.type,
    title: normalizedItem.title,
    description: normalizedItem.description?.text ?? null,
    acceptanceCriteria: (normalizedItem.acceptanceCriteria || []).map((entry) => typeof entry === "string" ? entry : entry.text),
    ...normalizedItem.fields
  };
}

export function refreshedItem({ item, source, normalizedItem, actor, operationId, syncedAt, baselineId = null }) {
  const sourceRef = deriveSourceRef({ source, normalizedItem, importedAt: item.sourceRefs.find((ref) => ref.role === "primary")?.importedAt || syncedAt });
  const mapped = mappedReleaseSnapshot(normalizedItem);
  const managedFields = MANAGED_FIELDS_BY_KIND[item.kind];
  if (!managedFields || mapped.kind !== item.kind) {
    const error = new Error("MAPPING_OBSOLETE: refresh mapping does not match the canonical item kind");
    error.code = "STALE";
    throw error;
  }
  const nextWithoutSync = {
    ...item,
    ...Object.fromEntries(managedFields.map((pointer) => [pointer.slice(1), mapped[pointer.slice(1)] ?? null])),
    sourceRefs: [sourceRef, ...(item.sourceRefs || []).filter((ref) => ref.role !== "primary")]
  };
  const managedSnapshot = sourceSnapshot(nextWithoutSync, managedFields);
  const previousBaseline = item.sourceSync?.baselines?.find((baseline) => baseline.role === "primary") || null;
  const baseline = {
    baselineId: previousBaseline?.baselineId || baselineId || generateUuidV7(),
    sourceRefIdentityHash: `sha256:${revisionHash(sourceRef)}`,
    role: "primary",
    sourceId: source.id,
    provider: source.provider,
    locator: source.provider === "local_repository" ? { itemId: sourceRef.itemId, path: sourceRef.path } : { externalId: sourceRef.externalId },
    sourceRevision: sourceRef.externalRevision || sourceRef.contentRevision || sourceRef.fingerprint,
    mappingVersion: source.mappingVersion,
    mappingProfile: source.mappingProfile || `${source.provider}-v${source.mappingVersion}`,
    configHash: `sha256:${workSourceConfigHash(source)}`,
    managedFields,
    managedSnapshot,
    managedSnapshotHash: `sha256:${revisionHash(managedSnapshot)}`,
    aggregateRevisionAtSync: sourceSyncAggregateRevision(nextWithoutSync),
    syncedAt,
    syncedBy: actor
  };
  return updateReleaseItemRevision({
    ...nextWithoutSync,
    sourceSync: { schemaVersion: 1, baselines: [baseline] },
    audit: { ...item.audit, updatedAt: syncedAt, updatedBy: actor, operationId }
  });
}

export function prepareWorkSourceRefresh({ planningRoot, releaseRef, itemRef, actor, operationId, idempotencyKey, runtimeContext = null, now = new Date().toISOString(), baselineId = null }) {
  const releaseResolution = resolveReleaseReference(planningRoot, releaseRef);
  if (releaseResolution.status !== "FOUND") throw new Error(`release reference failed: ${releaseResolution.status}: ${releaseResolution.findings.join("; ")}`);
  const itemResolution = resolveReleaseItemReference(planningRoot, releaseResolution.release.id, itemRef);
  if (itemResolution.status !== "FOUND") throw new Error(`release item reference failed: ${itemResolution.status}: ${itemResolution.findings.join("; ")}`);
  const item = readReleaseItemFile(planningRoot, releaseResolution.release.id, itemResolution.item.id).item;
  const ref = primaryRef(item);
  const registry = defaultWorkSourceRegistry({ planningRoot, runtimeContext });
  const source = registry.getSource(ref.sourceId);
  const provider = registry.resolve(source.id, "get");
  const fetched = provider.get({ source, itemRef: sourceItemRef(ref) });
  if (fetched.status !== "FOUND") return { status: fetched.status === "NOT_FOUND" ? "SOURCE_NOT_FOUND" : "UNAVAILABLE", findings: fetched.findings || [], item: null };
  const fields = MANAGED_FIELDS_BY_KIND[item.kind];
  const remoteItem = fetched.item;
  const remoteManagedSnapshot = sourceSnapshot(mappedReleaseSnapshot(remoteItem), fields);
  const localManagedSnapshot = sourceSnapshot(item, fields);
  const baseline = item.sourceSync?.baselines?.find((entry) => entry.role === "primary") || null;
  const drift = evaluateManagedFieldDrift({
    baseline,
    remoteManagedSnapshot,
    localManagedSnapshot,
    aggregateRevision: sourceSyncAggregateRevision(item),
    activeMappingProfile: source.mappingProfile || `${source.provider}-v${source.mappingVersion}`,
    activeConfigHash: `sha256:${workSourceConfigHash(source)}`
  });
  if (!["REMOTE_CHANGED", "BOTH_CHANGED_COMPATIBLE", "BASELINE_MISSING_SAFE"].includes(drift.status)) return { status: drift.status, findings: drift.findings, item, drift };
  const nextItem = refreshedItem({ item, source, normalizedItem: remoteItem, actor, operationId, syncedAt: now, baselineId });
  const releaseId = releaseResolution.release.id;
  const idempotency = idempotencyKey || operationId;
  const requestHash = revisionHash({ actor, releaseId, itemId: item.id, sourceId: source.id, provider: source.provider, mappingVersion: source.mappingVersion, configHash: workSourceConfigHash(source), baselineId: baseline?.baselineId || "BASELINE_MISSING", baselineHash: baseline?.managedSnapshotHash || "BASELINE_MISSING", remoteRevision: remoteItem.revision, remoteManagedSnapshot, localManagedSnapshot, aggregateRevision: sourceSyncAggregateRevision(item), targetPaths: [releaseItemYamlRelativePath(releaseId, item.id), releaseItemReadmeRelativePath(releaseId, item.id)], mode: drift.status === "BASELINE_MISSING_SAFE" ? "capture_baseline" : "refresh" });
  return {
    status: "PROPOSED",
    drift,
    target: { releaseId, itemId: item.id },
    payload: { operationId, releaseId, itemId: item.id, actor, proposedAt: now, sourceId: source.id, provider: source.provider, sourceRef: nextItem.sourceRefs.find((entry) => entry.role === "primary"), normalizedItem: remoteItem, baselineId: nextItem.sourceSync.baselines[0].baselineId, baselineHash: nextItem.sourceSync.baselines[0].managedSnapshotHash, requestSnapshot: nextItem, idempotencyKey: idempotency, idempotencyRequestHash: requestHash, targetPaths: [releaseItemYamlRelativePath(releaseId, item.id), releaseItemReadmeRelativePath(releaseId, item.id)] },
    targetFiles: [releaseItemYamlRelativePath(releaseId, item.id), releaseItemReadmeRelativePath(releaseId, item.id)],
    requestHash
  };
}

export function proposeWorkSourceRefresh({ planningRoot, releaseRef, itemRef, actor, idempotencyKey = null, runtimeContext = null }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const candidate = generateUuidV7();
  const prepared = prepareWorkSourceRefresh({ planningRoot, releaseRef, itemRef, actor, operationId: candidate, idempotencyKey, runtimeContext });
  if (prepared.status !== "PROPOSED") return prepared;
  const operationId = propose({ operationsRoot, planningRoot, kind: "work-source.refresh", target: prepared.target, payload: prepared.payload, targetFiles: prepared.targetFiles, actor, operationId: candidate, proposedAt: prepared.payload.proposedAt, idempotency: { key: prepared.payload.idempotencyKey, requestHash: prepared.payload.idempotencyRequestHash } });
  const operation = readOperation(operationsRoot, operationId);
  return { status: operation.status, operationId, releaseId: prepared.payload.releaseId, itemId: prepared.payload.itemId, drift: prepared.drift, idempotent: operationId !== candidate };
}

export function renderWorkSourceRefresh(payload, { planningRoot, runtimeContext = null }) {
  const prepared = prepareWorkSourceRefresh({
    planningRoot,
    releaseRef: payload.releaseId,
    itemRef: payload.itemId,
    actor: payload.actor,
    operationId: payload.operationId,
    idempotencyKey: payload.idempotencyKey,
    runtimeContext,
    now: payload.proposedAt,
    baselineId: payload.baselineId
  });
  const payloadMatches = prepared.status === "PROPOSED"
    && prepared.payload.idempotencyRequestHash === payload.idempotencyRequestHash
    && prepared.payload.baselineId === payload.baselineId
    && prepared.payload.baselineHash === payload.baselineHash
    && revisionHash(prepared.payload.sourceRef) === revisionHash(payload.sourceRef)
    && revisionHash(prepared.payload.requestSnapshot) === revisionHash(payload.requestSnapshot)
    && revisionHash(prepared.payload.targetPaths) === revisionHash(payload.targetPaths);
  if (!payloadMatches) {
    const error = new Error("SOURCE_STALE: refresh request no longer matches current source or local item");
    error.code = "STALE";
    throw error;
  }
  return new Map([[releaseItemYamlRelativePath(payload.releaseId, payload.itemId), stringifyYaml(prepared.payload.requestSnapshot)], [releaseItemReadmeRelativePath(payload.releaseId, payload.itemId), renderReleaseItemReadme(prepared.payload.requestSnapshot)]]);
}

export function readRefreshChangeSet(operationsRoot, operationId) {
  return readChangeSet(operationsRoot, operationId);
}
