import fs from "node:fs";
import path from "node:path";
import { validate } from "./schema.mjs";
import { parseYaml } from "./yaml.mjs";
import { contentHash, revisionHash } from "./canonical.mjs";
import { buildGuideGenerationInput } from "./guideGeneration.mjs";
import { compareGuideProjection } from "./guideProjection.mjs";
import { confineWritePath, confineUnder } from "./paths.mjs";

export const GUIDE_FINDING_CODES = Object.freeze({
  MISSING: "GUIDE_MISSING",
  SCHEMA: "GUIDE_SCHEMA_INVALID",
  METADATA: "GUIDE_METADATA_MISMATCH",
  REVISION: "GUIDE_REVISION_MISMATCH",
  CONTENT_HASH: "GUIDE_CONTENT_HASH_MISMATCH",
  STATUS: "GUIDE_STATUS_UNAPPROVED",
  REJECTED: "GUIDE_REJECTED",
  APPROVAL: "GUIDE_APPROVAL_MISSING",
  APPROVAL_REVISION: "GUIDE_APPROVAL_REVISION_MISMATCH",
  APPROVAL_CONTENT: "GUIDE_APPROVAL_CONTENT_HASH_MISMATCH",
  SOURCE_MISSING: "GUIDE_SOURCE_MISSING",
  SOURCE_UNCONFIRMED: "GUIDE_SOURCE_UNCONFIRMED",
  SOURCE_CHANGED: "GUIDE_SOURCE_FINGERPRINT_CHANGED",
  SOURCE_NOT_APPROVED: "GUIDE_SOURCE_NOT_APPROVED",
  INPUT_CHANGED: "GUIDE_GENERATION_INPUT_CHANGED",
  GENERATOR_MISSING: "GUIDE_GENERATOR_MISSING",
  GENERATOR_VERSION: "GUIDE_GENERATOR_VERSION_CHANGED",
  GENERATOR_FINGERPRINT: "GUIDE_GENERATOR_FINGERPRINT_CHANGED",
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

function currentGenerator({ workspaceRoot, scope, kind }) {
  const configured = scope.customGenerators?.[kind];
  if (!configured) return null;
  try {
    const executable = confineUnder(workspaceRoot, configured.executable);
    const stat = fs.lstatSync(executable);
    if (!stat.isFile() || stat.isSymbolicLink()) return { configured, missing: true };
    return { configured, fingerprint: contentHash(fs.readFileSync(executable)) };
  } catch {
    return { configured, missing: true };
  }
}

function addSourceFindings({ guide, sources, config, scopeId, kind, reasons }) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const approvedRefs = new Set(config.documentation?.source_refs || []);
  for (const sourceId of guide.sourceRefs || []) {
    const source = byId.get(sourceId);
    if (!source) {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_MISSING, scopeId, kind, `Documentation Source ${sourceId} is missing`, { sourceId }, "rerun_discovery"));
      continue;
    }
    if (!approvedRefs.has(sourceId)) reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_NOT_APPROVED, scopeId, kind, `Documentation Source ${sourceId} is not in approved Project Context refs`, { sourceId }, "repair_project_context_refs"));
    if (!source.confirmedFingerprint) {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_UNCONFIRMED, scopeId, kind, `Documentation Source ${sourceId} has no confirmed fingerprint`, { sourceId }, "rerun_discovery"));
    } else if (guide.provenance.sourceFingerprints?.[sourceId] !== source.confirmedFingerprint) {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_CHANGED, scopeId, kind, `Documentation Source ${sourceId} fingerprint changed`, { sourceId, expected: guide.provenance.sourceFingerprints?.[sourceId] || null, actual: source.confirmedFingerprint }, "regenerate"));
    }
    if (["deprecated", "historical", "unknown"].includes(source.availability)) {
      reasons.push(finding(GUIDE_FINDING_CODES.SOURCE_NOT_APPROVED, scopeId, kind, `Documentation Source ${sourceId} availability is ${source.availability}`, { sourceId, availability: source.availability }, "repair_project_context_refs"));
    }
  }
  for (const sourceId of approvedRefs) {
    if (!guide.sourceRefs.includes(sourceId)) reasons.push(finding(GUIDE_FINDING_CODES.INPUT_CHANGED, scopeId, kind, `approved Project Context source set changed for Guide`, { sourceId }, "regenerate"));
  }
}

