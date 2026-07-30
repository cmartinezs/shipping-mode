import fs from "node:fs";
import path from "node:path";
import { validate } from "./schema.mjs";
import { parseYaml } from "./yaml.mjs";
import { confineWritePath } from "./paths.mjs";
import { revisionHash } from "./canonical.mjs";
import { isUuidV7 } from "./ids.mjs";
import { isReleaseDisplayIdForUuid } from "./releaseIdentity.mjs";
import { compareReleaseReadme } from "./releaseProjection.mjs";
import { releaseCatalogPolicyFindings, laneConfigFindings } from "./releasePolicy.mjs";
import { listReleaseDocuments } from "./releaseStore.mjs";
import { listReleaseItemDocuments, listReleaseItemRecords, releaseItemCatalogFindings, evaluateReleaseItemHealth } from "./releaseItemStore.mjs";
import { readCatalogEntry } from "./operationalCatalog.mjs";
import { buildScopeRefsEvidence } from "./releaseScopeEvidence.mjs";

export const RELEASE_HEALTH_FINDING_CODES = Object.freeze({
  SCHEMA_INVALID: "RELEASE_SCHEMA_INVALID",
  REVISION_INVALID: "RELEASE_REVISION_INVALID",
  ID_DIRECTORY_MISMATCH: "RELEASE_ID_DIRECTORY_MISMATCH",
  DISPLAY_ID_INVALID: "RELEASE_DISPLAY_ID_INVALID",
  PROJECTION_DRIFT: "RELEASE_PROJECTION_DRIFT",
  LANE_INVALID: "LANE_INVALID",
  POLICY_VIOLATION: "POLICY_VIOLATION",
  CAPABILITY_UNAVAILABLE: "CAPABILITY_UNAVAILABLE",
  INVALID_REFERENCE: "INVALID_REFERENCE",
  CATALOG_CORRUPT: "CATALOG_CORRUPT",
  GUIDE_EVIDENCE_STALE: "GUIDE_EVIDENCE_STALE",
  SCOPE_NOT_READY: "SCOPE_NOT_READY",
  DEPLOYMENT_EVIDENCE_MISSING: "DEPLOYMENT_EVIDENCE_MISSING",
  DEPLOYMENT_EVIDENCE_INVALID: "DEPLOYMENT_EVIDENCE_INVALID",
  BLOCKER_OPEN: "BLOCKER_OPEN",
  RISK_OPEN: "RISK_OPEN",
  FINALIZATION_INVALID: "FINALIZATION_INVALID",
  RELEASE_ITEMS_EMPTY: "RELEASE_ITEMS_EMPTY",
  RELEASE_ITEM_INVALID: "RELEASE_ITEM_INVALID"
});

const FUTURE_CAPABILITIES = Object.freeze(["work_packages", "tasks", "gates"]);

function finding({ code, severity = "error", dimension, message, evidence = {} }) {
  return { code, severity, dimension, message, evidence };
}

function dimension(id, status, summary, findings = [], evidence = {}) {
  return { id, status, summary, evidence, findings };
}

function readConfig(planningRoot) {
  const relativePath = "config.yml";
  let configPath;
  try {
    configPath = confineWritePath(planningRoot, relativePath);
  } catch (error) {
    return { status: "corrupt", config: null, revision: null, findings: [finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "lane", message: `Project Context config.yml path is unsafe: ${error.message}`, evidence: { relativePath } })] };
  }
  if (!fs.existsSync(configPath)) {
    return { status: "missing", config: null, revision: null, findings: [finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "lane", message: "Project Context config.yml is missing", evidence: { relativePath } })] };
  }
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { status: "corrupt", config: null, revision: null, findings: [finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "lane", message: "Project Context config.yml must be a real file", evidence: { relativePath } })] };
  }
  try {
    const config = parseYaml(fs.readFileSync(configPath, "utf8"));
    const schema = validate("config", config);
    if (!schema.valid) {
      return {
        status: "invalid",
        config,
        revision: null,
        findings: schema.errors.map((error) => finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "lane", message: `config.yml${error.path}: ${error.message}`, evidence: { relativePath } }))
      };
    }
    return { status: "found", config, revision: revisionHash(config), findings: [] };
  } catch (error) {
    return { status: "corrupt", config: null, revision: null, findings: [finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "lane", message: `config.yml failed to parse: ${error.message}`, evidence: { relativePath } })] };
  }
}

