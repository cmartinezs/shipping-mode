#!/usr/bin/env bash
set -euo pipefail

cat > runtime/src/commands/proposalPreparation.mjs <<'EOF'
import { generateUuidV7 } from "../lib/ids.mjs";
import { UsageError } from "../lib/errors.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES } from "../lib/bootstrapTopology.mjs";
import { deriveUniqueReleaseDisplayId } from "../lib/releaseIdentity.mjs";
import { releaseReadmeRelativePath, releaseYamlRelativePath } from "../lib/releaseStore.mjs";
import { revisionHash } from "../lib/canonical.mjs";

const SUPPORTED_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set", "scope.generator.set", "guide.update", "release.create"]);
const RELEASE_CREATE_ALLOWED_FIELDS = new Set(["title", "objective", "laneId", "policyMode", "slug", "idempotencyKey"]);
const RELEASE_CREATE_SERVER_FIELDS = new Set(["id", "displayId", "displayIdStatus", "status", "createdAt", "createdBy", "updatedAt", "updatedBy", "audit", "completion", "readiness", "canonicalPath", "approval", "scopeRefs", "itemRefs", "blockers", "risks", "deploymentEvents", "finalization", "requestSnapshot", "idempotencyRequestHash"]);

function requireObjectPayload(rawPayload) {
  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new UsageError("changeset payload must be a mapping/object");
  }
  return rawPayload;
}

function requireExplicitBoolean(rawPayload, field) {
  if (typeof rawPayload[field] !== "boolean") {
    throw new UsageError(`scope.command.set ${field} must be an explicit boolean`);
  }
  return rawPayload[field];
}

function assertOnlyAllowedReleaseCreateFields(rawPayload) {
  for (const field of Object.keys(rawPayload)) {
    if (RELEASE_CREATE_SERVER_FIELDS.has(field)) throw new UsageError(`release.create field is server-owned: ${field}`);
    if (!RELEASE_CREATE_ALLOWED_FIELDS.has(field)) throw new UsageError(`release.create contains unsupported field: ${field}`);
  }
}

function requireTrimmedString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new UsageError(`release.create requires non-blank ${field}`);
  return value.trim();
}

function normalizeOptionalString(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new UsageError(`release.create ${field} must be a non-blank string`);
  return value.trim();
}

function normalizeSlug(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new UsageError("release.create slug must be a string or null");
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return slug || null;
}

export function normalizeReleaseCreateRequest(rawPayload, { actor, defaultIdempotencyKey }) {
  requireObjectPayload(rawPayload);
  assertOnlyAllowedReleaseCreateFields(rawPayload);
  if (typeof actor !== "string" || actor.trim().length === 0) throw new UsageError("release.create requires non-blank actor");
  const title = requireTrimmedString(rawPayload.title, "title");
  const objective = requireTrimmedString(rawPayload.objective, "objective");
  const requestedLaneId = normalizeOptionalString(rawPayload.laneId, "laneId") ?? null;
  const requestedPolicyMode = normalizeOptionalString(rawPayload.policyMode, "policyMode") ?? null;
  if (requestedPolicyMode !== null && !["strict_sequence", "dependency_graph"].includes(requestedPolicyMode)) {
    throw new UsageError(`unsupported release policy mode: ${requestedPolicyMode}`);
  }
  const slug = normalizeSlug(rawPayload.slug);
  const idempotencyKey = rawPayload.idempotencyKey === undefined
    ? requireTrimmedString(defaultIdempotencyKey, "idempotencyKey")
    : requireTrimmedString(rawPayload.idempotencyKey, "idempotencyKey");
  const requestSnapshot = { title, objective, laneId: requestedLaneId, policyMode: requestedPolicyMode, slug };
  return {
    requestSnapshot,
    idempotencyKey,
    idempotencyRequestHash: revisionHash({ actor, ...requestSnapshot })
  };
}

