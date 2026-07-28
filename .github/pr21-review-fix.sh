#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path


def write(path, content):
    Path(path).write_text(content, encoding="utf-8")


def replace(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"expected text not found in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")

write("runtime/src/lib/releaseIdentity.mjs", r'''import crypto from "node:crypto";
import { isUuidV7 } from "./ids.mjs";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RELEASE_DISPLAY_ID_LENGTHS = Object.freeze([8, 12, 16, 26, 52]);
export const RELEASE_DISPLAY_ID_PATTERN = /^REL-([0-9A-HJKMNP-TV-Z]{8}|[0-9A-HJKMNP-TV-Z]{12}|[0-9A-HJKMNP-TV-Z]{16}|[0-9A-HJKMNP-TV-Z]{26}|[0-9A-HJKMNP-TV-Z]{52})$/;

function encodeCrockford(buffer) {
  let value = 0;
  let bits = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  if (bits > 0) output += CROCKFORD[(value << (5 - bits)) & 31];
  return output;
}

export function releaseDisplayTokenForUuid(uuid) {
  if (!isUuidV7(uuid)) throw new Error(`invalid release UUIDv7: ${uuid}`);
  const uuidBytes = Buffer.from(uuid.replaceAll("-", ""), "hex");
  return encodeCrockford(crypto.createHash("sha256").update(uuidBytes).digest());
}

export function releaseDisplayIdForUuid(uuid, length = 8) {
  if (!RELEASE_DISPLAY_ID_LENGTHS.includes(length)) throw new Error(`unsupported display ID length: ${length}`);
  return `REL-${releaseDisplayTokenForUuid(uuid).slice(0, length)}`;
}

export function deriveUniqueReleaseDisplayId(uuid, existingReleases = []) {
  for (const length of RELEASE_DISPLAY_ID_LENGTHS) {
    const candidate = releaseDisplayIdForUuid(uuid, length);
    const collision = existingReleases.find((release) => release.displayId === candidate && release.id !== uuid);
    if (!collision) return { displayId: candidate, length, collisionResolved: length > RELEASE_DISPLAY_ID_LENGTHS[0] };
  }
  throw new Error(`display ID collision for release ${uuid}`);
}

export function isReleaseDisplayId(value) {
  return typeof value === "string" && RELEASE_DISPLAY_ID_PATTERN.test(value);
}

export function isReleaseDisplayIdForUuid(uuid, displayId) {
  if (!isUuidV7(uuid) || !isReleaseDisplayId(displayId)) return false;
  return RELEASE_DISPLAY_ID_LENGTHS.some((length) => releaseDisplayIdForUuid(uuid, length) === displayId);
}
''')

write("runtime/src/lib/releaseStore.mjs", r'''import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";
import { isUuidV7 } from "./ids.mjs";
import { isReleaseDisplayId, isReleaseDisplayIdForUuid } from "./releaseIdentity.mjs";
import { validate } from "./schema.mjs";
import { confineWritePath } from "./paths.mjs";
import { revisionHash } from "./canonical.mjs";

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
''')

