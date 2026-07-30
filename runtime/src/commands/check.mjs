import fs from "node:fs";
import path from "node:path";
import { validate } from "../lib/schema.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { readOperation } from "../lib/operationStore.mjs";
import { isUuidV7 } from "../lib/ids.mjs";
import { assertTrustedRoots, confineWritePath } from "../lib/paths.mjs";
import { findCommandFingerprintKeyMismatches } from "../lib/discoverScan.mjs";
import { REQUIRED_BOOTSTRAP_DIRECTORIES } from "../lib/bootstrapTopology.mjs";
import { projectContextConsistencyFindings } from "../lib/projectContextValidation.mjs";
import { contentHash, revisionHash } from "../lib/canonical.mjs";
import { compareReleaseReadme } from "../lib/releaseProjection.mjs";
import { listReleaseDocuments, listReleaseRecords, releaseIntegrityFindings, resolveReleaseReference } from "../lib/releaseStore.mjs";
import { readCatalogEntry } from "../lib/operationalCatalog.mjs";
import { releaseCatalogPolicyFindings } from "../lib/releasePolicy.mjs";
import { evaluateReleaseHealth } from "../lib/releaseHealth.mjs";
import { pendingRecovery } from "./release.mjs";

function checkRequiredFile(planningRoot, relativePath, schemaName, findings) {
  let filePath;
  try {
    filePath = confineWritePath(planningRoot, relativePath);
  } catch (error) {
    findings.push(`${relativePath}: untrusted path (${error.message})`);
    return null;
  }
  if (!fs.existsSync(filePath)) {
    findings.push(`${relativePath}: required file is missing`);
    return null;
  }
  let value;
  try {
    value = parseYaml(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    findings.push(`${relativePath}: failed to parse (${error.message})`);
    return null;
  }
  const result = validate(schemaName, value);
  if (!result.valid) {
    for (const error of result.errors) findings.push(`${relativePath}${error.path}: ${error.message}`);
    return null;
  }
  return value;
}

function checkProjectContextConsistency(config, findings, knownSourceIds) {
  if (!config) return;
  findings.push(...projectContextConsistencyFindings(config, { knownSourceIds }));
}

function checkPluginLockConsistency(pluginLock, findings) {
  if (!pluginLock) return;
  if (pluginLock.plugin.version !== pluginLock.pluginVersion) {
    findings.push("plugin.lock.yml: plugin.version must match compatibility field pluginVersion");
  }
  if (pluginLock.plugin.templatePack.fingerprint !== pluginLock.templatePackFingerprint) {
    findings.push("plugin.lock.yml: plugin.templatePack.fingerprint must match compatibility field templatePackFingerprint");
  }
  const expectedVendorSnapshot = `.planning/vendor/template-packs/${pluginLock.templatePackFingerprint.replace(":", "-")}`;
  if (pluginLock.plugin.templatePack.vendorSnapshot !== expectedVendorSnapshot) {
    findings.push("plugin.lock.yml: plugin.templatePack.vendorSnapshot must be derived from templatePackFingerprint");
  }
}

function checkRequiredDirectory(planningRoot, relativePath, findings) {
  let directoryPath;
  try {
    directoryPath = confineWritePath(planningRoot, relativePath);
  } catch (error) {
    findings.push(`${relativePath}: untrusted path (${error.message})`);
    return;
  }
  if (!fs.existsSync(directoryPath)) {
    findings.push(`${relativePath}: required directory is missing`);
    return;
  }
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink()) {
    findings.push(`${relativePath}: symlink entries are not permitted`);
    return;
  }
  if (!stat.isDirectory()) {
    findings.push(`${relativePath}: entry must be a directory`);
  }
}