export function prepareProposal(kind, rawPayload, {
  operationId = null,
  actor = null,
  proposedAt = null,
  existingReleases = [],
  currentConfig = null,
  releaseRequest = null,
  releaseId = null
} = {}) {
  if (!SUPPORTED_KINDS.has(kind)) throw new UsageError(`unsupported changeset kind: ${kind}`);
  requireObjectPayload(rawPayload);

  if (kind === "workspace.init") {
    return { payload: rawPayload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore", ...BOOTSTRAP_CANONICAL_DIRECTORIES] };
  }
  if (kind === "config.update") {
    return { payload: rawPayload, targetFiles: ["config.yml"] };
  }
  if (kind === "config.autonomy.set") {
    return { payload: rawPayload, targetFiles: ["config.yml"] };
  }

  if (kind === "scope.command.set") {
    if (!operationId || !actor || !proposedAt) {
      throw new UsageError("scope.command.set requires runtime operationId, actor, and proposedAt");
    }
    const payload = {
      operationId,
      scopeId: rawPayload.scopeId,
      role: rawPayload.role,
      command: rawPayload.command,
      requiresEnvironment: requireExplicitBoolean(rawPayload, "requiresEnvironment"),
      requiresSecrets: requireExplicitBoolean(rawPayload, "requiresSecrets"),
      declaredBy: actor,
      declaredAt: proposedAt
    };
    return { payload, targetFiles: [`scopes/${payload.scopeId}/scope.yml`] };
  }

  if (kind === "scope.generator.set") {
    if (!operationId || !actor || !proposedAt) throw new UsageError("scope.generator.set requires runtime operationId, actor, and proposedAt");
    const payload = {
      operationId,
      scopeId: rawPayload.scopeId,
      guideKind: rawPayload.guideKind,
      generator: rawPayload.generator ?? null,
      declaredBy: actor,
      declaredAt: proposedAt
    };
    return { payload, targetFiles: [`scopes/${payload.scopeId}/scope.yml`] };
  }

  if (kind === "guide.update") {
    if (!rawPayload.scopeId || !rawPayload.guideKind || !rawPayload.action) {
      throw new UsageError("guide.update requires scopeId, guideKind, and action");
    }
    if (!operationId || !actor || !proposedAt) throw new UsageError("guide.update requires runtime operationId, actor, and proposedAt");
    const payload = {
      ...rawPayload,
      operationId,
      proposedAt,
      guideId: generateUuidV7()
    };
    return {
      payload,
      targetFiles: ["config.yml", `scopes/${payload.scopeId}/scope.yml`, `scopes/${payload.scopeId}/${payload.guideKind}-guide.yml`, ...(["generate", "regenerate"].includes(payload.action) ? [`scopes/${payload.scopeId}/${payload.guideKind}-guide.md`] : [])]
    };
  }

  if (kind === "release.create") {
    if (!operationId || !actor || !proposedAt) throw new UsageError("release.create requires runtime operationId, actor, and proposedAt");
    if (!currentConfig?.policies?.release) throw new UsageError("release.create requires initialized Project Context release policy");
    const normalized = releaseRequest ?? normalizeReleaseCreateRequest(rawPayload, { actor, defaultIdempotencyKey: operationId });
    const { requestSnapshot, idempotencyKey, idempotencyRequestHash } = normalized;
    const laneId = requestSnapshot.laneId
      ?? requireTrimmedString(currentConfig.policies.release.defaultLane, "Project Context policies.release.defaultLane");
    const policyMode = requestSnapshot.policyMode
      ?? requireTrimmedString(currentConfig.policies.release.mode, "Project Context policies.release.mode");
    if (!["strict_sequence", "dependency_graph"].includes(policyMode)) throw new UsageError(`unsupported release policy mode: ${policyMode}`);
    const id = releaseId ?? generateUuidV7();
    const display = deriveUniqueReleaseDisplayId(id, existingReleases);
    const payload = {
      operationId,
      id,
      displayId: display.displayId,
      displayIdStatus: "ACTIVE",
      title: requestSnapshot.title,
      objective: requestSnapshot.objective,
      laneId,
      policyMode,
      slug: requestSnapshot.slug,
      status: "DRAFT",
      createdAt: proposedAt,
      createdBy: actor,
      updatedAt: proposedAt,
      updatedBy: actor,
      requestSnapshot,
      idempotencyKey,
      idempotencyRequestHash
    };
    return { payload, targetFiles: [releaseYamlRelativePath(id), releaseReadmeRelativePath(id)] };
  }

  const payload = {
    ...(rawPayload.id ? rawPayload : { ...rawPayload, id: generateUuidV7() }),
    guideGapId: generateUuidV7()
  };
  return { payload, targetFiles: ["config.yml", `scopes/${payload.id}/scope.yml`] };
}
EOF

cat > runtime/src/lib/releaseStore.mjs <<'EOF'
import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";
import { isUuidV7 } from "./ids.mjs";
import { isReleaseDisplayId, isReleaseDisplayIdForUuid } from "./releaseIdentity.mjs";
import { validate } from "./schema.mjs";
import { confineWritePath } from "./paths.mjs";
import { revisionHash } from "./canonical.mjs";
import { readChangeSet, readOperation } from "./operationStore.mjs";
import { StateError } from "./errors.mjs";

export function releaseRelativeDir(releaseId) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid release id: ${releaseId}`);
  return path.join("releases", releaseId);
}

export function releaseYamlRelativePath(releaseId) {
  return path.join(releaseRelativeDir(releaseId), "release.yml");
}

export function releaseReadmeRelativePath(releaseId) {
  return path.join(releaseRelativeDir(releaseId), "README.md");
}

export function releaseIntegrityFindings(release, { directoryId = null } = {}) {
  const findings = [];
  const schemaResult = validate("release", release);
  if (!schemaResult.valid) {
    for (const error of schemaResult.errors) findings.push(`release.yml${error.path}: ${error.message}`);
    return { schemaValid: false, findings };
  }
  if (directoryId && release.id !== directoryId) findings.push(`release.id ${release.id} does not match directory ${directoryId}`);
  if (!isReleaseDisplayIdForUuid(release.id, release.displayId)) findings.push(`displayId ${release.displayId} is not derived from release UUIDv7 ${release.id}`);
  const revisionless = { ...release, audit: { ...release.audit } };
  delete revisionless.audit.revision;
  const expectedRevision = `sha256:${revisionHash(revisionless)}`;
  if (release.audit.revision !== expectedRevision) findings.push(`audit.revision does not match canonical release content (expected ${expectedRevision})`);
  return { schemaValid: true, findings };
}

export function readReleaseFile(planningRoot, releaseId) {
  const relativePath = releaseYamlRelativePath(releaseId);
  const filePath = confineWritePath(planningRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    const error = new Error(`release not found: ${releaseId}`);
    error.code = "ENOENT";
    throw error;
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relativePath}: canonical release must be a real file`);
  const release = parseYaml(fs.readFileSync(filePath, "utf8"));
  return { relativePath, filePath, release };
}

