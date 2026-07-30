from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f"expected text not found in {path}: {old[:80]!r}")
    write(path, text.replace(old, new, 1))


def replace_section(path, start_marker, end_marker, replacement):
    text = read(path)
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"start marker not found in {path}: {start_marker}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"end marker not found in {path}: {end_marker}")
    write(path, text[:start] + replacement.rstrip() + "\n\n" + text[end:])


# ---------------------------------------------------------------------------
# Live derived health and finalization evidence binding.
# ---------------------------------------------------------------------------
health_path = "runtime/src/lib/releaseHealth.mjs"
replace_once(
    health_path,
    'import { readCatalogEntry } from "./operationalCatalog.mjs";\n',
    'import { readCatalogEntry } from "./operationalCatalog.mjs";\nimport { buildScopeRefsEvidence } from "./releaseScopeEvidence.mjs";\n'
)

replace_section(
    health_path,
    "function readConfig(planningRoot) {",
    "function projectionDimension",
    '''function readConfig(planningRoot) {
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
}'''
)

replace_section(
    health_path,
    "function laneDimension(configRead, release) {",
    "function policyDimension",
    '''function laneDimension(configRead, release) {
  if (configRead.status !== "found") return dimension("lane", "invalid", "Release lane cannot be evaluated without a valid Project Context", configRead.findings, {});
  const findings = laneConfigFindings(configRead.config, release.lane.id).map((entry) => finding({ code: entry.code, dimension: "lane", message: entry.message, evidence: { laneId: release.lane.id } }));
  return findings.length === 0
    ? dimension("lane", "valid", "Release lane is configured", [], { laneId: release.lane.id, configRevision: configRead.revision })
    : dimension("lane", "failed", "Release lane is not configured consistently", findings, { laneId: release.lane.id, configRevision: configRead.revision });
}'''
)

replace_section(
    health_path,
    "function scopeDimension(planningRoot, release) {",
    "function refsDimension",
    '''function scopeDimension(planningRoot, release) {
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
}'''
)

replace_section(
    health_path,
    "function refsDimension(planningRoot, release) {",
    "function deploymentDimension",
    '''function refsDimension(planningRoot, release) {
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
}'''
)

replace_section(
    health_path,
    "function deploymentDimension(planningRoot, release) {",
    "function blockerRiskDimension",
    '''function deploymentDimension(planningRoot, release) {
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
}'''
)

replace_section(
    health_path,
    "function summarize(dimensions) {",
    "function completion(release)",
    '''function summarize(dimensions) {
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
}'''
)

replace_section(
    health_path,
    "export function releaseFinalizationGuardSummary(health, release) {",
    "export function assertReleaseCanFinalize",
    '''export function releaseFinalizationGuardSummary(health, release) {
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
}'''
)

replace_section(
    health_path,
    "export function assertReleaseCanFinalize({ health, release }) {",
    "\n}",
    '''export function assertReleaseCanFinalize({ health, release }) {
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
}'''
)

# The previous function replacement uses the first closing brace marker. Repair
# any duplicated trailing brace left at EOF deterministically.
text = read(health_path)
text = re.sub(r'\n}\n}\s*$', '\n}\n', text)
write(health_path, text)

# ---------------------------------------------------------------------------
# Expose raw Release records so catalog checks cannot silently omit corruption.
# ---------------------------------------------------------------------------
store_path = "runtime/src/lib/releaseStore.mjs"
replace_once(
    store_path,
    '''export function listReleaseDocuments(planningRoot, options = {}) {
  return scanReleaseRecords(planningRoot, options).filter((record) => record.release).map((record) => record.release);
}
''',
    '''export function listReleaseDocuments(planningRoot, options = {}) {
  return scanReleaseRecords(planningRoot, options).filter((record) => record.release).map((record) => record.release);
}

export function listReleaseRecords(planningRoot, options = {}) {
  return scanReleaseRecords(planningRoot, options).map((record) => ({ ...record, findings: [...record.findings] }));
}
'''
)

