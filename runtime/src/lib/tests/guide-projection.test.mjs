import assert from "node:assert/strict";
import { compareGuideProjection, renderGuideMarkdown } from "../guideProjection.mjs";

const guide = {
  id: "018f0000-0000-7000-8000-000000000021",
  scopeId: "018f0000-0000-7000-8000-000000000022",
  kind: "task",
  dslVersion: 1,
  sourceRefs: ["018f0000-0000-7000-8000-000000000023"],
  provenance: { sourceFingerprints: { "018f0000-0000-7000-8000-000000000023": "a".repeat(64) } },
  workPackageTypes: [{ id: "z", appliesWhen: { field: "item.kind", op: "exists", value: true }, requiredSections: [], requiredGateRefs: [] }, { id: "a", appliesWhen: { field: "item.kind", op: "exists", value: true }, requiredSections: [], requiredGateRefs: [] }],
  taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" }, openGaps: []
};
const first = renderGuideMarkdown(guide);
const second = renderGuideMarkdown({ ...guide, workPackageTypes: [...guide.workPackageTypes].reverse() });
assert.equal(first, second, "projection ordering must be deterministic");
assert.equal(compareGuideProjection(guide, first).equal, true);
assert.equal(compareGuideProjection(guide, `${first}manual edit\n`).equal, false);
assert.match(first, /## Work Package Types/);
console.log("guide-projection: deterministic YAML-owned Markdown and drift comparison pass");