function scanReleaseRecords(planningRoot, { includeInvalid = false, requireIntegrity = true } = {}) {
  const releasesRoot = confineWritePath(planningRoot, "releases");
  if (!fs.existsSync(releasesRoot)) return [];
  const rootStat = fs.lstatSync(releasesRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("releases catalog must be a real directory");
  const records = [];
  for (const entry of fs.readdirSync(releasesRoot).sort()) {
    if (!isUuidV7(entry)) throw new Error(`releases/${entry}: not a valid release id`);
    let releasePath;
    try {
      releasePath = confineWritePath(planningRoot, releaseYamlRelativePath(entry));
    } catch (error) {
      throw new Error(`releases/${entry}: ${error.message}`);
    }
    if (!fs.existsSync(releasePath)) throw new Error(`releases/${entry}/release.yml: required file is missing`);
    const stat = fs.lstatSync(releasePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`releases/${entry}/release.yml: canonical release must be a real file`);
    try {
      const release = parseYaml(fs.readFileSync(releasePath, "utf8"));
      const integrity = releaseIntegrityFindings(release, { directoryId: entry });
      const invalid = !integrity.schemaValid || (requireIntegrity && integrity.findings.length > 0);
      if (invalid && !includeInvalid) throw new Error(integrity.findings.join("; "));
      records.push({ directoryId: entry, release, invalid, findings: integrity.findings });
    } catch (error) {
      if (!includeInvalid) throw error;
      records.push({ directoryId: entry, release: null, invalid: true, findings: [error.message] });
    }
  }
  return records;
}

export function listReleaseDocuments(planningRoot, options = {}) {
  return scanReleaseRecords(planningRoot, options).filter((record) => record.release).map((record) => record.release);
}

export function listReservedReleaseDocuments(operationsRoot) {
  if (!fs.existsSync(operationsRoot)) return [];
  const reserved = [];
  for (const operationId of fs.readdirSync(operationsRoot).sort()) {
    let operation;
    try {
      operation = readOperation(operationsRoot, operationId);
    } catch (error) {
      throw new StateError(`cannot inspect operation ${operationId} while reserving Release identities: ${error.message}`);
    }
    if (operation.kind !== "release.create") continue;
    let changeSet;
    try {
      changeSet = readChangeSet(operationsRoot, operationId);
    } catch (error) {
      throw new StateError(`cannot verify release.create identity reservation for operation ${operationId}: ${error.message}`);
    }
    if (changeSet.kind !== "release.create" || changeSet.operationId !== operationId) {
      throw new StateError(`release.create identity reservation is inconsistent for operation ${operationId}`);
    }
    if (["INVALID", "STALE"].includes(operation.status)) continue;
    const releaseId = changeSet.payload?.id;
    const displayId = changeSet.payload?.displayId;
    if (!isUuidV7(releaseId) || !isReleaseDisplayIdForUuid(releaseId, displayId)) {
      throw new StateError(`release.create identity reservation is invalid for operation ${operationId}`);
    }
    reserved.push({ id: releaseId, displayId });
  }
  return reserved;
}

export function resolveReleaseReference(planningRoot, reference) {
  if (isUuidV7(reference)) {
    let read;
    try {
      read = readReleaseFile(planningRoot, reference);
    } catch (error) {
      return { status: error.code === "ENOENT" ? "NOT_FOUND" : "INVALID", reference, findings: [error.message] };
    }
    const integrity = releaseIntegrityFindings(read.release, { directoryId: reference });
    if (integrity.findings.length > 0) return { status: "INVALID", reference, release: read.release, findings: integrity.findings };
    return { status: "FOUND", reference, release: read.release, findings: [] };
  }
  if (!isReleaseDisplayId(reference)) {
    return { status: "NOT_FOUND", reference, findings: ["release references must be UUIDv7 or display ID; slug is not accepted"] };
  }
  let records;
  try {
    records = scanReleaseRecords(planningRoot, { includeInvalid: true, requireIntegrity: false });
  } catch (error) {
    return { status: "INVALID", reference, findings: [`release catalog is invalid: ${error.message}`] };
  }
  const matches = records.filter((record) => record.release?.displayId === reference);
  if (matches.length === 0) return { status: "NOT_FOUND", reference, findings: [`release not found: ${reference}`] };
  if (matches.length > 1) {
    return { status: "AMBIGUOUS", reference, findings: [`display ID ${reference} is ambiguous across ${matches.length} releases`], matches: matches.map((record) => record.directoryId).sort() };
  }
  const match = matches[0];
  const integrity = releaseIntegrityFindings(match.release, { directoryId: match.directoryId });
  if (match.invalid || integrity.findings.length > 0) return { status: "INVALID", reference, release: match.release, findings: [...new Set([...match.findings, ...integrity.findings])] };
  return { status: "FOUND", reference, release: match.release, findings: [] };
}
EOF

cat > runtime/src/commands/release.mjs <<'EOF'
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
      return {
        target: { releaseId: prepared.payload.id },
        payload: prepared.payload,
        targetFiles: prepared.targetFiles
      };
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
EOF

cat > runtime/src/commands/changesetCommand.mjs <<'EOF'
import fs from "node:fs";
import path from "node:path";
import { validateOperation, approveOperation, applyOperation, propose } from "../lib/changeset.mjs";
import { generateUuidV7 } from "../lib/ids.mjs";
import { renderWorkspaceInit, renderConfigUpdate, renderConfigAutonomySet, renderScopeAdd, renderScopeCommandSet, renderScopeGeneratorSet, renderDiscoveryPropose, renderGuideUpdate, renderReleaseCreate } from "./renderers.mjs";
import { readChangeSet, readOperation } from "../lib/operationStore.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { prepareProposal } from "./proposalPreparation.mjs";
import { UsageError } from "../lib/errors.mjs";
import { confineRuntimeWritePath } from "../lib/paths.mjs";
import { readConfirmedSources, readConfirmedScopes } from "../lib/discoverScan.mjs";
import { generateGuideOutput } from "../lib/guideGeneration.mjs";
import { revisionHash } from "../lib/canonical.mjs";
import { proposeReleaseCreate } from "./release.mjs";

function readCurrentConfig(planningRoot) {
  const configPath = confineRuntimeWritePath(planningRoot, "config.yml");
  return fs.existsSync(configPath) ? parseYaml(fs.readFileSync(configPath, "utf8")) : null;
}

function renderFor(kind, payload, currentConfig, workspaceRoot, planningRoot, { currentSources = [], currentScopes = [], approvalMode = "human", approval = null, proposedAt = null } = {}) {
  if (kind === "workspace.init") return renderWorkspaceInit(payload);
  if (kind === "config.update") return renderConfigUpdate(payload, currentConfig, { knownSourceIds: currentSources.map((source) => source.id) });
  if (kind === "config.autonomy.set") return renderConfigAutonomySet(payload, currentConfig);
  if (kind === "scope.add") return renderScopeAdd(payload, currentConfig, workspaceRoot);
  if (kind === "scope.command.set") {
    const currentScope = currentScopes.find((scope) => scope.id === payload.scopeId);
    return renderScopeCommandSet(payload, currentScope);
  }
  if (kind === "scope.generator.set") {
    const currentScope = currentScopes.find((scope) => scope.id === payload.scopeId);
    return renderScopeGeneratorSet(payload, currentScope, workspaceRoot);
  }
  if (kind === "discovery.propose") return renderDiscoveryPropose(payload, currentConfig, workspaceRoot, { currentSources, currentScopes, approvalMode });
  if (kind === "guide.update") return renderGuideUpdate(payload, currentConfig, planningRoot, { currentSources, proposedAt: payload.proposedAt || proposedAt || new Date().toISOString(), approval });
  if (kind === "release.create") return renderReleaseCreate(payload);
  throw new UsageError(`unsupported changeset kind: ${kind}`);
}

export function runChangesetPropose({ planningRoot, kind, payloadText, actor }) {
  let rawPayload;
  try {
    const trimmed = payloadText.trim();
    rawPayload = trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(trimmed);
  } catch (error) {
    throw new UsageError(`invalid payload: ${error.message}`);
  }
  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new UsageError("changeset payload must be a mapping/object");
  }
  if (kind === "guide.update" && ["generate", "regenerate"].includes(rawPayload.action)) {
    if (rawPayload.generationEvidence !== undefined) throw new UsageError("generationEvidence is server-owned");
    if (rawPayload.document === undefined) {
      const config = readCurrentConfig(planningRoot);
      const scope = readConfirmedScopes(planningRoot).find((candidate) => candidate.id === rawPayload.scopeId);
      if (!scope) throw new UsageError(`guide scope not found: ${rawPayload.scopeId}`);
      let generated;
      try {
        generated = generateGuideOutput({ workspaceRoot: path.dirname(planningRoot), scope, guideKind: rawPayload.guideKind, sources: readConfirmedSources(planningRoot), config });
      } catch (error) {
        throw new UsageError(error.message);
      }
      rawPayload = { ...rawPayload, document: generated.document, generationEvidence: generated.evidence };
    } else {
      rawPayload = {
        ...rawPayload,
        generationEvidence: {
          generationMethod: "manual",
          generatorVersion: "shipping-mode:manual-guide-input/1",
          generatorFingerprint: null,
          generationInputHash: revisionHash({ scopeId: rawPayload.scopeId, guideKind: rawPayload.guideKind, document: rawPayload.document }),
          generationOutputHash: revisionHash(rawPayload.document)
        }
      };
    }
  }
  if (kind === "release.create") {
    const created = proposeReleaseCreate({ planningRoot, rawPayload, actor });
    return { operationId: created.operationId, releaseId: created.releaseId, displayId: created.displayId, idempotent: created.idempotent };
  }
  const runtimeContext = {};
  if (kind === "scope.command.set" || kind === "scope.generator.set" || kind === "guide.update") {
    runtimeContext.operationId = generateUuidV7();
    runtimeContext.actor = actor;
    runtimeContext.proposedAt = new Date().toISOString();
  }
  const { payload, targetFiles } = prepareProposal(kind, rawPayload, runtimeContext);
  const operationsRoot = path.join(planningRoot, "operations");
  const candidateOperationId = runtimeContext.operationId || null;
  const operationId = propose({
    operationsRoot,
    planningRoot,
    kind,
    target: {},
    payload,
    targetFiles,
    actor,
    operationId: candidateOperationId,
    proposedAt: runtimeContext.proposedAt || null
  });
  return { operationId };
}