function projectionDimension(planningRoot, release) {
  const relativePath = path.join("releases", release.id, "README.md");
  let readmePath;
  try {
    readmePath = confineWritePath(planningRoot, relativePath);
  } catch (error) {
    const f = finding({ code: RELEASE_HEALTH_FINDING_CODES.PROJECTION_DRIFT, dimension: "projection", message: `${relativePath}: ${error.message}`, evidence: { relativePath } });
    return dimension("projection", "invalid", "Release README projection path is unsafe", [f], { relativePath });
  }
  if (!fs.existsSync(readmePath)) {
    const f = finding({ code: RELEASE_HEALTH_FINDING_CODES.PROJECTION_DRIFT, dimension: "projection", message: `${relativePath}: projection is missing`, evidence: { relativePath } });
    return dimension("projection", "failed", "Release README projection is missing", [f], { relativePath });
  }
  const stat = fs.lstatSync(readmePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const f = finding({ code: RELEASE_HEALTH_FINDING_CODES.PROJECTION_DRIFT, dimension: "projection", message: `${relativePath}: projection must be a real file`, evidence: { relativePath } });
    return dimension("projection", "invalid", "Release README projection is unsafe", [f], { relativePath });
  }
  const comparison = compareReleaseReadme(release, fs.readFileSync(readmePath, "utf8"));
  if (!comparison.equal) {
    const f = finding({ code: RELEASE_HEALTH_FINDING_CODES.PROJECTION_DRIFT, dimension: "projection", message: `${relativePath}: projection drift`, evidence: { relativePath } });
    return dimension("projection", "failed", "Release README projection has drifted", [f], { relativePath });
  }
  return dimension("projection", "valid", "Release README projection matches release.yml", [], { relativePath });
}

function structuralDimensions(release, directoryId) {
  const schema = validate("release", release);
  if (!schema.valid) {
    return [dimension("structure", "invalid", "release.yml is schema-invalid", schema.errors.map((error) => finding({ code: RELEASE_HEALTH_FINDING_CODES.SCHEMA_INVALID, dimension: "structure", message: `release.yml${error.path}: ${error.message}` })), { schemaValid: false })];
  }
  const dimensions = [dimension("structure", "valid", "release.yml is schema-valid", [], { schemaValid: true })];
  if (directoryId && release.id !== directoryId) {
    dimensions.push(dimension("identity", "invalid", "Release directory UUID does not match release.id", [finding({ code: RELEASE_HEALTH_FINDING_CODES.ID_DIRECTORY_MISMATCH, dimension: "identity", message: `release.id ${release.id} does not match directory ${directoryId}`, evidence: { directoryId, releaseId: release.id } })], { directoryId, releaseId: release.id }));
  } else if (!isUuidV7(release.id)) {
    dimensions.push(dimension("identity", "invalid", "release.id is not a UUIDv7", [finding({ code: RELEASE_HEALTH_FINDING_CODES.ID_DIRECTORY_MISMATCH, dimension: "identity", message: `release.id is not UUIDv7: ${release.id}` })], { releaseId: release.id }));
  } else {
    dimensions.push(dimension("identity", "valid", "Release directory and UUID identity are consistent", [], { directoryId: directoryId ?? release.id, releaseId: release.id }));
  }
  if (!isReleaseDisplayIdForUuid(release.id, release.displayId)) {
    dimensions.push(dimension("displayId", "invalid", "Release display ID is not derived from release.id", [finding({ code: RELEASE_HEALTH_FINDING_CODES.DISPLAY_ID_INVALID, dimension: "displayId", message: `displayId ${release.displayId} is not derived from release.id ${release.id}`, evidence: { releaseId: release.id, displayId: release.displayId } })], { releaseId: release.id, displayId: release.displayId }));
  } else {
    dimensions.push(dimension("displayId", "valid", "Release display ID is derived and unambiguous for this Release", [], { displayId: release.displayId }));
  }
  const revisionless = { ...release, audit: { ...release.audit } };
  delete revisionless.audit.revision;
  const expectedRevision = `sha256:${revisionHash(revisionless)}`;
  if (release.audit.revision !== expectedRevision) {
    dimensions.push(dimension("revision", "invalid", "Release audit revision does not match canonical content", [finding({ code: RELEASE_HEALTH_FINDING_CODES.REVISION_INVALID, dimension: "revision", message: `audit.revision does not match canonical release content`, evidence: { expectedRevision, actualRevision: release.audit.revision } })], { expectedRevision, actualRevision: release.audit.revision }));
  } else {
    dimensions.push(dimension("revision", "valid", "Release audit revision matches canonical content", [], { revision: release.audit.revision }));
  }
  return dimensions;
}

