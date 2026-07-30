import fs from "node:fs";
import path from "node:path";
import { generateUuidV7, isUuidV7 } from "./ids.mjs";
import { revisionHash } from "./canonical.mjs";
import { validate } from "./schema.mjs";
import { parseYaml } from "./yaml.mjs";
import { confineWritePath } from "./paths.mjs";
import { resolveReleaseReference, readReleaseFile } from "./releaseStore.mjs";
import { resolveReleaseItemReference, readReleaseItemFile } from "./releaseItemStore.mjs";
import { buildScopeRefsEvidence, assertScopeEvidenceCurrent } from "./releaseScopeEvidence.mjs";
import { deriveUniqueWorkPackageDisplayId, isWorkPackageDisplayIdForUuid } from "./workPackageIdentity.mjs";
import {
  assertReleaseItemCanAcceptWorkPackage,
  assertReleaseParentCanAcceptWorkPackage,
  listReservedWorkPackageDocuments,
  listWorkPackageDocuments,
  updateWorkPackageRevision,
  workPackageCatalogFindings,
  workPackageReadmeRelativePath,
  workPackageYamlRelativePath
} from "./workPackageStore.mjs";

const SERVER_OWNED = new Set([
  "id", "displayId", "displayIdStatus", "releaseId", "releaseItemId", "scopeIdResolved",
  "guideRefs", "gateRequirements", "audit", "createdAt", "updatedAt", "createdBy",
  "updatedBy", "operationId", "revision", "status", "resolution", "health",
  "readiness", "completion", "eventId", "targetPaths", "parentRevision",
  "itemRevision", "scopeRevision", "guideRevisions", "gateRequirementRevisions",
  "proposalHash", "idempotencyRequestHash"
]);
const ALLOWED_FIELDS = new Set(["scopeId", "title", "description", "commitment", "design", "interfaces", "contracts", "dependencies", "dependencyRefs", "risks", "blockers", "idempotencyKey"]);

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, field);
}

function normalizeUuidArray(value, field) {
  const values = value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : String(value).split(",");
  const normalized = values.map((entry) => requireString(entry, field));
  for (const entry of normalized) if (!isUuidV7(entry)) throw new Error(`${field} entries must be UUIDv7: ${entry}`);
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length) throw new Error(`${field} cannot contain duplicates`);
  return unique;
}

function normalizeNamedTextArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const allowed = new Set(["id", "summary", "detail"]);
  const normalized = value.map((entry, index) => {
    requireObject(entry, `${field}[${index}]`);
    for (const key of Object.keys(entry)) if (!allowed.has(key)) throw new Error(`${field}[${index}] contains unsupported field: ${key}`);
    return { id: requireString(entry.id, `${field}[${index}].id`), summary: requireString(entry.summary, `${field}[${index}].summary`), detail: optionalString(entry.detail, `${field}[${index}].detail`) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length) throw new Error(`${field} cannot contain duplicate ids`);
  return normalized;
}

function normalizeRiskArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("risks must be an array");
  const allowed = new Set(["id", "level", "summary"]);
  return value.map((risk, index) => {
    requireObject(risk, `risks[${index}]`);
    for (const key of Object.keys(risk)) if (!allowed.has(key)) throw new Error(`risks[${index}] contains unsupported field: ${key}`);
    const level = requireString(risk.level, `risks[${index}].level`);
    if (!["low", "medium", "high", "critical"].includes(level)) throw new Error(`risks[${index}].level is invalid`);
    if (!isUuidV7(risk.id)) throw new Error(`risks[${index}].id must be UUIDv7`);
    return { id: risk.id, level, summary: requireString(risk.summary, `risks[${index}].summary`) };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeBlockerArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("blockers must be an array");
  const allowed = new Set(["id", "severity", "summary"]);
  return value.map((blocker, index) => {
    requireObject(blocker, `blockers[${index}]`);
    for (const key of Object.keys(blocker)) if (!allowed.has(key)) throw new Error(`blockers[${index}] contains unsupported field: ${key}`);
    const severity = requireString(blocker.severity, `blockers[${index}].severity`);
    if (!["low", "medium", "high", "critical"].includes(severity)) throw new Error(`blockers[${index}].severity is invalid`);
    if (!isUuidV7(blocker.id)) throw new Error(`blockers[${index}].id must be UUIDv7`);
    return { id: blocker.id, severity, summary: requireString(blocker.summary, `blockers[${index}].summary`) };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function rejectServerOwned(rawPayload) {
  for (const field of Object.keys(rawPayload)) {
    if (SERVER_OWNED.has(field)) throw new Error(`work-package.create field is server-owned: ${field}`);
    if (!ALLOWED_FIELDS.has(field)) throw new Error(`work-package.create contains unsupported field: ${field}`);
  }
}

export function workPackageCreateRequestHash({ actor, releaseId, releaseItemId, scopeId, requestSnapshot }) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid Work Package release id: ${releaseId}`);
  if (!isUuidV7(releaseItemId)) throw new Error(`invalid Work Package Release Item id: ${releaseItemId}`);
  if (!isUuidV7(scopeId)) throw new Error(`invalid Work Package Scope id: ${scopeId}`);
  return revisionHash({ actor, releaseId, releaseItemId, scopeId, ...requestSnapshot });
}

export function normalizeWorkPackageCreateRequest(rawPayload, { actor, defaultIdempotencyKey, releaseId, releaseItemId, scopeId }) {
  requireObject(rawPayload, "work-package.create payload");
  rejectServerOwned(rawPayload);
  if (typeof actor !== "string" || actor.trim().length === 0) throw new Error("work-package.create requires non-blank actor");
  const commitment = requireString(rawPayload.commitment, "commitment");
  if (!["required", "optional"].includes(commitment)) throw new Error("commitment must be required or optional");
  const requestSnapshot = {
    title: requireString(rawPayload.title, "title"),
    description: optionalString(rawPayload.description, "description"),
    commitment,
    design: optionalString(rawPayload.design, "design"),
    interfaces: normalizeNamedTextArray(rawPayload.interfaces, "interfaces"),
    contracts: normalizeNamedTextArray(rawPayload.contracts, "contracts"),
    dependencies: normalizeUuidArray(rawPayload.dependencies ?? rawPayload.dependencyRefs, "dependencies"),
    risks: normalizeRiskArray(rawPayload.risks),
    blockers: normalizeBlockerArray(rawPayload.blockers)
  };
  const idempotencyKey = rawPayload.idempotencyKey === undefined ? requireString(defaultIdempotencyKey, "idempotencyKey") : requireString(rawPayload.idempotencyKey, "idempotencyKey");
  return {
    requestSnapshot,
    idempotencyKey,
    idempotencyRequestHash: workPackageCreateRequestHash({ actor, releaseId, releaseItemId, scopeId, requestSnapshot })
  };
}

function readGuide(planningRoot, scopeId, kind) {
  const relativePath = path.join("scopes", scopeId, `${kind}-guide.yml`);
  const filePath = confineWritePath(planningRoot, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return parseYaml(fs.readFileSync(filePath, "utf8"));
}

function deriveGuideRefs(scopeEvidence, capturedAt) {
  return scopeEvidence.guides.map((guide) => {
    if (!guide.id || !guide.revision || !guide.contentHash || !guide.usable) throw new Error(`CAPABILITY_UNAVAILABLE: ${guide.kind} guide is not usable for Work Package creation`);
    return {
      scopeId: scopeEvidence.scopeId,
      kind: guide.kind,
      id: guide.id,
      revision: guide.revision,
      contentHash: guide.contentHash,
      state: guide.state,
      usable: true,
      capturedAt
    };
  }).sort((left, right) => left.kind.localeCompare(right.kind));
}

function deriveGateRequirements(planningRoot, scopeId, guideRefs) {
  const requirements = [];
  const taskGuide = readGuide(planningRoot, scopeId, "task");
  const taskRef = guideRefs.find((ref) => ref.kind === "task");
  if (taskGuide && taskRef) {
    for (const id of [...(taskGuide.requiredGateRefs || [])].sort()) {
      requirements.push({ id, required: true, applicability: "declared", source: { type: "guide", scopeId, guideKind: "task", guideId: taskRef.id, revision: taskRef.revision } });
    }
  }
  return requirements;
}

export function prepareWorkPackageCreate(rawPayload, {
  planningRoot,
  operationsRoot,
  operationId,
  actor,
  proposedAt,
  releaseRef,
  itemRef,
  packageRequest = null,
  packageId = null,
  expectedReleaseId = null,
  expectedReleaseItemId = null,
  expectedScopeId = null
}) {
  const releaseResolution = resolveReleaseReference(planningRoot, releaseRef);
  if (releaseResolution.status !== "FOUND") throw new Error(`release reference failed: ${releaseResolution.status}: ${releaseResolution.findings.join("; ")}`);
  const release = releaseResolution.release;
  if (expectedReleaseId && release.id !== expectedReleaseId) {
    const error = new Error(`REFERENCE_STALE: Release reference resolved to ${release.id}, expected ${expectedReleaseId}`);
    error.code = "STALE";
    throw error;
  }
  const itemResolution = resolveReleaseItemReference(planningRoot, release.id, itemRef);
  if (itemResolution.status !== "FOUND") throw new Error(`release item reference failed: ${itemResolution.status}: ${itemResolution.findings.join("; ")}`);
  const item = itemResolution.item;
  if (expectedReleaseItemId && item.id !== expectedReleaseItemId) {
    const error = new Error(`REFERENCE_STALE: Release Item reference resolved to ${item.id}, expected ${expectedReleaseItemId}`);
    error.code = "STALE";
    throw error;
  }
  const scopeId = requireString(rawPayload.scopeId, "scopeId");
  if (!isUuidV7(scopeId)) throw new Error(`scopeId must be UUIDv7: ${scopeId}`);
  if (expectedScopeId && scopeId !== expectedScopeId) {
    const error = new Error(`REFERENCE_STALE: Scope reference resolved to ${scopeId}, expected ${expectedScopeId}`);
    error.code = "STALE";
    throw error;
  }
  assertReleaseParentCanAcceptWorkPackage(release);
  assertReleaseItemCanAcceptWorkPackage(item);
  const normalized = packageRequest ?? normalizeWorkPackageCreateRequest(rawPayload, { actor, defaultIdempotencyKey: operationId, releaseId: release.id, releaseItemId: item.id, scopeId });
  const expectedRequestHash = workPackageCreateRequestHash({ actor, releaseId: release.id, releaseItemId: item.id, scopeId, requestSnapshot: normalized.requestSnapshot });
  if (normalized.idempotencyRequestHash !== expectedRequestHash) throw new Error("work-package.create request binding does not match the canonical Release, Item and Scope");

  const currentRelease = readReleaseFile(planningRoot, release.id).release;
  const currentItem = readReleaseItemFile(planningRoot, release.id, item.id).item;
  if (currentRelease.audit.revision !== release.audit.revision) {
    const error = new Error("REFERENCE_STALE: release.yml changed during Work Package proposal");
    error.code = "STALE";
    throw error;
  }
  if (currentItem.audit.revision !== item.audit.revision) {
    const error = new Error("REFERENCE_STALE: release-item.yml changed during Work Package proposal");
    error.code = "STALE";
    throw error;
  }
  const scopeEvidenceBundle = buildScopeRefsEvidence({ planningRoot, workspaceRoot: path.dirname(planningRoot), scopeIds: [scopeId], evaluatedAt: proposedAt, policyMode: "strict" });
  const scopeEvidence = scopeEvidenceBundle.refs[0];
  if (!scopeEvidence?.readiness?.ready) throw new Error(`CAPABILITY_UNAVAILABLE: Scope ${scopeId} does not have usable approved guides`);
  const guideRefs = deriveGuideRefs(scopeEvidence, proposedAt);
  const gateRequirements = deriveGateRequirements(planningRoot, scopeId, guideRefs);
  const scopeRevision = scopeEvidenceBundle.observedRevisions[`scopes/${scopeId}/scope.yml`];

  const existingPackages = [
    ...listWorkPackageDocuments(planningRoot),
    ...listReservedWorkPackageDocuments(operationsRoot)
  ];
  const id = packageId ?? generateUuidV7();
  const display = deriveUniqueWorkPackageDisplayId(id, existingPackages);
  const dependencies = normalized.requestSnapshot.dependencies;
  for (const dep of dependencies) {
    const target = existingPackages.find((pkg) => pkg.id === dep && pkg.releaseId === release.id);
    if (!target) throw new Error(`INVALID_REFERENCE: dependency ${dep} does not resolve to a Work Package in ${release.id}`);
  }
  if (dependencies.includes(id)) throw new Error("INVALID_REFERENCE: Work Package cannot depend on itself");

  const materialized = updateWorkPackageRevision({
    schemaVersion: 1,
    id,
    displayId: display.displayId,
    displayIdStatus: "ACTIVE",
    releaseId: release.id,
    releaseItemId: item.id,
    scopeId,
    title: normalized.requestSnapshot.title,
    description: normalized.requestSnapshot.description,
    status: "DRAFT",
    commitment: normalized.requestSnapshot.commitment,
    design: normalized.requestSnapshot.design,
    interfaces: normalized.requestSnapshot.interfaces,
    contracts: normalized.requestSnapshot.contracts,
    dependencies,
    guideRefs,
    gateRequirements,
    risks: normalized.requestSnapshot.risks.map((risk) => ({ ...risk, createdAt: proposedAt, createdBy: actor })),
    blockers: normalized.requestSnapshot.blockers.map((blocker) => ({ ...blocker, createdAt: proposedAt, createdBy: actor })),
    resolution: null,
    audit: { createdAt: proposedAt, createdBy: actor, updatedAt: proposedAt, updatedBy: actor, operationId }
  });
  const schema = validate("work-package", materialized);
  if (!schema.valid) throw new Error(`work-package.create produced invalid Work Package: ${schema.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  const graphFindings = workPackageCatalogFindings([...listWorkPackageDocuments(planningRoot, { releaseId: release.id }), materialized], { releaseId: release.id });
  if (graphFindings.length > 0) throw new Error(graphFindings.map((finding) => `${finding.code}: ${finding.message}`).join("; "));
  return {
    target: { releaseId: release.id, itemId: item.id, packageId: id },
    payload: {
      operationId,
      id,
      displayId: display.displayId,
      displayIdStatus: "ACTIVE",
      releaseId: release.id,
      releaseItemId: item.id,
      scopeId,
      parentRevision: release.audit.revision,
      itemRevision: item.audit.revision,
      scopeRevision,
      guideRefs,
      guideEvidence: scopeEvidence,
      observedRevisions: scopeEvidenceBundle.observedRevisions,
      gateRequirements,
      proposedAt,
      actor,
      requestSnapshot: normalized.requestSnapshot,
      idempotencyKey: normalized.idempotencyKey,
      idempotencyRequestHash: normalized.idempotencyRequestHash,
      targetPaths: [workPackageYamlRelativePath(release.id, item.id, id), workPackageReadmeRelativePath(release.id, item.id, id)]
    },
    targetFiles: [workPackageYamlRelativePath(release.id, item.id, id), workPackageReadmeRelativePath(release.id, item.id, id)],
    normalized
  };
}

export function renderWorkPackageCreate(payload, { planningRoot }) {
  const release = readReleaseFile(planningRoot, payload.releaseId).release;
  if (release.audit.revision !== payload.parentRevision) {
    const error = new Error("REFERENCE_STALE: release.yml changed since propose");
    error.code = "STALE";
    throw error;
  }
  assertReleaseParentCanAcceptWorkPackage(release);
  const item = readReleaseItemFile(planningRoot, payload.releaseId, payload.releaseItemId).item;
  if (item.audit.revision !== payload.itemRevision) {
    const error = new Error("REFERENCE_STALE: release-item.yml changed since propose");
    error.code = "STALE";
    throw error;
  }
  assertReleaseItemCanAcceptWorkPackage(item);
  assertScopeEvidenceCurrent({
    planningRoot,
    workspaceRoot: path.dirname(planningRoot),
    scopeIds: [payload.scopeId],
    evaluatedAt: payload.proposedAt,
    policyMode: "strict",
    expectedRefs: [payload.guideEvidence],
    expectedRevisions: payload.observedRevisions
  });
  const workPackage = updateWorkPackageRevision({
    schemaVersion: 1,
    id: payload.id,
    displayId: payload.displayId,
    displayIdStatus: payload.displayIdStatus,
    releaseId: payload.releaseId,
    releaseItemId: payload.releaseItemId,
    scopeId: payload.scopeId,
    title: payload.requestSnapshot.title,
    description: payload.requestSnapshot.description,
    status: "DRAFT",
    commitment: payload.requestSnapshot.commitment,
    design: payload.requestSnapshot.design,
    interfaces: payload.requestSnapshot.interfaces,
    contracts: payload.requestSnapshot.contracts,
    dependencies: payload.requestSnapshot.dependencies,
    guideRefs: payload.guideRefs,
    gateRequirements: payload.gateRequirements,
    risks: payload.requestSnapshot.risks.map((risk) => ({ ...risk, createdAt: payload.proposedAt, createdBy: payload.actor })),
    blockers: payload.requestSnapshot.blockers.map((blocker) => ({ ...blocker, createdAt: payload.proposedAt, createdBy: payload.actor })),
    resolution: null,
    audit: { createdAt: payload.proposedAt, createdBy: payload.actor, updatedAt: payload.proposedAt, updatedBy: payload.actor, operationId: payload.operationId }
  });
  const schema = validate("work-package", workPackage);
  if (!schema.valid) throw new Error(`work-package.create produced invalid Work Package: ${schema.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  const graphFindings = workPackageCatalogFindings([...listWorkPackageDocuments(planningRoot, { releaseId: payload.releaseId }), workPackage], { releaseId: payload.releaseId });
  if (graphFindings.length > 0) {
    const error = new Error(graphFindings.map((finding) => `${finding.code}: ${finding.message}`).join("; "));
    error.code = "STALE";
    throw error;
  }
  return workPackage;
}

export function workPackageCreateInvariantFindings(changeSet, operation = null, existingPackages = []) {
  const findings = [];
  const payload = changeSet.payload || {};
  if (payload.operationId !== changeSet.operationId) findings.push("work-package.create payload.operationId must match ChangeSet operationId");
  const targetKeys = Object.keys(changeSet.target || {}).sort();
  if (targetKeys.length !== 3 || changeSet.target.releaseId !== payload.releaseId || changeSet.target.itemId !== payload.releaseItemId || changeSet.target.packageId !== payload.id) findings.push("work-package.create target must contain exactly releaseId, itemId and packageId matching payload");
  if (!isWorkPackageDisplayIdForUuid(payload.id, payload.displayId)) findings.push(`work-package.create displayId ${payload.displayId} is not derived from Work Package UUIDv7 ${payload.id}`);
  const displayIdCollision = existingPackages.find((pkg) => pkg.id !== payload.id && pkg.displayId === payload.displayId);
  if (displayIdCollision) findings.push(`work-package.create displayId ${payload.displayId} is already owned by Work Package ${displayIdCollision.id}`);
  if (!Array.isArray(payload.targetPaths) || payload.targetPaths.length !== 2 || !payload.targetPaths.includes(workPackageYamlRelativePath(payload.releaseId, payload.releaseItemId, payload.id)) || !payload.targetPaths.includes(workPackageReadmeRelativePath(payload.releaseId, payload.releaseItemId, payload.id))) findings.push("work-package.create targetPaths must be server-owned canonical YAML and README paths");
  if (!payload.requestSnapshot || typeof payload.requestSnapshot !== "object" || Array.isArray(payload.requestSnapshot)) {
    findings.push("work-package.create requestSnapshot must be a normalized object");
  } else {
    const expectedHash = workPackageCreateRequestHash({ actor: payload.actor, releaseId: payload.releaseId, releaseItemId: payload.releaseItemId, scopeId: payload.scopeId, requestSnapshot: payload.requestSnapshot });
    if (payload.idempotencyRequestHash !== expectedHash) findings.push("work-package.create idempotencyRequestHash does not match normalized caller intent, parent, scope and actor");
  }
  if (!Array.isArray(payload.guideRefs) || payload.guideRefs.length < 2 || payload.guideRefs.some((ref) => ref.scopeId !== payload.scopeId || ref.usable !== true)) findings.push("work-package.create guideRefs must be server-owned usable Guide revisions for the resolved Scope");
  if (!Array.isArray(payload.gateRequirements)) findings.push("work-package.create gateRequirements must be server-owned and derived");
  if (operation) {
    if (payload.proposedAt !== operation.proposedAt) findings.push("work-package.create proposedAt must match Operation proposedAt");
    if (payload.actor !== operation.proposedBy) findings.push("work-package.create actor must match Operation proposedBy");
  }
  return findings;
}
