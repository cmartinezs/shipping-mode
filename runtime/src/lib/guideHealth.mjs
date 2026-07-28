import fs from "node:fs";
import path from "node:path";
import { validate } from "./schema.mjs";
import { parseYaml } from "./yaml.mjs";
import { contentHash, revisionHash } from "./canonical.mjs";
import { buildGuideGenerationInput, customGuideGenerationInputHash } from "./guideGeneration.mjs";
import { compareGuideProjection } from "./guideProjection.mjs";
import { confineWritePath, confineUnder } from "./paths.mjs";

export const GUIDE_FINDING_CODES = Object.freeze({
  MISSING: "GUIDE_MISSING",
  SCHEMA: "GUIDE_SCHEMA_INVALID",
  METADATA: "GUIDE_METADATA_MISMATCH",
  REVISION: "GUIDE_REVISION_MISMATCH",
  CONTENT_HASH: "GUIDE_CONTENT_HASH_MISMATCH",
  OUTPUT_HASH: "GUIDE_GENERATION_OUTPUT_HASH_MISMATCH",
  SOURCE_MAP: "GUIDE_SOURCE_MAP_REVISION_MISMATCH",
  STATUS: "GUIDE_STATUS_UNAPPROVED",
  REJECTED: "GUIDE_REJECTED",
  PERSISTED_STALE: "GUIDE_PERSISTED_STALE",
  APPROVAL: "GUIDE_APPROVAL_MISSING",
  APPROVAL_REVISION: "GUIDE_APPROVAL_REVISION_MISMATCH",
  APPROVAL_CONTENT: "GUIDE_APPROVAL_CONTENT_HASH_MISMATCH",
  SOURCE_MISSING: "GUIDE_SOURCE_MISSING",
  SOURCE_UNCONFIRMED: "GUIDE_SOURCE_UNCONFIRMED",
  SOURCE_CHANGED: "GUIDE_SOURCE_FINGERPRINT_CHANGED",
  SOURCE_NOT_APPROVED: "GUIDE_SOURCE_NOT_APPROVED",
  SOURCE_UNAVAILABLE: "GUIDE_SOURCE_UNAVAILABLE",
  SOURCE_OBSERVATION: "GUIDE_SOURCE_OBSERVATION_FAILED",
  INPUT_CHANGED: "GUIDE_GENERATION_INPUT_CHANGED",
  GENERATOR_MISSING: "GUIDE_GENERATOR_MISSING",
  GENERATOR_VERSION: "GUIDE_GENERATOR_VERSION_CHANGED",
  GENERATOR_FINGERPRINT: "GUIDE_GENERATOR_FINGERPRINT_CHANGED",
  GENERATOR_CONFIG: "GUIDE_GENERATOR_CONFIG_CHANGED",
  PROJECTION_MISSING: "GUIDE_PROJECTION_MISSING",
  PROJECTION_DRIFT: "GUIDE_PROJECTION_DRIFT",
  DSL_VERSION: "GUIDE_DSL_VERSION_UNSUPPORTED",
  SCHEMA_VERSION: "GUIDE_SCHEMA_VERSION_UNSUPPORTED",
  OPEN_GAP: "GUIDE_OPEN_GAP"
});

function finding(code, scopeId, guideKind, message, evidence = {}, recommendedAction = "inspect") {
  return { code, severity: code === GUIDE_FINDING_CODES.OPEN_GAP ? "warning" : "error", scopeId, guideKind, message, evidence, recommendedAction };
}

function guidePath(planningRoot, scopeId, kind, file) {
  return confineWritePath(planningRoot, path.join("scopes", scopeId, file || `${kind}-guide.yml`));
}

function sameCanonicalValue(left, right) {
  return revisionHash(left) === revisionHash(right);
}

export function guidePayloadDocument(guide) {
  const common = { sourceRefs: guide.sourceRefs, openGaps: guide.openGaps };
  if (guide.kind === "task") {
    return {
      ...common,
      workPackageTypes: guide.workPackageTypes,
      taskTypes: guide.taskTypes,
      requiredSections: guide.requiredSections,
      requiredGateRefs: guide.requiredGateRefs,
      templateRefs: guide.templateRefs,
      decompositionRules: guide.decompositionRules,
      automation: guide.automation
    };
  }
  return {
    ...common,
    gatesByWorkPackageType: guide.gatesByWorkPackageType,
    gatesByTaskType: guide.gatesByTaskType,
    commandRefs: guide.commandRefs,
    evidenceRequirements: guide.evidenceRequirements,
    testData: guide.testData,
    executionContexts: guide.executionContexts,
    environments: guide.environments
  };
}

