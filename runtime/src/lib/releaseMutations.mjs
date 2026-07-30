import fs from "node:fs";
import path from "node:path";
import { generateUuidV7, isUuidV7 } from "./ids.mjs";
import { revisionHash } from "./canonical.mjs";
import { validate } from "./schema.mjs";
import { parseYaml } from "./yaml.mjs";
import { confineWritePath } from "./paths.mjs";
import { resolveReleaseReference, releaseYamlRelativePath, releaseReadmeRelativePath, readReleaseFile, listReleaseDocuments } from "./releaseStore.mjs";
import { isReleaseDisplayId } from "./releaseIdentity.mjs";
import { assertReleasePolicyValid, assertValidLaneConfig, releasePolicyRequestHash } from "./releasePolicy.mjs";
import { assertCatalogRefsValid } from "./operationalCatalog.mjs";
import { buildScopeRefsEvidence, assertScopeEvidenceCurrent } from "./releaseScopeEvidence.mjs";
import { assertReleaseCanFinalize, evaluateReleaseHealth, releaseFinalizationGuardSummary } from "./releaseHealth.mjs";

export const RELEASE_PLAN2_KINDS = Object.freeze([
  "release.policy.configure",
  "release.scopeRefs.set",
  "release.operationalRefs.set",
  "release.deployment.record",
  "release.finalization.complete"
]);

function requireObject(rawPayload) {
  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) throw new Error("release mutation payload must be an object");
}

function requireActor(actor) {
  if (typeof actor !== "string" || actor.trim().length === 0) throw new Error("release mutation requires non-blank actor");
  return actor.trim();
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, field);
}

function normalizeUuidList(value, field) {
  const values = value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : String(value).split(",");
  const refs = values.map((entry) => requireString(entry, field));
  for (const ref of refs) {
    if (!isUuidV7(ref)) throw new Error(`${field} entries must be UUIDv7: ${ref}`);
  }
  return refs;
}

function rejectServerOwned(rawPayload) {
  const serverOwned = new Set(["id", "displayId", "audit", "operationId", "createdAt", "updatedAt", "actor", "eventId", "changeSetHash", "revision", "readiness", "completion", "health", "findings", "deploymentEvents", "finalization", "completed", "completedBy"]);
  for (const field of Object.keys(rawPayload)) {
    if (serverOwned.has(field)) throw new Error(`release mutation field is server-owned: ${field}`);
  }
}

function assertAllowedFields(kind, rawPayload) {
  const allowedByKind = {
    "release.policy.configure": new Set(["releaseRef", "laneId", "policyMode", "previousReleaseRefs", "dependencyRefs", "idempotencyKey"]),
    "release.scopeRefs.set": new Set(["releaseRef", "scopeIds", "policyMode", "idempotencyKey"]),
    "release.operationalRefs.set": new Set(["releaseRef", "executionContextRefs", "environmentRefs", "idempotencyKey"]),
    "release.deployment.record": new Set(["releaseRef", "environmentRef", "executionContextRef", "status", "artifactRefs", "evidenceRefs", "completedAt", "idempotencyKey"]),
    "release.finalization.complete": new Set(["releaseRef", "retrospectiveStatus", "idempotencyKey"])
  };
  const allowed = allowedByKind[kind];
  if (!allowed) throw new Error(`unsupported release mutation kind: ${kind}`);
  for (const field of Object.keys(rawPayload)) {
    if (!allowed.has(field)) throw new Error(`${kind} contains unsupported field: ${field}`);
  }
}