function laneDimension(configRead, release) {
  if (configRead.status !== "found") return dimension("lane", "invalid", "Release lane cannot be evaluated without a valid Project Context", configRead.findings, {});
  const findings = laneConfigFindings(configRead.config, release.lane.id).map((entry) => finding({ code: entry.code, dimension: "lane", message: entry.message, evidence: { laneId: release.lane.id } }));
  return findings.length === 0
    ? dimension("lane", "valid", "Release lane is configured", [], { laneId: release.lane.id, configRevision: configRead.revision })
    : dimension("lane", "failed", "Release lane is not configured consistently", findings, { laneId: release.lane.id, configRevision: configRead.revision });
}

function policyDimension(planningRoot, release) {
  try {
    const releases = listReleaseDocuments(planningRoot, { includeInvalid: false });
    const findings = releaseCatalogPolicyFindings(releases).map((entry) => finding({ code: entry.code, dimension: "policy", message: entry.message, evidence: { releaseId: release.id } }));
    return findings.length === 0
      ? dimension("policy", "valid", "Release policy catalog is globally consistent", [], { mode: release.policy.mode })
      : dimension("policy", "failed", "Release policy catalog has consistency findings", findings, { mode: release.policy.mode });
  } catch (error) {
    const f = finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "policy", message: `release catalog cannot be evaluated: ${error.message}` });
    return dimension("policy", "invalid", "Release policy catalog is corrupt", [f], { mode: release.policy?.mode ?? null });
  }
}