function checkGuideConsistency(planningRoot, scope, scopeId, knownSourceIds, findings) {
  for (const kind of ["task", "test"]) {
    const metadata = scope.guides?.[kind];
    if (!metadata) continue;
    const relativePath = path.join("scopes", scopeId, `${kind}-guide.yml`);
    const guide = checkRequiredFile(planningRoot, relativePath, "guide", findings);
    if (!guide) continue;
    if (guide.id !== metadata.id || guide.scopeId !== scopeId || guide.kind !== kind) {
      findings.push(`${relativePath}: guide metadata identity does not match scope.yml`);
    }
    const { revision, ...withoutRevision } = guide;
    if (guide.revision !== `sha256:${revisionHash(withoutRevision)}`) findings.push(`${relativePath}: revision does not match canonical guide content`);
    const bytes = fs.readFileSync(path.join(planningRoot, relativePath));
    const actualContentHash = contentHash(bytes);
    if (metadata.contentHash !== actualContentHash) findings.push(`${relativePath}: contentHash does not match scope.yml`);
    if (metadata.revision !== guide.revision || revisionHash(metadata.sourceRefs) !== revisionHash(guide.sourceRefs) || revisionHash(metadata.provenance) !== revisionHash(guide.provenance)) {
      findings.push(`${relativePath}: guide revision/source/provenance metadata is inconsistent`);
    }
    const fingerprintKeys = Object.keys(guide.provenance?.sourceFingerprints || {}).sort();
    const sourceRefKeys = [...(guide.sourceRefs || [])].sort();
    if (revisionHash(fingerprintKeys) !== revisionHash(sourceRefKeys)) findings.push(`${relativePath}: provenance sourceFingerprints keys do not match sourceRefs`);
    const expectedSourceMapRevision = revisionHash({ sourceRefs: guide.sourceRefs, sourceFingerprints: guide.provenance?.sourceFingerprints || {} });
    if (guide.provenance?.sourceMapRevision !== expectedSourceMapRevision) findings.push(`${relativePath}: provenance sourceMapRevision is inconsistent`);
    if (metadata.status === "approved") {
      if (!metadata.approval || metadata.approval.revision !== guide.revision || metadata.approval.contentHash !== actualContentHash) {
        findings.push(`${relativePath}: approved metadata is not bound to the canonical guide revision/content hash`);
      }
    } else if (metadata.approval !== null) {
      findings.push(`${relativePath}: non-approved guide retains approval metadata`);
    }
    for (const sourceId of guide.sourceRefs || []) {
      if (!knownSourceIds.includes(sourceId)) findings.push(`${relativePath}: sourceRef ${sourceId} does not resolve`);
    }
  }
}

function checkRequiredNonSymlinkFile(planningRoot, relativePath, findings) {
  let filePath;
  try {
    filePath = confineWritePath(planningRoot, relativePath);
  } catch (error) {
    findings.push(`${relativePath}: untrusted path (${error.message})`);
    return null;
  }
  if (!fs.existsSync(filePath)) {
    findings.push(`${relativePath}: required file is missing`);
    return null;
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    findings.push(`${relativePath}: symlink entries are not permitted`);
    return null;
  }
  if (!stat.isFile()) {
    findings.push(`${relativePath}: entry must be a file`);
    return null;
  }
  return filePath;
}