write("runtime/src/commands/release.mjs", r'''import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "../lib/ids.mjs";
import { propose } from "../lib/changeset.mjs";
import { prepareProposal } from "./proposalPreparation.mjs";
import { listReleaseDocuments, resolveReleaseReference, releaseReadmeRelativePath } from "../lib/releaseStore.mjs";
import { readChangeSet, readOperation } from "../lib/operationStore.mjs";
import { compareReleaseReadme } from "../lib/releaseProjection.mjs";
import { confineWritePath } from "../lib/paths.mjs";
import { validate } from "../lib/schema.mjs";

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

export function runReleaseNew({ planningRoot, args }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const candidateOperationId = generateUuidV7();
  const proposedAt = new Date().toISOString();
  const rawPayload = {
    title: args.title,
    objective: args.objective,
    ...(args.laneId ? { laneId: args.laneId } : {}),
    ...(args.policyMode ? { policyMode: args.policyMode } : {}),
    ...(args.slug !== undefined ? { slug: args.slug } : {}),
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
  };
  const { payload, targetFiles } = prepareProposal("release.create", rawPayload, {
    operationId: candidateOperationId,
    actor: args.actor,
    proposedAt,
    existingReleases: listReleaseDocuments(planningRoot)
  });
  const persistedOperationId = propose({
    operationsRoot,
    planningRoot,
    kind: "release.create",
    target: { releaseId: payload.id },
    payload,
    targetFiles,
    actor: args.actor,
    operationId: candidateOperationId,
    proposedAt,
    idempotency: { key: payload.idempotencyKey, requestHash: payload.idempotencyRequestHash }
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
    release: { id: release.id, displayId: release.displayId, lifecycle: release.status, title: release.title, objective: release.objective },
    derivedHealth: {
      schemaValid: schemaResult.valid,
      projection: projection.status,
      readiness: { available: false, releasable: false, unavailableDependencies: ["release_items", "work_packages", "gates"] }
    },
    refs: { scopeRefs: release.scopeRefs, itemRefs: release.itemRefs },
    findings
  };
}
''')

replace("runtime/src/commands/proposalPreparation.mjs",
'''import { deriveUniqueReleaseDisplayId } from "../lib/releaseIdentity.mjs";
import { releaseReadmeRelativePath, releaseYamlRelativePath } from "../lib/releaseStore.mjs";''',
'''import { deriveUniqueReleaseDisplayId } from "../lib/releaseIdentity.mjs";
import { releaseReadmeRelativePath, releaseYamlRelativePath } from "../lib/releaseStore.mjs";
import { revisionHash } from "../lib/canonical.mjs";''')
replace("runtime/src/commands/proposalPreparation.mjs",
'''const RELEASE_CREATE_SERVER_FIELDS = new Set(["id", "displayId", "displayIdStatus", "status", "createdAt", "createdBy", "updatedAt", "updatedBy", "audit", "completion", "readiness", "canonicalPath", "approval", "scopeRefs", "itemRefs", "blockers", "risks", "deploymentEvents", "finalization"]);''',
'''const RELEASE_CREATE_SERVER_FIELDS = new Set(["id", "displayId", "displayIdStatus", "status", "createdAt", "createdBy", "updatedAt", "updatedBy", "audit", "completion", "readiness", "canonicalPath", "approval", "scopeRefs", "itemRefs", "blockers", "risks", "deploymentEvents", "finalization", "idempotencyRequestHash"]);''')
replace("runtime/src/commands/proposalPreparation.mjs",
'''function normalizeSlug(value) {
  if (value === undefined || value === null || value === "") return null;
  const slug = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  if (!slug) return null;
  return slug;
}''',
'''function requireTrimmedString(value, field) {
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
}''')
replace("runtime/src/commands/proposalPreparation.mjs",
'''    if (!rawPayload.title || !rawPayload.objective) throw new UsageError("release.create requires title and objective");
    const id = generateUuidV7();
    const display = deriveUniqueReleaseDisplayId(id, existingReleases);
    const payload = {
      operationId,
      id,
      displayId: display.displayId,
      displayIdStatus: "ACTIVE",
      title: rawPayload.title,
      objective: rawPayload.objective,
      laneId: rawPayload.laneId,
      policyMode: rawPayload.policyMode,
      slug: normalizeSlug(rawPayload.slug),
      status: "DRAFT",
      createdAt: proposedAt,
      createdBy: actor,
      updatedAt: proposedAt,
      updatedBy: actor,
      idempotencyKey: rawPayload.idempotencyKey || operationId
    };''',
'''    const title = requireTrimmedString(rawPayload.title, "title");
    const objective = requireTrimmedString(rawPayload.objective, "objective");
    const laneId = normalizeOptionalString(rawPayload.laneId, "laneId");
    const policyMode = normalizeOptionalString(rawPayload.policyMode, "policyMode");
    const slug = normalizeSlug(rawPayload.slug);
    const idempotencyKey = rawPayload.idempotencyKey === undefined
      ? operationId
      : requireTrimmedString(rawPayload.idempotencyKey, "idempotencyKey");
    const idempotencyRequestHash = revisionHash({ actor, title, objective, laneId: laneId ?? null, policyMode: policyMode ?? null, slug });
    const id = generateUuidV7();
    const display = deriveUniqueReleaseDisplayId(id, existingReleases);
    const payload = {
      operationId,
      id,
      displayId: display.displayId,
      displayIdStatus: "ACTIVE",
      title,
      objective,
      laneId,
      policyMode,
      slug,
      status: "DRAFT",
      createdAt: proposedAt,
      createdBy: actor,
      updatedAt: proposedAt,
      updatedBy: actor,
      idempotencyKey,
      idempotencyRequestHash
    };''')

