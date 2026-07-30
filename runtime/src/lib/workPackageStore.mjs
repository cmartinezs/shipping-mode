import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";
import { isUuidV7 } from "./ids.mjs";
import { validate } from "./schema.mjs";
import { confineWritePath } from "./paths.mjs";
import { revisionHash } from "./canonical.mjs";
import { readOperation, readChangeSet } from "./operationStore.mjs";
import { StateError } from "./errors.mjs";
import { readReleaseFile, releaseIntegrityFindings } from "./releaseStore.mjs";
import { readReleaseItemFile, releaseItemIntegrityFindings } from "./releaseItemStore.mjs";
import { compareWorkPackageProjection } from "./workPackageProjection.mjs";
import { isWorkPackageDisplayId, isWorkPackageDisplayIdForUuid } from "./workPackageIdentity.mjs";
import { buildScopeRefsEvidence } from "./releaseScopeEvidence.mjs";

export function workPackageRelativeDir(releaseId, itemId, packageId) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid release id: ${releaseId}`);
  if (!isUuidV7(itemId)) throw new Error(`invalid Release Item id: ${itemId}`);
  if (!isUuidV7(packageId)) throw new Error(`invalid Work Package id: ${packageId}`);
  return path.join("releases", releaseId, "items", itemId, "work-packages", packageId);
}

export function workPackageYamlRelativePath(releaseId, itemId, packageId) {
  return path.join(workPackageRelativeDir(releaseId, itemId, packageId), "work-package.yml");
}

export function workPackageReadmeRelativePath(releaseId, itemId, packageId) {
  return path.join(workPackageRelativeDir(releaseId, itemId, packageId), "README.md");
}

export function updateWorkPackageRevision(pkgWithoutRevision) {
  const withoutRevision = { ...pkgWithoutRevision, audit: { ...pkgWithoutRevision.audit } };
  delete withoutRevision.audit.revision;
  return { ...withoutRevision, audit: { ...withoutRevision.audit, revision: `sha256:${revisionHash(withoutRevision)}` } };
}

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

function terminalResolutionMatches(pkg) {
  return ["DONE", "CANCELLED", "SUPERSEDED"].includes(pkg.status) && pkg.resolution?.type === pkg.status;
}

export function workPackageIntegrityFindings(pkg, { releaseId = null, itemId = null, directoryId = null } = {}) {
  const findings = [];
  const schemaResult = validate("work-package", pkg);
  if (!schemaResult.valid) {
    for (const error of schemaResult.errors) findings.push(`work-package.yml${error.path}: ${error.message}`);
    return { schemaValid: false, findings };
  }
  for (const [label, values] of [
    ["interfaces", pkg.interfaces.map((entry) => entry.id)],
    ["contracts", pkg.contracts.map((entry) => entry.id)],
    ["guideRefs", pkg.guideRefs.map((entry) => entry.kind)],
    ["gateRequirements", pkg.gateRequirements.map((entry) => entry.id)],
    ["risks", pkg.risks.map((entry) => entry.id)],
    ["blockers", pkg.blockers.map((entry) => entry.id)]
  ]) {
    for (const duplicate of duplicateValues(values)) findings.push(`${label} contains duplicate identity ${duplicate}`);
  }
  const guideKinds = pkg.guideRefs.map((entry) => entry.kind).sort();
  if (guideKinds.length !== 2 || guideKinds[0] !== "task" || guideKinds[1] !== "test") findings.push("guideRefs must contain exactly one task Guide and one test Guide");
  for (const ref of pkg.guideRefs) {
    if (ref.scopeId !== pkg.scopeId) findings.push(`guideRef ${ref.kind} scopeId ${ref.scopeId} does not match Work Package scopeId ${pkg.scopeId}`);
  }
  for (const gate of pkg.gateRequirements) {
    const guide = pkg.guideRefs.find((ref) => ref.kind === gate.source.guideKind);
    if (gate.source.scopeId !== pkg.scopeId || !guide || gate.source.guideId !== guide.id || gate.source.revision !== guide.revision) {
      findings.push(`gateRequirement ${gate.id} source does not match the captured ${gate.source.guideKind} Guide revision`);
    }
  }
  for (const blocker of pkg.blockers) {
    const resolvedFieldCount = [blocker.resolvedAt, blocker.resolvedBy].filter((value) => value !== undefined && value !== null).length;
    if (resolvedFieldCount === 1) findings.push(`blocker ${blocker.id} must set resolvedAt and resolvedBy together`);
  }
  if (directoryId && pkg.id !== directoryId) findings.push(`workPackage.id ${pkg.id} does not match directory ${directoryId}`);
  if (releaseId && pkg.releaseId !== releaseId) findings.push(`workPackage.releaseId ${pkg.releaseId} does not match parent release directory ${releaseId}`);
  if (itemId && pkg.releaseItemId !== itemId) findings.push(`workPackage.releaseItemId ${pkg.releaseItemId} does not match parent item directory ${itemId}`);
  if (!isWorkPackageDisplayIdForUuid(pkg.id, pkg.displayId)) findings.push(`displayId ${pkg.displayId} is not derived from Work Package UUIDv7 ${pkg.id}`);
  const revisionless = { ...pkg, audit: { ...pkg.audit } };
  delete revisionless.audit.revision;
  const expectedRevision = `sha256:${revisionHash(revisionless)}`;
  if (pkg.audit.revision !== expectedRevision) findings.push(`audit.revision does not match canonical Work Package content (expected ${expectedRevision})`);
  return { schemaValid: true, findings };
}

export function readWorkPackageFile(planningRoot, releaseId, itemId, packageId) {
  const relativePath = workPackageYamlRelativePath(releaseId, itemId, packageId);
  const filePath = confineWritePath(planningRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Work Package not found: ${packageId}`);
    error.code = "ENOENT";
    throw error;
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relativePath}: canonical Work Package must be a real file`);
  const workPackage = parseYaml(fs.readFileSync(filePath, "utf8"));
  return { relativePath, filePath, workPackage };
}

export function listWorkPackageRecords(planningRoot, { releaseId = null, itemId = null, includeInvalid = false, requireIntegrity = true } = {}) {
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
    if (!fs.lstatSync(itemsRoot).isDirectory() || fs.lstatSync(itemsRoot).isSymbolicLink()) {
      if (!includeInvalid) throw new Error(`releases/${candidateReleaseId}/items: must be a real directory`);
      continue;
    }
    for (const candidateItemId of fs.readdirSync(itemsRoot).sort()) {
      if (itemId && candidateItemId !== itemId) continue;
      if (!isUuidV7(candidateItemId)) continue;
      const packagesRoot = path.join(itemsRoot, candidateItemId, "work-packages");
      const relativeRoot = path.join("releases", candidateReleaseId, "items", candidateItemId, "work-packages");
      if (!fs.existsSync(packagesRoot)) continue;
      const rootStat = fs.lstatSync(packagesRoot);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        if (!includeInvalid) throw new Error(`${relativeRoot}: must be a real directory`);
        records.push({ releaseId: candidateReleaseId, itemId: candidateItemId, directoryId: null, workPackage: null, invalid: true, findings: ["work-packages catalog must be a real directory"] });
        continue;
      }
      for (const packageId of fs.readdirSync(packagesRoot).sort()) {
        const packageDir = path.join(packagesRoot, packageId);
        const relativeDir = path.join(relativeRoot, packageId);
        const findings = [];
        if (!isUuidV7(packageId)) findings.push(`${relativeDir}: not a valid Work Package id`);
        const stat = fs.lstatSync(packageDir);
        if (stat.isSymbolicLink()) findings.push(`${relativeDir}: symlink entries are not permitted`);
        if (!stat.isDirectory()) findings.push(`${relativeDir}: entry must be a directory`);
        const packagePath = path.join(packageDir, "work-package.yml");
        if (findings.length > 0) {
          if (!includeInvalid) throw new Error(findings.join("; "));
          records.push({ releaseId: candidateReleaseId, itemId: candidateItemId, directoryId: packageId, workPackage: null, invalid: true, findings });
          continue;
        }
        if (!fs.existsSync(packagePath)) {
          const missing = [`${relativeDir}/work-package.yml: required file is missing`];
          if (!includeInvalid) throw new Error(missing[0]);
          records.push({ releaseId: candidateReleaseId, itemId: candidateItemId, directoryId: packageId, workPackage: null, invalid: true, findings: missing });
          continue;
        }
        try {
          const fileStat = fs.lstatSync(packagePath);
          if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error(`${relativeDir}/work-package.yml: canonical Work Package must be a real file`);
          const workPackage = parseYaml(fs.readFileSync(packagePath, "utf8"));
          const integrity = workPackageIntegrityFindings(workPackage, { releaseId: candidateReleaseId, itemId: candidateItemId, directoryId: packageId });
          const invalid = !integrity.schemaValid || (requireIntegrity && integrity.findings.length > 0);
          if (invalid && !includeInvalid) throw new Error(integrity.findings.join("; "));
          records.push({ releaseId: candidateReleaseId, itemId: candidateItemId, directoryId: packageId, workPackage, invalid, findings: integrity.findings });
        } catch (error) {
          if (!includeInvalid) throw error;
          records.push({ releaseId: candidateReleaseId, itemId: candidateItemId, directoryId: packageId, workPackage: null, invalid: true, findings: [error.message] });
        }
      }
    }
  }
  return records;
}

export function listWorkPackageDocuments(planningRoot, options = {}) {
  return listWorkPackageRecords(planningRoot, options).filter((record) => record.workPackage).map((record) => record.workPackage);
}

export function listReservedWorkPackageDocuments(operationsRoot) {
  if (!fs.existsSync(operationsRoot)) return [];
  const reserved = [];
  for (const operationId of fs.readdirSync(operationsRoot).sort()) {
    let operation;
    try {
      operation = readOperation(operationsRoot, operationId);
    } catch (error) {
      throw new StateError(`cannot inspect operation ${operationId} while reserving Work Package identities: ${error.message}`);
    }
    if (operation.kind !== "work-package.create" || ["APPLIED"].includes(operation.status)) continue;
    let changeSet;
    try {
      changeSet = readChangeSet(operationsRoot, operationId);
    } catch (error) {
      throw new StateError(`cannot verify work-package.create identity reservation for operation ${operationId}: ${error.message}`);
    }
    if (changeSet.kind !== "work-package.create" || changeSet.operationId !== operationId) throw new StateError(`work-package.create identity reservation is inconsistent for operation ${operationId}`);
    const packageId = changeSet.payload?.id;
    const displayId = changeSet.payload?.displayId;
    if (!isUuidV7(packageId) || !isWorkPackageDisplayIdForUuid(packageId, displayId)) throw new StateError(`work-package.create identity reservation is invalid for operation ${operationId}`);
    reserved.push({ id: packageId, displayId, releaseId: changeSet.payload.releaseId, releaseItemId: changeSet.payload.releaseItemId });
  }
  return reserved;
}

export function resolveWorkPackageReference(planningRoot, releaseId, itemId, reference) {
  if (isUuidV7(reference)) {
    let read;
    try {
      read = readWorkPackageFile(planningRoot, releaseId, itemId, reference);
    } catch (error) {
      return { status: error.code === "ENOENT" ? "NOT_FOUND" : "INVALID", reference, findings: [error.message] };
    }
    const integrity = workPackageIntegrityFindings(read.workPackage, { releaseId, itemId, directoryId: reference });
    if (integrity.findings.length > 0) return { status: "INVALID", reference, workPackage: read.workPackage, findings: integrity.findings };
    return { status: "FOUND", reference, workPackage: read.workPackage, findings: [] };
  }
  if (!isWorkPackageDisplayId(reference)) {
    return { status: "NOT_FOUND", reference, findings: ["Work Package references must be UUIDv7 or display ID; slug is not accepted"] };
  }
  let records;
  try {
    records = listWorkPackageRecords(planningRoot, { releaseId, itemId, includeInvalid: true, requireIntegrity: false });
  } catch (error) {
    return { status: "INVALID", reference, findings: [`Work Package catalog is invalid: ${error.message}`] };
  }
  const matches = records.filter((record) => record.workPackage?.displayId === reference);
  if (matches.length === 0) return { status: "NOT_FOUND", reference, findings: [`Work Package not found: ${reference}`] };
  if (matches.length > 1) return { status: "AMBIGUOUS", reference, findings: [`display ID ${reference} is ambiguous across ${matches.length} Work Packages`], matches: matches.map((record) => record.directoryId).sort() };
  const match = matches[0];
  const integrity = workPackageIntegrityFindings(match.workPackage, { releaseId, itemId, directoryId: match.directoryId });
  if (match.invalid || integrity.findings.length > 0) return { status: "INVALID", reference, workPackage: match.workPackage, findings: [...new Set([...match.findings, ...integrity.findings])] };
  return { status: "FOUND", reference, workPackage: match.workPackage, findings: [] };
}

export function workPackageCatalogFindings(packages, { releaseId }) {
  const findings = [];
  const byId = new Map();
  const displayOwners = new Map();
  for (const pkg of packages) {
    if (byId.has(pkg.id)) findings.push({ code: "WORK_PACKAGE_ID_DUPLICATE", severity: "error", packageId: pkg.id, message: `Work Package ID ${pkg.id} appears more than once in Release ${releaseId}` });
    else byId.set(pkg.id, pkg);
    const displayOwner = displayOwners.get(pkg.displayId);
    if (displayOwner && displayOwner !== pkg.id) findings.push({ code: "WORK_PACKAGE_DISPLAY_ID_DUPLICATE", severity: "error", packageId: pkg.id, message: `Work Package display ID ${pkg.displayId} is owned by both ${displayOwner} and ${pkg.id}` });
    else displayOwners.set(pkg.displayId, pkg.id);
    if (pkg.releaseId !== releaseId) findings.push({ code: "WORK_PACKAGE_PARENT_MISMATCH", severity: "error", packageId: pkg.id, message: `Work Package ${pkg.id} belongs to ${pkg.releaseId}, not ${releaseId}` });
  }
  for (const pkg of packages) {
    const deps = [...pkg.dependencies].sort();
    if (deps.length !== pkg.dependencies.length || new Set(deps).size !== deps.length) findings.push({ code: "WORK_PACKAGE_DEPENDENCY_INVALID", severity: "error", packageId: pkg.id, message: `Work Package ${pkg.id} dependencies must be unique and sorted` });
    for (const dep of pkg.dependencies) {
      if (dep === pkg.id) findings.push({ code: "WORK_PACKAGE_DEPENDENCY_SELF", severity: "error", packageId: pkg.id, message: `Work Package ${pkg.id} cannot depend on itself` });
      const target = byId.get(dep);
      if (!target) findings.push({ code: "WORK_PACKAGE_DEPENDENCY_MISSING", severity: "error", packageId: pkg.id, message: `Work Package ${pkg.id} depends on missing package ${dep}` });
      else if (target.releaseId !== pkg.releaseId) findings.push({ code: "WORK_PACKAGE_DEPENDENCY_CROSS_RELEASE", severity: "error", packageId: pkg.id, message: `Work Package ${pkg.id} depends on package ${dep} from another Release` });
    }
    if (pkg.status === "SUPERSEDED") {
      const replacementId = pkg.resolution?.replacementId;
      if (!replacementId) findings.push({ code: "WORK_PACKAGE_REPLACEMENT_MISSING", severity: "error", packageId: pkg.id, message: `Superseded Work Package ${pkg.id} requires replacementId` });
      else if (replacementId === pkg.id) findings.push({ code: "WORK_PACKAGE_REPLACEMENT_SELF", severity: "error", packageId: pkg.id, message: `Work Package ${pkg.id} cannot replace itself` });
      else if (!byId.get(replacementId)) findings.push({ code: "WORK_PACKAGE_REPLACEMENT_NOT_FOUND", severity: "error", packageId: pkg.id, message: `Work Package ${pkg.id} replacement ${replacementId} does not exist in Release ${releaseId}` });
    } else if (pkg.resolution?.replacementId) {
      findings.push({ code: "WORK_PACKAGE_REPLACEMENT_UNEXPECTED", severity: "error", packageId: pkg.id, message: `Work Package ${pkg.id} status ${pkg.status} cannot declare replacementId` });
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(pkg, stack = []) {
    if (visiting.has(pkg.id)) {
      findings.push({ code: "WORK_PACKAGE_DEPENDENCY_CYCLE", severity: "error", packageId: pkg.id, message: `Work Package dependency cycle detected: ${[...stack, pkg.id].join(" -> ")}` });
      return;
    }
    if (visited.has(pkg.id)) return;
    visiting.add(pkg.id);
    for (const dep of pkg.dependencies) {
      const target = byId.get(dep);
      if (target) visit(target, [...stack, pkg.id]);
    }
    visiting.delete(pkg.id);
    visited.add(pkg.id);
  }
  for (const pkg of [...packages].sort((left, right) => left.id.localeCompare(right.id))) visit(pkg);
  return findings.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`));
}