# ---------------------------------------------------------------------------
# Controlled catalog checking for parse/schema-invalid Release documents.
# ---------------------------------------------------------------------------
check_path = "runtime/src/commands/check.mjs"
replace_once(
    check_path,
    'import { listReleaseDocuments, releaseIntegrityFindings, resolveReleaseReference } from "../lib/releaseStore.mjs";\n',
    'import { listReleaseDocuments, listReleaseRecords, releaseIntegrityFindings, resolveReleaseReference } from "../lib/releaseStore.mjs";\n'
)

replace_section(
    check_path,
    "function checkReleaseDocument(planningRoot, release) {",
    "function releaseCheckStatus",
    '''function checkReleaseDocument(planningRoot, record) {
  const release = record.release;
  const directoryId = record.directoryId ?? release?.id ?? null;
  const health = evaluateReleaseHealth({ planningRoot, release, directoryId });
  if (!release && record.findings.length > 0) {
    const structure = health.dimensions.find((entry) => entry.id === "structure");
    const parseFindings = record.findings.map((message) => ({ code: "RELEASE_SCHEMA_INVALID", severity: "error", dimension: "structure", message: `releases/${directoryId}/release.yml: ${message}`, evidence: { directoryId } }));
    if (structure) {
      structure.findings.push(...parseFindings);
      structure.findings.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`));
    }
    health.findings.push(...parseFindings);
    health.findings.sort((left, right) => `${left.dimension}:${left.code}:${left.message}`.localeCompare(`${right.dimension}:${right.code}:${right.message}`));
    health.aggregate = { ...health.aggregate, status: "invalid", valid: false, blockingFindingCount: health.aggregate.blockingFindingCount + parseFindings.length };
  }
  return {
    release: {
      id: typeof release?.id === "string" ? release.id : directoryId,
      displayId: typeof release?.displayId === "string" ? release.displayId : null,
      lifecycle: typeof release?.status === "string" ? release.status : null,
      laneId: typeof release?.lane?.id === "string" ? release.lane.id : null,
      policyMode: typeof release?.policy?.mode === "string" ? release.policy.mode : null
    },
    derivedHealth: health,
    completion: health.completion,
    readiness: health.readiness,
    findings: health.findings
  };
}'''
)

replace_section(
    check_path,
    "export function checkRelease({ planningRoot, reference = null }) {",
    "",
    '''export function checkRelease({ planningRoot, reference = null }) {
  if (!fs.existsSync(planningRoot)) {
    return { status: "NOT_INITIALIZED", scope: reference ? "single" : "catalog", releases: [], findings: ["workspace is not initialized: .planning/ does not exist"], pendingOperations: [] };
  }
  const pending = pendingRecovery(planningRoot);
  if (pending.length > 0) {
    return { status: "RECOVERY_REQUIRED", scope: reference ? "single" : "catalog", releases: [], findings: ["workspace has pending or recovery-required operations"], pendingOperations: pending };
  }
  if (reference) {
    const resolution = resolveReleaseReference(planningRoot, reference);
    if (resolution.status !== "FOUND") {
      return { status: resolution.status, scope: "single", releases: [], findings: resolution.findings, matches: resolution.matches || [] };
    }
    const entry = checkReleaseDocument(planningRoot, { directoryId: resolution.release.id, release: resolution.release, invalid: false, findings: [] });
    return {
      status: releaseCheckStatus([entry]),
      scope: "single",
      releases: [entry],
      findings: entry.findings.map((finding) => `${finding.code}: ${finding.message}`),
      pendingOperations: []
    };
  }
  let records;
  try {
    records = listReleaseRecords(planningRoot, { includeInvalid: true, requireIntegrity: false });
  } catch (error) {
    return { status: "FAIL", scope: "catalog", releases: [], findings: [`release catalog is invalid: ${error.message}`], pendingOperations: [] };
  }
  const entries = records.sort((left, right) => left.directoryId.localeCompare(right.directoryId)).map((record) => checkReleaseDocument(planningRoot, record));
  const findings = entries.flatMap((entry) => entry.findings.map((finding) => `${entry.release.id}: ${finding.code}: ${finding.message}`));
  if (entries.length === 0) findings.push("release catalog is empty");
  return {
    status: entries.length === 0 ? "FAIL" : releaseCheckStatus(entries),
    scope: "catalog",
    releases: entries,
    findings,
    pendingOperations: []
  };
}
'''
)