replace("runtime/src/lib/changeset.mjs",
'''export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor, operationId = null, proposedAt = null, preconditions = null }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId: null }, () => {
    operationId ??= generateUuidV7();''',
'''function findIdempotentOperation(operationsRoot, { kind, key, requestHash }) {
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
    operationId ??= generateUuidV7();''')

replace("runtime/src/commands/changesetCommand.mjs",
'''  const operationId = propose({
    operationsRoot,
    planningRoot,
    kind,
    target: {},
    payload,
    targetFiles,
    actor,
    operationId: runtimeContext.operationId || null,
    proposedAt: runtimeContext.proposedAt || null
  });
  return { operationId };''',
'''  const candidateOperationId = runtimeContext.operationId || null;
  const operationId = propose({
    operationsRoot,
    planningRoot,
    kind,
    target: kind === "release.create" ? { releaseId: payload.id } : {},
    payload,
    targetFiles,
    actor,
    operationId: candidateOperationId,
    proposedAt: runtimeContext.proposedAt || null,
    ...(kind === "release.create" ? { idempotency: { key: payload.idempotencyKey, requestHash: payload.idempotencyRequestHash } } : {})
  });
  return { operationId, ...(kind === "release.create" ? { idempotent: operationId !== candidateOperationId } : {}) };''')

replace("runtime/src/lib/paths.mjs",
'''  for (const name of ["operations", "events", ".runtime", "scopes", "sources"]) {''',
'''  for (const name of ["operations", "events", ".runtime", "scopes", "sources", "releases"]) {''')

replace("runtime/src/commands/check.mjs",
'''import { isReleaseDisplayId } from "../lib/releaseIdentity.mjs";''',
'''import { releaseIntegrityFindings } from "../lib/releaseStore.mjs";''')
replace("runtime/src/commands/check.mjs",
'''    const schemaResult = validate("release", release);
    if (!schemaResult.valid) {
      for (const error of schemaResult.errors) findings.push(`${releaseRelativePath}${error.path}: ${error.message}`);
      continue;
    }
    if (release.id !== releaseId) findings.push(`${releaseRelativePath}: release.id ${release.id} does not match its directory`);
    if (!isReleaseDisplayId(release.displayId)) findings.push(`${releaseRelativePath}: displayId is invalid`);''',
'''    const integrity = releaseIntegrityFindings(release, { directoryId: releaseId });
    for (const finding of integrity.findings) findings.push(`${releaseRelativePath}: ${finding}`);
    if (!integrity.schemaValid) continue;''')
replace("runtime/src/commands/check.mjs",
'''    const revisionless = { ...release, audit: { ...release.audit } };
    delete revisionless.audit.revision;
    if (release.audit.revision !== `sha256:${revisionHash(revisionless)}`) findings.push(`${releaseRelativePath}: audit.revision does not match canonical release content`);
    if (readmePath) {''',
'''    if (readmePath) {''')

