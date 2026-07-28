#!/usr/bin/env bash
set -euo pipefail

cat > runtime/src/lib/guideGeneration.mjs <<'EOF'
import { revisionHash } from "./canonical.mjs";
import { runConfiguredGuideGenerator } from "./customGuideGenerator.mjs";

function sourceSnapshot(source) {
  return {
    id: source.id,
    family: source.family,
    kind: source.kind,
    role: source.role,
    authority: source.authority,
    availability: source.availability,
    confirmedFingerprint: source.confirmedFingerprint
  };
}

export function normalizeGuideGeneratorConfig(generator) {
  if (!generator) return null;
  return {
    executable: generator.executable,
    args: [...(generator.args || [])],
    cwd: generator.cwd || null,
    version: generator.version,
    timeoutMs: generator.timeoutMs || 1000,
    maxOutputBytes: generator.maxOutputBytes || 256 * 1024
  };
}

export function customGuideGenerationInputHash({ input, generator }) {
  return revisionHash({ guideInput: input, generatorConfig: normalizeGuideGeneratorConfig(generator) });
}

export function buildGuideGenerationInput({ scope, guideKind, sources, config }) {
  const refs = [...new Set(config.documentation?.source_refs || [])].sort();
  if (refs.length === 0) throw new Error("guide generation requires approved Project Context documentation.source_refs");
  const byId = new Map(sources.map((source) => [source.id, source]));
  const missing = refs.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`approved Documentation Source refs do not resolve: ${missing.join(", ")}`);
  const selected = refs.map((id) => byId.get(id));
  const input = {
    schemaVersion: 1,
    dslVersion: 1,
    guideKind,
    scope: { id: scope.id, key: scope.key, label: scope.label, kind: scope.kind, path: scope.path },
    sourceRefs: selected.map((source) => source.id),
    sources: selected.map(sourceSnapshot),
    commands: scope.commands || {},
    configRefs: { scopeCatalog: config.scopeCatalog || null, documentationSourceRefs: refs },
    schemaVersionRef: "guide/1",
    dslVersionRef: "guide-dsl/1"
  };
  return { input, inputHash: revisionHash(input) };
}