function checkReleaseConsistency(planningRoot, findings) {
  const releasesRoot = path.join(planningRoot, "releases");
  if (!fs.existsSync(releasesRoot)) return;
  const displayIdOwners = new Map();
  const releaseDocuments = [];
  for (const releaseId of fs.readdirSync(releasesRoot).sort()) {
    const releaseEntryPath = path.join(releasesRoot, releaseId);
    const releaseStat = fs.lstatSync(releaseEntryPath);
    if (releaseStat.isSymbolicLink()) {
      findings.push(`releases/${releaseId}: symlink entries are not permitted`);
      continue;
    }
    if (!isUuidV7(releaseId)) {
      findings.push(`releases/${releaseId}: not a valid release id`);
      continue;
    }
    if (!releaseStat.isDirectory()) {
      findings.push(`releases/${releaseId}: entry must be a directory`);
      continue;
    }
    const releaseRelativePath = path.join("releases", releaseId, "release.yml");
    const readmeRelativePath = path.join("releases", releaseId, "README.md");
    const releasePath = checkRequiredNonSymlinkFile(planningRoot, releaseRelativePath, findings);
    if (!releasePath) continue;
    const readmePath = checkRequiredNonSymlinkFile(planningRoot, readmeRelativePath, findings);
    let release;
    try {
      release = parseYaml(fs.readFileSync(releasePath, "utf8"));
    } catch (error) {
      findings.push(`${releaseRelativePath}: failed to parse (${error.message})`);
      continue;
    }
    const integrity = releaseIntegrityFindings(release, { directoryId: releaseId });
    for (const finding of integrity.findings) findings.push(`${releaseRelativePath}: ${finding}`);
    if (!integrity.schemaValid) continue;
    if (integrity.findings.length === 0) releaseDocuments.push(release);
    if (release.itemRefs.length > 0) findings.push(`${releaseRelativePath}: itemRefs cannot be resolved before Release Items exist`);
    for (const scopeRef of release.scopeRefs) {
      const scopePath = path.join(planningRoot, "scopes", scopeRef.scopeId, "scope.yml");
      if (!fs.existsSync(scopePath)) findings.push(`${releaseRelativePath}: scopeRef ${scopeRef.scopeId} does not resolve`);
    }
    for (const executionContextRef of release.executionContextRefs || []) {
      const result = readCatalogEntry(planningRoot, "executionContext", executionContextRef);
      if (result.status !== "FOUND") findings.push(`${releaseRelativePath}: executionContextRef ${executionContextRef} invalid (${result.findings.map((finding) => `${finding.code}: ${finding.message}`).join("; ")})`);
    }
    for (const environmentRef of release.environmentRefs || []) {
      const result = readCatalogEntry(planningRoot, "environment", environmentRef);
      if (result.status !== "FOUND") findings.push(`${releaseRelativePath}: environmentRef ${environmentRef} invalid (${result.findings.map((finding) => `${finding.code}: ${finding.message}`).join("; ")})`);
      else if (result.entry.laneRefs.length > 0 && !result.entry.laneRefs.includes(release.lane.id)) findings.push(`${releaseRelativePath}: environmentRef ${environmentRef} is not compatible with lane ${release.lane.id}`);
    }
    for (const event of release.deploymentEvents || []) {
      if (event.releaseId !== release.id) findings.push(`${releaseRelativePath}: deployment event ${event.id} releaseId does not match Release`);
      const environment = readCatalogEntry(planningRoot, "environment", event.environmentRef);
      if (environment.status !== "FOUND") findings.push(`${releaseRelativePath}: deployment event ${event.id} environmentRef invalid (${environment.findings.map((finding) => `${finding.code}: ${finding.message}`).join("; ")})`);
      if (event.executionContextRef) {
        const executionContext = readCatalogEntry(planningRoot, "executionContext", event.executionContextRef);
        if (executionContext.status !== "FOUND") findings.push(`${releaseRelativePath}: deployment event ${event.id} executionContextRef invalid (${executionContext.findings.map((finding) => `${finding.code}: ${finding.message}`).join("; ")})`);
      }
    }
    const existingOwner = displayIdOwners.get(release.displayId);
    if (existingOwner && existingOwner !== releaseId) findings.push(`${releaseRelativePath}: displayId ${release.displayId} is ambiguous with releases/${existingOwner}/release.yml`);
    displayIdOwners.set(release.displayId, releaseId);
    if (readmePath) {
      const currentReadme = fs.readFileSync(readmePath, "utf8");
      if (!compareReleaseReadme(release, currentReadme).equal) findings.push(`${readmeRelativePath}: projection drift`);
    }
  }
  for (const finding of releaseCatalogPolicyFindings(releaseDocuments)) {
    findings.push(`releases: ${finding.code}: ${finding.message}`);
  }
}