export function runChangesetValidate({ planningRoot, operationsRoot, operationId }) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  const currentConfig = changeSet.kind === "workspace.init" ? null : readCurrentConfig(planningRoot);
  const render = (payload) => renderFor(changeSet.kind, payload, currentConfig, path.dirname(planningRoot), planningRoot, { currentSources: readConfirmedSources(planningRoot), currentScopes: readConfirmedScopes(planningRoot), proposedAt: changeSet.proposedAt });
  validateOperation({ operationsRoot, planningRoot, operationId, render });
  const operation = readOperation(operationsRoot, operationId);
  return { status: operation.status, errors: operation.validation?.errors || [] };
}

export function runChangesetApprove({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval, mode = "human", authorizationContext = null }) {
  approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval: Boolean(allowSelfApproval), mode, authorizationContext });
  return { status: readOperation(operationsRoot, operationId).status };
}

export function runChangesetApply({ planningRoot, operationsRoot, operationId, actor }) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  const operation = readOperation(operationsRoot, operationId);
  const currentConfig = changeSet.kind === "workspace.init" ? null : readCurrentConfig(planningRoot);
  const render = (payload) => renderFor(changeSet.kind, payload, currentConfig, path.dirname(planningRoot), planningRoot, { currentSources: readConfirmedSources(planningRoot), currentScopes: readConfirmedScopes(planningRoot), approvalMode: operation.approval?.mode || "human", approval: operation.approval, proposedAt: changeSet.proposedAt });
  return applyOperation({ operationsRoot, planningRoot, operationId, actor, render });
}
EOF