function addGeneratorFindings({ guide, scope, workspaceRoot, config, kind, scopeId, reasons }) {
  const method = guide.provenance.generationMethod;
  const current = currentGenerator({ workspaceRoot, scope, kind });
  if (method === "custom") {
    if (!current || current.missing) {
      reasons.push(finding(GUIDE_FINDING_CODES.GENERATOR_MISSING, scopeId, kind, "configured custom generator is missing or unsafe", {}, "repair_generator_config"));
    } else {
      if (guide.provenance.generatorVersion !== current.configured.version) reasons.push(finding(GUIDE_FINDING_CODES.GENERATOR_VERSION, scopeId, kind, "custom generator version changed", { expected: guide.provenance.generatorVersion, actual: current.configured.version }, "regenerate"));
      if (guide.provenance.generatorFingerprint !== current.fingerprint) reasons.push(finding(GUIDE_FINDING_CODES.GENERATOR_FINGERPRINT, scopeId, kind, "custom generator fingerprint changed", { expected: guide.provenance.generatorFingerprint, actual: current.fingerprint }, "regenerate"));
    }
  } else if (method === "generic" && guide.provenance.generatorVersion !== "shipping-mode:generic-guide/1") {
    reasons.push(finding(GUIDE_FINDING_CODES.GENERATOR_VERSION, scopeId, kind, "generic generator version is no longer supported", { expected: guide.provenance.generatorVersion, actual: "shipping-mode:generic-guide/1" }, "regenerate"));
  }

  try {
    const { inputHash } = buildGuideGenerationInput({ scope, guideKind: kind, sources: config.__currentSources || [], config });
    if (guide.provenance.generationInputHash !== inputHash) reasons.push(finding(GUIDE_FINDING_CODES.INPUT_CHANGED, scopeId, kind, "Guide generation input changed", { expected: guide.provenance.generationInputHash, actual: inputHash }, "regenerate"));
  } catch (error) {
    reasons.push(finding(GUIDE_FINDING_CODES.INPUT_CHANGED, scopeId, kind, `Guide generation input cannot be reconstructed: ${error.message}`, {}, "repair_project_context_refs"));
  }
}