function scopeDimension(planningRoot, release) {
  if (release.scopeRefs.length === 0) {
    const f = finding({ code: RELEASE_HEALTH_FINDING_CODES.INVALID_REFERENCE, dimension: "scope", message: "Release has no scopeRefs; an empty list is not completion evidence", evidence: { scopeRefCount: 0 } });
    return dimension("scope", "failed", "No Release scope evidence is selected", [f], { scopeRefCount: 0, evidenceByScope: {} });
  }
  const findings = [];
  const evidenceByScope = {};
  for (const scopeRef of [...release.scopeRefs].sort((left, right) => left.scopeId.localeCompare(right.scopeId))) {
    try {
      const current = buildScopeRefsEvidence({
        planningRoot,
        workspaceRoot: path.dirname(planningRoot),
        scopeIds: [scopeRef.scopeId],
        evaluatedAt: scopeRef.evaluatedAt,
        policyMode: scopeRef.readiness.policyMode
      });
      const currentRef = current.refs[0];
      const persistedEvidenceRevision = revisionHash(scopeRef);
      const currentEvidenceRevision = revisionHash(currentRef);
      evidenceByScope[scopeRef.scopeId] = {
        persistedEvidenceRevision,
        currentEvidenceRevision,
        observedRevisions: current.observedRevisions
      };
      if (persistedEvidenceRevision !== currentEvidenceRevision) {
        findings.push(finding({
          code: RELEASE_HEALTH_FINDING_CODES.GUIDE_EVIDENCE_STALE,
          dimension: "scope",
          message: `scopeRef ${scopeRef.scopeId} guide evidence is stale`,
          evidence: { scopeId: scopeRef.scopeId, persistedEvidenceRevision, currentEvidenceRevision, observedRevisions: current.observedRevisions }
        }));
      }
      if (!currentRef.readiness.ready) {
        findings.push(finding({
          code: RELEASE_HEALTH_FINDING_CODES.SCOPE_NOT_READY,
          dimension: "scope",
          message: `scopeRef ${scopeRef.scopeId} is not currently ready`,
          evidence: { scopeId: scopeRef.scopeId, findings: currentRef.findings }
        }));
      }
    } catch (error) {
      const corrupt = /schema-invalid|failed to parse|real file|catalog|unsafe/i.test(error.message);
      findings.push(finding({
        code: corrupt ? RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT : RELEASE_HEALTH_FINDING_CODES.INVALID_REFERENCE,
        dimension: "scope",
        message: `scopeRef ${scopeRef.scopeId} cannot be reevaluated: ${error.message}`,
        evidence: { scopeId: scopeRef.scopeId }
      }));
    }
  }
  const invalid = findings.some((entry) => entry.code === RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT);
  return findings.length === 0
    ? dimension("scope", "valid", "Release scope evidence is current and ready", [], { scopeRefCount: release.scopeRefs.length, evidenceByScope })
    : dimension("scope", invalid ? "invalid" : "failed", "Release scope evidence is stale, missing or not ready", findings, { scopeRefCount: release.scopeRefs.length, evidenceByScope });
}

function refsDimension(planningRoot, release) {
  const findings = [];
  const revisions = { executionContexts: {}, environments: {} };
  for (const id of [...(release.executionContextRefs || [])].sort()) {
    try {
      const result = readCatalogEntry(planningRoot, "executionContext", id);
      if (result.status !== "FOUND") findings.push(...result.findings.map((entry) => finding({ code: entry.code, dimension: "refs", message: entry.message, evidence: { executionContextRef: id } })));
      else revisions.executionContexts[id] = result.revision;
    } catch (error) {
      findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "refs", message: `executionContext ${id} cannot be read: ${error.message}`, evidence: { executionContextRef: id } }));
    }
  }
  for (const id of [...(release.environmentRefs || [])].sort()) {
    try {
      const result = readCatalogEntry(planningRoot, "environment", id);
      if (result.status !== "FOUND") {
        findings.push(...result.findings.map((entry) => finding({ code: entry.code, dimension: "refs", message: entry.message, evidence: { environmentRef: id } })));
      } else {
        revisions.environments[id] = result.revision;
        if (Array.isArray(result.entry.laneRefs) && result.entry.laneRefs.length > 0 && !result.entry.laneRefs.includes(release.lane.id)) {
          findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.POLICY_VIOLATION, dimension: "refs", message: `environment ${id} is not compatible with lane ${release.lane.id}`, evidence: { environmentRef: id, laneId: release.lane.id } }));
        }
      }
    } catch (error) {
      findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "refs", message: `environment ${id} cannot be read: ${error.message}`, evidence: { environmentRef: id } }));
    }
  }
  if ((release.executionContextRefs || []).length === 0 && (release.environmentRefs || []).length === 0) {
    return dimension("refs", "unavailable", "No operational refs are selected for this Release", [finding({ code: RELEASE_HEALTH_FINDING_CODES.CAPABILITY_UNAVAILABLE, severity: "warning", dimension: "refs", message: "Execution Context and Environment refs are empty; operational evidence cannot be fully evaluated" })], { executionContextRefCount: 0, environmentRefCount: 0, revisions });
  }
  return findings.length === 0
    ? dimension("refs", "valid", "Release operational refs resolve", [], { executionContextRefCount: release.executionContextRefs.length, environmentRefCount: release.environmentRefs.length, revisions })
    : dimension("refs", findings.some((entry) => entry.code === RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT) ? "invalid" : "failed", "Release operational refs have findings", findings, { executionContextRefCount: release.executionContextRefs.length, environmentRefCount: release.environmentRefs.length, revisions });
}