python3 - <<'PY'
from pathlib import Path
p = Path('runtime/src/lib/changeset.mjs')
s = p.read_text()
s = s.replace('import { DIRECTORY_CONTENT_HASH, isDirectoryRenderEntry } from "./bootstrapTopology.mjs";\n', 'import { DIRECTORY_CONTENT_HASH, isDirectoryRenderEntry } from "./bootstrapTopology.mjs";\nimport { isReleaseDisplayIdForUuid } from "./releaseIdentity.mjs";\n')
old = '''function findIdempotentOperation(operationsRoot, { kind, key, requestHash }) {
  if (!key || !fs.existsSync(operationsRoot)) return null;
  for (const candidateId of fs.readdirSync(operationsRoot).sort()) {
    let operation;
    let changeSet;
    try {
      operation = readOperation(operationsRoot, candidateId);
      if (operation.kind !== kind || ["INVALID", "STALE"].includes(operation.status)) continue;
      changeSet = readChangeSet(operationsRoot, candidateId);
    } catch {
      continue;
    }
    if (changeSet.payload?.idempotencyKey !== key) continue;
    if (changeSet.payload?.idempotencyRequestHash !== requestHash) {
      throw new StateError(`idempotency key ${key} was already used for a different ${kind} request`);
    }
    return candidateId;
  }
  return null;
}

export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor, operationId = null, proposedAt = null, preconditions = null, idempotency = null }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId: null }, () => {
    if (idempotency) {
      const existingOperationId = findIdempotentOperation(operationsRoot, { kind, ...idempotency });
      if (existingOperationId) return existingOperationId;
    }
    operationId ??= generateUuidV7();
    assertDistinctMutationTargets(planningRoot, targetFiles);
'''
new = '''function findIdempotentOperation(operationsRoot, { kind, key, requestHash }) {
  if (!key || !fs.existsSync(operationsRoot)) return null;
  for (const candidateId of fs.readdirSync(operationsRoot).sort()) {
    let operation;
    try {
      operation = readOperation(operationsRoot, candidateId);
    } catch (error) {
      throw new StateError(`cannot verify ${kind} idempotency because operation ${candidateId} is unreadable: ${error.message}`);
    }
    if (operation.kind !== kind) continue;
    let changeSet;
    try {
      changeSet = readChangeSet(operationsRoot, candidateId);
    } catch (error) {
      throw new StateError(`cannot verify ${kind} idempotency because change-set for operation ${candidateId} is unreadable: ${error.message}`);
    }
    if (changeSet.operationId !== candidateId || changeSet.kind !== kind || computePersistedChangeSetHash(changeSet) !== changeSet.hash) {
      throw new StateError(`cannot verify ${kind} idempotency because operation ${candidateId} has an inconsistent ChangeSet`);
    }
    if (changeSet.payload?.idempotencyKey !== key) continue;
    if (changeSet.payload?.idempotencyRequestHash !== requestHash) {
      throw new StateError(`idempotency key ${key} was already used for a different ${kind} request`);
    }
    return candidateId;
  }
  return null;
}

export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor, operationId = null, proposedAt = null, preconditions = null, idempotency = null, prepareUnderLock = null }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId: null }, () => {
    if (idempotency) {
      const existingOperationId = findIdempotentOperation(operationsRoot, { kind, ...idempotency });
      if (existingOperationId) return existingOperationId;
    }
    if (prepareUnderLock) {
      const prepared = prepareUnderLock();
      if (!prepared || !prepared.target || !prepared.payload || !Array.isArray(prepared.targetFiles)) {
        throw new StateError(`${kind} prepareUnderLock must return target, payload, and targetFiles`);
      }
      target = prepared.target;
      payload = prepared.payload;
      targetFiles = prepared.targetFiles;
    }
    if (!target || !payload || !Array.isArray(targetFiles)) throw new StateError(`${kind} proposal is missing target, payload, or targetFiles`);
    operationId ??= generateUuidV7();
    assertDistinctMutationTargets(planningRoot, targetFiles);
'''
if old not in s:
    raise SystemExit('changeset idempotency/propose block not found')