export function evaluateGuideHealth({ planningRoot, workspaceRoot, scope, guideKind, sources, config }) {
  const scopeId = scope.id;
  const relative = path.join("scopes", scopeId, `${guideKind}-guide.yml`);
  const reasons = [];
  const metadata = scope.guides?.[guideKind] || null;
  let guide;
  let guideBytes;
  try {
    const file = guidePath(planningRoot, scopeId, guideKind);
    if (!fs.existsSync(file)) {
      reasons.push(finding(GUIDE_FINDING_CODES.MISSING, scopeId, guideKind, "required Guide YAML is missing", { path: relative }, "generate"));
    } else {
      guideBytes = fs.readFileSync(file);
      guide = parseYaml(guideBytes.toString("utf8"));
      const schemaResult = validate("guide", guide);
      if (!schemaResult.valid) reasons.push(...schemaResult.errors.map((error) => finding(GUIDE_FINDING_CODES.SCHEMA, scopeId, guideKind, `${relative}${error.path}: ${error.message}`, { path: relative, error }, "regenerate")));
    }
  } catch (error) {
    reasons.push(finding(GUIDE_FINDING_CODES.SCHEMA, scopeId, guideKind, `${relative}: ${error.message}`, { path: relative }, "regenerate"));
  }

  if (!guide) return { state: "missing", usable: false, persistedStatus: metadata?.status || null, reasons };
  if (!metadata || guide.id !== metadata.id || guide.scopeId !== scopeId || guide.kind !== guideKind) reasons.push(finding(GUIDE_FINDING_CODES.METADATA, scopeId, guideKind, "Guide identity or scope metadata does not match", {}, "regenerate"));
  const { revision, ...withoutRevision } = guide;
  const expectedRevision = `sha256:${revisionHash(withoutRevision)}`;
  if (revision !== expectedRevision) reasons.push(finding(GUIDE_FINDING_CODES.REVISION, scopeId, guideKind, "Guide revision does not match canonical content", { expected: expectedRevision, actual: revision }, "regenerate"));
  const actualContentHash = contentHash(guideBytes);
  if (!metadata || metadata.contentHash !== actualContentHash) reasons.push(finding(GUIDE_FINDING_CODES.CONTENT_HASH, scopeId, guideKind, "Guide content hash does not match scope metadata", { expected: metadata?.contentHash || null, actual: actualContentHash }, "regenerate"));
  if (metadata?.status === "approved") {
    if (!metadata.approval) reasons.push(finding(GUIDE_FINDING_CODES.APPROVAL, scopeId, guideKind, "approved Guide has no approval binding", {}, "submit_review"));
    else {
      if (metadata.approval.revision !== revision) reasons.push(finding(GUIDE_FINDING_CODES.APPROVAL_REVISION, scopeId, guideKind, "approval revision does not match Guide revision", { expected: revision, actual: metadata.approval.revision }, "regenerate"));
      if (metadata.approval.contentHash !== actualContentHash) reasons.push(finding(GUIDE_FINDING_CODES.APPROVAL_CONTENT, scopeId, guideKind, "approval content hash does not match Guide content", { expected: actualContentHash, actual: metadata.approval.contentHash }, "regenerate"));
    }
  } else if (metadata?.status === "rejected") reasons.push(finding(GUIDE_FINDING_CODES.REJECTED, scopeId, guideKind, "Guide was rejected", {}, "regenerate"));
  else if (metadata?.status) reasons.push(finding(GUIDE_FINDING_CODES.STATUS, scopeId, guideKind, `Guide status is ${metadata.status}`, { status: metadata.status }, "review"));
  else reasons.push(finding(GUIDE_FINDING_CODES.METADATA, scopeId, guideKind, "Guide lifecycle metadata is missing", {}, "regenerate"));

  const healthConfig = { ...config, __currentSources: sources };
  addSourceFindings({ guide, sources, config, scopeId, kind: guideKind, reasons });
  addGeneratorFindings({ guide, scope, workspaceRoot, config: healthConfig, kind: guideKind, scopeId, reasons });
  for (const gap of guide.openGaps || []) reasons.push(finding(GUIDE_FINDING_CODES.OPEN_GAP, scopeId, guideKind, `Guide has open gap: ${gap.description}`, { gapId: gap.id }, "review"));

  const projectionPath = guidePath(planningRoot, scopeId, guideKind, `${guideKind}-guide.md`);
  if (!fs.existsSync(projectionPath)) reasons.push(finding(GUIDE_FINDING_CODES.PROJECTION_MISSING, scopeId, guideKind, "Markdown projection is missing", { path: `${guideKind}-guide.md` }, "regenerate"));
  else {
    const comparison = compareGuideProjection(guide, fs.readFileSync(projectionPath, "utf8"));
    if (!comparison.equal) reasons.push(finding(GUIDE_FINDING_CODES.PROJECTION_DRIFT, scopeId, guideKind, "Markdown projection differs from canonical Guide YAML", {}, "regenerate"));
  }

  reasons.sort((left, right) => `${left.code}:${JSON.stringify(left.evidence)}`.localeCompare(`${right.code}:${JSON.stringify(right.evidence)}`));
  const hasBlocking = reasons.some((reason) => reason.severity === "error");
  const state = metadata?.status === "approved" ? (hasBlocking ? "approved_stale" : "approved_current") : metadata?.status || "invalid";
  return { state, usable: state === "approved_current", persistedStatus: metadata?.status || null, reasons };
}

export function evaluateGuideReadiness({ healthByKind, scopeId, requiredGuideKinds = ["task", "test"], policyMode = "strict" }) {
  if (!["strict", "advisory"].includes(policyMode)) throw new Error(`unsupported Guide readiness policy mode: ${policyMode}`);
  const findings = [];
  for (const kind of requiredGuideKinds) {
    const health = healthByKind[kind] || { state: "missing", usable: false, reasons: [finding(GUIDE_FINDING_CODES.MISSING, scopeId, kind, "required Guide is missing", {}, "generate")] };
    findings.push(...health.reasons);
  }
  const blocking = findings.filter((item) => item.severity === "error");
  return { scopeId, policyMode, requiredGuideKinds: [...requiredGuideKinds], ready: policyMode === "advisory" || blocking.length === 0, findings };
}