function deploymentDimension(planningRoot, release) {
  if (release.deploymentEvents.length === 0) {
    const f = finding({ code: RELEASE_HEALTH_FINDING_CODES.DEPLOYMENT_EVIDENCE_MISSING, dimension: "deployment", message: "Release has no deployment evidence", evidence: { deploymentEventCount: 0 } });
    return dimension("deployment", "failed", "No deployment evidence is recorded", [f], { deploymentEventCount: 0, revisions: { executionContexts: {}, environments: {} } });
  }
  const findings = [];
  const revisions = { executionContexts: {}, environments: {} };
  let succeededWithEvidence = false;
  for (const event of [...release.deploymentEvents].sort((left, right) => left.id.localeCompare(right.id))) {
    if (event.releaseId !== release.id) {
      findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.DEPLOYMENT_EVIDENCE_INVALID, dimension: "deployment", message: `deployment event ${event.id} releaseId does not match Release`, evidence: { eventId: event.id, releaseId: event.releaseId } }));
    }
    try {
      const environment = readCatalogEntry(planningRoot, "environment", event.environmentRef);
      if (environment.status !== "FOUND") {
        findings.push(...environment.findings.map((entry) => finding({ code: entry.code, dimension: "deployment", message: entry.message, evidence: { eventId: event.id, environmentRef: event.environmentRef } })));
      } else {
        revisions.environments[event.environmentRef] = environment.revision;
        if (Array.isArray(environment.entry.laneRefs) && environment.entry.laneRefs.length > 0 && !environment.entry.laneRefs.includes(release.lane.id)) {
          findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.POLICY_VIOLATION, dimension: "deployment", message: `deployment event ${event.id} environment ${event.environmentRef} is not compatible with lane ${release.lane.id}`, evidence: { eventId: event.id, environmentRef: event.environmentRef, laneId: release.lane.id } }));
        }
      }
    } catch (error) {
      findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "deployment", message: `deployment event ${event.id} environment cannot be read: ${error.message}`, evidence: { eventId: event.id, environmentRef: event.environmentRef } }));
    }
    if (event.executionContextRef) {
      try {
        const executionContext = readCatalogEntry(planningRoot, "executionContext", event.executionContextRef);
        if (executionContext.status !== "FOUND") findings.push(...executionContext.findings.map((entry) => finding({ code: entry.code, dimension: "deployment", message: entry.message, evidence: { eventId: event.id, executionContextRef: event.executionContextRef } })));
        else revisions.executionContexts[event.executionContextRef] = executionContext.revision;
      } catch (error) {
        findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "deployment", message: `deployment event ${event.id} execution context cannot be read: ${error.message}`, evidence: { eventId: event.id, executionContextRef: event.executionContextRef } }));
      }
    }
    if (event.status === "succeeded" && ((event.evidenceRefs || []).length > 0 || (event.artifactRefs || []).length > 0)) succeededWithEvidence = true;
  }
  if (!succeededWithEvidence) {
    findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.DEPLOYMENT_EVIDENCE_MISSING, dimension: "deployment", message: "Release has no succeeded deployment event with artifactRefs or evidenceRefs", evidence: { deploymentEventCount: release.deploymentEvents.length } }));
  }
  return findings.length === 0
    ? dimension("deployment", "valid", "Release has succeeded deployment evidence", [], { deploymentEventCount: release.deploymentEvents.length, revisions })
    : dimension("deployment", findings.some((entry) => entry.code === RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT) ? "invalid" : "failed", "Release deployment evidence has findings", findings, { deploymentEventCount: release.deploymentEvents.length, revisions });
}