export function genericGuideOutput(input) {
  const sourceRefs = [...input.sourceRefs].sort();
  const openGaps = [{
    id: sourceRefs[0],
    category: "generation_incomplete",
    description: "generic metadata-only generation cannot derive executable guide rules; human or custom-generator input is required",
    sourceRefs
  }];
  if (input.guideKind === "task") {
    return { sourceRefs, workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" }, openGaps };
  }
  return { sourceRefs, gatesByWorkPackageType: [], gatesByTaskType: [], commandRefs: [], evidenceRequirements: [], testData: [], executionContexts: [], environments: [], openGaps };
}

export function generateGuideOutput({ workspaceRoot, scope, guideKind, sources, config }) {
  const built = buildGuideGenerationInput({ scope, guideKind, sources, config });
  const generator = scope.customGenerators?.[guideKind];
  if (generator) {
    const result = runConfiguredGuideGenerator({ workspaceRoot, generator, input: built.input, timeoutMs: generator.timeoutMs || 1000, maxOutputBytes: generator.maxOutputBytes || 256 * 1024 });
    return {
      document: result.output,
      evidence: {
        generationMethod: "custom",
        generatorVersion: generator.version,
        generatorFingerprint: result.generatorFingerprint,
        generationInputHash: customGuideGenerationInputHash({ input: built.input, generator }),
        generationOutputHash: result.outputHash
      }
    };
  }
  const document = genericGuideOutput(built.input);
  return {
    document,
    evidence: {
      generationMethod: "generic",
      generatorVersion: "shipping-mode:generic-guide/1",
      generatorFingerprint: null,
      generationInputHash: built.inputHash,
      generationOutputHash: revisionHash(document)
    }
  };
}
EOF

cat > runtime/src/lib/guideHealth.mjs <<'EOF'
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
EOF

cat > runtime/src/commands/checkGuides.mjs <<'EOF'
import fs from "node:fs";
import path from "node:path";
import { assertTrustedRoots, confineWritePath } from "../lib/paths.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { isUuidV7 } from "../lib/ids.mjs";
import { readConfirmedSources, computeKnownSourceDrift, DEFAULT_MAX_SOURCE_BYTES } from "../lib/discoverScan.mjs";
import { evaluateGuideHealth, evaluateGuideReadiness } from "../lib/guideHealth.mjs";
import { validate } from "../lib/schema.mjs";
import { UsageError } from "../lib/errors.mjs";
import { checkSchema } from "./check.mjs";

function workspaceFinding(code, message, evidence = {}, recommendedAction = "inspect") {
  return { code, severity: "error", scopeId: null, guideKind: null, message, evidence, recommendedAction };
}

function readConfig(planningRoot) {
  const config = parseYaml(fs.readFileSync(confineWritePath(planningRoot, "config.yml"), "utf8"));
  const result = validate("config", config);
  if (!result.valid) throw new Error(result.errors.map((entry) => `${entry.path}: ${entry.message}`).join("; "));
  return config;
}

function readEnabledScopes(planningRoot, enabledIds, findings) {
  const scopes = [];
  for (const id of [...enabledIds].sort()) {
    const relative = path.join("scopes", id, "scope.yml");
    let file;
    try {
      file = confineWritePath(planningRoot, relative);
    } catch (error) {
      findings.push(workspaceFinding("GUIDE_SCOPE_INVALID", `enabled Scope ${id} has an untrusted path: ${error.message}`, { scopeId: id }, "repair_scope_catalog"));
      continue;
    }
    if (!fs.existsSync(file)) {
      findings.push(workspaceFinding("GUIDE_SCOPE_MISSING", `enabled Scope ${id} is missing scope.yml`, { scopeId: id }, "repair_scope_catalog"));
      continue;
    }
    try {
      const scope = parseYaml(fs.readFileSync(file, "utf8"));
      const result = validate("scope", scope);
      if (!result.valid) throw new Error(result.errors.map((entry) => `${entry.path}: ${entry.message}`).join("; "));
      if (scope.id !== id) throw new Error(`scope.id ${scope.id} does not match directory ${id}`);
      scopes.push(scope);
    } catch (error) {
      findings.push(workspaceFinding("GUIDE_SCOPE_INVALID", `enabled Scope ${id} is invalid: ${error.message}`, { scopeId: id }, "repair_scope_catalog"));
    }
  }
  return scopes;
}

function stableFindings(findings) {
  return findings.sort((left, right) => `${left.scopeId || ""}:${left.guideKind || ""}:${left.code}:${JSON.stringify(left.evidence || {})}`.localeCompare(`${right.scopeId || ""}:${right.guideKind || ""}:${right.code}:${JSON.stringify(right.evidence || {})}`));
}

export function checkGuides({ planningRoot, workspaceRoot, scopeId = null, policyMode = "strict" }) {
  if (!fs.existsSync(planningRoot)) return { status: "NOT_INITIALIZED", findings: [workspaceFinding("GUIDE_WORKSPACE_NOT_INITIALIZED", "workspace is not initialized")], scopes: [] };
  if (!["strict", "advisory"].includes(policyMode)) throw new UsageError("check guides --mode must be strict or advisory");
  if (scopeId && !isUuidV7(scopeId)) throw new UsageError(`invalid scope id: ${scopeId}`);

  assertTrustedRoots(planningRoot);
  const schema = checkSchema({ planningRoot });
  if (schema.status === "RECOVERY_REQUIRED") return { status: "RECOVERY_REQUIRED", findings: schema.findings, scopes: [], pendingOperations: schema.pendingOperations };

  const findings = (schema.findings || []).map((message) => workspaceFinding("GUIDE_WORKSPACE_SCHEMA_INVALID", message, {}, "run_check_schema"));
  let config;
  try {
    config = readConfig(planningRoot);
  } catch (error) {
    findings.push(workspaceFinding("GUIDE_PROJECT_CONTEXT_INVALID", `Project Context cannot be read: ${error.message}`, {}, "run_check_schema"));
    return { status: "FAIL", policyMode, scopes: [], findings: stableFindings(findings), pendingOperations: schema.pendingOperations || [] };
  }

  const enabledIds = new Set(config.scopeCatalog?.enabled || []);
  if (scopeId && !enabledIds.has(scopeId)) {
    findings.push(workspaceFinding("GUIDE_SCOPE_NOT_ENABLED", `Scope ${scopeId} is not enabled in Project Context`, { scopeId }, "repair_scope_catalog"));
    return { status: "FAIL", policyMode, scopes: [], findings: stableFindings(findings), pendingOperations: schema.pendingOperations || [] };
  }
  const selectedIds = scopeId ? new Set([scopeId]) : enabledIds;
  const scopes = readEnabledScopes(planningRoot, selectedIds, findings);

  let sources;
  try {
    sources = readConfirmedSources(planningRoot);
  } catch (error) {
    findings.push(workspaceFinding("GUIDE_SOURCE_CATALOG_INVALID", `Documentation Source catalog cannot be read: ${error.message}`, {}, "run_check_schema"));
    return { status: "FAIL", policyMode, scopes: [], findings: stableFindings(findings), pendingOperations: schema.pendingOperations || [] };
  }

  let observation = { results: [], diagnostics: [] };
  try {
    observation = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: DEFAULT_MAX_SOURCE_BYTES });
  } catch (error) {
    findings.push(workspaceFinding("GUIDE_SOURCE_OBSERVATION_FAILED", `current repository source state cannot be observed: ${error.message}`, {}, "rerun_discovery"));
  }

  const resultScopes = scopes.map((scope) => {
    const guides = {};
    for (const kind of ["task", "test"]) {
      guides[kind] = evaluateGuideHealth({ planningRoot, workspaceRoot, scope, guideKind: kind, sources, config, sourceDrift: observation.results, sourceDiagnostics: observation.diagnostics });
    }
    const readiness = evaluateGuideReadiness({ healthByKind: guides, scopeId: scope.id, requiredGuideKinds: ["task", "test"], policyMode });
    return { scopeId: scope.id, guides, readiness };
  });

  findings.push(...resultScopes.flatMap((entry) => entry.readiness.findings));
  stableFindings(findings);
  const hasErrors = findings.some((entry) => entry.severity === "error") || schema.status === "FAIL";
  const hasWarnings = findings.some((entry) => entry.severity === "warning");
  return { status: hasErrors ? "FAIL" : hasWarnings ? "WARN" : "PASS", policyMode, scopes: resultScopes, findings, pendingOperations: schema.pendingOperations || [] };
}
EOF