function readCurrentConfig(planningRoot) {
  const configPath = confineWritePath(planningRoot, "config.yml");
  if (!fs.existsSync(configPath)) throw new Error("Project Context config.yml is missing");
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Project Context config.yml must be a real file");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  const result = validate("config", config);
  if (!result.valid) throw new Error(`Project Context config.yml is schema-invalid: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  return config;
}

function resolveTargetRelease(planningRoot, reference) {
  const resolution = resolveReleaseReference(planningRoot, reference);
  if (resolution.status !== "FOUND") throw new Error(`release reference failed: ${resolution.status}: ${resolution.findings.join("; ")}`);
  return resolution.release;
}

function releaseMutationRequestHash({ actor, kind, requestSnapshot }) {
  return revisionHash({ actor, kind, requestSnapshot });
}

function canonicalEqual(left, right) {
  return revisionHash(left) === revisionHash(right);
}

export function releaseMutationInvariantFindings(changeSet, operation = null, planningRoot = null) {
  const findings = [];
  const payload = changeSet.payload || {};
  const targetKeys = Object.keys(changeSet.target || {}).sort();
  if (targetKeys.length !== 1 || targetKeys[0] !== "releaseId" || changeSet.target.releaseId !== payload.releaseId) {
    findings.push(`${changeSet.kind} target must contain exactly releaseId equal to payload.releaseId`);
  }
  if (payload.operationId !== changeSet.operationId) findings.push(`${changeSet.kind} payload.operationId must match ChangeSet operationId`);

  if (operation) {
    if (payload.updatedAt !== operation.proposedAt) findings.push(`${changeSet.kind} updatedAt must match the server-owned Operation proposedAt`);
    if (payload.updatedBy !== operation.proposedBy) findings.push(`${changeSet.kind} updatedBy must match the server-owned Operation proposedBy`);
  }

  const snapshot = payload.requestSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    findings.push(`${changeSet.kind} requestSnapshot must be a normalized object`);
    return findings;
  }

  const actor = operation?.proposedBy ?? payload.updatedBy;
  try {
    const rawRequest = { releaseRef: snapshot.releaseRef, idempotencyKey: payload.idempotencyKey };
    if (changeSet.kind === "release.policy.configure") {
      if (snapshot.laneId !== null) rawRequest.laneId = snapshot.laneId;
      if (snapshot.policyMode !== null) rawRequest.policyMode = snapshot.policyMode;
      if (snapshot.previousReleaseRefs !== null) rawRequest.previousReleaseRefs = snapshot.previousReleaseRefs;
      if (snapshot.dependencyRefs !== null) rawRequest.dependencyRefs = snapshot.dependencyRefs;
    } else if (changeSet.kind === "release.scopeRefs.set") {
      rawRequest.scopeIds = snapshot.scopeIds;
      rawRequest.policyMode = snapshot.policyMode;
    } else if (changeSet.kind === "release.operationalRefs.set") {
      rawRequest.executionContextRefs = snapshot.executionContextRefs;
      rawRequest.environmentRefs = snapshot.environmentRefs;
    } else if (changeSet.kind === "release.deployment.record") {
      rawRequest.environmentRef = snapshot.environmentRef;
      rawRequest.executionContextRef = snapshot.executionContextRef;
      rawRequest.status = snapshot.status;
      rawRequest.artifactRefs = snapshot.artifactRefs;
      rawRequest.evidenceRefs = snapshot.evidenceRefs;
      rawRequest.completedAt = snapshot.completedAt;
    } else if (changeSet.kind === "release.finalization.complete") {
      rawRequest.retrospectiveStatus = snapshot.retrospectiveStatus;
    }
    const normalized = normalizeReleaseMutationRequest(changeSet.kind, rawRequest, {
      actor,
      defaultIdempotencyKey: payload.idempotencyKey
    });
    if (!canonicalEqual(normalized.requestSnapshot, snapshot)) findings.push(`${changeSet.kind} requestSnapshot is not canonical normalized caller intent`);
    if (normalized.idempotencyRequestHash !== payload.idempotencyRequestHash) findings.push(`${changeSet.kind} idempotencyRequestHash does not match normalized caller intent and actor`);
  } catch (error) {
    findings.push(`${changeSet.kind} requestSnapshot is invalid: ${error.message}`);
  }

  let currentRelease = null;
  if (planningRoot) {
    try {
      const resolved = resolveTargetRelease(planningRoot, snapshot.releaseRef);
      if (resolved.id !== payload.releaseId) findings.push(`${changeSet.kind} requestSnapshot.releaseRef resolves to ${resolved.id}, not payload.releaseId ${payload.releaseId}`);
      currentRelease = readReleaseFile(planningRoot, payload.releaseId).release;
    } catch (error) {
      findings.push(`${changeSet.kind} cannot rebind requestSnapshot.releaseRef: ${error.message}`);
    }
  }

  if (changeSet.kind === "release.policy.configure") {
    if (currentRelease) {
      const expectedLaneId = snapshot.laneId ?? currentRelease.lane.id;
      const expectedPolicy = {
        mode: snapshot.policyMode ?? currentRelease.policy.mode,
        previousReleaseRefs: snapshot.previousReleaseRefs ?? currentRelease.policy.previousReleaseRefs,
        dependencyRefs: snapshot.dependencyRefs ?? currentRelease.policy.dependencyRefs
      };
      if (payload.laneId !== expectedLaneId) findings.push("release.policy.configure laneId is not derived from caller intent and the target Release base state");
      if (!canonicalEqual(payload.policy, expectedPolicy)) findings.push("release.policy.configure policy is not derived from caller intent and the target Release base state");
    }
  } else if (changeSet.kind === "release.scopeRefs.set") {
    const payloadScopeIds = Array.isArray(payload.scopeRefs) ? payload.scopeRefs.map((entry) => entry.scopeId).sort() : [];
    if (!canonicalEqual(payloadScopeIds, [...(snapshot.scopeIds || [])].sort())) findings.push("release.scopeRefs.set scopeRefs do not correspond to requestSnapshot.scopeIds");
  } else if (changeSet.kind === "release.operationalRefs.set") {
    if (!canonicalEqual(payload.executionContextRefs, snapshot.executionContextRefs)) findings.push("release.operationalRefs.set executionContextRefs do not match caller intent");
    if (!canonicalEqual(payload.environmentRefs, snapshot.environmentRefs)) findings.push("release.operationalRefs.set environmentRefs do not match caller intent");
  } else if (changeSet.kind === "release.deployment.record") {
    const event = payload.deploymentEvent || {};
    if (!isUuidV7(event.id)) findings.push("release.deployment.record deploymentEvent.id must be a server-owned UUIDv7");
    if (event.releaseId !== payload.releaseId) findings.push("release.deployment.record deploymentEvent.releaseId must match payload.releaseId");
    if (event.operationId !== changeSet.operationId) findings.push("release.deployment.record deploymentEvent.operationId must match ChangeSet operationId");
    if (operation && event.actor !== operation.proposedBy) findings.push("release.deployment.record deploymentEvent.actor must match the server-owned Operation proposedBy");
    if (operation && event.startedAt !== operation.proposedAt) findings.push("release.deployment.record deploymentEvent.startedAt must match the server-owned Operation proposedAt");
    for (const field of ["environmentRef", "executionContextRef", "status", "artifactRefs", "evidenceRefs", "completedAt"]) {
      if (!canonicalEqual(event[field], snapshot[field])) findings.push(`release.deployment.record deploymentEvent.${field} does not match caller intent`);
    }
  } else if (changeSet.kind === "release.finalization.complete") {
    if (payload.previousFinalization?.completed !== false) findings.push("release.finalization.complete previousFinalization must be the current incomplete state at propose");
    if (payload.nextFinalization?.completed !== true) findings.push("release.finalization.complete nextFinalization must complete finalization");
    if (operation && payload.nextFinalization?.completedAt !== operation.proposedAt) findings.push("release.finalization.complete completedAt must match the server-owned Operation proposedAt");
    if (operation && payload.nextFinalization?.completedBy !== operation.proposedBy) findings.push("release.finalization.complete completedBy must match the server-owned Operation proposedBy");
    if (payload.nextFinalization?.retrospectiveStatus !== snapshot.retrospectiveStatus) findings.push("release.finalization.complete retrospectiveStatus must match caller intent");
    if (payload.guardSummary && payload.guardSummary.lifecycle !== payload.lifecycleStatus) findings.push("release.finalization.complete guard lifecycle must match payload lifecycleStatus");
    if (payload.guardSummary && payload.guardSummaryHash !== releasePolicyRequestHash({ actor: "system:release-health", requestSnapshot: payload.guardSummary })) findings.push("release.finalization.complete guardSummaryHash must match guardSummary");
    if (currentRelease && !canonicalEqual(currentRelease.finalization, payload.previousFinalization)) findings.push("release.finalization.complete previousFinalization must match current Release finalization at validation");
  }

  return findings;
}

export function normalizeReleaseMutationRequest(kind, rawPayload, { actor, defaultIdempotencyKey }) {
  requireObject(rawPayload);
  rejectServerOwned(rawPayload);
  assertAllowedFields(kind, rawPayload);
  actor = requireActor(actor);
  const releaseRef = requireString(rawPayload.releaseRef, "releaseRef");
  if (!isUuidV7(releaseRef) && !isReleaseDisplayId(releaseRef)) throw new Error("releaseRef must be UUIDv7 or display ID");
  const idempotencyKey = rawPayload.idempotencyKey === undefined ? requireString(defaultIdempotencyKey, "idempotencyKey") : requireString(rawPayload.idempotencyKey, "idempotencyKey");
  let requestSnapshot;
  if (kind === "release.policy.configure") {
    const policyMode = optionalString(rawPayload.policyMode, "policyMode");
    if (policyMode !== null && !["strict_sequence", "dependency_graph"].includes(policyMode)) throw new Error(`unsupported release policy mode: ${policyMode}`);
    requestSnapshot = {
      releaseRef,
      laneId: optionalString(rawPayload.laneId, "laneId"),
      policyMode,
      previousReleaseRefs: rawPayload.previousReleaseRefs === undefined ? null : normalizeUuidList(rawPayload.previousReleaseRefs, "previousReleaseRefs"),
      dependencyRefs: rawPayload.dependencyRefs === undefined ? null : normalizeUuidList(rawPayload.dependencyRefs, "dependencyRefs")
    };
  } else if (kind === "release.scopeRefs.set") {
    const policyMode = optionalString(rawPayload.policyMode, "policyMode") || "strict";
    if (!["strict", "advisory"].includes(policyMode)) throw new Error("release.scopeRefs.set policyMode must be strict or advisory");
    requestSnapshot = {
      releaseRef,
      scopeIds: normalizeUuidList(rawPayload.scopeIds, "scopeIds"),
      policyMode
    };
  } else if (kind === "release.operationalRefs.set") {
    requestSnapshot = {
      releaseRef,
      executionContextRefs: normalizeUuidList(rawPayload.executionContextRefs, "executionContextRefs"),
      environmentRefs: normalizeUuidList(rawPayload.environmentRefs, "environmentRefs")
    };
  } else if (kind === "release.deployment.record") {
    const status = requireString(rawPayload.status, "status");
    if (!["planned", "started", "succeeded", "failed", "cancelled"].includes(status)) throw new Error(`unsupported deployment status: ${status}`);
    requestSnapshot = {
      releaseRef,
      environmentRef: requireString(rawPayload.environmentRef, "environmentRef"),
      executionContextRef: optionalString(rawPayload.executionContextRef, "executionContextRef"),
      status,
      artifactRefs: normalizeUuidOrStringEvidence(rawPayload.artifactRefs, "artifactRefs"),
      evidenceRefs: normalizeUuidOrStringEvidence(rawPayload.evidenceRefs, "evidenceRefs"),
      completedAt: optionalString(rawPayload.completedAt, "completedAt")
    };
    if (!isUuidV7(requestSnapshot.environmentRef)) throw new Error("environmentRef must be UUIDv7");
    if (requestSnapshot.executionContextRef !== null && !isUuidV7(requestSnapshot.executionContextRef)) throw new Error("executionContextRef must be UUIDv7 or null");
  } else if (kind === "release.finalization.complete") {
    const retrospectiveStatus = optionalString(rawPayload.retrospectiveStatus, "retrospectiveStatus") || "not_required";
    if (!["not_started", "draft", "approved", "not_required"].includes(retrospectiveStatus)) throw new Error("release.finalization.complete retrospectiveStatus is invalid");
    requestSnapshot = {
      releaseRef,
      retrospectiveStatus
    };
  } else {
    throw new Error(`unsupported release mutation kind: ${kind}`);
  }
  return {
    requestSnapshot,
    idempotencyKey,
    idempotencyRequestHash: releaseMutationRequestHash({ actor, kind, requestSnapshot })
  };
}

function normalizeUuidOrStringEvidence(value, field) {
  const values = value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : String(value).split(",");
  return values.map((entry) => requireString(entry, field));
}

function mutationTargets(releaseId) {
  return [releaseYamlRelativePath(releaseId), releaseReadmeRelativePath(releaseId)];
}

function observedConfigRevision(config) {
  return revisionHash(config);
}

export function prepareReleaseMutation(kind, rawPayload, {
  planningRoot,
  workspaceRoot,
  operationId,
  actor,
  proposedAt,
  releaseRequest = null,
  deploymentEventId = null
}) {
  const normalized = releaseRequest ?? normalizeReleaseMutationRequest(kind, rawPayload, { actor, defaultIdempotencyKey: operationId });
  const config = readCurrentConfig(planningRoot);
  const release = resolveTargetRelease(planningRoot, normalized.requestSnapshot.releaseRef);
  let payload = {
    operationId,
    releaseId: release.id,
    updatedAt: proposedAt,
    updatedBy: actor,
    requestSnapshot: normalized.requestSnapshot,
    idempotencyKey: normalized.idempotencyKey,
    idempotencyRequestHash: normalized.idempotencyRequestHash,
    observedRevisions: {
      config: observedConfigRevision(config),
      release: release.audit.revision
    }
  };

  if (kind === "release.policy.configure") {
    const nextLaneId = normalized.requestSnapshot.laneId ?? release.lane.id;
    const nextPolicy = {
      mode: normalized.requestSnapshot.policyMode ?? release.policy.mode,
      previousReleaseRefs: normalized.requestSnapshot.previousReleaseRefs ?? release.policy.previousReleaseRefs,
      dependencyRefs: normalized.requestSnapshot.dependencyRefs ?? release.policy.dependencyRefs
    };
    assertValidLaneConfig(config, nextLaneId);
    assertReleasePolicyValid({ releases: listReleaseDocuments(planningRoot), targetRelease: release, nextPolicy, nextLaneId });
    payload = { ...payload, laneId: nextLaneId, policy: nextPolicy };
  } else if (kind === "release.scopeRefs.set") {
    const evidence = buildScopeRefsEvidence({ planningRoot, workspaceRoot, scopeIds: normalized.requestSnapshot.scopeIds, evaluatedAt: proposedAt, policyMode: normalized.requestSnapshot.policyMode });
    payload = { ...payload, scopeRefs: evidence.refs, observedRevisions: { ...payload.observedRevisions, scopeGuideEvidence: evidence.observedRevisions } };
  } else if (kind === "release.operationalRefs.set") {
    assertValidLaneConfig(config, release.lane.id);
    const executionContextRevisions = assertCatalogRefsValid({ planningRoot, kind: "executionContext", ids: normalized.requestSnapshot.executionContextRefs });
    const environmentRevisions = assertCatalogRefsValid({ planningRoot, kind: "environment", ids: normalized.requestSnapshot.environmentRefs, laneId: release.lane.id });
    payload = { ...payload, executionContextRefs: normalized.requestSnapshot.executionContextRefs, environmentRefs: normalized.requestSnapshot.environmentRefs, observedRevisions: { ...payload.observedRevisions, executionContextRefs: executionContextRevisions, environmentRefs: environmentRevisions } };
  } else if (kind === "release.deployment.record") {
    assertValidLaneConfig(config, release.lane.id);
    const environmentRevisions = assertCatalogRefsValid({ planningRoot, kind: "environment", ids: [normalized.requestSnapshot.environmentRef], laneId: release.lane.id });
    const executionContextRevisions = normalized.requestSnapshot.executionContextRef === null ? {} : assertCatalogRefsValid({ planningRoot, kind: "executionContext", ids: [normalized.requestSnapshot.executionContextRef] });
    payload = {
      ...payload,
      deploymentEvent: {
        id: deploymentEventId ?? generateUuidV7(),
        releaseId: release.id,
        environmentRef: normalized.requestSnapshot.environmentRef,
        executionContextRef: normalized.requestSnapshot.executionContextRef,
        status: normalized.requestSnapshot.status,
        artifactRefs: normalized.requestSnapshot.artifactRefs,
        evidenceRefs: normalized.requestSnapshot.evidenceRefs,
        startedAt: proposedAt,
        completedAt: normalized.requestSnapshot.completedAt,
        actor,
        operationId
      },
      observedRevisions: { ...payload.observedRevisions, executionContextRefs: executionContextRevisions, environmentRefs: environmentRevisions }
    };
  } else if (kind === "release.finalization.complete") {
    const health = evaluateReleaseHealth({ planningRoot, release, directoryId: release.id });
    const currentGuardSummary = releaseFinalizationGuardSummary(health, release);
    const nextFinalization = {
      completed: true,
      completedAt: proposedAt,
      completedBy: actor,
      retrospectiveStatus: normalized.requestSnapshot.retrospectiveStatus
    };
    payload = {
      ...payload,
      lifecycleStatus: release.status,
      previousFinalization: release.finalization,
      nextFinalization,
      guardSummary,
      guardSummaryHash: releasePolicyRequestHash({ actor: "system:release-health", requestSnapshot: guardSummary })
    };
  }

  return { target: { releaseId: release.id }, payload, targetFiles: mutationTargets(release.id), normalized };
}

function assertConfigUnchanged(config, expectedRevision) {
  if (observedConfigRevision(config) !== expectedRevision) {
    const error = new Error("REFERENCE_STALE: config.yml changed since propose");
    error.code = "STALE";
    throw error;
  }
}

export function updateReleaseRevision(releaseWithoutRevision) {
  const withoutRevision = { ...releaseWithoutRevision, audit: { ...releaseWithoutRevision.audit } };
  delete withoutRevision.audit.revision;
  return {
    ...withoutRevision,
    audit: {
      ...withoutRevision.audit,
      revision: `sha256:${revisionHash(withoutRevision)}`
    }
  };
}

export function renderReleaseMutation(kind, payload, { planningRoot, workspaceRoot, currentConfig }) {
  const config = currentConfig ?? readCurrentConfig(planningRoot);
  assertConfigUnchanged(config, payload.observedRevisions.config);
  const { release } = readReleaseFile(planningRoot, payload.releaseId);
  if (release.audit.revision !== payload.observedRevisions.release) {
    const error = new Error("REFERENCE_STALE: release.yml changed since propose");
    error.code = "STALE";
    throw error;
  }
  let nextRelease = {
    ...release,
    audit: {
      ...release.audit,
      updatedAt: payload.updatedAt,
      updatedBy: payload.updatedBy,
      operationId: payload.operationId
    }
  };
  if (kind === "release.policy.configure") {
    assertValidLaneConfig(config, payload.laneId);
    assertReleasePolicyValid({ releases: listReleaseDocuments(planningRoot), targetRelease: release, nextPolicy: payload.policy, nextLaneId: payload.laneId });
    nextRelease = { ...nextRelease, lane: { id: payload.laneId }, policy: payload.policy };
  } else if (kind === "release.scopeRefs.set") {
    const refs = assertScopeEvidenceCurrent({
      planningRoot,
      workspaceRoot,
      scopeIds: payload.requestSnapshot.scopeIds,
      evaluatedAt: payload.updatedAt,
      policyMode: payload.requestSnapshot.policyMode,
      expectedRefs: payload.scopeRefs,
      expectedRevisions: payload.observedRevisions.scopeGuideEvidence
    });
    nextRelease = { ...nextRelease, scopeRefs: refs };
  } else if (kind === "release.operationalRefs.set") {
    assertValidLaneConfig(config, release.lane.id);
    assertCatalogRefsValid({ planningRoot, kind: "executionContext", ids: payload.executionContextRefs, expectedRevisions: payload.observedRevisions.executionContextRefs });
    assertCatalogRefsValid({ planningRoot, kind: "environment", ids: payload.environmentRefs, laneId: release.lane.id, expectedRevisions: payload.observedRevisions.environmentRefs });
    nextRelease = { ...nextRelease, executionContextRefs: payload.executionContextRefs, environmentRefs: payload.environmentRefs };
  } else if (kind === "release.deployment.record") {
    assertValidLaneConfig(config, release.lane.id);
    assertCatalogRefsValid({ planningRoot, kind: "environment", ids: [payload.deploymentEvent.environmentRef], laneId: release.lane.id, expectedRevisions: payload.observedRevisions.environmentRefs });
    if (payload.deploymentEvent.executionContextRef) {
      assertCatalogRefsValid({ planningRoot, kind: "executionContext", ids: [payload.deploymentEvent.executionContextRef], expectedRevisions: payload.observedRevisions.executionContextRefs });
    }
    if (release.deploymentEvents.some((event) => event.id === payload.deploymentEvent.id)) throw new Error(`DUPLICATE_REFERENCE: deployment event already exists: ${payload.deploymentEvent.id}`);
    nextRelease = { ...nextRelease, deploymentEvents: [...release.deploymentEvents, payload.deploymentEvent] };
  } else if (kind === "release.finalization.complete") {
    const health = evaluateReleaseHealth({ planningRoot, release, directoryId: release.id });
    const guardSummary = assertReleaseCanFinalize({ health, release });
    const guardHash = releasePolicyRequestHash({ actor: "system:release-health", requestSnapshot: currentGuardSummary });
    if (guardHash !== payload.guardSummaryHash) {
      const error = new Error("REFERENCE_STALE: release finalization guard summary changed since propose");
      error.code = "STALE";
      throw error;
    }
    assertReleaseCanFinalize({ health, release });
    if (revisionHash(release.finalization) !== revisionHash(payload.previousFinalization)) {
      const error = new Error("REFERENCE_STALE: finalization metadata changed since propose");
      error.code = "STALE";
      throw error;
    }
    nextRelease = { ...nextRelease, finalization: payload.nextFinalization };
  } else {
    throw new Error(`unsupported release mutation kind: ${kind}`);
  }
  const finalRelease = updateReleaseRevision(nextRelease);
  const result = validate("release", finalRelease);
  if (!result.valid) throw new Error(`release mutation produced invalid release: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  return finalRelease;
}