# ---------------------------------------------------------------------------
# Parse check release positional args and --format without aliasing the flag to
# a Release reference.
# ---------------------------------------------------------------------------
index_path = "runtime/src/index.mjs"
insert_after = '''function argsToOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) continue;
    const key = args[index].slice(2).replaceAll("-", "_");
    const next = args[index + 1];
    options[key] = next === undefined || next.startsWith("--") ? true : args[++index];
  }
  return options;
}
'''
replace_once(
    index_path,
    insert_after,
    insert_after + '''
function parseCheckReleaseArgs(args) {
  let reference = null;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--format") {
      const format = args[++index];
      if (!format || format.startsWith("--")) throw new UsageError("check release --format requires json");
      if (format !== "json") throw new UsageError("check release --format must be json");
      continue;
    }
    if (value.startsWith("--")) throw new UsageError(`check release does not support option ${value}`);
    if (reference !== null) throw new UsageError("check release accepts at most one id-or-display-id");
    reference = value;
  }
  return reference;
}
'''
)
replace_once(
    index_path,
    '    if (stage === "release") return checkRelease({ planningRoot, reference: rest[0] || null });\n',
    '    if (stage === "release") return checkRelease({ planningRoot, reference: parseCheckReleaseArgs(rest) });\n'
)

# ---------------------------------------------------------------------------
# Tests: stale Scope evidence, required current capabilities, corrupt catalogs,
# CLI --format parsing, finalization tamper and external revision drift.
# ---------------------------------------------------------------------------
health_test = "runtime/src/lib/tests/release-health.test.mjs"
append_marker = 'console.log("release-health: all tests passed");\n'
health_cases = r'''
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-health-stale-scope-"));
  for (const dir of ["releases", "scopes", "sources", "execution-contexts", "environments"]) fs.mkdirSync(path.join(planningRoot, dir), { recursive: true });
  writeConfig(planningRoot);
  const scopeId = generateUuidV7();
  fs.mkdirSync(path.join(planningRoot, "scopes", scopeId), { recursive: true });
  fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), stringifyYaml({ schemaVersion: 1, id: scopeId, key: "api", label: "API", kind: "code", path: "src/", owner: null, commands: {} }));
  const claimedReady = {
    scopeId,
    evaluatedAt: "2026-07-29T00:00:00.000Z",
    readiness: { policyMode: "strict", ready: true },
    guides: [
      { kind: "task", id: null, revision: null, contentHash: null, state: "approved_current", usable: true },
      { kind: "test", id: null, revision: null, contentHash: null, state: "approved_current", usable: true }
    ],
    findings: []
  };
  const release = releaseFixture({ scopeRefs: [claimedReady] });
  writeRelease(planningRoot, release);
  const health = evaluateReleaseHealth({ planningRoot, release, directoryId: release.id });
  assert.ok(health.findings.some((entry) => entry.code === "GUIDE_EVIDENCE_STALE"), "live Scope/Guide evidence must be recomputed");
  assert.equal(health.readiness.releasable, false, "stale claimed readiness must not become releasable");
}

{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-health-missing-config-"));
  for (const dir of ["releases", "scopes", "sources", "execution-contexts", "environments"]) fs.mkdirSync(path.join(planningRoot, dir), { recursive: true });
  const release = releaseFixture();
  writeRelease(planningRoot, release);
  const health = evaluateReleaseHealth({ planningRoot, release, directoryId: release.id });
  assert.equal(health.dimensions.find((entry) => entry.id === "lane").status, "invalid");
  assert.equal(health.aggregate.valid, false, "missing required Project Context must not pass as optional capability");
}

'''
replace_once(health_test, append_marker, health_cases + append_marker)