s = s.replace(old, new)
old2 = '''  if (changeSet.kind === "release.create") {
    const releasePath = `releases/${changeSet.payload.id}/release.yml`;
    const readmePath = `releases/${changeSet.payload.id}/README.md`;
    const actualPaths = new Set(Object.keys(changeSet.baseRevisions));
    if (actualPaths.size !== 2 || !actualPaths.has(releasePath) || !actualPaths.has(readmePath)) {
      errors.push("release.create baseRevisions must contain exactly release.yml and README.md for the UUIDv7 release directory");
    }
    for (const relativePath of [releasePath, readmePath]) {
      const entry = changeSet.baseRevisions[relativePath];
      if (!entry || entry.revisionHash !== ABSENT || entry.contentHash !== ABSENT) {
        errors.push(`${relativePath} must be ABSENT for release.create`);
      }
    }
  }
'''
new2 = '''  if (changeSet.kind === "release.create") {
    const payload = changeSet.payload;
    const releasePath = `releases/${payload.id}/release.yml`;
    const readmePath = `releases/${payload.id}/README.md`;
    const actualPaths = new Set(Object.keys(changeSet.baseRevisions));
    if (actualPaths.size !== 2 || !actualPaths.has(releasePath) || !actualPaths.has(readmePath)) {
      errors.push("release.create baseRevisions must contain exactly release.yml and README.md for the UUIDv7 release directory");
    }
    for (const relativePath of [releasePath, readmePath]) {
      const entry = changeSet.baseRevisions[relativePath];
      if (!entry || entry.revisionHash !== ABSENT || entry.contentHash !== ABSENT) {
        errors.push(`${relativePath} must be ABSENT for release.create`);
      }
    }
    const targetKeys = Object.keys(changeSet.target || {});
    if (targetKeys.length !== 1 || changeSet.target?.releaseId !== payload.id) errors.push("release.create target.releaseId must exactly match payload.id");
    if (payload.operationId !== changeSet.operationId) errors.push("release.create payload.operationId must match changeSet.operationId");
    if (!isReleaseDisplayIdForUuid(payload.id, payload.displayId)) errors.push("release.create displayId must be derived from payload.id");
    if (payload.createdAt !== payload.updatedAt || payload.createdBy !== payload.updatedBy) errors.push("release.create initial audit timestamps and actors must match");
    const snapshot = payload.requestSnapshot || {};
    if (snapshot.title !== payload.title || snapshot.objective !== payload.objective || snapshot.slug !== payload.slug) {
      errors.push("release.create requestSnapshot business fields must match the resolved payload");
    }
    if (snapshot.laneId !== null && snapshot.laneId !== payload.laneId) errors.push("release.create explicit requestSnapshot.laneId must match payload.laneId");
    if (snapshot.policyMode !== null && snapshot.policyMode !== payload.policyMode) errors.push("release.create explicit requestSnapshot.policyMode must match payload.policyMode");
    const expectedRequestHash = revisionHash({ actor: payload.createdBy, ...snapshot });
    if (payload.idempotencyRequestHash !== expectedRequestHash) errors.push("release.create idempotencyRequestHash does not match the caller request snapshot");
  }
'''
if old2 not in s:
    raise SystemExit('release invariant block not found')
