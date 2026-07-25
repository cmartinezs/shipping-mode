import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { computeSourceFingerprint, detectMoved, FingerprintError } from "./fingerprint.mjs";
import { confineWritePath, confineScopePath, PathConfinementError } from "./paths.mjs";
import { parseYaml } from "./yaml.mjs";
import { isUuidV7 } from "./ids.mjs";

function defaultExecFile(command, args, options) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

export function detectGit(workspaceRoot, { execFileFn = defaultExecFile } = {}) {
  let revision;
  try {
    revision = execFileFn("git", ["-C", workspaceRoot, "rev-parse", "HEAD"]).trim();
  } catch {
    return { enabled: false, revision: null, branch: null, remote: null, vcs: "none" };
  }
  const branch = execFileFn("git", ["-C", workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
  let remote = null;
  try {
    remote = execFileFn("git", ["-C", workspaceRoot, "config", "--get", "remote.origin.url"]).trim() || null;
    if (remote) remote = "origin";
  } catch {
    remote = null;
  }
  return { enabled: true, revision, branch, remote, vcs: "git" };
}

const SCOPE_MANIFEST_RULES = [
  { fileName: "package.json", ruleId: "scope.node-package", kind: "code" },
  { fileName: "pom.xml", ruleId: "scope.maven-project", kind: "code" },
  { fileName: "pyproject.toml", ruleId: "scope.python-project", kind: "code" },
  { fileName: "go.mod", ruleId: "scope.go-module", kind: "code" }
];

// Every rule below maps to one or more of the 19 families in
// docs/plugin-redesign-release-flow/04-release-init-configuracion.md:165-187. Each
// fileName/dirName appears in at most one rule (a path can still end up tagged with
// multiple families via a single rule's `families` array, e.g. scripts/ below).
const SOURCE_FILE_RULES = [
  { fileName: "package.json", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "pom.xml", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "pyproject.toml", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "go.mod", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "Cargo.toml", ruleId: "source.package-manifest", families: ["project-module-manifests"] },
  { fileName: "CODEOWNERS", ruleId: "source.ownership", families: ["ownership"] },
  { fileName: "AGENTS.md", ruleId: "source.agent-instructions", families: ["agent-repository-instructions"] },
  { fileName: "CLAUDE.md", ruleId: "source.agent-instructions", families: ["agent-repository-instructions"] },
  { fileName: "README.md", ruleId: "source.agent-instructions", families: ["agent-repository-instructions"] },
  { fileName: "CONTRIBUTING.md", ruleId: "source.agent-instructions", families: ["agent-repository-instructions"] },
  { fileName: "Dockerfile", ruleId: "source.env-runtime", families: ["local-runtime-environment"] },
  { fileName: "docker-compose.yml", ruleId: "source.env-runtime", families: ["local-runtime-environment"] },
  { fileName: ".env.example", ruleId: "source.env-runtime", families: ["local-runtime-environment"] },
  { fileName: ".eslintrc.json", ruleId: "source.quality-config", families: ["quality-definitions"] },
  { fileName: ".eslintrc.js", ruleId: "source.quality-config", families: ["quality-definitions"] },
  { fileName: ".prettierrc", ruleId: "source.quality-config", families: ["quality-definitions"] },
  { fileName: "sonar-project.properties", ruleId: "source.quality-config", families: ["quality-definitions"] },
  { fileName: "openapi.yaml", ruleId: "source.api-contract", families: ["public-data-contracts"] },
  { fileName: "openapi.yml", ruleId: "source.api-contract", families: ["public-data-contracts"] },
  { fileName: "openapi.json", ruleId: "source.api-contract", families: ["public-data-contracts"] },
  { fileName: "STYLEGUIDE.md", ruleId: "source.engineering-standard", families: ["engineering-standards"] },
  { fileName: "REPOSITORY_MAP.md", ruleId: "source.repository-map", families: ["repository-map"] }
];

const SOURCE_DIRECTORY_RULES = [
  { dirName: "adr", underDocs: true, ruleId: "source.adr-directory", families: ["decision-sources"] },
  { dirName: "decisions", underDocs: true, ruleId: "source.adr-directory", families: ["decision-sources"] },
  { relativePath: ".github/workflows", ruleId: "source.ci-workflows", families: ["delivery-ci-deployment"] },
  { dirName: "product", underDocs: true, ruleId: "source.product-docs", families: ["product-sources"] },
  { dirName: "requirements", underDocs: true, ruleId: "source.functional-requirements", families: ["functional-sources"] },
  { dirName: "architecture", underDocs: true, ruleId: "source.technical-architecture", families: ["technical-sources"] },
  { dirName: "developer-guide", underDocs: true, ruleId: "source.developer-guide", families: ["developer-guides"] },
  { dirName: "evidence", underDocs: true, ruleId: "source.evidence-docs", families: ["evidence-contracts"] },
  { dirName: "migrations", ruleId: "source.db-migrations", families: ["public-data-contracts"] },
  { dirName: "scripts", ruleId: "source.scripts-directory", families: ["execution-commands", "custom-automation"] },
  { dirName: "design-system", ruleId: "source.design-system", families: ["design-system"] },
  { dirName: "prompts", ruleId: "source.prompt-sources", families: ["prompt-sources"] },
  { dirName: "tools", ruleId: "source.custom-automation", families: ["custom-automation"] },
  { dirName: "bin", ruleId: "source.custom-automation", families: ["custom-automation"] }
];

function listTopLevel(currentDir, { readdirFn = fs.readdirSync, lstatFn = fs.lstatSync } = {}) {
  return readdirFn(currentDir).map((name) => ({
    name,
    absPath: path.join(currentDir, name),
    stat: lstatFn(path.join(currentDir, name))
  }));
}

export function enumerateCandidates(workspaceRoot, { readdirFn = fs.readdirSync, lstatFn = fs.lstatSync } = {}) {
  const scopeCandidates = [];
  const sourceCandidates = [];
  const diagnostics = [];

  function walk(currentDir, relativeDir) {
    let children;
    try {
      children = listTopLevel(currentDir, { readdirFn, lstatFn });
    } catch (error) {
      // Never silently drop a subtree: an EACCES, I/O error, or filesystem race here would
      // otherwise omit evidence with no trace at all, contradicting the design's "hard
      // diagnostic, never silent" principle just as much as a fingerprint failure would.
      diagnostics.push({ code: "enumeration_error", path: relativeDir || ".", message: error.message });
      return;
    }
    const fileNames = new Set(children.filter((c) => c.stat.isFile()).map((c) => c.name));

    for (const scopeRule of SCOPE_MANIFEST_RULES) {
      if (fileNames.has(scopeRule.fileName) && relativeDir !== "") {
        const existing = scopeCandidates.find((c) => c.path === `${relativeDir}/`);
        if (existing) {
          existing.signals.push(scopeRule.fileName);
          existing.suggestions.ruleIds.push(scopeRule.ruleId);
        } else {
          scopeCandidates.push({ path: `${relativeDir}/`, signals: [scopeRule.fileName], suggestions: { kind: scopeRule.kind, ruleIds: [scopeRule.ruleId] } });
        }
      }
    }

    for (const child of children) {
      if (child.stat.isSymbolicLink()) continue;
      const childRelative = relativeDir ? `${relativeDir}/${child.name}` : child.name;

      if (child.stat.isFile()) {
        const fileRule = SOURCE_FILE_RULES.find((r) => r.fileName === child.name);
        if (fileRule) sourceCandidates.push({ path: childRelative, candidateFamilies: fileRule.families, ruleIds: [fileRule.ruleId] });
      }

      if (child.stat.isDirectory()) {
        if (child.name === "node_modules" || child.name === ".git") continue;
        const dirRule = SOURCE_DIRECTORY_RULES.find((r) =>
          r.relativePath ? childRelative === r.relativePath : (r.dirName === child.name && (!r.underDocs || relativeDir === "docs"))
        );
        if (dirRule) sourceCandidates.push({ path: `${childRelative}/`, candidateFamilies: dirRule.families, ruleIds: [dirRule.ruleId] });
        walk(child.absPath, childRelative);
      }
    }
  }

  walk(workspaceRoot, "");
  return { scopeCandidates, sourceCandidates, diagnostics };
}

function readConfirmedSources(planningRoot) {
  const sourcesRoot = path.join(planningRoot, "sources");
  if (!fs.existsSync(sourcesRoot)) return [];
  const sources = [];
  for (const id of fs.readdirSync(sourcesRoot)) {
    if (!isUuidV7(id)) continue;
    const sourceFile = confineWritePath(planningRoot, path.join("sources", id, "source.yml"));
    if (!fs.existsSync(sourceFile)) continue;
    sources.push(parseYaml(fs.readFileSync(sourceFile, "utf8")));
  }
  return sources;
}

// Resolves a host-repository-relative path (a source's `path` field, or a candidate's
// `path`) safely under workspaceRoot -- relative-only, no `..` escapes, no absolute paths.
// Reuses the existing confineScopePath rather than inventing a parallel confinement
// function: a source's path needs exactly the same guarantee a scope's path already gets.
function resolveHostPath(workspaceRoot, relativePath) {
  return confineScopePath(workspaceRoot, relativePath);
}

function fingerprintOne(absolutePath, maxSourceBytes) {
  return computeSourceFingerprint(absolutePath, { maxBytes: maxSourceBytes });
}

export function computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates, maxSourceBytes }) {
  const confirmedSources = readConfirmedSources(planningRoot);
  const results = [];
  const diagnostics = [];
  const missingForMoveDetection = [];

  for (const source of confirmedSources) {
    let absolutePath;
    try {
      absolutePath = resolveHostPath(workspaceRoot, source.path);
    } catch (error) {
      if (!(error instanceof PathConfinementError)) throw error;
      diagnostics.push({ code: "untrusted_source_path", path: source.path, sourceId: source.id, message: error.message });
      continue; // never read outside workspaceRoot, and never let one bad entry crash the scan
    }
    if (!fs.existsSync(absolutePath)) {
      missingForMoveDetection.push({ sourceId: source.id, path: source.path, confirmedFingerprint: source.confirmedFingerprint, confirmedContentHash: source.confirmedContentHash });
      continue;
    }
    let observed;
    try {
      observed = fingerprintOne(absolutePath, maxSourceBytes);
    } catch (error) {
      if (!(error instanceof FingerprintError)) throw error;
      diagnostics.push({ code: error.code, path: source.path, sourceId: source.id, message: error.message });
      continue; // a fingerprint failure on one confirmed source must never abort the rest of the scan
    }
    const driftState = observed.fingerprint === source.confirmedFingerprint ? "unchanged" : "changed";
    results.push({
      sourceId: source.id,
      path: source.path,
      confirmedFingerprint: source.confirmedFingerprint,
      confirmedContentHash: source.confirmedContentHash,
      observedFingerprint: observed.fingerprint,
      observedContentHash: observed.contentHash,
      driftState,
      freshness: driftState === "unchanged" ? "current" : "stale",
      observedAtPath: null
    });
  }

  // Every candidate is fingerprinted unconditionally -- this is discover scan's own
  // observation, consumed both by move-detection below AND directly as the ScanResult's
  // sourceCandidates output (Task 11 uses fingerprintedSourceCandidates as-is).
  const fingerprintedSourceCandidates = [];
  for (const candidate of sourceCandidates) {
    let absolutePath;
    try {
      absolutePath = resolveHostPath(workspaceRoot, candidate.path);
    } catch (error) {
      if (!(error instanceof PathConfinementError)) throw error;
      diagnostics.push({ code: "untrusted_source_path", path: candidate.path, message: error.message });
      continue;
    }
    try {
      const observed = fingerprintOne(absolutePath, maxSourceBytes);
      fingerprintedSourceCandidates.push({ ...candidate, observedFingerprint: observed.fingerprint, observedContentHash: observed.contentHash });
    } catch (error) {
      if (!(error instanceof FingerprintError)) throw error;
      diagnostics.push({ code: error.code, path: candidate.path, message: error.message });
    }
  }

  if (missingForMoveDetection.length > 0) {
    const movedResults = detectMoved(missingForMoveDetection, fingerprintedSourceCandidates);
    for (const missing of missingForMoveDetection) {
      const moveResult = movedResults.find((r) => r.sourceId === missing.sourceId);
      results.push({
        sourceId: missing.sourceId,
        path: missing.path,
        confirmedFingerprint: missing.confirmedFingerprint,
        confirmedContentHash: missing.confirmedContentHash,
        observedFingerprint: null,
        observedContentHash: null,
        driftState: moveResult.driftState,
        observedAtPath: moveResult.observedAtPath
        // no `freshness` key at all for missing/moved -- see the Interfaces note above
      });
    }
  }

  return { results, diagnostics, fingerprintedSourceCandidates };
}