function finding({ code, severity = "error", dimension, message, evidence = {} }) {
  return { code, severity, dimension, message, evidence };
}

function dimension(id, status, summary, findings = [], evidence = {}) {
  return { id, status, summary, findings, evidence };
}

export function evaluateWorkPackageHealth({ planningRoot, release, item, workPackage, directoryId = workPackage?.id ?? null }) {
  const dimensions = [];
  const findings = [];
  if (!workPackage) {
    findings.push(finding({ code: "WORK_PACKAGE_SCHEMA_INVALID", dimension: "structure", message: "Work Package cannot be read", evidence: { directoryId } }));
    return { aggregate: { status: "invalid", valid: false, blockingFindingCount: 1 }, dimensions, completionContribution: { status: "invalid", complete: false, evaluable: false }, readiness: { status: "blocked", releasable: false }, findings };
  }
  const integrity = workPackageIntegrityFindings(workPackage, { releaseId: release.id, itemId: item.id, directoryId });
  dimensions.push(dimension("structure", integrity.schemaValid && integrity.findings.length === 0 ? "valid" : "invalid", "Work Package schema, identity and revision", integrity.findings.map((message) => finding({ code: "WORK_PACKAGE_SCHEMA_INVALID", dimension: "structure", message, evidence: { packageId: workPackage.id } })), { packageId: workPackage.id }));

  const parentFindings = [];
  const releaseIntegrity = releaseIntegrityFindings(release, { directoryId: release.id });
  parentFindings.push(...releaseIntegrity.findings.map((message) => finding({ code: "WORK_PACKAGE_RELEASE_PARENT_INVALID", dimension: "parent", message, evidence: { releaseId: release.id } })));
  const itemIntegrity = releaseItemIntegrityFindings(item, { releaseId: release.id, directoryId: item.id });
  parentFindings.push(...itemIntegrity.findings.map((message) => finding({ code: "WORK_PACKAGE_ITEM_PARENT_INVALID", dimension: "parent", message, evidence: { itemId: item.id } })));
  if (workPackage.releaseId !== release.id || workPackage.releaseItemId !== item.id) parentFindings.push(finding({ code: "WORK_PACKAGE_PARENT_MISMATCH", dimension: "parent", message: "Work Package immutable parent fields do not match storage parent", evidence: { releaseId: workPackage.releaseId, itemId: workPackage.releaseItemId } }));
  dimensions.push(dimension("parent", parentFindings.length === 0 ? "valid" : "invalid", "Release and Release Item parents resolve and are intact", parentFindings, { releaseId: release.id, itemId: item.id }));

  let projectionFindings = [];
  const readmeRelativePath = workPackageReadmeRelativePath(release.id, item.id, workPackage.id);
  try {
    const readmePath = confineWritePath(planningRoot, readmeRelativePath);
    if (!fs.existsSync(readmePath)) projectionFindings.push(`${readmeRelativePath}: projection is missing`);
    else if (!fs.lstatSync(readmePath).isFile() || fs.lstatSync(readmePath).isSymbolicLink()) projectionFindings.push(`${readmeRelativePath}: projection must be a real file`);
    else if (!compareWorkPackageProjection(workPackage, fs.readFileSync(readmePath, "utf8")).equal) projectionFindings.push(`${readmeRelativePath}: projection drift`);
  } catch (error) {
    projectionFindings.push(`${readmeRelativePath}: ${error.message}`);
  }
  dimensions.push(dimension("projection", projectionFindings.length === 0 ? "valid" : "failed", "Work Package README projection", projectionFindings.map((message) => finding({ code: "WORK_PACKAGE_PROJECTION_DRIFT", dimension: "projection", message, evidence: { packageId: workPackage.id } })), { relativePath: readmeRelativePath }));

  let scopeFindings = [];
  try {
    const evidence = buildScopeRefsEvidence({ planningRoot, workspaceRoot: path.dirname(planningRoot), scopeIds: [workPackage.scopeId], evaluatedAt: workPackage.audit.createdAt, policyMode: "strict" });
    const currentRefs = evidence.refs[0]?.guides || [];
    for (const ref of workPackage.guideRefs) {
      const current = currentRefs.find((candidate) => candidate.kind === ref.kind);
      if (!current) scopeFindings.push(finding({ code: "WORK_PACKAGE_GUIDE_MISSING", dimension: "scope", message: `${ref.kind} guide no longer resolves`, evidence: { scopeId: workPackage.scopeId, guideKind: ref.kind } }));
      else if (current.revision !== ref.revision || current.contentHash !== ref.contentHash || current.id !== ref.id) scopeFindings.push(finding({ code: "WORK_PACKAGE_GUIDE_STALE", dimension: "scope", message: `${ref.kind} guide changed since Work Package creation`, evidence: { scopeId: workPackage.scopeId, guideKind: ref.kind, expectedRevision: ref.revision, actualRevision: current.revision } }));
      if (!current?.usable) scopeFindings.push(finding({ code: "WORK_PACKAGE_GUIDE_UNUSABLE", dimension: "scope", message: `${ref.kind} guide is not currently usable`, evidence: { scopeId: workPackage.scopeId, guideKind: ref.kind } }));
    }
  } catch (error) {
    scopeFindings = [finding({ code: /schema-invalid|parse|real file|unsafe/i.test(error.message) ? "WORK_PACKAGE_SCOPE_INVALID" : "WORK_PACKAGE_SCOPE_UNAVAILABLE", dimension: "scope", message: `scope ${workPackage.scopeId} cannot be evaluated: ${error.message}`, evidence: { scopeId: workPackage.scopeId } })];
  }
  dimensions.push(dimension("scope", scopeFindings.length === 0 ? "valid" : scopeFindings.some((entry) => entry.code === "WORK_PACKAGE_SCOPE_INVALID") ? "invalid" : "failed", "Scope owner and captured Guide revisions", scopeFindings, { scopeId: workPackage.scopeId, guideRefCount: workPackage.guideRefs.length }));

  let dependencyFindings = [];
  try {
    const catalogPackages = listWorkPackageDocuments(planningRoot, { releaseId: release.id });
    dependencyFindings = workPackageCatalogFindings(catalogPackages, { releaseId: release.id })
      .filter((entry) => !entry.packageId || entry.packageId === workPackage.id || workPackage.dependencies.includes(entry.packageId))
      .map((entry) => finding({ code: entry.code, severity: entry.severity, dimension: "dependencies", message: entry.message, evidence: { packageId: workPackage.id } }));
    for (const dependencyId of workPackage.dependencies) {
      const target = catalogPackages.find((candidate) => candidate.id === dependencyId);
      if (target && !terminalResolutionMatches(target)) {
        dependencyFindings.push(finding({ code: "WORK_PACKAGE_DEPENDENCY_UNSATISFIED", dimension: "dependencies", message: `dependency ${dependencyId} is not terminally resolved`, evidence: { packageId: workPackage.id, dependencyId, dependencyStatus: target.status } }));
      }
    }
  } catch (error) {
    dependencyFindings = [finding({ code: "WORK_PACKAGE_CATALOG_CORRUPT", dimension: "dependencies", message: `Work Package catalog cannot be evaluated: ${error.message}`, evidence: { releaseId: release.id } })];
  }
  dimensions.push(dimension("dependencies", dependencyFindings.length === 0 ? "valid" : "failed", "Work Package dependency graph", dependencyFindings, { dependencyCount: workPackage.dependencies.length }));

  const gateFindings = workPackage.gateRequirements.filter((gate) => gate.required).map((gate) => finding({ code: "CAPABILITY_UNAVAILABLE", severity: "warning", dimension: "gates", message: `gate ${gate.id} is declarative only; execution is deferred`, evidence: { gateId: gate.id, capability: "gate_execution" } }));
  dimensions.push(dimension("gates", gateFindings.length === 0 ? "valid" : "unavailable", "Declarative gate requirements are captured, execution is deferred", gateFindings, { requiredGateCount: workPackage.gateRequirements.filter((gate) => gate.required).length }));

  const openBlockers = (workPackage.blockers || []).filter((blocker) => !blocker.resolvedAt);
  const blockerFindings = openBlockers.map((blocker) => finding({ code: "WORK_PACKAGE_BLOCKER_OPEN", dimension: "blockers", message: `open ${blocker.severity} blocker: ${blocker.summary}`, evidence: { blockerId: blocker.id } }));
  const riskFindings = (workPackage.risks || []).map((risk) => finding({ code: "WORK_PACKAGE_RISK_OPEN", severity: "warning", dimension: "blockers", message: `${risk.level} risk: ${risk.summary}`, evidence: { riskId: risk.id } }));
  dimensions.push(dimension("blockers", blockerFindings.length === 0 ? "valid" : "failed", "Blockers and risks", [...blockerFindings, ...riskFindings], { openBlockerCount: openBlockers.length, riskCount: workPackage.risks.length }));

  dimensions.push(dimension("tasks", "unavailable", "Task capability is deferred", [finding({ code: "CAPABILITY_UNAVAILABLE", severity: "info", dimension: "tasks", message: "Task capability is deferred to Plan 3", evidence: { capability: "tasks" } })], { unavailableCapabilities: ["tasks"] }));

  for (const entry of dimensions) findings.push(...entry.findings);
  const blocking = findings.filter((entry) => entry.severity !== "info" && entry.severity !== "warning");
  const invalid = dimensions.some((entry) => entry.status === "invalid");
  const failed = dimensions.some((entry) => entry.status === "failed");
  const unavailable = dimensions.some((entry) => entry.status === "unavailable" && entry.id !== "tasks");
  const structurallyComplete = terminalResolutionMatches(workPackage);
  const complete = !invalid && !failed && !unavailable && structurallyComplete;
  return {
    aggregate: { status: invalid ? "invalid" : failed ? "failed" : unavailable ? "unavailable" : "partial", valid: !invalid && !failed && !unavailable, blockingFindingCount: blocking.length },
    dimensions: dimensions.sort((left, right) => left.id.localeCompare(right.id)),
    completionContribution: { status: invalid ? "invalid" : unavailable ? "unavailable" : complete ? "complete" : "incomplete", complete, evaluable: !invalid && !unavailable },
    readiness: { status: blocking.length > 0 ? "blocked" : unavailable ? "unavailable" : "available", releasable: false, blockedDimensions: [...new Set(blocking.map((entry) => entry.dimension))].sort(), unavailableFutureCapabilities: ["tasks", "gate_execution"] },
    findings: findings.sort((left, right) => `${left.dimension}:${left.code}:${left.message}`.localeCompare(`${right.dimension}:${right.code}:${right.message}`))
  };
}

