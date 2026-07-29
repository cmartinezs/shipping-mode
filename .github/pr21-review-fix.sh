#!/usr/bin/env bash
set -euo pipefail

cat > runtime/src/lib/releaseCreate.mjs <<'EOF'
import { revisionHash } from "./canonical.mjs";
import { isReleaseDisplayIdForUuid } from "./releaseIdentity.mjs";

export function releaseCreateRequestHash({ actor, requestSnapshot }) {
  return revisionHash({ actor, ...requestSnapshot });
}

function isCanonicalTrimmedString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

export function releaseCreateInvariantFindings(changeSet, operation = null) {
  const findings = [];
  const payload = changeSet.payload;

  if (payload.operationId !== changeSet.operationId) {
    findings.push(`release.create payload.operationId ${payload.operationId} does not match ChangeSet operationId ${changeSet.operationId}`);
  }

  const targetKeys = Object.keys(changeSet.target || {}).sort();
  if (targetKeys.length !== 1 || targetKeys[0] !== "releaseId" || changeSet.target.releaseId !== payload.id) {
    findings.push("release.create target must contain exactly releaseId equal to payload.id");
  }

  if (!isReleaseDisplayIdForUuid(payload.id, payload.displayId)) {
    findings.push(`release.create displayId ${payload.displayId} is not derived from release UUIDv7 ${payload.id}`);
  }

  for (const field of ["title", "objective", "laneId", "idempotencyKey"]) {
    if (!isCanonicalTrimmedString(payload[field])) {
      findings.push(`release.create payload.${field} must be a canonical non-blank trimmed string`);
    }
  }

  const snapshot = payload.requestSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    findings.push("release.create requestSnapshot must be a server-owned normalized object");
  } else {
    if (snapshot.title !== payload.title || snapshot.objective !== payload.objective || snapshot.slug !== payload.slug) {
      findings.push("release.create requestSnapshot business fields must match the resolved payload");
    }
    if (snapshot.laneId !== null && snapshot.laneId !== payload.laneId) {
      findings.push("release.create explicit requestSnapshot.laneId must match payload.laneId");
    }
    if (snapshot.policyMode !== null && snapshot.policyMode !== payload.policyMode) {
      findings.push("release.create explicit requestSnapshot.policyMode must match payload.policyMode");
    }
    const expectedRequestHash = releaseCreateRequestHash({ actor: payload.createdBy, requestSnapshot: snapshot });
    if (payload.idempotencyRequestHash !== expectedRequestHash) {
      findings.push("release.create idempotencyRequestHash does not match the normalized caller request snapshot");
    }
  }

  if (payload.createdAt !== payload.updatedAt) {
    findings.push("release.create createdAt and updatedAt must be identical at creation");
  }
  if (payload.createdBy !== payload.updatedBy) {
    findings.push("release.create createdBy and updatedBy must be identical at creation");
  }

  if (operation) {
    if (operation.id !== changeSet.operationId) {
      findings.push(`release.create operation.id ${operation.id} does not match ChangeSet operationId ${changeSet.operationId}`);
    }
    if (payload.createdAt !== operation.proposedAt || payload.updatedAt !== operation.proposedAt) {
      findings.push("release.create timestamps must match the server-owned operation proposedAt value");
    }
    if (payload.createdBy !== operation.proposedBy || payload.updatedBy !== operation.proposedBy) {
      findings.push("release.create actors must match the server-owned operation proposedBy value");
    }
  }

  return findings;
}
EOF

cat > runtime/src/commands/proposalPreparation.mjs <<'EOF'
import { generateUuidV7 } from "../lib/ids.mjs";
import { UsageError } from "../lib/errors.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES } from "../lib/bootstrapTopology.mjs";
import { deriveUniqueReleaseDisplayId } from "../lib/releaseIdentity.mjs";
import { releaseReadmeRelativePath, releaseYamlRelativePath } from "../lib/releaseStore.mjs";
import { releaseCreateRequestHash } from "../lib/releaseCreate.mjs";

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
    idempotencyRequestHash: releaseCreateRequestHash({ actor, requestSnapshot })
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

python3 - <<'PY'
from pathlib import Path
p = Path('runtime/src/lib/releaseStore.mjs')
s = p.read_text()
if 'listReservedReleaseDocuments' not in s:
    s = s.replace('import { revisionHash } from "./canonical.mjs";\n', 'import { revisionHash } from "./canonical.mjs";\nimport { readChangeSet, readOperation } from "./operationStore.mjs";\nimport { StateError } from "./errors.mjs";\n')
    marker = '''export function listReleaseDocuments(planningRoot, options = {}) {
  return scanReleaseRecords(planningRoot, options).filter((record) => record.release).map((record) => record.release);
}
'''
    addition = marker + '''
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
    if (operation.kind !== "release.create" || ["INVALID", "STALE", "APPLIED"].includes(operation.status)) continue;
    let changeSet;
    try {
      changeSet = readChangeSet(operationsRoot, operationId);
    } catch (error) {
      throw new StateError(`cannot verify release.create identity reservation for operation ${operationId}: ${error.message}`);
    }
    if (changeSet.kind !== "release.create" || changeSet.operationId !== operationId) {
      throw new StateError(`release.create identity reservation is inconsistent for operation ${operationId}`);
    }
    const releaseId = changeSet.payload?.id;
    const displayId = changeSet.payload?.displayId;
    if (!isUuidV7(releaseId) || !isReleaseDisplayIdForUuid(releaseId, displayId)) {
      throw new StateError(`release.create identity reservation is invalid for operation ${operationId}`);
    }
    reserved.push({ id: releaseId, displayId });
  }
  return reserved;
}
'''
    if marker not in s:
        raise SystemExit('releaseStore listReleaseDocuments marker not found')
    s = s.replace(marker, addition)