commands_test = "runtime/src/commands/tests/commands.test.mjs"
replace_once(commands_test, 'import { revisionHash } from "../../lib/canonical.mjs";\n', 'import { contentHash, revisionHash } from "../../lib/canonical.mjs";\n')
replace_once(commands_test, 'import { renderReleaseReadme } from "../../lib/releaseProjection.mjs";\n', 'import { renderReleaseReadme } from "../../lib/releaseProjection.mjs";\nimport { renderGuideMarkdown } from "../../lib/guideProjection.mjs";\nimport { computeSourceFingerprint } from "../../lib/fingerprint.mjs";\nimport { DEFAULT_MAX_SOURCE_BYTES } from "../../lib/discoverScan.mjs";\n')

helper_anchor = 'const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "commands-"));\n'
helper_code = r'''function persistApprovedManualGuides({ workspace, planningRoot, scopeId }) {
  const sourceId = generateUuidV7();
  const sourcePath = "docs/release-guide-source.md";
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, sourcePath), "release guide source\n");
  const observed = computeSourceFingerprint(path.join(workspace, sourcePath), { maxBytes: DEFAULT_MAX_SOURCE_BYTES });
  const source = {
    schemaVersion: 1,
    id: sourceId,
    path: sourcePath,
    family: "technical-sources",
    kind: "testing",
    role: "canonical",
    authority: { standing: "authoritative", force: "normative" },
    availability: "implemented",
    confirmedFingerprint: observed.fingerprint,
    confirmedContentHash: observed.contentHash
  };
  fs.mkdirSync(path.join(planningRoot, "sources", sourceId), { recursive: true });
  fs.writeFileSync(path.join(planningRoot, "sources", sourceId, "source.yml"), stringifyYaml(source));

  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.documentation.source_refs = [...new Set([...(config.documentation.source_refs || []), sourceId])].sort();
  fs.writeFileSync(configPath, stringifyYaml(config));

  const scopePath = path.join(planningRoot, "scopes", scopeId, "scope.yml");
  const scope = parseYaml(fs.readFileSync(scopePath, "utf8"));
  const guides = {};
  for (const kind of ["task", "test"]) {
    const guideId = generateUuidV7();
    const body = kind === "task"
      ? { workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" } }
      : { gatesByWorkPackageType: [], gatesByTaskType: [], commandRefs: [], evidenceRequirements: [], testData: [], executionContexts: [], environments: [] };
    const document = { sourceRefs: [sourceId], ...body, openGaps: [] };
    const provenance = {
      sourceMapRevision: revisionHash({ sourceRefs: [sourceId], sourceFingerprints: { [sourceId]: source.confirmedFingerprint } }),
      generationMethod: "manual",
      generatorVersion: "shipping-mode:manual-guide-input/1",
      generatorFingerprint: null,
      generatedAt: "2026-07-29T00:00:00.000Z",
      sourceFingerprints: { [sourceId]: source.confirmedFingerprint },
      generationInputHash: revisionHash({ scopeId, guideKind: kind, document }),
      generationOutputHash: revisionHash(document)
    };
    const withoutRevision = { schemaVersion: 1, dslVersion: 1, id: guideId, scopeId, kind, sourceRefs: [sourceId], provenance, openGaps: [], ...body };
    const guide = { ...withoutRevision, revision: `sha256:${revisionHash(withoutRevision)}` };
    const bytes = Buffer.from(stringifyYaml(guide));
    const hash = contentHash(bytes);
    guides[kind] = {
      id: guideId,
      scopeId,
      kind,
      status: "approved",
      path: `${kind}-guide.yml`,
      projection: `${kind}-guide.md`,
      revision: guide.revision,
      contentHash: hash,
      sourceRefs: guide.sourceRefs,
      provenance: guide.provenance,
      approval: { actor: "reviewer", approvedAt: "2026-07-29T00:00:00.000Z", revision: guide.revision, contentHash: hash }
    };
    fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, `${kind}-guide.yml`), bytes);
    fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, `${kind}-guide.md`), renderGuideMarkdown(guide));
  }
  fs.writeFileSync(scopePath, stringifyYaml({ ...scope, guides }));
}

'''
replace_once(commands_test, helper_anchor, helper_code + helper_anchor)