function blockerRiskDimension(release) {
  const openBlockers = (release.blockers || []).filter((blocker) => !blocker.resolvedAt);
  const risks = release.risks || [];
  const findings = [
    ...openBlockers.map((blocker) => finding({ code: RELEASE_HEALTH_FINDING_CODES.BLOCKER_OPEN, dimension: "blockers", message: `open ${blocker.severity} blocker: ${blocker.summary}`, evidence: { blockerId: blocker.id, severity: blocker.severity } })),
    ...risks.map((risk) => finding({ code: RELEASE_HEALTH_FINDING_CODES.RISK_OPEN, severity: "warning", dimension: "blockers", message: `${risk.level} risk: ${risk.summary}`, evidence: { riskId: risk.id, level: risk.level } }))
  ];
  return openBlockers.length === 0
    ? dimension("blockers", "valid", risks.length === 0 ? "No open blockers or risks are recorded" : "No open blockers are recorded; risks are visible", findings, { openBlockerCount: 0, riskCount: risks.length })
    : dimension("blockers", "failed", "Open blockers prevent readiness/finalization", findings, { openBlockerCount: openBlockers.length, riskCount: risks.length });
}

function releaseItemsDimension(planningRoot, release) {
  let records;
  try {
    records = listReleaseItemRecords(planningRoot, { releaseId: release.id, includeInvalid: true, requireIntegrity: false });
  } catch (error) {
    const f = finding({ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, dimension: "releaseItems", message: `Release Item catalog cannot be read: ${error.message}`, evidence: { releaseId: release.id } });
    return dimension("releaseItems", "invalid", "Release Item catalog is corrupt", [f], { itemCount: 0, itemRefs: release.itemRefs });
  }
  const validItems = [];
  const findings = [];
  for (const record of records) {
    if (!record.item) {
      findings.push(...record.findings.map((message) => finding({ code: RELEASE_HEALTH_FINDING_CODES.RELEASE_ITEM_INVALID, dimension: "releaseItems", message, evidence: { releaseId: release.id, itemId: record.directoryId } })));
      continue;
    }
    const itemHealth = evaluateReleaseItemHealth({ planningRoot, release, item: record.item, directoryId: record.directoryId });
    if (!itemHealth.aggregate.valid) {
      findings.push(...itemHealth.findings.filter((entry) => entry.severity !== "info").map((entry) => finding({ code: entry.code, severity: entry.severity, dimension: "releaseItems", message: `${record.item.id}: ${entry.message}`, evidence: { releaseId: release.id, itemId: record.item.id } })));
    }
    validItems.push(record.item);
  }
  let graphFindings = [];
  try {
    graphFindings = releaseItemCatalogFindings(listReleaseItemDocuments(planningRoot, { releaseId: release.id }), { releaseId: release.id });
  } catch (error) {
    graphFindings = [{ code: RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT, severity: "error", message: `Release Item catalog cannot be evaluated: ${error.message}` }];
  }
  findings.push(...graphFindings.map((entry) => finding({ code: entry.code, severity: entry.severity, dimension: "releaseItems", message: entry.message, evidence: { releaseId: release.id, itemId: entry.itemId || null } })));
  for (const itemRef of release.itemRefs || []) {
    if (!validItems.some((item) => item.id === itemRef)) {
      findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.INVALID_REFERENCE, dimension: "releaseItems", message: `release.itemRefs contains ${itemRef}, but no canonical Release Item exists under items/`, evidence: { releaseId: release.id, itemRef } }));
    }
  }
  if (validItems.length === 0 && findings.length === 0) {
    findings.push(finding({ code: RELEASE_HEALTH_FINDING_CODES.RELEASE_ITEMS_EMPTY, dimension: "releaseItems", message: "Release has no canonical Release Items; empty catalog is not completion evidence", evidence: { releaseId: release.id, itemCount: 0 } }));
  }
  if (findings.length > 0) {
    const invalid = findings.some((entry) => entry.code === RELEASE_HEALTH_FINDING_CODES.CATALOG_CORRUPT || entry.code === RELEASE_HEALTH_FINDING_CODES.RELEASE_ITEM_INVALID);
    return dimension("releaseItems", invalid ? "invalid" : "failed", "Release Item catalog has findings", findings, { itemCount: validItems.length, itemRefs: release.itemRefs });
  }
  return dimension("releaseItems", "valid", "Canonical Release Items resolve and their dependency graph is valid", [], { itemCount: validItems.length, itemIds: validItems.map((item) => item.id).sort(), itemRefs: release.itemRefs });
}