cat > runtime/src/lib/tests/guide-health-regressions.test.mjs <<'EOF'
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { revisionHash, contentHash } from "../canonical.mjs";
import { computeSourceFingerprint } from "../fingerprint.mjs";
import { renderGuideMarkdown } from "../guideProjection.mjs";
import { buildGuideGenerationInput, customGuideGenerationInputHash } from "../guideGeneration.mjs";
import { evaluateGuideHealth } from "../guideHealth.mjs";
import { computeKnownSourceDrift, DEFAULT_MAX_SOURCE_BYTES } from "../discoverScan.mjs";

const scopeId = "018f0000-0000-7000-8000-000000000021";
const guideId = "018f0000-0000-7000-8000-000000000022";
const sourceId = "018f0000-0000-7000-8000-000000000011";

function taskPayload(refs = [sourceId]) {
  return { sourceRefs: refs, workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" }, openGaps: [] };
}

function fixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guide-health-regression-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  const sourcePath = "docs/source.md";
  fs.mkdirSync(path.join(workspaceRoot, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, sourcePath), "version-one\n");
  const observed = computeSourceFingerprint(path.join(workspaceRoot, sourcePath), { maxBytes: DEFAULT_MAX_SOURCE_BYTES });
  const source = { schemaVersion: 1, id: sourceId, path: sourcePath, family: "technical-sources", kind: "testing", role: "canonical", authority: { standing: "authoritative", force: "normative" }, availability: "implemented", confirmedFingerprint: observed.fingerprint, confirmedContentHash: observed.contentHash };
  fs.mkdirSync(path.join(planningRoot, "sources", sourceId), { recursive: true });
  fs.writeFileSync(path.join(planningRoot, "sources", sourceId, "source.yml"), stringifyYaml(source));
  const scope = { schemaVersion: 1, id: scopeId, key: "api", label: "API", kind: "code", path: "src/", owner: null, commands: {} };
  const config = { documentation: { source_refs: [sourceId] }, scopeCatalog: { directory: ".planning/scopes", enabled: [scopeId] } };
  return { workspaceRoot, planningRoot, sourcePath, source, scope, config };
}