old_finalization_block = r'''let releasableFixture = parseYaml(fs.readFileSync(releaseYmlPath, "utf8"));
releasableFixture = {
  ...releasableFixture,
  status: "RELEASED",
  scopeRefs: releasableFixture.scopeRefs.map((scopeRef) => ({ ...scopeRef, readiness: { ...scopeRef.readiness, ready: true }, findings: [] }))
};
releasableFixture = updateReleaseRevision(releasableFixture);
fs.writeFileSync(releaseYmlPath, stringifyYaml(releasableFixture));
fs.writeFileSync(releaseReadmePath, renderReleaseReadme(releasableFixture));
const finalize = runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-plan3", actor: "carlos" }
});
assert.equal(readChangeSet(operationsRoot, finalize.operationId).kind, "release.finalization.complete");
runChangesetValidate({ planningRoot, operationsRoot, operationId: finalize.operationId });
runChangesetApprove({ operationsRoot, planningRoot, operationId: finalize.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: finalize.operationId, actor: "carlos" });
'''
new_finalization_block = r'''let releasableFixture = parseYaml(fs.readFileSync(releaseYmlPath, "utf8"));
releasableFixture = {
  ...releasableFixture,
  status: "RELEASED",
  scopeRefs: releasableFixture.scopeRefs.map((scopeRef) => ({ ...scopeRef, readiness: { ...scopeRef.readiness, ready: true }, findings: [] }))
};
releasableFixture = updateReleaseRevision(releasableFixture);
fs.writeFileSync(releaseYmlPath, stringifyYaml(releasableFixture));
fs.writeFileSync(releaseReadmePath, renderReleaseReadme(releasableFixture));
assert.throws(() => runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-stale-scope-plan3", actor: "carlos" }
}), /scope|GUIDE_EVIDENCE_STALE/, "caller-edited readiness cannot replace live Scope/Guide evaluation");

persistApprovedManualGuides({ workspace, planningRoot, scopeId: scopeResult.scopeId });
const currentScopeEvidence = runReleaseScopeSet({
  planningRoot,
  args: { releaseRef: releaseCreate.releaseId, scopeIds: scopeResult.scopeId, policyMode: "strict", idempotencyKey: "scope-refs-current-plan3", actor: "carlos" }
});
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: currentScopeEvidence.operationId }).status, "VALIDATED");
runChangesetApprove({ operationsRoot, planningRoot, operationId: currentScopeEvidence.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: currentScopeEvidence.operationId, actor: "carlos" });
assert.equal(parseYaml(fs.readFileSync(releaseYmlPath, "utf8")).scopeRefs[0].readiness.ready, true);

const driftedFinalize = runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-drift-plan3", actor: "carlos" }
});
const environmentPath = path.join(planningRoot, "environments", environmentId, "environment.yml");
const environmentBeforeDrift = fs.readFileSync(environmentPath, "utf8");
const changedEnvironment = parseYaml(environmentBeforeDrift);
changedEnvironment.label = "Staging changed after propose";
fs.writeFileSync(environmentPath, stringifyYaml(changedEnvironment));
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: driftedFinalize.operationId }).status, "STALE", "external evidence revision drift must stale finalization even when health remains valid");
fs.writeFileSync(environmentPath, environmentBeforeDrift);

const tamperedFinalize = runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-tampered-plan3", actor: "carlos" }
});
const tamperedFinalizeChangeSet = readChangeSet(operationsRoot, tamperedFinalize.operationId);
tamperedFinalizeChangeSet.payload.nextFinalization.completedBy = "mallory";
tamperedFinalizeChangeSet.payload.guardSummary.healthRevision = "0".repeat(64);
tamperedFinalizeChangeSet.hash = computePersistedChangeSetHash(tamperedFinalizeChangeSet);
writeChangeSet(operationsRoot, tamperedFinalize.operationId, tamperedFinalizeChangeSet);
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: tamperedFinalize.operationId }).status, "INVALID", "recomputed public hashes must not permit forged finalization evidence");

const finalize = runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-plan3", actor: "carlos" }
});
assert.equal(readChangeSet(operationsRoot, finalize.operationId).kind, "release.finalization.complete");
runChangesetValidate({ planningRoot, operationsRoot, operationId: finalize.operationId });
runChangesetApprove({ operationsRoot, planningRoot, operationId: finalize.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: finalize.operationId, actor: "carlos" });
'''
replace_once(commands_test, old_finalization_block, new_finalization_block)