s = s.replace(old2, new2)
p.write_text(s)
PY

python3 - <<'PY'
import json
from pathlib import Path
p = Path('runtime/src/schemas/change-set.schema.json')
data = json.loads(p.read_text())
branch = None
for candidate in data.get('allOf', []):
    if candidate.get('if', {}).get('properties', {}).get('kind', {}).get('const') == 'release.create':
        branch = candidate
        break
if branch is None:
    raise SystemExit('release.create schema branch not found')
payload = branch['then']['properties']['payload']
if 'requestSnapshot' not in payload['required']:
    idx = payload['required'].index('idempotencyKey')
    payload['required'].insert(idx, 'requestSnapshot')
payload['properties']['requestSnapshot'] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['title', 'objective', 'laneId', 'policyMode', 'slug'],
    'properties': {
        'title': {'type': 'string', 'minLength': 1},
        'objective': {'type': 'string', 'minLength': 1},
        'laneId': {'type': ['string', 'null'], 'pattern': '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'},
        'policyMode': {'type': ['string', 'null'], 'enum': ['strict_sequence', 'dependency_graph', None]},
        'slug': {'type': ['string', 'null'], 'pattern': '^[a-z0-9]+(-[a-z0-9]+)*$'}
    }
}
p.write_text(json.dumps(data, indent=2) + '\n')
PY

cat > runtime/src/commands/tests/release-core-review.test.mjs <<'EOF'
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../init.mjs";
import { runChangesetApprove, runChangesetApply, runChangesetValidate } from "../changesetCommand.mjs";
import { runReleaseNew, runReleaseStatus } from "../release.mjs";
import { computePersistedChangeSetHash } from "../../lib/changeset.mjs";
import { readChangeSet, writeChangeSet } from "../../lib/operationStore.mjs";
import { parseYaml, stringifyYaml } from "../../lib/yaml.mjs";

function initializedWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "release-core-review-"));
  const planningRoot = path.join(workspace, ".planning");
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "release-review", vcs: "none", actor: "tester" } });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "tester", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "tester" });
  return { workspace, planningRoot, operationsRoot };
}