for schema_path in ["runtime/src/schemas/release.schema.json", "runtime/src/schemas/change-set.schema.json"]:
    replace(schema_path,
        '^REL-([0-9A-F]{8}|[0-9A-F]{12}|[0-9A-F]{16}|[0-9A-F]{32})$',
        '^REL-([0-9A-HJKMNP-TV-Z]{8}|[0-9A-HJKMNP-TV-Z]{12}|[0-9A-HJKMNP-TV-Z]{16}|[0-9A-HJKMNP-TV-Z]{26}|[0-9A-HJKMNP-TV-Z]{52})$')

replace("runtime/src/schemas/change-set.schema.json",
'''              "idempotencyKey"
            ],''',
'''              "idempotencyKey",
              "idempotencyRequestHash"
            ],''')
replace("runtime/src/schemas/change-set.schema.json",
'''              "idempotencyKey": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256
              }''',
'''              "idempotencyKey": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256
              },
              "idempotencyRequestHash": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$"
              }''')

write("runtime/src/lib/tests/release-identity.test.mjs", r'''import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { revisionHash } from "../canonical.mjs";
import { deriveUniqueReleaseDisplayId, isReleaseDisplayId, releaseDisplayIdForUuid } from "../releaseIdentity.mjs";
import { resolveReleaseReference } from "../releaseStore.mjs";

function releaseDocument(id, displayId) {
  const withoutRevision = {
    schemaVersion: 1, id, displayId, displayIdStatus: "ACTIVE", slug: "decorative", title: "Core", objective: "Create release core", status: "DRAFT",
    lane: { id: "main" }, policy: { mode: "strict_sequence", previousReleaseRefs: [], dependencyRefs: [] }, scopeRefs: [], itemRefs: [], blockers: [], risks: [], deploymentEvents: [],
    finalization: { completed: false, completedAt: null, completedBy: null, retrospectiveStatus: "not_started" },
    audit: { createdAt: "2026-07-28T00:00:00.000Z", createdBy: "carlos", updatedAt: "2026-07-28T00:00:00.000Z", updatedBy: "carlos", operationId: id }
  };
  return { ...withoutRevision, audit: { ...withoutRevision.audit, revision: `sha256:${revisionHash(withoutRevision)}` } };
}

const releaseId = "018f0000-0000-7000-8000-000000000123";
const sameTimestampPrefixId = "018f0000-0000-7000-8000-000000000124";
const displayId = releaseDisplayIdForUuid(releaseId);
assert.match(displayId, /^REL-[0-9A-HJKMNP-TV-Z]{8}$/);
assert.notEqual(displayId, "REL-018F0000", "display ID must hash the UUID instead of exposing UUIDv7 timestamp bits");
assert.notEqual(displayId, releaseDisplayIdForUuid(sameTimestampPrefixId), "UUIDv7 values sharing timestamp bits must still get distinct compact display IDs");
assert.equal(isReleaseDisplayId(displayId), true);
assert.equal(isReleaseDisplayId("draft-slug"), false);
assert.deepEqual(deriveUniqueReleaseDisplayId(releaseId, []), { displayId, length: 8, collisionResolved: false });
assert.equal(deriveUniqueReleaseDisplayId(releaseId, [{ id: sameTimestampPrefixId, displayId }]).displayId, releaseDisplayIdForUuid(releaseId, 12));

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-resolve-"));
const releaseDir = path.join(planningRoot, "releases", releaseId);
fs.mkdirSync(releaseDir, { recursive: true });
fs.writeFileSync(path.join(releaseDir, "release.yml"), stringifyYaml(releaseDocument(releaseId, displayId)));
assert.equal(resolveReleaseReference(planningRoot, releaseId).status, "FOUND");
assert.equal(resolveReleaseReference(planningRoot, displayId).status, "FOUND");
assert.equal(resolveReleaseReference(planningRoot, "decorative").status, "NOT_FOUND", "slug must not resolve as an identity");

const secondId = sameTimestampPrefixId;
const secondDir = path.join(planningRoot, "releases", secondId);
fs.mkdirSync(secondDir, { recursive: true });
fs.writeFileSync(path.join(secondDir, "release.yml"), stringifyYaml(releaseDocument(secondId, displayId)));
assert.equal(resolveReleaseReference(planningRoot, displayId).status, "AMBIGUOUS", "ambiguous display ID must fail closed before selecting a release");
fs.rmSync(secondDir, { recursive: true, force: true });

const tampered = releaseDocument(releaseId, releaseDisplayIdForUuid(secondId));
fs.writeFileSync(path.join(releaseDir, "release.yml"), stringifyYaml(tampered));
assert.equal(resolveReleaseReference(planningRoot, releaseId).status, "INVALID", "valid-looking but non-derived display IDs must fail aggregate integrity");

console.log("release-identity: hashed Crockford IDs, collision extension, safe resolution and integrity checks pass");
''')