function readConfirmedScopes(planningRoot) {
  const scopesRoot = path.join(planningRoot, "scopes");
  if (!fs.existsSync(scopesRoot)) return [];
  const scopes = [];
  for (const id of fs.readdirSync(scopesRoot)) {
    if (!isUuidV7(id)) continue;
    const scopeFile = confineWritePath(planningRoot, path.join("scopes", id, "scope.yml"));
    if (!fs.existsSync(scopeFile)) continue;
    scopes.push(parseYaml(fs.readFileSync(scopeFile, "utf8")));
  }
  return scopes;
}

function allCommandEntries(scope) {
  if (!scope.commands) return [];
  const entries = [];
  for (const role of ["build", "test", "smoke", "lint", "verify"]) {
    if (scope.commands[role]) entries.push({ role, entry: scope.commands[role] });
  }
  for (const [role, entry] of Object.entries(scope.commands.custom || {})) {
    entries.push({ role: `custom.${role}`, entry });
  }
  return entries;
}

function evaluateCommandEvidence(commandEntry, knownSourceDrift) {
  if (!commandEntry.sourceRefs || commandEntry.sourceRefs.length === 0) {
    return { evidenceState: "not-evidence-backed", reasons: [] };
  }

  const driftById = new Map(knownSourceDrift.map((d) => [d.sourceId, d]));
  const refDrifts = commandEntry.sourceRefs.map((ref) => driftById.get(ref));

  if (refDrifts.some((d) => d === undefined || d.driftState === "missing")) {
    return { evidenceState: "evidence-missing", reasons: [] };
  }
  if (refDrifts.some((d) => d.observedFingerprint === undefined || d.observedFingerprint === null)) {
    return { evidenceState: "unknown", reasons: [] };
  }

  const reasons = new Set();
  let anyDrifted = false;
  let anyUpdated = false;
  for (const ref of commandEntry.sourceRefs) {
    const drift = driftById.get(ref);
    // NEVER fall back to observedFingerprint here: confirmedFingerprint (the catalog's
    // baseline) and observedFingerprint (what's live right now) answer different questions.
    // Using the live value as a stand-in for the catalog's would report a false
    // "catalog-advanced-since-selection" whenever there's live drift but the catalog itself
    // never moved -- exactly the bug this explicit field separation exists to prevent.
    if (drift.driftState === "changed") {
      anyDrifted = true;
      reasons.add("live-source-differs-from-catalog");
    }
    if (commandEntry.sourceFingerprintAtSelection[ref] !== drift.confirmedFingerprint) {
      anyUpdated = true;
      reasons.add("catalog-advanced-since-selection");
    }
  }

  if (anyDrifted) return { evidenceState: "evidence-drifted", reasons: [...reasons] };
  if (anyUpdated) return { evidenceState: "evidence-updated", reasons: [...reasons] };
  return { evidenceState: "current", reasons: [] };
}

export function computeCommandEvidence({ planningRoot, knownSourceDrift }) {
  const scopes = readConfirmedScopes(planningRoot);
  const results = [];
  for (const scope of scopes) {
    for (const { role, entry } of allCommandEntries(scope)) {
      const { evidenceState, reasons } = evaluateCommandEvidence(entry, knownSourceDrift);
      results.push({ scopeId: scope.id, role, evidenceState, reasons });
    }
  }
  return results;
}