function persistApprovedTask({ planningRoot, scope, source, config, method = "manual", generator = null }) {
  const payload = taskPayload();
  let generationInputHash;
  let generatorVersion;
  let generatorFingerprint = null;
  if (method === "manual") {
    generationInputHash = revisionHash({ scopeId, guideKind: "task", document: payload });
    generatorVersion = "shipping-mode:manual-guide-input/1";
  } else {
    const built = buildGuideGenerationInput({ scope, guideKind: "task", sources: [source], config });
    generationInputHash = method === "custom" ? customGuideGenerationInputHash({ input: built.input, generator }) : built.inputHash;
    generatorVersion = method === "custom" ? generator.version : "shipping-mode:generic-guide/1";
    if (method === "custom") generatorFingerprint = contentHash(fs.readFileSync(path.join(path.dirname(planningRoot), generator.executable)));
  }
  const provenance = {
    sourceMapRevision: revisionHash({ sourceRefs: [sourceId], sourceFingerprints: { [sourceId]: source.confirmedFingerprint } }),
    generationMethod: method,
    generatorVersion,
    generatorFingerprint,
    generatedAt: "2026-07-28T00:00:00Z",
    sourceFingerprints: { [sourceId]: source.confirmedFingerprint },
    generationInputHash,
    generationOutputHash: revisionHash(payload)
  };
  const withoutRevision = { schemaVersion: 1, dslVersion: 1, id: guideId, scopeId, kind: "task", sourceRefs: payload.sourceRefs, provenance, openGaps: payload.openGaps, workPackageTypes: payload.workPackageTypes, taskTypes: payload.taskTypes, requiredSections: payload.requiredSections, requiredGateRefs: payload.requiredGateRefs, templateRefs: payload.templateRefs, decompositionRules: payload.decompositionRules, automation: payload.automation };
  const guide = { ...withoutRevision, revision: `sha256:${revisionHash(withoutRevision)}` };
  const bytes = Buffer.from(stringifyYaml(guide));
  const metadata = { id: guideId, scopeId, kind: "task", status: "approved", path: "task-guide.yml", projection: "task-guide.md", revision: guide.revision, contentHash: contentHash(bytes), sourceRefs: guide.sourceRefs, provenance: guide.provenance, approval: { actor: "reviewer", approvedAt: "2026-07-28T00:00:00Z", revision: guide.revision, contentHash: contentHash(bytes) } };
  const scopeWithGuide = { ...scope, ...(generator ? { customGenerators: { task: generator } } : {}), guides: { task: metadata } };
  fs.mkdirSync(path.join(planningRoot, "scopes", scopeId), { recursive: true });
  fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, "task-guide.yml"), bytes);
  fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, "task-guide.md"), renderGuideMarkdown(guide));
  return { guide, scope: scopeWithGuide };
}

