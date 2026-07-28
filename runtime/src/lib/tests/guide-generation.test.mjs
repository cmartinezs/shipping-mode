import assert from "node:assert/strict";
import { buildGuideGenerationInput, genericGuideOutput } from "../guideGeneration.mjs";

const source = { id: "018f0000-0000-7000-8000-000000000011", family: "technical-sources", kind: "testing", role: "canonical", authority: { standing: "authoritative", force: "normative" }, availability: "implemented", confirmedFingerprint: "a".repeat(64), path: "docs/test.md" };
const scope = { id: "018f0000-0000-7000-8000-000000000021", key: "api", label: "API", kind: "code", path: "src/", commands: { test: { command: "npm test" } } };
const config = { scopeCatalog: { directory: ".planning/scopes", enabled: [scope.id] }, documentation: { source_refs: [source.id] } };
const first = buildGuideGenerationInput({ scope, guideKind: "task", sources: [source], config });
const second = buildGuideGenerationInput({ scope, guideKind: "task", sources: [{ ...source, path: "other.md" }], config });
assert.deepEqual(first.input, second.input, "generator input excludes unneeded source paths");
assert.equal(first.inputHash, second.inputHash);
assert.deepEqual(genericGuideOutput(first.input).automation, { fallback: "markGaps" });
assert.equal(genericGuideOutput(first.input).openGaps[0].category, "generation_incomplete");
assert.throws(() => buildGuideGenerationInput({ scope, guideKind: "task", sources: [source], config: { documentation: { source_refs: [] } } }), /approved Project Context/);
assert.throws(() => buildGuideGenerationInput({ scope, guideKind: "task", sources: [], config }), /do not resolve/);
const secondSource = { ...source, id: "018f0000-0000-7000-8000-000000000012", confirmedFingerprint: "c".repeat(64) };
const twoSourceInput = buildGuideGenerationInput({ scope, guideKind: "task", sources: [source, secondSource], config: { ...config, documentation: { source_refs: [source.id, secondSource.id] } } }).input;
assert.equal(genericGuideOutput(twoSourceInput).openGaps[0].category, "generation_incomplete", "different fingerprints are not automatically a semantic conflict");
console.log("guide-generation: approved refs only, deterministic input hashes, no false fingerprint conflicts, and explicit incomplete-generation gaps pass");
