import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { enumerateCandidates } from "../discoverScan.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "discover-candidates-"));
fs.mkdirSync(path.join(root, "api"));
fs.writeFileSync(path.join(root, "api", "pom.xml"), "<project/>");
fs.mkdirSync(path.join(root, "web"));
fs.writeFileSync(path.join(root, "web", "package.json"), "{}");
fs.mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
fs.mkdirSync(path.join(root, "docs", "product"), { recursive: true });
fs.mkdirSync(path.join(root, "docs", "requirements"), { recursive: true });
fs.mkdirSync(path.join(root, "docs", "architecture"), { recursive: true });
fs.mkdirSync(path.join(root, "docs", "developer-guide"), { recursive: true });
fs.mkdirSync(path.join(root, "docs", "evidence"), { recursive: true });
fs.writeFileSync(path.join(root, "CODEOWNERS"), "* @carlos");
fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
fs.writeFileSync(path.join(root, "AGENTS.md"), "# agent instructions");
fs.writeFileSync(path.join(root, "REPOSITORY_MAP.md"), "# map");
fs.writeFileSync(path.join(root, "STYLEGUIDE.md"), "# standards");
fs.mkdirSync(path.join(root, "scripts"));
fs.mkdirSync(path.join(root, "design-system"));
fs.mkdirSync(path.join(root, "prompts"));
fs.mkdirSync(path.join(root, "migrations"));
fs.writeFileSync(path.join(root, "openapi.yaml"), "openapi: 3.0.0");
fs.writeFileSync(path.join(root, ".eslintrc.json"), "{}");

const result = enumerateCandidates(root);

const apiScope = result.scopeCandidates.find((c) => c.path === "api/");
assert.ok(apiScope, "api/ with pom.xml should be a scope candidate");
assert.deepEqual(apiScope.signals, ["pom.xml"]);
assert.equal(apiScope.suggestions.kind, "code");
assert.ok(apiScope.suggestions.ruleIds.includes("scope.maven-project"));

const webScope = result.scopeCandidates.find((c) => c.path === "web/");
assert.ok(webScope, "web/ with package.json should be a scope candidate");
assert.ok(webScope.suggestions.ruleIds.includes("scope.node-package"));

// one representative check per family -- all 19 families must have at least one matching rule
const byPath = (p) => result.sourceCandidates.find((c) => c.path === p);
assert.ok(byPath("docs/adr/")?.candidateFamilies.includes("decision-sources"));
assert.ok(byPath("docs/product/")?.candidateFamilies.includes("product-sources"));
assert.ok(byPath("docs/requirements/")?.candidateFamilies.includes("functional-sources"));
assert.ok(byPath("docs/architecture/")?.candidateFamilies.includes("technical-sources"));
assert.ok(byPath("docs/developer-guide/")?.candidateFamilies.includes("developer-guides"));
assert.ok(byPath("docs/evidence/")?.candidateFamilies.includes("evidence-contracts"));
assert.ok(byPath("CODEOWNERS")?.candidateFamilies.includes("ownership"));
assert.ok(byPath(".github/workflows/")?.candidateFamilies.includes("delivery-ci-deployment"));
assert.ok(byPath("AGENTS.md")?.candidateFamilies.includes("agent-repository-instructions"));
assert.ok(byPath("REPOSITORY_MAP.md")?.candidateFamilies.includes("repository-map"));
assert.ok(byPath("STYLEGUIDE.md")?.candidateFamilies.includes("engineering-standards"));
assert.ok(byPath("design-system/")?.candidateFamilies.includes("design-system"));
assert.ok(byPath("prompts/")?.candidateFamilies.includes("prompt-sources"));
assert.ok(byPath("migrations/")?.candidateFamilies.includes("public-data-contracts"));
assert.ok(byPath("openapi.yaml")?.candidateFamilies.includes("public-data-contracts"));
assert.ok(byPath(".eslintrc.json")?.candidateFamilies.includes("quality-definitions"));

// package.json is both a scope signal AND a project-module-manifests source candidate
const webManifestSource = byPath("web/package.json");
assert.ok(webManifestSource, "package.json should also be registered as its own source candidate");
assert.ok(webManifestSource.candidateFamilies.includes("project-module-manifests"));

// scripts/ carries BOTH execution-commands and custom-automation -- one path, two families
const scriptsSource = byPath("scripts/");
assert.ok(scriptsSource);
assert.ok(scriptsSource.candidateFamilies.includes("execution-commands"));
assert.ok(scriptsSource.candidateFamilies.includes("custom-automation"));

// an unreadable subtree must produce a diagnostic and never abort the rest of the walk
{
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "discover-candidates-err-"));
  fs.mkdirSync(path.join(root2, "ok"));
  fs.writeFileSync(path.join(root2, "ok", "pom.xml"), "<project/>");
  fs.mkdirSync(path.join(root2, "broken"));

  const injectedReaddir = (dir, ...rest) => {
    if (dir === path.join(root2, "broken")) {
      const e = new Error("denied"); e.code = "EACCES"; throw e;
    }
    return fs.readdirSync(dir, ...rest);
  };
  const result2 = enumerateCandidates(root2, { readdirFn: injectedReaddir });
  assert.ok(result2.scopeCandidates.some((c) => c.path === "ok/"), "the healthy subtree must still be processed");
  assert.ok(result2.diagnostics.some((d) => d.code === "enumeration_error" && d.path === "broken"), "the broken subtree must produce a diagnostic instead of crashing the whole scan");
}

console.log("discover-candidates: all 19 families produce expected candidates with signals/families/ruleIds");