p.write_text(s)
PY

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
EOF

python3 - <<'PY'
from pathlib import Path
p = Path('runtime/src/commands/changesetCommand.mjs')
s = p.read_text()
if 'proposeReleaseCreate' not in s:
    s = s.replace('import { revisionHash } from "../lib/canonical.mjs";\n', 'import { revisionHash } from "../lib/canonical.mjs";\nimport { proposeReleaseCreate } from "./release.mjs";\n')
start = s.index('export function runChangesetPropose')
end = s.index('\nexport function runChangesetValidate', start)
old = s[start:end]
new = '''export function runChangesetPropose({ planningRoot, kind, payloadText, actor }) {
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
'''
s = s[:start] + new + s[end:]
s = s.replace('import { listReleaseDocuments } from "../lib/releaseStore.mjs";\n', '')
p.write_text(s)
PY

python3 - <<'PY'
from pathlib import Path
p = Path('runtime/src/lib/changeset.mjs')
s = p.read_text()
if 'prepareUnderLock = null' not in s:
    old_sig = 'export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor, operationId = null, proposedAt = null, preconditions = null, idempotency = null }) {'
    new_sig = 'export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor, operationId = null, proposedAt = null, preconditions = null, idempotency = null, prepareUnderLock = null }) {'
    if old_sig not in s:
        raise SystemExit('current propose signature not found')
    s = s.replace(old_sig, new_sig)
    needle = '''    if (idempotency) {
      const existingOperationId = findIdempotentOperation(operationsRoot, { kind, ...idempotency });
      if (existingOperationId) return existingOperationId;
    }
    operationId ??= generateUuidV7();
    assertDistinctMutationTargets(planningRoot, targetFiles);
'''
    replacement = '''    if (idempotency) {
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
    if needle not in s:
        raise SystemExit('current propose body marker not found')
    s = s.replace(needle, replacement)
if 'computePersistedChangeSetHash(changeSet) !== changeSet.hash' not in s[s.index('function findIdempotentOperation'):s.index('export function propose')]:
    needle = '''    if (changeSet.kind !== kind || changeSet.operationId !== candidateId) {
      throw new StateError(`cannot establish ${kind} idempotency because operation ${candidateId} is internally inconsistent`);
    }
'''
    replacement = '''    if (changeSet.kind !== kind || changeSet.operationId !== candidateId || computePersistedChangeSetHash(changeSet) !== changeSet.hash) {
      throw new StateError(`cannot establish ${kind} idempotency because operation ${candidateId} is internally inconsistent`);
    }
'''
    if needle not in s:
        raise SystemExit('idempotency integrity marker not found')
    s = s.replace(needle, replacement)
p.write_text(s)
PY

python3 - <<'PY'
import json
from pathlib import Path
p = Path('runtime/src/schemas/change-set.schema.json')
data = json.loads(p.read_text())
branch = next((candidate for candidate in data.get('allOf', []) if candidate.get('if', {}).get('properties', {}).get('kind', {}).get('const') == 'release.create'), None)
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
        'policyMode': {'enum': ['strict_sequence', 'dependency_graph', None]},
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
import { readChangeSet, readOperation } from "../../lib/operationStore.mjs";
import { parseYaml, stringifyYaml } from "../../lib/yaml.mjs";
import { listReservedReleaseDocuments } from "../../lib/releaseStore.mjs";

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
  const firstChangeSet = readChangeSet(operationsRoot, first.operationId);
  assert.deepEqual(firstChangeSet.payload.requestSnapshot, { title: "Stable retry", objective: "Survive policy drift", laneId: null, policyMode: null, slug: null });
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

// Pending release.create operations reserve their identities before canonical apply.
{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const pending = runReleaseNew({ planningRoot, args: { title: "Pending", objective: "Reserve identity", idempotencyKey: "pending-reservation", actor: "tester" } });
  const reservations = listReservedReleaseDocuments(operationsRoot);
  assert.ok(reservations.some((entry) => entry.id === pending.releaseId && entry.displayId === pending.displayId));
  assert.equal(readOperation(operationsRoot, pending.operationId).status, "PROPOSED");
}

// A corrupted pending release ChangeSet makes identity/idempotency state unknowable and must fail closed.
{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const pending = runReleaseNew({ planningRoot, args: { title: "Corrupt pending", objective: "Fail closed", idempotencyKey: "corrupt-key", actor: "tester" } });
  fs.writeFileSync(path.join(operationsRoot, pending.operationId, "change-set.json"), "{not-json\n");
  assert.throws(() => runReleaseNew({ planningRoot, args: { title: "Another release", objective: "Must not bypass corruption", idempotencyKey: "another-key", actor: "tester" } }), /cannot establish release\.create idempotency/);
}

console.log("release-core-review: caller-intent idempotency, locked identity reservations and complete status refs pass");
EOF

python3 - <<'PY'
from pathlib import Path
p = Path('docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md')
s = p.read_text()
marker = '## Post-review trust-boundary corrections\n'
if marker not in s:
    s += '''

## Post-review trust-boundary corrections

Adversarial PR review found and closed the following Plan 1 gaps:

- idempotency hashes are based on normalized caller intent, not mutable resolved Project Context defaults;
- exact retries resolve under the workspace lock before rereading current defaults or allocating another Release identity;
- pending non-terminal `release.create` Operations reserve their UUID/display-ID pairs during collision resolution;
- unreadable Release operations or ChangeSets fail closed when identity/idempotency state cannot be established;
- `release.create` validation binds its caller request snapshot to the resolved payload and server-owned hash;
- `release status` exposes lane, policy and release dependency references required by the Plan 1 query contract.
'''
p.write_text(s)
PY