export function deriveReleaseItemCompletionFromWorkPackages({ planningRoot, release, item }) {
  let records;
  try {
    records = listWorkPackageRecords(planningRoot, { releaseId: release.id, itemId: item.id, includeInvalid: true, requireIntegrity: false });
  } catch (error) {
    return { status: "invalid", complete: false, evaluable: false, packageCount: 0, requiredCount: 0, requiredCompletedCount: 0, optionalCount: 0, optionalCompletedCount: 0, blockingPackageIds: [], invalidPackageIds: [], unavailableCapabilities: [], findings: [{ code: "WORK_PACKAGE_CATALOG_CORRUPT", severity: "error", dimension: "children", message: error.message, evidence: { itemId: item.id } }] };
  }
  const findings = [];
  const packages = [];
  const invalidPackageIds = [];
  const blockingPackageIds = [];
  const unavailableCapabilities = new Set();
  for (const record of records) {
    if (!record.workPackage) {
      invalidPackageIds.push(record.directoryId);
      findings.push(...record.findings.map((message) => finding({ code: "WORK_PACKAGE_INVALID", dimension: "children", message, evidence: { packageId: record.directoryId } })));
      continue;
    }
    const health = evaluateWorkPackageHealth({ planningRoot, release, item, workPackage: record.workPackage, directoryId: record.directoryId });
    packages.push({ workPackage: record.workPackage, health });
    if (health.aggregate.status === "invalid") invalidPackageIds.push(record.workPackage.id);
    if (record.workPackage.commitment === "required" && !health.completionContribution.complete) blockingPackageIds.push(record.workPackage.id);
    findings.push(...health.findings.filter((entry) => entry.severity !== "info" && entry.severity !== "warning").map((entry) => ({ ...entry, dimension: "children", message: `${record.workPackage.id}: ${entry.message}`, evidence: { ...entry.evidence, itemId: item.id, packageId: record.workPackage.id } })));
    for (const entry of health.findings) {
      if (entry.code === "CAPABILITY_UNAVAILABLE") unavailableCapabilities.add(entry.evidence.capability || entry.dimension);
    }
  }
  const required = packages.filter((entry) => entry.workPackage.commitment === "required");
  const optional = packages.filter((entry) => entry.workPackage.commitment === "optional");
  const requiredCompleted = required.filter((entry) => entry.health.completionContribution.complete);
  const optionalCompleted = optional.filter((entry) => entry.health.completionContribution.complete);
  const hasUnavailableRequired = required.some((entry) => entry.health.completionContribution.status === "unavailable");
  const complete = required.length > 0 && requiredCompleted.length === required.length && invalidPackageIds.length === 0 && !hasUnavailableRequired;
  return {
    status: invalidPackageIds.length > 0 ? "invalid" : hasUnavailableRequired ? "unavailable" : complete ? "complete" : "incomplete",
    complete,
    evaluable: invalidPackageIds.length === 0 && !hasUnavailableRequired,
    packageCount: packages.length + invalidPackageIds.length,
    requiredCount: required.length,
    requiredCompletedCount: requiredCompleted.length,
    optionalCount: optional.length,
    optionalCompletedCount: optionalCompleted.length,
    blockingPackageIds: [...new Set(blockingPackageIds)].sort(),
    invalidPackageIds: [...new Set(invalidPackageIds.filter(Boolean))].sort(),
    unavailableCapabilities: [...unavailableCapabilities].sort(),
    findings: findings.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`))
  };
}

export function assertReleaseParentCanAcceptWorkPackage(release) {
  if (["RELEASED", "CANCELLED"].includes(release.status)) {
    const error = new Error(`POLICY_VIOLATION: work-package.create requires a non-terminal Release, got ${release.status}`);
    error.code = "INVALID";
    throw error;
  }
  if (release.finalization?.completed) {
    const error = new Error("POLICY_VIOLATION: finalized Releases cannot accept new Work Packages");
    error.code = "INVALID";
    throw error;
  }
}

export function assertReleaseItemCanAcceptWorkPackage(item) {
  if (item.status !== "DRAFT") {
    const error = new Error(`POLICY_VIOLATION: work-package.create requires a non-terminal Release Item, got ${item.status}`);
    error.code = "INVALID";
    throw error;
  }
}