function observe({ planningRoot, workspaceRoot }) {
  return computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: DEFAULT_MAX_SOURCE_BYTES });
}

// Manual Guides use their own server-owned input contract and ignore unrelated approved-source additions and generator configuration.
{
  const f = fixture();
  const persisted = persistApprovedTask(f);
  let current = observe(f);
  let health = evaluateGuideHealth({ ...f, scope: { ...persisted.scope, customGenerators: { task: { executable: "tools/unused.mjs", args: [], version: "1" } } }, guideKind: "task", sources: [f.source], sourceDrift: current.results, sourceDiagnostics: current.diagnostics });
  assert.equal(health.state, "approved_current");
  const unrelatedId = "018f0000-0000-7000-8000-000000000012";
  health = evaluateGuideHealth({ ...f, scope: persisted.scope, guideKind: "task", sources: [f.source], config: { ...f.config, documentation: { source_refs: [sourceId, unrelatedId] } }, sourceDrift: current.results, sourceDiagnostics: current.diagnostics });
  assert.equal(health.state, "approved_current", "manual Guide must not stale because an unrelated approved source was added");
  fs.writeFileSync(path.join(f.workspaceRoot, f.sourcePath), "version-two\n");
  current = observe(f);
  health = evaluateGuideHealth({ ...f, scope: persisted.scope, guideKind: "task", sources: [f.source], sourceDrift: current.results, sourceDiagnostics: current.diagnostics });
  assert.ok(health.reasons.some((entry) => entry.code === "GUIDE_SOURCE_FINGERPRINT_CHANGED"), "live repository drift must stale before catalog mutation");
}

// Custom generator args/cwd/limits participate in effective generation input.
{
  const f = fixture();
  fs.mkdirSync(path.join(f.workspaceRoot, "tools"), { recursive: true });
  fs.writeFileSync(path.join(f.workspaceRoot, "tools/gen.mjs"), "process.stdout.write('{}')\n");
  const generator = { executable: "tools/gen.mjs", args: ["--mode", "a"], cwd: null, version: "1", timeoutMs: 1000, maxOutputBytes: 4096 };
  const persisted = persistApprovedTask({ ...f, method: "custom", generator });
  const current = observe(f);
  let health = evaluateGuideHealth({ ...f, scope: persisted.scope, guideKind: "task", sources: [f.source], sourceDrift: current.results, sourceDiagnostics: current.diagnostics });
  assert.equal(health.state, "approved_current");
  const changedScope = { ...persisted.scope, customGenerators: { task: { ...generator, args: ["--mode", "b"] } } };
  health = evaluateGuideHealth({ ...f, scope: changedScope, guideKind: "task", sources: [f.source], sourceDrift: current.results, sourceDiagnostics: current.diagnostics });
  assert.ok(health.reasons.some((entry) => entry.code === "GUIDE_GENERATOR_CONFIG_CHANGED"));
}

// Schema-invalid Guides and metadata divergence are structured failures, never exceptions or ready results.
{
  const f = fixture();
  const persisted = persistApprovedTask(f);
  fs.writeFileSync(path.join(f.planningRoot, "scopes", scopeId, "task-guide.yml"), stringifyYaml({ schemaVersion: 1 }));
  let health = evaluateGuideHealth({ ...f, scope: persisted.scope, guideKind: "task", sources: [f.source], sourceDrift: [], sourceDiagnostics: [] });
  assert.equal(health.state, "invalid");
  assert.ok(health.reasons.some((entry) => entry.code === "GUIDE_SCHEMA_INVALID"));

  const restored = persistApprovedTask(f);
  const divergentScope = { ...restored.scope, guides: { task: { ...restored.scope.guides.task, provenance: { ...restored.scope.guides.task.provenance, generatorVersion: "tampered" } } } };
  health = evaluateGuideHealth({ ...f, scope: divergentScope, guideKind: "task", sources: [f.source], sourceDrift: observe(f).results, sourceDiagnostics: [] });
  assert.equal(health.state, "invalid");
  assert.ok(health.reasons.some((entry) => entry.code === "GUIDE_METADATA_MISMATCH"));
}