export function checkSchema({ planningRoot }) {
  if (!fs.existsSync(planningRoot)) {
    return { status: "NOT_INITIALIZED", findings: ["workspace is not initialized: .planning/ does not exist"], pendingOperations: [] };
  }

  const findings = [];
  try {
    assertTrustedRoots(planningRoot);
  } catch (error) {
    return { status: "FAIL", findings: [`trusted roots: ${error.message}`], pendingOperations: [] };
  }

  const config = checkRequiredFile(planningRoot, "config.yml", "config", findings);
  const pluginLock = checkRequiredFile(planningRoot, "plugin.lock.yml", "plugin-lock", findings);
  const sourcesRoot = path.join(planningRoot, "sources");
  const knownSourceIds = fs.existsSync(sourcesRoot)
    ? fs.readdirSync(sourcesRoot).filter((sourceId) => isUuidV7(sourceId))
    : [];
  checkProjectContextConsistency(config, findings, knownSourceIds);
  checkPluginLockConsistency(pluginLock, findings);
  for (const relativeDirectory of REQUIRED_BOOTSTRAP_DIRECTORIES) {
    checkRequiredDirectory(planningRoot, relativeDirectory, findings);
  }

  const scopesRoot = path.join(planningRoot, "scopes");
  if (fs.existsSync(scopesRoot)) {
    for (const scopeId of fs.readdirSync(scopesRoot)) {
      if (!isUuidV7(scopeId)) {
        findings.push(`scopes/${scopeId}: not a valid scope id`);
        continue;
      }
      const scopeEntryPath = path.join(scopesRoot, scopeId);
      const scopeStat = fs.lstatSync(scopeEntryPath);
      if (scopeStat.isSymbolicLink()) {
        findings.push(`scopes/${scopeId}: symlink entries are not permitted`);
        continue;
      }
      if (!scopeStat.isDirectory()) {
        findings.push(`scopes/${scopeId}: entry must be a directory`);
        continue;
      }
      const scopeBeforeCount = findings.length;
      checkRequiredFile(planningRoot, path.join("scopes", scopeId, "scope.yml"), "scope", findings);
      if (findings.length === scopeBeforeCount) {
        const scopeFile = confineWritePath(planningRoot, path.join("scopes", scopeId, "scope.yml"));
        const scope = parseYaml(fs.readFileSync(scopeFile, "utf8"));
        checkGuideConsistency(planningRoot, scope, scopeId, knownSourceIds, findings);
        for (const mismatch of findCommandFingerprintKeyMismatches(scope)) {
          findings.push(`scopes/${scopeId}/scope.yml: commands.${mismatch.label} sourceFingerprintAtSelection keys do not match sourceRefs (missing=${JSON.stringify(mismatch.missing)}, extra=${JSON.stringify(mismatch.extra)})`);
        }
      }
    }
  }

  if (fs.existsSync(sourcesRoot)) {
    for (const sourceId of fs.readdirSync(sourcesRoot)) {
      if (!isUuidV7(sourceId)) {
        findings.push(`sources/${sourceId}: not a valid source id`);
        continue;
      }
      const sourceEntryPath = path.join(sourcesRoot, sourceId);
      const sourceStat = fs.lstatSync(sourceEntryPath);
      if (sourceStat.isSymbolicLink()) {
        findings.push(`sources/${sourceId}: symlink entries are not permitted`);
        continue;
      }
      if (!sourceStat.isDirectory()) {
        findings.push(`sources/${sourceId}: entry must be a directory`);
        continue;
      }
      const sourceBeforeCount = findings.length;
      checkRequiredFile(planningRoot, path.join("sources", sourceId, "source.yml"), "source", findings);
      if (findings.length === sourceBeforeCount) {
        const sourceFile = confineWritePath(planningRoot, path.join("sources", sourceId, "source.yml"));
        const source = parseYaml(fs.readFileSync(sourceFile, "utf8"));
        if (source.id !== sourceId) {
          findings.push(`sources/${sourceId}/source.yml: source.id ${source.id} does not match its directory`);
        }
      }
    }
  }

  for (const [rootName, fileName, schemaName] of [
    ["execution-contexts", "execution-context.yml", "execution-context"],
    ["environments", "environment.yml", "environment"]
  ]) {
    const catalogRoot = path.join(planningRoot, rootName);
    if (!fs.existsSync(catalogRoot)) continue;
    for (const id of fs.readdirSync(catalogRoot)) {
      if (!isUuidV7(id)) {
        findings.push(`${rootName}/${id}: not a valid id`);
        continue;
      }
      const entryPath = path.join(catalogRoot, id);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        findings.push(`${rootName}/${id}: symlink entries are not permitted`);
        continue;
      }
      if (!stat.isDirectory()) {
        findings.push(`${rootName}/${id}: entry must be a directory`);
        continue;
      }
      const before = findings.length;
      const entry = checkRequiredFile(planningRoot, path.join(rootName, id, fileName), schemaName, findings);
      if (entry && entry.id !== id) findings.push(`${rootName}/${id}/${fileName}: id must match directory`);
      if (before === findings.length && schemaName === "environment") {
        const laneIds = new Set(config?.policies?.release?.lanes?.map((lane) => lane.id) || []);
        for (const laneRef of entry.laneRefs || []) {
          if (!laneIds.has(laneRef)) findings.push(`${rootName}/${id}/${fileName}: laneRef ${laneRef} is not configured`);
        }
      }
    }
  }

  checkReleaseConsistency(planningRoot, findings);

  const pendingOperations = [];
  const operationsRoot = path.join(planningRoot, "operations");
  if (fs.existsSync(operationsRoot)) {
    for (const operationId of fs.readdirSync(operationsRoot)) {
      if (!isUuidV7(operationId)) {
        findings.push(`operations/${operationId}: not a valid operation id`);
        continue;
      }
      const operationEntryPath = path.join(operationsRoot, operationId);
      const operationStat = fs.lstatSync(operationEntryPath);
      if (operationStat.isSymbolicLink()) {
        findings.push(`operations/${operationId}: symlink entries are not permitted`);
        continue;
      }
      if (!operationStat.isDirectory()) {
        findings.push(`operations/${operationId}: entry must be a directory`);
        continue;
      }
      let operation;
      try {
        operation = readOperation(operationsRoot, operationId);
      } catch (error) {
        findings.push(`operations/${operationId}/operation.yml: failed to read or parse (${error.message})`);
        continue;
      }
      const operationSchemaCheck = validate("operation", operation);
      if (!operationSchemaCheck.valid) {
        for (const error of operationSchemaCheck.errors) findings.push(`operations/${operationId}/operation.yml${error.path}: ${error.message}`);
        continue;
      }
      if (operation.id !== operationId) {
        findings.push(`operations/${operationId}/operation.yml: operation.id ${operation.id} does not match its directory`);
        continue;
      }
      if (operation.status === "APPLYING" || operation.status === "RECOVERY_REQUIRED") {
        pendingOperations.push({ operationId, status: operation.status });
      }
    }
  }

  const status = findings.length > 0 ? "FAIL" : pendingOperations.length > 0 ? "RECOVERY_REQUIRED" : "PASS";
  return { status, findings, pendingOperations };
}

function checkReleaseDocument(planningRoot, record) {
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
}

function releaseCheckStatus(entries, extraFindings = []) {
  if (extraFindings.length > 0) return "FAIL";
  return entries.some((entry) => !entry.derivedHealth.aggregate.valid) ? "FAIL" : "PASS";
}

export function checkRelease({ planningRoot, reference = null }) {
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