function finalizationDimension(release) {
  const finalized = release.finalization.completed === true;
  const invalid = finalized && (!release.finalization.completedAt || !release.finalization.completedBy);
  if (invalid) {
    return dimension("finalization", "invalid", "Release finalization metadata is inconsistent", [finding({ code: RELEASE_HEALTH_FINDING_CODES.FINALIZATION_INVALID, dimension: "finalization", message: "completed finalization must include completedAt and completedBy" })], { completed: finalized });
  }
  return dimension("finalization", "valid", finalized ? "Release finalization metadata is complete" : "Release finalization metadata is not completed", [], { completed: finalized, retrospectiveStatus: release.finalization.retrospectiveStatus });
}

function futureCapabilityDimension(release) {
  const findings = [finding({ code: RELEASE_HEALTH_FINDING_CODES.CAPABILITY_UNAVAILABLE, severity: "info", dimension: "futureCapabilities", message: "Work Packages, Tasks and gates are deferred capabilities", evidence: { unavailableCapabilities: FUTURE_CAPABILITIES, itemRefCount: release.itemRefs.length } })];
  return dimension("futureCapabilities", "unavailable", "Corte 3 Plan 1 does not evaluate Work Packages, Tasks or gates", findings, { unavailableCapabilities: FUTURE_CAPABILITIES, itemRefCount: release.itemRefs.length });
}

function summarize(dimensions) {
  const blocking = dimensions.flatMap((entry) => entry.findings.filter((f) => f.severity !== "info" && f.severity !== "warning"));
  const invalid = dimensions.some((entry) => entry.status === "invalid");
  const failed = dimensions.some((entry) => entry.status === "failed");
  const unavailable = dimensions.filter((entry) => entry.status === "unavailable");
  const unavailableCurrent = unavailable.filter((entry) => entry.id !== "futureCapabilities");
  return {
    status: invalid ? "invalid" : failed ? "failed" : unavailable.length > 0 ? "partial" : "valid",
    valid: !invalid && !failed && unavailableCurrent.length === 0,
    blockingFindingCount: blocking.length,
    unavailableDimensionCount: unavailable.length,
    unavailableCurrentDimensionCount: unavailableCurrent.length
  };
}

function readiness(dimensions, release) {
  const blocking = dimensions.flatMap((entry) => entry.findings.filter((f) => f.severity !== "info" && f.severity !== "warning"));
  const failedCurrent = dimensions.filter((entry) => ["invalid", "failed"].includes(entry.status)).map((entry) => entry.id);
  const unavailableCurrent = dimensions.filter((entry) => entry.status === "unavailable" && entry.id !== "futureCapabilities").map((entry) => entry.id);
  const blockedDimensions = [...new Set([...failedCurrent, ...unavailableCurrent])].sort();
  return {
    status: failedCurrent.length > 0 ? "blocked" : unavailableCurrent.length > 0 ? "unavailable" : "available",
    releasable: blockedDimensions.length === 0,
    lifecycle: release.status,
    blockedDimensions,
    unavailableDimensions: unavailableCurrent.sort(),
    blockingFindings: blocking.map((entry) => entry.code),
    unavailableFutureCapabilities: FUTURE_CAPABILITIES
  };
}

function completion(release) {
  return {
    status: "unavailable",
    complete: false,
    evaluable: false,
    itemRefCount: release.itemRefs.length,
    unavailableCapabilities: FUTURE_CAPABILITIES,
    reason: "Release Items are evaluable, but Work Packages, Tasks and gates are deferred; empty itemRefs is not completion evidence"
  };
}