// The idempotency request is caller intent, not mutable Project Context defaults.
{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const first = runReleaseNew({ planningRoot, args: { title: "Stable retry", objective: "Survive policy drift", idempotencyKey: "stable-retry", actor: "tester" } });
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.policies.release.defaultLane = "hotfix";
  config.policies.release.mode = "dependency_graph";
  fs.writeFileSync(configPath, stringifyYaml(config));
  const retry = runReleaseNew({ planningRoot, args: { title: "Stable retry", objective: "Survive policy drift", idempotencyKey: "stable-retry", actor: "tester" } });
  assert.equal(retry.operationId, first.operationId);
  assert.equal(retry.releaseId, first.releaseId);
  assert.equal(retry.idempotent, true);
  assert.throws(() => runReleaseNew({ planningRoot, args: { title: "Stable retry", objective: "Survive policy drift", laneId: "hotfix", idempotencyKey: "stable-retry", actor: "tester" } }), /different release\.create request/);
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: first.operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId: first.operationId, actor: "tester", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: first.operationId, actor: "tester" });
  const status = runReleaseStatus({ planningRoot, reference: first.releaseId });
  assert.equal(status.release.laneId, "main", "the original resolved policy snapshot must survive later config changes");
  assert.equal(status.release.policyMode, "strict_sequence");
  assert.deepEqual(status.refs.previousReleaseRefs, []);
  assert.deepEqual(status.refs.dependencyRefs, []);
}

// STALE and INVALID operations retain their idempotency key and identity.
{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const stale = runReleaseNew({ planningRoot, args: { title: "Stale identity", objective: "Retain key", idempotencyKey: "stale-key", actor: "tester" } });
  const releasePath = path.join(planningRoot, "releases", stale.releaseId, "release.yml");
  fs.mkdirSync(path.dirname(releasePath), { recursive: true });
  fs.writeFileSync(releasePath, "{}\n");
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: stale.operationId }).status, "STALE");
  const staleRetry = runReleaseNew({ planningRoot, args: { title: "Stale identity", objective: "Retain key", idempotencyKey: "stale-key", actor: "tester" } });
  assert.equal(staleRetry.operationId, stale.operationId);
  assert.equal(staleRetry.releaseId, stale.releaseId);
  assert.equal(staleRetry.operationStatus, "STALE");
}

{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const invalid = runReleaseNew({ planningRoot, args: { title: "Invalid identity", objective: "Retain key", idempotencyKey: "invalid-key", actor: "tester" } });
  const changeSet = readChangeSet(operationsRoot, invalid.operationId);
  changeSet.target.releaseId = "018f0000-0000-7000-8000-000000000999";
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  writeChangeSet(operationsRoot, invalid.operationId, changeSet);
  const validation = runChangesetValidate({ planningRoot, operationsRoot, operationId: invalid.operationId });
  assert.equal(validation.status, "INVALID");
  assert.ok(validation.errors.some((error) => error.includes("target.releaseId")));
  const invalidRetry = runReleaseNew({ planningRoot, args: { title: "Invalid identity", objective: "Retain key", idempotencyKey: "invalid-key", actor: "tester" } });
  assert.equal(invalidRetry.operationId, invalid.operationId);
  assert.equal(invalidRetry.releaseId, invalid.releaseId);
  assert.equal(invalidRetry.operationStatus, "INVALID");
}

// A corrupted pending release ChangeSet makes identity/idempotency state unknowable and must fail closed.
{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const pending = runReleaseNew({ planningRoot, args: { title: "Corrupt pending", objective: "Fail closed", idempotencyKey: "corrupt-key", actor: "tester" } });
  fs.writeFileSync(path.join(operationsRoot, pending.operationId, "change-set.json"), "{not-json\n");
  assert.throws(() => runReleaseNew({ planningRoot, args: { title: "Another release", objective: "Must not bypass corruption", idempotencyKey: "another-key", actor: "tester" } }), /cannot verify release\.create idempotency/);
}

console.log("release-core-review: stable caller-intent idempotency, terminal key binding, relational guards and fail-closed reservations pass");
EOF

cat >> docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md <<'EOF'

## Post-review trust-boundary corrections

Adversarial PR review found and closed the following Plan 1 gaps:

- idempotency hashes are now based on normalized caller intent rather than mutable resolved Project Context defaults;
- exact retries resolve before rereading current config or allocating a second Release identity;
- `STALE` and `INVALID` operations retain their idempotency-key binding;
- unreadable Release ChangeSets fail closed instead of being skipped during idempotency lookup;
- display-ID reservations include pending non-terminal `release.create` Operations and are collected under the workspace mutation lock;
- `release.create` validation binds target, operation ID, display ID, initial audit fields and request hash relationally;
- `release status` exposes lane, policy and dependency references required by the Plan 1 query contract.
EOF
