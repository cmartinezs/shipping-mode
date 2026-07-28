import { canonicalize } from "./canonical.mjs";

function json(value) {
  return JSON.stringify(canonicalize(value));
}

function list(items = []) {
  return [...items].sort((left, right) => String(left.id || left.type || left).localeCompare(String(right.id || right.type || right))).map((item) => typeof item === "string" ? `- ${item}` : `- ${item.id || item.type}: ${json(item)}`);
}

export function renderGuideMarkdown(guide) {
  const title = guide.kind === "task" ? "Task Guide" : "Test Guide";
  const lines = [`# ${title}`, "", `- Scope ID: \`${guide.scopeId}\``, `- Guide ID: \`${guide.id}\``, `- DSL version: \`${guide.dslVersion}\``, "", "## Documentation Sources", "", ...guide.sourceRefs.map((sourceRef) => `- \`${sourceRef}\` (${guide.provenance.sourceFingerprints[sourceRef]})`), ""];
  if (guide.kind === "task") {
    lines.push("## Work Package Types", "", ...list(guide.workPackageTypes), "", "## Task Types", "", ...list(guide.taskTypes), "", "## Required Sections", "", ...list(guide.requiredSections), "", "## Required Gates", "", ...list(guide.requiredGateRefs), "", "## Templates", "", ...list(guide.templateRefs), "", "## Decomposition", "", ...list(guide.decompositionRules), "", "## Automation", "", `- ${json(guide.automation)}`);
  } else {
    lines.push("## Gates By Work Package Type", "", ...list(guide.gatesByWorkPackageType), "", "## Gates By Task Type", "", ...list(guide.gatesByTaskType), "", "## Commands", "", ...list(guide.commandRefs), "", "## Evidence", "", ...list(guide.evidenceRequirements), "", "## Test Data", "", ...list(guide.testData), "", "## Execution Contexts", "", ...list(guide.executionContexts), "", "## Environments", "", ...list(guide.environments));
  }
  lines.push("", "## Open Gaps", "", ...(guide.openGaps.length ? list(guide.openGaps) : ["- None"]), "");
  return `${lines.join("\n")}\n`;
}

export function compareGuideProjection(guide, actualMarkdown) {
  const expected = renderGuideMarkdown(guide);
  return { equal: expected === actualMarkdown, expected, actual: actualMarkdown };
}
