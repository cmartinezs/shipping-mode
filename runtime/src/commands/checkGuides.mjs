import fs from "node:fs";
import path from "node:path";
import { assertTrustedRoots, confineWritePath } from "../lib/paths.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { isUuidV7 } from "../lib/ids.mjs";
import { readConfirmedScopes, readConfirmedSources } from "../lib/discoverScan.mjs";
import { evaluateGuideHealth, evaluateGuideReadiness } from "../lib/guideHealth.mjs";
import { checkSchema } from "./check.mjs";

function readConfig(planningRoot) {
  return parseYaml(fs.readFileSync(confineWritePath(planningRoot, "config.yml"), "utf8"));
}

export function checkGuides({ planningRoot, workspaceRoot, scopeId = null, policyMode = "strict" }) {
  if (!fs.existsSync(planningRoot)) return { status: "NOT_INITIALIZED", findings: [{ code: "GUIDE_WORKSPACE_NOT_INITIALIZED", severity: "error", message: "workspace is not initialized" }], scopes: [] };
  assertTrustedRoots(planningRoot);
  const schema = checkSchema({ planningRoot });
  if (schema.status === "RECOVERY_REQUIRED") return { status: "RECOVERY_REQUIRED", findings: schema.findings, scopes: [], pendingOperations: schema.pendingOperations };
  const config = readConfig(planningRoot);
  const scopes = readConfirmedScopes(planningRoot).filter((scope) => !scopeId || scope.id === scopeId);
  if (scopeId && !isUuidV7(scopeId)) throw new Error(`invalid scope id: ${scopeId}`);
  const sources = readConfirmedSources(planningRoot);
  const resultScopes = scopes.map((scope) => {
    const guides = {};
    for (const kind of ["task", "test"]) guides[kind] = evaluateGuideHealth({ planningRoot, workspaceRoot, scope, guideKind: kind, sources, config });
    const readiness = evaluateGuideReadiness({ healthByKind: guides, scopeId: scope.id, requiredGuideKinds: ["task", "test"], policyMode });
    return { scopeId: scope.id, guides, readiness };
  });
  const findings = resultScopes.flatMap((entry) => entry.readiness.findings);
  const hasErrors = findings.some((entry) => entry.severity === "error") || schema.status === "FAIL";
  const hasWarnings = findings.some((entry) => entry.severity === "warning");
  return { status: hasErrors ? "FAIL" : hasWarnings ? "WARN" : "PASS", policyMode, scopes: resultScopes, findings, pendingOperations: schema.pendingOperations || [] };
}