export function evaluateReleaseHealth({ planningRoot, release, directoryId = null }) {
  let dimensions = structuralDimensions(release, directoryId);
  const schemaInvalid = dimensions.some((entry) => entry.id === "structure" && entry.status === "invalid");
  if (!schemaInvalid) {
    const config = readConfig(planningRoot);
    dimensions = [
      ...dimensions,
      projectionDimension(planningRoot, release),
      laneDimension(config, release),
      policyDimension(planningRoot, release),
      scopeDimension(planningRoot, release),
      refsDimension(planningRoot, release),
      releaseItemsDimension(planningRoot, release),
      deploymentDimension(planningRoot, release),
      blockerRiskDimension(release),
      finalizationDimension(release),
      futureCapabilityDimension(release)
    ];
  }
  dimensions = dimensions.sort((left, right) => left.id.localeCompare(right.id));
  for (const entry of dimensions) {
    entry.findings.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`));
  }
  const findings = dimensions.flatMap((entry) => entry.findings).sort((left, right) => `${left.dimension}:${left.code}:${left.message}`.localeCompare(`${right.dimension}:${right.code}:${right.message}`));
  const aggregate = summarize(dimensions);
  return {
    aggregate,
    dimensions,
    completion: schemaInvalid ? { status: "invalid", complete: false, evaluable: false, unavailableCapabilities: FUTURE_CAPABILITIES, reason: "release.yml is invalid" } : completion(release),
    readiness: schemaInvalid ? { status: "invalid", releasable: false, lifecycle: release?.status ?? null, blockedDimensions: ["structure"], blockingFindings: [RELEASE_HEALTH_FINDING_CODES.SCHEMA_INVALID], unavailableFutureCapabilities: FUTURE_CAPABILITIES } : readiness(dimensions, release),
    findings
  };
}

export function releaseFinalizationGuardSummary(health, release) {
  const failedCurrentDimensions = health.dimensions
    .filter((entry) => ["invalid", "failed"].includes(entry.status))
    .map((entry) => entry.id)
    .sort();
  const unavailableCurrentDimensions = health.dimensions
    .filter((entry) => entry.status === "unavailable" && entry.id !== "futureCapabilities")
    .map((entry) => entry.id)
    .sort();
  const guardDimensions = health.dimensions
    .filter((entry) => entry.id !== "futureCapabilities")
    .map((entry) => ({ id: entry.id, status: entry.status, evidence: entry.evidence, findings: entry.findings }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    lifecycle: release.status,
    releasable: health.readiness.releasable,
    failedCurrentDimensions,
    unavailableCurrentDimensions,
    blockingFindingCodes: health.findings.filter((entry) => entry.severity !== "info" && entry.severity !== "warning").map((entry) => entry.code).sort(),
    unavailableFutureCapabilities: FUTURE_CAPABILITIES,
    healthRevision: revisionHash({ dimensions: guardDimensions, completion: health.completion, readiness: health.readiness })
  };
}

export function assertReleaseCanFinalize({ health, release }) {
  const guardSummary = releaseFinalizationGuardSummary(health, release);
  if (release.status !== "RELEASED") {
    const error = new Error(`POLICY_VIOLATION: release finalization requires lifecycle RELEASED, got ${release.status}`);
    error.code = "INVALID";
    error.guardSummary = guardSummary;
    throw error;
  }
  const failed = guardSummary.failedCurrentDimensions.filter((id) => id !== "finalization" && id !== "futureCapabilities");
  if (failed.length > 0) {
    const error = new Error(`POLICY_VIOLATION: release finalization guard failed: ${failed.join(", ")}`);
    error.code = "INVALID";
    error.guardSummary = guardSummary;
    throw error;
  }
  const unavailable = guardSummary.unavailableCurrentDimensions.filter((id) => id !== "finalization");
  if (unavailable.length > 0) {
    const error = new Error(`CAPABILITY_UNAVAILABLE: release finalization guard cannot evaluate: ${unavailable.join(", ")}`);
    error.code = "CAPABILITY_UNAVAILABLE";
    error.guardSummary = guardSummary;
    throw error;
  }
  if (release.finalization.completed) {
    const error = new Error("POLICY_VIOLATION: release is already finalized");
    error.code = "INVALID";
    error.guardSummary = guardSummary;
    throw error;
  }
  return guardSummary;
}
