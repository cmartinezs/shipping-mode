import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";
import { isUuidV7 } from "./ids.mjs";
import { validate } from "./schema.mjs";
import { confineWritePath } from "./paths.mjs";
import { revisionHash } from "./canonical.mjs";
import { readChangeSet, readOperation } from "./operationStore.mjs";
import { StateError } from "./errors.mjs";
import { readReleaseFile, releaseIntegrityFindings } from "./releaseStore.mjs";
import { isReleaseItemDisplayId, isReleaseItemDisplayIdForUuid } from "./releaseItemIdentity.mjs";
import { compareReleaseItemProjection } from "./releaseItemProjection.mjs";
import { deriveReleaseItemCompletionFromWorkPackages } from "./workPackageStore.mjs";

export function releaseItemRelativeDir(releaseId, itemId) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid release id: ${releaseId}`);
  if (!isUuidV7(itemId)) throw new Error(`invalid Release Item id: ${itemId}`);
  return path.join("releases", releaseId, "items", itemId);
}

export function releaseItemYamlRelativePath(releaseId, itemId) {
  return path.join(releaseItemRelativeDir(releaseId, itemId), "release-item.yml");
}

export function releaseItemReadmeRelativePath(releaseId, itemId) {
  return path.join(releaseItemRelativeDir(releaseId, itemId), "README.md");
}

export function releaseItemIntegrityFindings(item, { releaseId = null, directoryId = null } = {}) {
  const findings = [];
  const schemaResult = validate("release-item", item);
  if (!schemaResult.valid) {
    for (const error of schemaResult.errors) findings.push(`release-item.yml${error.path}: ${error.message}`);
    return { schemaValid: false, findings };
  }
  if (directoryId && item.id !== directoryId) findings.push(`releaseItem.id ${item.id} does not match directory ${directoryId}`);
  if (releaseId && item.releaseId !== releaseId) findings.push(`releaseItem.releaseId ${item.releaseId} does not match parent release directory ${releaseId}`);
  if (!isReleaseItemDisplayIdForUuid(item.id, item.displayId)) findings.push(`displayId ${item.displayId} is not derived from Release Item UUIDv7 ${item.id}`);
  const revisionless = { ...item, audit: { ...item.audit } };
  delete revisionless.audit.revision;
  const expectedRevision = `sha256:${revisionHash(revisionless)}`;
  if (item.audit.revision !== expectedRevision) findings.push(`audit.revision does not match canonical Release Item content (expected ${expectedRevision})`);
  return { schemaValid: true, findings };
}

export function updateReleaseItemRevision(itemWithoutRevision) {
  const withoutRevision = { ...itemWithoutRevision, audit: { ...itemWithoutRevision.audit } };
  delete withoutRevision.audit.revision;
  return {
    ...withoutRevision,
    audit: {
      ...withoutRevision.audit,
      revision: `sha256:${revisionHash(withoutRevision)}`
    }
  };
}

export function readReleaseItemFile(planningRoot, releaseId, itemId) {
  const relativePath = releaseItemYamlRelativePath(releaseId, itemId);
  const filePath = confineWritePath(planningRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Release Item not found: ${itemId}`);
    error.code = "ENOENT";
    throw error;
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relativePath}: canonical Release Item must be a real file`);
  const item = parseYaml(fs.readFileSync(filePath, "utf8"));
  return { relativePath, filePath, item };
}

export function listReleaseItemRecords(planningRoot, { releaseId = null, includeInvalid = false, requireIntegrity = true } = {}) {
  const releasesRoot = confineWritePath(planningRoot, "releases");
  if (!fs.existsSync(releasesRoot)) return [];
  const records = [];
  for (const candidateReleaseId of fs.readdirSync(releasesRoot).sort()) {
    if (releaseId && candidateReleaseId !== releaseId) continue;
    if (!isUuidV7(candidateReleaseId)) {
      if (!includeInvalid) throw new Error(`releases/${candidateReleaseId}: not a valid release id`);
      continue;
    }
    const itemsRoot = confineWritePath(planningRoot, path.join("releases", candidateReleaseId, "items"));
    if (!fs.existsSync(itemsRoot)) continue;
    const itemsStat = fs.lstatSync(itemsRoot);
    if (!itemsStat.isDirectory() || itemsStat.isSymbolicLink()) {
      if (!includeInvalid) throw new Error(`releases/${candidateReleaseId}/items: must be a real directory`);
      records.push({ releaseId: candidateReleaseId, directoryId: null, item: null, invalid: true, findings: ["items catalog must be a real directory"] });
      continue;
    }
    for (const itemId of fs.readdirSync(itemsRoot).sort()) {
      const itemDir = path.join(itemsRoot, itemId);
      const relativeDir = path.join("releases", candidateReleaseId, "items", itemId);
      const findings = [];
      if (!isUuidV7(itemId)) findings.push(`${relativeDir}: not a valid Release Item id`);
      const stat = fs.lstatSync(itemDir);
      if (stat.isSymbolicLink()) findings.push(`${relativeDir}: symlink entries are not permitted`);
      if (!stat.isDirectory()) findings.push(`${relativeDir}: entry must be a directory`);
      const releaseItemPath = path.join(itemDir, "release-item.yml");
      if (findings.length > 0) {
        if (!includeInvalid) throw new Error(findings.join("; "));
        records.push({ releaseId: candidateReleaseId, directoryId: itemId, item: null, invalid: true, findings });
        continue;
      }
      if (!fs.existsSync(releaseItemPath)) {
        const missing = [`${relativeDir}/release-item.yml: required file is missing`];
        if (!includeInvalid) throw new Error(missing[0]);
        records.push({ releaseId: candidateReleaseId, directoryId: itemId, item: null, invalid: true, findings: missing });
        continue;
      }
      try {
        const fileStat = fs.lstatSync(releaseItemPath);
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error(`${relativeDir}/release-item.yml: canonical Release Item must be a real file`);
        const item = parseYaml(fs.readFileSync(releaseItemPath, "utf8"));
        const integrity = releaseItemIntegrityFindings(item, { releaseId: candidateReleaseId, directoryId: itemId });
        const invalid = !integrity.schemaValid || (requireIntegrity && integrity.findings.length > 0);
        if (invalid && !includeInvalid) throw new Error(integrity.findings.join("; "));
        records.push({ releaseId: candidateReleaseId, directoryId: itemId, item, invalid, findings: integrity.findings });
      } catch (error) {
        if (!includeInvalid) throw error;
        records.push({ releaseId: candidateReleaseId, directoryId: itemId, item: null, invalid: true, findings: [error.message] });
      }
    }
  }
  return records;
}

export function listReleaseItemDocuments(planningRoot, options = {}) {
  return listReleaseItemRecords(planningRoot, options).filter((record) => record.item).map((record) => record.item);
}

export function listReservedReleaseItemDocuments(operationsRoot) {
  if (!fs.existsSync(operationsRoot)) return [];
  const reserved = [];
  for (const operationId of fs.readdirSync(operationsRoot).sort()) {
    let operation;
    try {
      operation = readOperation(operationsRoot, operationId);
    } catch (error) {
      throw new StateError(`cannot inspect operation ${operationId} while reserving Release Item identities: ${error.message}`);
    }
    if (!["release-item.create", "work-source.import"].includes(operation.kind) || ["APPLIED"].includes(operation.status)) continue;
    let changeSet;
    try {
      changeSet = readChangeSet(operationsRoot, operationId);
    } catch (error) {
      throw new StateError(`cannot verify release-item.create identity reservation for operation ${operationId}: ${error.message}`);
    }
    if (changeSet.kind !== operation.kind || changeSet.operationId !== operationId) {
      throw new StateError(`${operation.kind} identity reservation is inconsistent for operation ${operationId}`);
    }
    const itemId = changeSet.payload?.id;
    const displayId = changeSet.payload?.displayId;
    if (!isUuidV7(itemId) || !isReleaseItemDisplayIdForUuid(itemId, displayId)) {
      throw new StateError(`${operation.kind} identity reservation is invalid for operation ${operationId}`);
    }
    reserved.push({ id: itemId, displayId, releaseId: changeSet.payload.releaseId, sourceRefs: changeSet.payload.requestSnapshot?.sourceRefs || [] });
  }
  return reserved;
}

export function resolveReleaseItemReference(planningRoot, releaseId, reference) {
  if (isUuidV7(reference)) {
    let read;
    try {
      read = readReleaseItemFile(planningRoot, releaseId, reference);
    } catch (error) {
      return { status: error.code === "ENOENT" ? "NOT_FOUND" : "INVALID", reference, findings: [error.message] };
    }
    const integrity = releaseItemIntegrityFindings(read.item, { releaseId, directoryId: reference });
    if (integrity.findings.length > 0) return { status: "INVALID", reference, item: read.item, findings: integrity.findings };
    return { status: "FOUND", reference, item: read.item, findings: [] };
  }
  if (!isReleaseItemDisplayId(reference)) {
    return { status: "NOT_FOUND", reference, findings: ["Release Item references must be UUIDv7 or display ID; slug is not accepted"] };
  }
  let records;
  try {
    records = listReleaseItemRecords(planningRoot, { releaseId, includeInvalid: true, requireIntegrity: false });
  } catch (error) {
    return { status: "INVALID", reference, findings: [`Release Item catalog is invalid: ${error.message}`] };
  }
  const matches = records.filter((record) => record.item?.displayId === reference);
  if (matches.length === 0) return { status: "NOT_FOUND", reference, findings: [`Release Item not found: ${reference}`] };
  if (matches.length > 1) {
    return { status: "AMBIGUOUS", reference, findings: [`display ID ${reference} is ambiguous across ${matches.length} Release Items`], matches: matches.map((record) => record.directoryId).sort() };
  }
  const match = matches[0];
  const integrity = releaseItemIntegrityFindings(match.item, { releaseId, directoryId: match.directoryId });
  if (match.invalid || integrity.findings.length > 0) return { status: "INVALID", reference, item: match.item, findings: [...new Set([...match.findings, ...integrity.findings])] };
  return { status: "FOUND", reference, item: match.item, findings: [] };
}

export function releaseItemCatalogFindings(items, { releaseId }) {
  const findings = [];
  const byId = new Map();
  for (const item of items) {
    byId.set(item.id, item);
    if (item.releaseId !== releaseId) findings.push({ code: "RELEASE_ITEM_PARENT_MISMATCH", severity: "error", itemId: item.id, message: `Release Item ${item.id} belongs to ${item.releaseId}, not ${releaseId}` });
  }
  for (const item of items) {
    const deps = [...item.dependencies].sort();
    if (deps.length !== item.dependencies.length || new Set(deps).size !== deps.length) {
      findings.push({ code: "RELEASE_ITEM_DEPENDENCY_INVALID", severity: "error", itemId: item.id, message: `Release Item ${item.id} dependencies must be unique and sorted` });
    }
    for (const dep of item.dependencies) {
      if (dep === item.id) findings.push({ code: "RELEASE_ITEM_DEPENDENCY_SELF", severity: "error", itemId: item.id, message: `Release Item ${item.id} cannot depend on itself` });
      const target = byId.get(dep);
      if (!target) findings.push({ code: "RELEASE_ITEM_DEPENDENCY_MISSING", severity: "error", itemId: item.id, message: `Release Item ${item.id} depends on missing item ${dep}` });
      else if (target.releaseId !== item.releaseId) findings.push({ code: "RELEASE_ITEM_DEPENDENCY_CROSS_RELEASE", severity: "error", itemId: item.id, message: `Release Item ${item.id} depends on item ${dep} from another release` });
    }
    if (item.status === "SUPERSEDED") {
      const replacementId = item.resolution?.replacementId;
      if (!replacementId) findings.push({ code: "RELEASE_ITEM_REPLACEMENT_MISSING", severity: "error", itemId: item.id, message: `Superseded Release Item ${item.id} requires replacementId` });
      else if (replacementId === item.id) findings.push({ code: "RELEASE_ITEM_REPLACEMENT_SELF", severity: "error", itemId: item.id, message: `Release Item ${item.id} cannot replace itself` });
      else {
        const replacementItem = byId.get(replacementId);
        if (!replacementItem) findings.push({ code: "RELEASE_ITEM_REPLACEMENT_NOT_FOUND", severity: "error", itemId: item.id, message: `Release Item ${item.id} replacement ${replacementId} does not exist` });
        else if (replacementItem.releaseId !== item.releaseId) findings.push({ code: "RELEASE_ITEM_REPLACEMENT_CROSS_RELEASE", severity: "error", itemId: item.id, message: `Release Item ${item.id} replacement ${replacementId} belongs to another Release` });
      }
    } else if (item.resolution?.replacementId) {
      findings.push({ code: "RELEASE_ITEM_REPLACEMENT_UNEXPECTED", severity: "error", itemId: item.id, message: `Release Item ${item.id} status ${item.status} cannot declare replacementId` });
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(item, stack = []) {
    if (visiting.has(item.id)) {
      findings.push({ code: "RELEASE_ITEM_DEPENDENCY_CYCLE", severity: "error", itemId: item.id, message: `Release Item dependency cycle detected: ${[...stack, item.id].join(" -> ")}` });
      return;
    }
    if (visited.has(item.id)) return;
    visiting.add(item.id);
    for (const dep of item.dependencies) {
      const target = byId.get(dep);
      if (target) visit(target, [...stack, item.id]);
    }
    visiting.delete(item.id);
    visited.add(item.id);
  }
  for (const item of [...items].sort((left, right) => left.id.localeCompare(right.id))) visit(item);
  return findings.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`));
}

