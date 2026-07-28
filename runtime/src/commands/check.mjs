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