function currentGenerator({ workspaceRoot, scope, kind }) {
  const configured = scope.customGenerators?.[kind];
  if (!configured) return null;
  try {
    const executable = confineUnder(workspaceRoot, configured.executable);
    const stat = fs.statSync(executable);
    if (!stat.isFile()) return { configured, missing: true };
    return { configured, fingerprint: contentHash(fs.readFileSync(executable)) };
  } catch {
    return { configured, missing: true };
  }
}

function addSourceFindings({ guide, sources, config, scopeId, kind, reasons, sourceDrift, sourceDiagnostics }) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const approvedRefs = new Set(config.documentation?.source_refs || []);
  const driftById = new Map((sourceDrift || []).map((entry) => [entry.sourceId, entry]));
  const diagnosticsById = new Map((sourceDiagnostics || []).filter((entry) => entry.sourceId).map((entry) => [entry.sourceId, entry]));
  const provenanceFingerprints = guide.provenance.sourceFingerprints || {};

  for (const sourceId of guide.sourceRefs) {
    const source = byId.get(sourceId);
    if (!source) {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_MISSING, scopeId, kind, `Documentation Source ${sourceId} is missing`, { sourceId }, "rerun_discovery"));
      continue;
    }
    if (!approvedRefs.has(sourceId)) reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_NOT_APPROVED, scopeId, kind, `Documentation Source ${sourceId} is not in approved Project Context refs`, { sourceId }, "repair_project_context_refs"));
    if (!source.confirmedFingerprint) {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_UNCONFIRMED, scopeId, kind, `Documentation Source ${sourceId} has no confirmed fingerprint`, { sourceId }, "rerun_discovery"));
    }
    if (["deprecated", "historical", "unknown"].includes(source.availability)) {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_UNAVAILABLE, scopeId, kind, `Documentation Source ${sourceId} availability is ${source.availability}`, { sourceId, availability: source.availability }, "repair_project_context_refs"));
    }

    const observation = driftById.get(sourceId);
    const diagnostic = diagnosticsById.get(sourceId);
    if (diagnostic) {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_OBSERVATION, scopeId, kind, `Documentation Source ${sourceId} could not be observed: ${diagnostic.message}`, { sourceId, diagnosticCode: diagnostic.code }, "rerun_discovery"));
    } else if (sourceDrift && !observation) {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_OBSERVATION, scopeId, kind, `Documentation Source ${sourceId} has no current repository observation`, { sourceId }, "rerun_discovery"));
    } else if (observation?.driftState === "missing" || observation?.driftState === "moved") {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_MISSING, scopeId, kind, `Documentation Source ${sourceId} is ${observation.driftState} in the current repository`, { sourceId, driftState: observation.driftState, observedAtPath: observation.observedAtPath || null }, "rerun_discovery"));
    } else {
      const expected = provenanceFingerprints[sourceId] || null;
      const catalog = source.confirmedFingerprint || null;
      const observed = observation?.observedFingerprint || null;
      if (expected !== catalog || observation?.driftState === "changed") {
        reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_CHANGED, scopeId, kind, `Documentation Source ${sourceId} fingerprint changed`, { sourceId, expected, catalog, observed }, "regenerate"));
      }
    }
  }

  if (guide.provenance.generationMethod !== "manual") {
    for (const sourceId of approvedRefs) {
      if (!guide.sourceRefs.includes(sourceId)) reasons.push(finding(GUIDE_FINDING_CODES.INPUT_CHANGED, scopeId, kind, "approved Project Context source set changed for Guide", { sourceId }, "regenerate"));
    }
  }
}