export function evaluateReleaseItemHealth({ planningRoot, release, item, directoryId = item?.id ?? null }) {
  const dimensions = [];
  const findings = [];
  const addFinding = (entry) => findings.push(entry);
  if (!item) {
    addFinding({ code: "RELEASE_ITEM_SCHEMA_INVALID", severity: "error", dimension: "structure", message: "Release Item cannot be read", evidence: { directoryId } });
    return { aggregate: { status: "invalid", valid: false, blockingFindingCount: 1 }, dimensions: [], completion: { status: "invalid", complete: false, evaluable: false }, readiness: { status: "blocked", releasable: false }, findings };
  }
  const integrity = releaseItemIntegrityFindings(item, { releaseId: release.id, directoryId });
  dimensions.push({ id: "structure", status: integrity.schemaValid && integrity.findings.length === 0 ? "valid" : "invalid", summary: "Release Item schema, identity and revision", evidence: { itemId: item.id }, findings: integrity.findings.map((message) => ({ code: "RELEASE_ITEM_SCHEMA_INVALID", severity: "error", dimension: "structure", message, evidence: { itemId: item.id } })) });
  if (item.releaseId !== release.id) {
    dimensions.push({ id: "parent", status: "invalid", summary: "Release Item parent does not match requested Release", evidence: { releaseId: release.id, itemReleaseId: item.releaseId }, findings: [{ code: "RELEASE_ITEM_PARENT_MISMATCH", severity: "error", dimension: "parent", message: `item.releaseId ${item.releaseId} does not match Release ${release.id}`, evidence: { releaseId: release.id, itemReleaseId: item.releaseId } }] });
  } else {
    const parentIntegrity = releaseIntegrityFindings(release, { directoryId: release.id });
    dimensions.push({ id: "parent", status: parentIntegrity.findings.length === 0 ? "valid" : "invalid", summary: "Release parent resolves and is intact", evidence: { releaseId: release.id, revision: release.audit?.revision ?? null }, findings: parentIntegrity.findings.map((message) => ({ code: "RELEASE_PARENT_INVALID", severity: "error", dimension: "parent", message, evidence: { releaseId: release.id } })) });
  }
  const readmeRelativePath = releaseItemReadmeRelativePath(release.id, item.id);
  let projectionFindings = [];
  try {
    const readmePath = confineWritePath(planningRoot, readmeRelativePath);
    if (!fs.existsSync(readmePath)) projectionFindings.push(`${readmeRelativePath}: projection is missing`);
    else if (!fs.lstatSync(readmePath).isFile() || fs.lstatSync(readmePath).isSymbolicLink()) projectionFindings.push(`${readmeRelativePath}: projection must be a real file`);
    else if (!compareReleaseItemProjection(item, fs.readFileSync(readmePath, "utf8")).equal) projectionFindings.push(`${readmeRelativePath}: projection drift`);
  } catch (error) {
    projectionFindings.push(`${readmeRelativePath}: ${error.message}`);
  }
  dimensions.push({ id: "projection", status: projectionFindings.length === 0 ? "valid" : "failed", summary: "Release Item README projection", evidence: { relativePath: readmeRelativePath }, findings: projectionFindings.map((message) => ({ code: "RELEASE_ITEM_PROJECTION_DRIFT", severity: "error", dimension: "projection", message, evidence: { itemId: item.id } })) });
  let catalog = [];
  let catalogFindings = [];
  try {
    catalog = listReleaseItemDocuments(planningRoot, { releaseId: release.id });
    catalogFindings = releaseItemCatalogFindings(catalog, { releaseId: release.id });
  } catch (error) {
    catalogFindings = [{ code: "RELEASE_ITEM_CATALOG_CORRUPT", severity: "error", itemId: item.id, message: `Release Item catalog is corrupt: ${error.message}` }];
  }
  dimensions.push({ id: "dependencies", status: catalogFindings.length === 0 ? "valid" : "failed", summary: "Release Item dependency graph", evidence: { dependencyCount: item.dependencies.length, catalogCount: catalog.length }, findings: catalogFindings.filter((entry) => !entry.itemId || entry.itemId === item.id || item.dependencies.includes(entry.itemId)).map((entry) => ({ ...entry, dimension: "dependencies", evidence: { itemId: item.id } })) });
  const completion = deriveReleaseItemCompletionFromWorkPackages({ planningRoot, release, item });
  const childFindings = [...(completion.findings || [])];
  if (completion.packageCount === 0) childFindings.push({ code: "WORK_PACKAGE_CATALOG_EMPTY", severity: "error", dimension: "children", message: "Release Item has no Work Packages; empty catalog is not completion evidence", evidence: { itemId: item.id } });
  if (completion.packageCount > 0 && completion.requiredCount === 0) childFindings.push({ code: "WORK_PACKAGE_REQUIRED_EMPTY", severity: "error", dimension: "children", message: "Release Item has no required Work Packages; optional-only catalog is not completion evidence", evidence: { itemId: item.id, packageCount: completion.packageCount } });
  for (const packageId of completion.blockingPackageIds || []) childFindings.push({ code: "WORK_PACKAGE_REQUIRED_INCOMPLETE", severity: "error", dimension: "children", message: `required Work Package ${packageId} is not complete`, evidence: { itemId: item.id, packageId } });
  for (const packageId of completion.invalidPackageIds || []) childFindings.push({ code: "WORK_PACKAGE_INVALID", severity: "error", dimension: "children", message: `Work Package ${packageId} is invalid`, evidence: { itemId: item.id, packageId } });
  const childStatus = completion.status === "invalid" ? "invalid" : childFindings.some((entry) => entry.severity === "error") ? "failed" : completion.status === "unavailable" ? "unavailable" : "valid";
  dimensions.push({ id: "children", status: childStatus, summary: "Work Package catalog and derived completion", evidence: { packageCount: completion.packageCount, requiredCount: completion.requiredCount, requiredCompletedCount: completion.requiredCompletedCount, optionalCount: completion.optionalCount, optionalCompletedCount: completion.optionalCompletedCount }, findings: childFindings });
  for (const dimension of dimensions) findings.push(...dimension.findings);
  const blocking = findings.filter((entry) => entry.severity !== "info" && entry.severity !== "warning");
  const invalid = dimensions.some((entry) => entry.status === "invalid");
  const failed = dimensions.some((entry) => entry.status === "failed");
  return {
    aggregate: { status: invalid ? "invalid" : failed ? "failed" : "partial", valid: !invalid && !failed, blockingFindingCount: blocking.length },
    dimensions: dimensions.sort((left, right) => left.id.localeCompare(right.id)),
    completion,
    readiness: { status: blocking.length > 0 ? "blocked" : "unavailable", releasable: false, blockedDimensions: [...new Set(blocking.map((entry) => entry.dimension))].sort(), unavailableFutureCapabilities: ["tasks", "gate_execution"] },
    findings: findings.sort((left, right) => `${left.dimension}:${left.code}:${left.message}`.localeCompare(`${right.dimension}:${right.code}:${right.message}`))
  };
}

export function assertReleaseParentCanAcceptItem(release) {
  if (release.status !== "DRAFT") {
    const error = new Error(`POLICY_VIOLATION: release-item.create is allowed only for Release DRAFT, got ${release.status}`);
    error.code = "INVALID";
    throw error;
  }
  if (release.finalization?.completed) {
    const error = new Error("POLICY_VIOLATION: finalized Releases cannot accept new Release Items");
    error.code = "INVALID";
    throw error;
  }
}
