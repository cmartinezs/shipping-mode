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