function addGeneratorFindings({ guide, scope, workspaceRoot, config, sources, kind, scopeId, reasons }) {
  const method = guide.provenance.generationMethod;
  const payloadDocument = guidePayloadDocument(guide);
  let expectedInputHash;

  if (method === "manual") {
    expectedInputHash = revisionHash({ scopeId, guideKind: kind, document: payloadDocument });
  } else {
    let built;
    try {
      built = buildGuideGenerationInput({ scope, guideKind: kind, sources, config });
    } catch (error) {
      reasons.push(finding(GUIDE_FINDING_CODES.INPUT_CHANGED, scopeId, kind, `Guide generation input cannot be reconstructed: ${error.message}`, {}, "repair_project_context_refs"));
      return;
    }

    if (method === "custom") {
      const current = currentGenerator({ workspaceRoot, scope, kind });
      if (!current || current.missing) {
        reasons.push(finding(GUIDE_FINDING_CODES.GENERATOR_MISSING, scopeId, kind, "configured custom generator is missing or unsafe", {}, "repair_generator_config"));
        return;
      }
      if (guide.provenance.generatorVersion !== current.configured.version) reasons.push(finding(GUIDE_FINDING_CODES.GENERATOR_VERSION, scopeId, kind, "custom generator version changed", { expected: guide.provenance.generatorVersion, actual: current.configured.version }, "regenerate"));
      if (guide.provenance.generatorFingerprint !== current.fingerprint) reasons.push(finding(GUIDE_FINDING_CODES.GENERATOR_FINGERPRINT, scopeId, kind, "custom generator fingerprint changed", { expected: guide.provenance.generatorFingerprint, actual: current.fingerprint }, "regenerate"));
      expectedInputHash = customGuideGenerationInputHash({ input: built.input, generator: current.configured });
      if (guide.provenance.generationInputHash !== expectedInputHash && guide.provenance.generatorVersion === current.configured.version && guide.provenance.generatorFingerprint === current.fingerprint) {
        reasons.push(finding(GUIDE_FINDING_CODES.GENERATOR_CONFIG, scopeId, kind, "custom generator configuration or structured generation input changed", { expected: guide.provenance.generationInputHash, actual: expectedInputHash }, "regenerate"));
        return;
      }
    } else {
      if (guide.provenance.generatorVersion !== "shipping-mode:generic-guide/1") reasons.push(finding(GUIDE_FINDING_CODES.GENERATOR_VERSION, scopeId, kind, "generic generator version is no longer supported", { expected: guide.provenance.generatorVersion, actual: "shipping-mode:generic-guide/1" }, "regenerate"));
      expectedInputHash = built.inputHash;
    }
  }

  if (guide.provenance.generationInputHash !== expectedInputHash) {
    reasons.push(finding(GUIDE_FINDING_CODES.INPUT_CHANGED, scopeId, kind, "Guide generation input changed", { expected: guide.provenance.generationInputHash, actual: expectedInputHash }, "regenerate"));
  }
}

function sortedReasons(reasons) {
  return reasons.sort((left, right) => `${left.code}:${JSON.stringify(left.evidence)}`.localeCompare(`${right.code}:${JSON.stringify(right.evidence)}`));
}

