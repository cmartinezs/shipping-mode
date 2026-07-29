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