replace("runtime/src/commands/tests/commands.test.mjs",
'''assert.match(releaseCreate.displayId, /^REL-[0-9A-F]{8}/);''',
'''assert.match(releaseCreate.displayId, /^REL-[0-9A-HJKMNP-TV-Z]{8}$/);''')
replace("runtime/src/commands/tests/commands.test.mjs",
'''assert.equal(idempotent.idempotent, true);

// changeset propose --payload-file equivalent''',
'''assert.equal(idempotent.idempotent, true);
assert.throws(() => runReleaseNew({
  planningRoot,
  args: { title: "Release Core", objective: "Different request", idempotencyKey: "release-core-key", actor: "carlos" }
}), /idempotency key .* different release\.create request/, "same idempotency key must not alias a different create request");
const pendingReleaseA = runReleaseNew({ planningRoot, args: { title: "Pending A", objective: "A", idempotencyKey: "pending-a", actor: "carlos" } });
const pendingReleaseB = runReleaseNew({ planningRoot, args: { title: "Pending B", objective: "B", idempotencyKey: "pending-b", actor: "carlos" } });
assert.notEqual(pendingReleaseA.displayId, pendingReleaseB.displayId, "separate pending releases must not inherit the same UUIDv7 timestamp-prefix display ID");
const genericPayload = JSON.stringify({ title: "Generic", objective: "Generic path", idempotencyKey: "generic-release", slug: null });
const genericFirst = runChangesetPropose({ planningRoot, kind: "release.create", actor: "carlos", payloadText: genericPayload });
const genericSecond = runChangesetPropose({ planningRoot, kind: "release.create", actor: "carlos", payloadText: genericPayload });
assert.equal(genericSecond.operationId, genericFirst.operationId, "generic changeset entrypoint must share release.create idempotency");
assert.equal(genericSecond.idempotent, true);

// changeset propose --payload-file equivalent''')

replace("docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md",
'''displayId = REL-<first 8 uppercase hex chars of uuid without dashes>''',
'''displayId = REL-<first 8 Crockford Base32 chars of SHA-256(UUID bytes)>''')
replace("docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md",
'''REL-<16>
REL-<32>''',
'''REL-<16>
REL-<26>
REL-<52>''')
replace("docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md",
'''- no identity from title, lane, scope or create order.''',
'''- no identity from title, lane, scope or create order;
- raw UUIDv7 timestamp prefixes are not used because releases created in the same time window would collide systematically.''')
replace("docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md",
'''| Display ID could become `REL-001` or path identity | Derive from UUIDv7 and store under UUID directory only |''',
'''| Display ID could become `REL-001`, path identity, or a truncated UUIDv7 timestamp | Derive a Crockford Base32 short-hash from UUID bytes and store under UUID directory only |''')
replace("docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md",
'''| Plan 1 could leak Corte 3 | No `items/`, `release-item.yml`, Work Packages or Tasks |''',
'''| Plan 1 could leak Corte 3 | No `items/`, `release-item.yml`, Work Packages or Tasks |
| Idempotency key could alias different requests or differ by entrypoint | Bind the key to a server-owned request hash inside the workspace mutation lock for both `release new` and generic `changeset propose` |
| `release status` could crash or trust a valid-looking corrupted aggregate | Safe resolver and shared schema/identity/revision integrity checks fail closed |''')

print("PR21 corrections applied")
PY
