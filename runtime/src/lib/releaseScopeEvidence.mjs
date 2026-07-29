import fs from "node:fs";
import path from "node:path";
import { isUuidV7 } from "./ids.mjs";
import { contentHash, revisionHash } from "./canonical.mjs";
import { parseYaml } from "./yaml.mjs";
import { validate } from "./schema.mjs";
import { confineWritePath } from "./paths.mjs";
import { evaluateGuideHealth, evaluateGuideReadiness } from "./guideHealth.mjs";
import { readConfirmedSources } from "./discoverScan.mjs";

function readConfig(planningRoot) {
  const configFile = confineWritePath(planningRoot, "config.yml");
  if (!fs.existsSync(configFile)) throw new Error("Project Context config.yml is missing");
  return parseYaml(fs.readFileSync(configFile, "utf8"));
}

function readScope(planningRoot, scopeId) {
  if (!isUuidV7(scopeId)) throw new Error(`INVALID_REFERENCE: scope reference must be UUIDv7: ${scopeId}`);
  const relativePath = path.join("scopes", scopeId, "scope.yml");
  const filePath = confineWritePath(planningRoot, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`INVALID_REFERENCE: scope reference does not resolve: ${scopeId}`);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relativePath}: canonical scope must be a real file`);
  const scope = parseYaml(fs.readFileSync(filePath, "utf8"));
  const result = validate("scope", scope);
  if (!result.valid) throw new Error(`INVALID_REFERENCE: scope ${scopeId} is schema-invalid: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
  if (scope.id !== scopeId) throw new Error(`INVALID_REFERENCE: scope.id does not match directory ${scopeId}`);
  return { scope, revision: revisionHash(scope) };
}

function guideEvidence(planningRoot, scopeId, kind, health) {
  const relativePath = path.join("scopes", scopeId, `${kind}-guide.yml`);
  let guide = null;
  let hash = null;
  try {
    const filePath = confineWritePath(planningRoot, relativePath);
    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
      const bytes = fs.readFileSync(filePath);
      hash = contentHash(bytes);
      guide = parseYaml(bytes.toString("utf8"));
    }
  } catch {
    guide = null;
    hash = null;
  }
  return {
    kind,
    id: isUuidV7(guide?.id) ? guide.id : null,
    revision: typeof guide?.revision === "string" ? guide.revision : null,
    contentHash: hash,
    state: health.state,
    usable: Boolean(health.usable)
  };
}

function normalizeFinding(finding) {
  return {
    code: finding.code,
    severity: finding.severity,
    scopeId: finding.scopeId ?? null,
    guideKind: finding.guideKind ?? null,
    message: finding.message,
    evidence: finding.evidence || {},
    recommendedAction: finding.recommendedAction ?? null
  };
}

export function buildScopeRefsEvidence({ planningRoot, workspaceRoot, scopeIds, evaluatedAt, policyMode = "strict" }) {
  const uniqueScopeIds = [...new Set(scopeIds)].sort();
  if (uniqueScopeIds.length !== scopeIds.length) throw new Error("DUPLICATE_REFERENCE: duplicate scope reference");
  const sources = readConfirmedSources(planningRoot);
  const config = readConfig(planningRoot);
  const refs = [];
  const observedRevisions = {};
  for (const scopeId of uniqueScopeIds) {
    const { scope, revision } = readScope(planningRoot, scopeId);
    observedRevisions[`scopes/${scopeId}/scope.yml`] = revision;
    const healthByKind = {
      task: evaluateGuideHealth({ planningRoot, workspaceRoot, scope, guideKind: "task", sources, config }),
      test: evaluateGuideHealth({ planningRoot, workspaceRoot, scope, guideKind: "test", sources, config })
    };
    for (const kind of ["task", "test"]) {
      const guidePath = path.join("scopes", scopeId, `${kind}-guide.yml`);
      try {
        const guideFile = confineWritePath(planningRoot, guidePath);
        if (fs.existsSync(guideFile)) observedRevisions[guidePath] = revisionHash(parseYaml(fs.readFileSync(guideFile, "utf8")));
      } catch {
        observedRevisions[guidePath] = "UNREADABLE";
      }
    }
    const readiness = evaluateGuideReadiness({ healthByKind, scopeId, requiredGuideKinds: ["task", "test"], policyMode });
    refs.push({
      scopeId,
      evaluatedAt,
      readiness: { policyMode, ready: readiness.ready },
      guides: [
        guideEvidence(planningRoot, scopeId, "task", healthByKind.task),
        guideEvidence(planningRoot, scopeId, "test", healthByKind.test)
      ],
      findings: readiness.findings.map(normalizeFinding)
    });
  }
  return { refs, observedRevisions };
}

export function assertScopeEvidenceCurrent({ planningRoot, workspaceRoot, scopeIds, evaluatedAt, policyMode, expectedRefs, expectedRevisions }) {
  const current = buildScopeRefsEvidence({ planningRoot, workspaceRoot, scopeIds, evaluatedAt, policyMode });
  for (const [relativePath, revision] of Object.entries(expectedRevisions || {})) {
    if (current.observedRevisions[relativePath] !== revision) {
      const error = new Error(`GUIDE_EVIDENCE_STALE: ${relativePath} changed since propose`);
      error.code = "STALE";
      throw error;
    }
  }
  if (revisionHash(current.refs) !== revisionHash(expectedRefs)) {
    const error = new Error("GUIDE_EVIDENCE_STALE: scope guide evidence changed since propose");
    error.code = "STALE";
    throw error;
  }
  return current.refs;
}