console.log("guide-health regressions: manual provenance, live drift, generator config, invalid schema and metadata binding pass");
EOF

cat > runtime/src/commands/tests/public-scope-generator-kind.test.mjs <<'EOF'
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatch, UsageError } from "../../index.mjs";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "public-generator-kind-"));
assert.throws(
  () => dispatch("changeset", ["propose", "--kind", "scope.generator.set"], cwd),
  (error) => error instanceof UsageError && /requires --actor/.test(error.message),
  "scope.generator.set must be a real public ChangeSet kind, not NOT_IMPLEMENTED"
);
console.log("public scope.generator.set: dispatch recognizes the ChangeSet kind");
EOF

python3 - <<'PY'
from pathlib import Path

p = Path('runtime/src/commands/renderers.mjs')
s = p.read_text()
s = s.replace('  provenance.generationOutputHash = revisionHash(withoutRevision);\n  const document = { ...withoutRevision, revision: `sha256:${revisionHash(withoutRevision)}` };', '  const document = { ...withoutRevision, revision: `sha256:${revisionHash(withoutRevision)}` };')
p.write_text(s)

p = Path('runtime/src/index.mjs')
s = p.read_text()
s = s.replace('"scope.add", "scope.command.set", "guide.update"', '"scope.add", "scope.command.set", "scope.generator.set", "guide.update"')
p.write_text(s)

p = Path('runtime/src/commands/tests/check-guides.test.mjs')
s = p.read_text()
append = '''\nconst unknownScope = checkGuides({ planningRoot, workspaceRoot: workspace, scopeId: "018f0000-0000-7000-8000-000000000099", policyMode: "strict" });\nassert.equal(unknownScope.status, "FAIL");\nassert.ok(unknownScope.findings.some((entry) => entry.code === "GUIDE_SCOPE_NOT_ENABLED"));\n'''
if 'GUIDE_SCOPE_NOT_ENABLED' not in s:
    s = s.replace('console.log("check-guides: initialized workspace, query-only behavior and stable PASS pass");', append + '\nconsole.log("check-guides: initialized workspace, query-only behavior, stable PASS and unknown-scope failure pass");')
p.write_text(s)

p = Path('docs/superpowers/plans/2026-07-27-corte-1-plan-3-staleness-strict-check-guides.md')
s = p.read_text()
addition = '''\n## Post-review corrections\n\nAdversarial PR review identified and closed six trust-boundary gaps before merge:\n\n1. manual Guides now reconstruct the manual server-owned input hash instead of the source-driven generator input; unrelated approved sources and later generator configuration do not stale them;\n2. custom generator executable, version and normalized non-secret configuration (`args`, `cwd`, timeout and output limit) participate in effective generation evidence;\n3. `check guides` observes the live repository through the existing Discovery fingerprint engine, so source-file drift blocks strict readiness before the confirmed catalog is mutated;\n4. schema-invalid Guides return structured `invalid` health instead of throwing during deeper provenance/source access;\n5. YAML-to-scope metadata revision, source refs and provenance are validated by the shared health primitive, and the persisted generation output hash remains bound to the actual generated payload;\n6. the public dispatcher recognizes `scope.generator.set`, matching the schema/runtime/help contract from Plan 2.\n\n`check guides` also evaluates only Project Context-enabled scopes, rejects an unknown selected scope, and includes workspace-schema findings in its machine-readable output.\n'''
if '## Post-review corrections' not in s:
    s += addition
p.write_text(s)
PY
