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
