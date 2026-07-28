import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { revisionHash, contentHash } from "../canonical.mjs";
import { renderGuideMarkdown } from "../guideProjection.mjs";
import { buildGuideGenerationInput } from "../guideGeneration.mjs";
import { evaluateGuideHealth, evaluateGuideReadiness } from "../guideHealth.mjs";

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guide-health-"));
const planningRoot = path.join(workspaceRoot, ".planning");
const scopeId = "018f0000-0000-7000-8000-000000000021";
const guideId = "018f0000-0000-7000-8000-000000000022";
const sourceId = "018f0000-0000-7000-8000-000000000011";
const scope = { id: scopeId, key: "api", label: "API", kind: "code", path: "src/", commands: {} };
const source = { id: sourceId, family: "technical-sources", kind: "testing", role: "canonical", authority: { standing: "authoritative", force: "normative" }, availability: "implemented", confirmedFingerprint: "a".repeat(64) };
const config = { documentation: { source_refs: [sourceId] }, scopeCatalog: { enabled: [scopeId] } };
const generation = buildGuideGenerationInput({ scope, guideKind: "task", sources: [source], config });
const document = {
  schemaVersion: 1, dslVersion: 1, id: guideId, scopeId, kind: "task", sourceRefs: [sourceId],
  workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [],
  automation: { fallback: "markGaps" }, openGaps: [],
  provenance: { sourceMapRevision: revisionHash({ sourceRefs: [sourceId], sourceFingerprints: { [sourceId]: source.confirmedFingerprint } }), generationMethod: "generic", generatorVersion: "shipping-mode:generic-guide/1", generatorFingerprint: null, generatedAt: "2026-07-28T00:00:00Z", sourceFingerprints: { [sourceId]: source.confirmedFingerprint }, generationInputHash: generation.inputHash, generationOutputHash: revisionHash({ sourceRefs: [sourceId], workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" }, openGaps: [] }) }
};
document.revision = `sha256:${revisionHash(document)}`;
const guideBytes = Buffer.from(stringifyYaml(document));
const scopeWithGuide = { ...scope, guides: { task: { id: guideId, scopeId, kind: "task", status: "approved", path: "task-guide.yml", projection: "task-guide.md", revision: document.revision, contentHash: contentHash(guideBytes), sourceRefs: [sourceId], provenance: document.provenance, approval: { actor: "reviewer", approvedAt: "2026-07-28T00:00:00Z", revision: document.revision, contentHash: contentHash(guideBytes) } } } };
fs.mkdirSync(path.join(planningRoot, "scopes", scopeId), { recursive: true });
fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, "task-guide.yml"), guideBytes);
fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, "task-guide.md"), renderGuideMarkdown(document));

let health = evaluateGuideHealth({ planningRoot, workspaceRoot, scope: scopeWithGuide, guideKind: "task", sources: [source], config });
assert.equal(health.state, "approved_current");
assert.equal(health.usable, true);
assert.deepEqual(health.reasons, []);

const changedSource = { ...source, confirmedFingerprint: "b".repeat(64) };
health = evaluateGuideHealth({ planningRoot, workspaceRoot, scope: scopeWithGuide, guideKind: "task", sources: [changedSource], config });
assert.equal(health.state, "approved_stale");
assert.ok(health.reasons.some((item) => item.code === "GUIDE_SOURCE_FINGERPRINT_CHANGED"));

const strict = evaluateGuideReadiness({ healthByKind: { task: health }, scopeId, requiredGuideKinds: ["task"], policyMode: "strict" });
assert.equal(strict.ready, false);
const advisory = evaluateGuideReadiness({ healthByKind: { task: health }, scopeId, requiredGuideKinds: ["task"], policyMode: "advisory" });
assert.equal(advisory.ready, true);
assert.equal(advisory.findings.length > 0, true);

const before = fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "task-guide.yml"));
assert.deepEqual(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "task-guide.yml")), before);
console.log("guide-health: approved-current, source drift, strict/advisory and query-only primitives pass");