# Add a controlled schema-invalid catalog assertion before the test's final log.
commands_log = 'console.log("commands: all tests passed");\n'
commands_extra = r'''
const corruptReleaseId = generateUuidV7();
fs.mkdirSync(path.join(planningRoot, "releases", corruptReleaseId), { recursive: true });
fs.writeFileSync(path.join(planningRoot, "releases", corruptReleaseId, "release.yml"), "schemaVersion: 1\n");
fs.writeFileSync(path.join(planningRoot, "releases", corruptReleaseId, "README.md"), "invalid\n");
const corruptCatalogCheck = checkRelease({ planningRoot });
assert.equal(corruptCatalogCheck.status, "FAIL");
assert.ok(corruptCatalogCheck.releases.some((entry) => entry.release.id === corruptReleaseId), "catalog checks must retain schema-invalid Release records instead of omitting or crashing");

'''
replace_once(commands_test, commands_log, commands_extra + commands_log)

cli_test = "runtime/tests/cli-e2e.test.mjs"
replace_once(
    cli_test,
    '''  const checkCatalog = run(["check", "release"], cwd);
  assert.equal(checkCatalog.code, 1);
  assert.equal(checkCatalog.json.scope, "catalog");
''',
    '''  const checkCatalog = run(["check", "release"], cwd);
  assert.equal(checkCatalog.code, 1);
  assert.equal(checkCatalog.json.scope, "catalog");
  const checkCatalogJson = run(["check", "release", "--format", "json"], cwd);
  assert.equal(checkCatalogJson.code, 1);
  assert.equal(checkCatalogJson.json.scope, "catalog", "--format json must not be parsed as a Release reference");
  const checkSingleJson = run(["check", "release", release.json.displayId, "--format", "json"], cwd);
  assert.equal(checkSingleJson.code, 1);
  assert.equal(checkSingleJson.json.scope, "single");
  const unsupportedFormat = run(["check", "release", "--format", "yaml"], cwd);
  assert.equal(unsupportedFormat.code, 1);
  assert.match(unsupportedFormat.json.error, /--format must be json/);
'''
)

# ---------------------------------------------------------------------------
# Documentation and public skill precision.
# ---------------------------------------------------------------------------
plan_path = "docs/superpowers/plans/2026-07-29-corte-2-plan-3-derived-health-closure.md"
plan_text = read(plan_path)
review_note = '''
## 21. Post-review Corrections

Adversarial review of PR #23 closed four material gaps:

- Scope/Guide health now rebuilds current canonical evidence instead of trusting the persisted readiness snapshot; stale guide content, metadata or source evidence is reported as `GUIDE_EVIDENCE_STALE` and blocks finalization.
- Finalization guard summaries include a deterministic health/evidence revision. Changes to Scope/Guide, Environment or Execution Context documents stale the operation even when their boolean health result remains unchanged.
- Whole-catalog `check release` retains parse/schema-invalid Release records and reports them structurally instead of silently omitting them or dereferencing missing fields.
- `check release --format json` is parsed as an option for both single and catalog checks; unsupported formats and extra positional arguments fail with a controlled usage error.

Required Project Context state and selected operational references are not treated as vacuously satisfied capabilities. Only explicitly deferred Corte 3+ completion capabilities remain non-blocking for current Release health.
'''
if "## 21. Post-review Corrections" not in plan_text:
    write(plan_path, plan_text.rstrip() + "\n\n" + review_note.strip() + "\n")

skill_path = "skills/check/SKILL.md"
replace_once(skill_path, 'argument-hint: "schema | guides [--scope-id <uuid>] | release [id-or-display-id]"\n', 'argument-hint: "schema | guides [--scope-id <uuid>] | release [id-or-display-id] [--format json]"\n')
replace_once(skill_path, 'shipping-mode check release [id-or-display-id]\n', 'shipping-mode check release [id-or-display-id] [--format json]\n')

print("PR23 review corrections applied")
