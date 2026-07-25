import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