export function evaluateGuideHealth({ planningRoot, workspaceRoot, scope, guideKind, sources, config, sourceDrift = null, sourceDiagnostics = [] }) {
  const scopeId = scope.id;
  const relative = path.join("scopes", scopeId, `${guideKind}-guide.yml`);
  const reasons = [];
  const metadata = scope.guides?.[guideKind] || null;
  let guide;
  let guideBytes;
  let file;

  try {
    file = guidePath(planningRoot, scopeId, guideKind);
  } catch (error) {
    reasons.push(finding(GUIDE_FINDING_CODES.SCHEMA, scopeId, guideKind, `${relative}: untrusted path (${error.message})`, { path: relative }, "regenerate"));
    return { state: "invalid", usable: false, persistedStatus: metadata?.status || null, reasons: sortedReasons(reasons) };
  }

  if (!fs.existsSync(file)) {
    reasons.push(finding(GUIDE_FINDING_CODES.MISSING, scopeId, guideKind, "required Guide YAML is missing", { path: relative }, "generate"));
    return { state: "missing", usable: false, persistedStatus: metadata?.status || null, reasons };
  }

  try {
    guideBytes = fs.readFileSync(file);
    guide = parseYaml(guideBytes.toString("utf8"));
  } catch (error) {
    reasons.push(finding(GUIDE_FINDING_CODES.SCHEMA, scopeId, guideKind, `${relative}: ${error.message}`, { path: relative }, "regenerate"));
    return { state: "invalid", usable: false, persistedStatus: metadata?.status || null, reasons: sortedReasons(reasons) };
  }

  if (guide?.schemaVersion !== 1) reasons.push(finding(GUIDE_FINDING_CODES.SCHEMA_VERSION, scopeId, guideKind, `unsupported Guide schemaVersion: ${guide?.schemaVersion}`, { actual: guide?.schemaVersion, supported: 1 }, "regenerate"));
  if (guide?.dslVersion !== 1) reasons.push(finding(GUIDE_FINDING_CODES.DSL_VERSION, scopeId, guideKind, `unsupported Guide dslVersion: ${guide?.dslVersion}`, { actual: guide?.dslVersion, supported: 1 }, "regenerate"));
  const schemaResult = validate("guide", guide);
  if (!schemaResult.valid) {
    reasons.push(...schemaResult.errors.map((error) => finding(GUIDE_FINDING_CODES.SCHEMA, scopeId, guideKind, `${relative}${error.path}: ${error.message}`, { path: relative, error }, "regenerate")));
    return { state: "invalid", usable: false, persistedStatus: metadata?.status || null, reasons: sortedReasons(reasons) };
  }

  if (!metadata || guide.id !== metadata.id || guide.scopeId !== scopeId || guide.kind !== guideKind) reasons.push(finding(GUIDE_FINDING_CODES.METADATA, scopeId, guideKind, "Guide identity or scope metadata does not match", {}, "regenerate"));
  const { revision, ...withoutRevision } = guide;
  const expectedRevision = `sha256:${revisionHash(withoutRevision)}`;
  if (revision !== expectedRevision) reasons.push(finding(GUIDE_FINDING_CODES.REVISION, scopeId, guideKind, "Guide revision does not match canonical content", { expected: expectedRevision, actual: revision }, "regenerate"));
  const actualContentHash = contentHash(guideBytes);
  if (!metadata || metadata.contentHash !== actualContentHash) reasons.push(finding(GUIDE_FINDING_CODES.CONTENT_HASH, scopeId, guideKind, "Guide content hash does not match scope metadata", { expected: metadata?.contentHash || null, actual: actualContentHash }, "regenerate"));
  if (metadata && (metadata.revision !== guide.revision || !sameCanonicalValue(metadata.sourceRefs, guide.sourceRefs) || !sameCanonicalValue(metadata.provenance, guide.provenance))) {
    reasons.push(finding(GUIDE_FINDING_CODES.METADATA, scopeId, guideKind, "Guide revision/source/provenance metadata does not match canonical YAML", {}, "regenerate"));
  }

  const expectedSourceMapRevision = revisionHash({ sourceRefs: guide.sourceRefs, sourceFingerprints: guide.provenance.sourceFingerprints || {} });
  if (guide.provenance.sourceMapRevision !== expectedSourceMapRevision) reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_MAP, scopeId, guideKind, "Guide source map revision is inconsistent", { expected: expectedSourceMapRevision, actual: guide.provenance.sourceMapRevision }, "regenerate"));
  const expectedOutputHash = revisionHash(guidePayloadDocument(guide));
  if (guide.provenance.generationOutputHash !== expectedOutputHash) reasons.push(finding(GUIDE_FINDING_CODES.OUTPUT_HASH, scopeId, guideKind, "Guide generation output hash does not match executable Guide document", { expected: expectedOutputHash, actual: guide.provenance.generationOutputHash }, "regenerate"));

  if (metadata?.status === "approved") {
    if (!metadata.approval) reasons.push(finding(GUIDE_FINDING_CODES.APPROVAL, scopeId, guideKind, "approved Guide has no approval binding", {}, "submit_review"));
    else {
      if (metadata.approval.revision !== revision) reasons.push(finding(GUIDE_FINDING_CODES.APPROVAL_REVISION, scopeId, guideKind, "approval revision does not match Guide revision", { expected: revision, actual: metadata.approval.revision }, "regenerate"));
      if (metadata.approval.contentHash !== actualContentHash) reasons.push(finding(GUIDE_FINDING_CODES.APPROVAL_CONTENT, scopeId, guideKind, "approval content hash does not match Guide content", { expected: actualContentHash, actual: metadata.approval.contentHash }, "regenerate"));
    }
  } else if (metadata?.status === "rejected") reasons.push(finding(GUIDE_FINDING_CODES.REJECTED, scopeId, guideKind, "Guide was rejected", {}, "regenerate"));
  else if (metadata?.status === "stale") reasons.push(finding(GUIDE_FINDING_CODES.PERSISTED_STALE, scopeId, guideKind, "Guide is persistently marked stale", {}, "regenerate"));
  else if (metadata?.status) reasons.push(finding(GUIDE_FINDING_CODES.STATUS, scopeId, guideKind, `Guide status is ${metadata.status}`, { status: metadata.status }, "review"));
  else reasons.push(finding(GUIDE_FINDING_CODES.METADATA, scopeId, guideKind, "Guide lifecycle metadata is missing", {}, "regenerate"));

  addSourceFindings({ guide, sources, config, scopeId, kind: guideKind, reasons, sourceDrift, sourceDiagnostics });
  addGeneratorFindings({ guide, scope, workspaceRoot, config, sources, kind: guideKind, scopeId, reasons });
  for (const gap of guide.openGaps || []) reasons.push(finding(GUIDE_FINDING_CODES.OPEN_GAP, scopeId, guideKind, `Guide has open gap: ${gap.description}`, { gapId: gap.id }, "review"));

  try {
    const projectionPath = guidePath(planningRoot, scopeId, guideKind, `${guideKind}-guide.md`);
    if (!fs.existsSync(projectionPath)) reasons.push(finding(GUIDE_FINDING_CODES.PROJECTION_MISSING, scopeId, guideKind, "Markdown projection is missing", { path: `${guideKind}-guide.md` }, "regenerate"));
    else {
      const comparison = compareGuideProjection(guide, fs.readFileSync(projectionPath, "utf8"));
      if (!comparison.equal) reasons.push(finding(GUIDE_FINDING_CODES.PROJECTION_DRIFT, scopeId, guideKind, "Markdown projection differs from canonical Guide YAML", {}, "regenerate"));
    }
  } catch (error) {
    reasons.push(finding(GUIDE_FINDING_CODES.PROJECTION_DRIFT, scopeId, guideKind, `Markdown projection path is untrusted: ${error.message}`, {}, "regenerate"));
  }

  sortedReasons(reasons);
  const blocking = reasons.filter((reason) => reason.severity === "error");
  const structuralCodes = new Set([GUIDE_FINDING_CODES.SCHEMA, GUIDE_FINDING_CODES.SCHEMA_VERSION, GUIDE_FINDING_CODES.DSL_VERSION, GUIDE_FINDING_CODES.METADATA, GUIDE_FINDING_CODES.REVISION, GUIDE_FINDING_CODES.CONTENT_HASH, GUIDE_FINDING_CODES.OUTPUT_HASH, GUIDE_FINDING_CODES.SOURCE_MAP]);
  const structurallyInvalid = blocking.some((reason) => structuralCodes.has(reason.code));
  const state = structurallyInvalid ? "invalid" : metadata?.status === "approved" ? (blocking.length > 0 ? "approved_stale" : "approved_current") : metadata?.status || "invalid";
  return { state, usable: state === "approved_current", persistedStatus: metadata?.status || null, reasons };
}

export function evaluateGuideReadiness({ healthByKind, scopeId, requiredGuideKinds = ["task", "test"], policyMode = "strict" }) {
  if (!["strict", "advisory"].includes(policyMode)) throw new Error(`unsupported Guide readiness policy mode: ${policyMode}`);
  const required = [...new Set(requiredGuideKinds)];
  if (required.some((kind) => !["task", "test"].includes(kind))) throw new Error("requiredGuideKinds may contain only task and test");
  const findings = [];
  for (const kind of required) {
    const health = healthByKind[kind] || { state: "missing", usable: false, reasons: [finding(GUIDE_FINDING_CODES.MISSING, scopeId, kind, "required Guide is missing", {}, "generate")] };
    findings.push(...health.reasons);
  }
  const blocking = findings.filter((item) => item.severity === "error");
  return { scopeId, policyMode, requiredGuideKinds: required, ready: policyMode === "advisory" || blocking.length === 0, findings };
}
