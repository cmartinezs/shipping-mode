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
assert.deepEqual(genericGuideOutput(first.input).openGaps, []);
const testOutput = genericGuideOutput({ ...first.input, guideKind: "test" });
assert.deepEqual(testOutput.commandRefs, []);
const conflict = genericGuideOutput({ ...first.input, sources: [source, { ...source, id: "018f0000-0000-7000-8000-000000000012", confirmedFingerprint: "c".repeat(64) }], sourceRefs: [source.id, "018f0000-0000-7000-8000-000000000012"] });
assert.equal(conflict.openGaps[0].category, "source_conflict");
console.log("guide-generation: bounded source snapshot, deterministic input hashes, safe fallback, and task/test variants pass");
