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

export const RELEASE_PLAN2_KINDS = Object.freeze([
  "release.policy.configure",
  "release.scopeRefs.set",
  "release.operationalRefs.set",
  "release.deployment.record"
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
  const serverOwned = new Set(["id", "displayId", "audit", "operationId", "createdAt", "updatedAt", "actor", "eventId", "changeSetHash", "revision", "readiness", "completion", "deploymentEvents"]);
  for (const field of Object.keys(rawPayload)) {
    if (serverOwned.has(field)) throw new Error(`release mutation field is server-owned: ${field}`);
  }
}

function assertAllowedFields(kind, rawPayload) {
  const allowedByKind = {
    "release.policy.configure": new Set(["releaseRef", "laneId", "policyMode", "previousReleaseRefs", "dependencyRefs", "idempotencyKey"]),
    "release.scopeRefs.set": new Set(["releaseRef", "scopeIds", "policyMode", "idempotencyKey"]),
    "release.operationalRefs.set": new Set(["releaseRef", "executionContextRefs", "environmentRefs", "idempotencyKey"]),
    "release.deployment.record": new Set(["releaseRef", "environmentRef", "executionContextRef", "status", "artifactRefs", "evidenceRefs", "completedAt", "idempotencyKey"])
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
  } else {
    throw new Error(`unsupported release mutation kind: ${kind}`);
  }
  const finalRelease = updateReleaseRevision(nextRelease);
  const result = validate("release", finalRelease);
  if (!result.valid) throw new Error(`release mutation produced invalid release: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  return finalRelease;
}
