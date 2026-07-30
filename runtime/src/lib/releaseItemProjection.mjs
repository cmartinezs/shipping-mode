export function renderReleaseItemReadme(item) {
  const dependencyLines = item.dependencies.length === 0 ? ["- none"] : item.dependencies.map((ref) => `- ${ref}`);
  const sourceLines = item.sourceRefs.length === 0
    ? ["- none"]
    : item.sourceRefs.map((ref) => `- ${ref.role}: ${ref.provider}/${ref.sourceId}${ref.externalId ? `#${ref.externalId}` : ""}${ref.path ? ` ${ref.path}` : ""}`);
  const resolutionLines = item.resolution === null
    ? ["- none"]
    : [
        `- Type: ${item.resolution.type}`,
        `- Reason: ${item.resolution.reason}`,
        `- Approved by: ${item.resolution.approvedBy}`,
        `- Risk accepted: ${item.resolution.riskAccepted ? "yes" : "no"}`,
        `- Replacement: ${item.resolution.replacementId || "none"}`
      ];
  const detailLines = Object.entries(kindDetailSummary(item))
    .map(([key, value]) => Array.isArray(value) ? `- ${key}: ${value.join("; ")}` : `- ${key}: ${value}`);
  const lines = [
    `# ${item.displayId} ${item.title}`,
    "",
    "## Identity",
    "",
    `- ID: ${item.id}`,
    `- Display ID: ${item.displayId}`,
    `- Display ID status: ${item.displayIdStatus}`,
    `- Release ID: ${item.releaseId}`,
    `- Slug: ${item.slug || "none"}`,
    "",
    "## Summary",
    "",
    `- Kind: ${item.kind}`,
    `- Status: ${item.status}`,
    `- Description: ${item.description || "none"}`,
    "",
    "## Kind Details",
    "",
    ...detailLines,
    "",
    "## Dependencies",
    "",
    ...dependencyLines,
    "",
    "## Source Refs",
    "",
    ...sourceLines,
    "",
    "## Resolution",
    "",
    ...resolutionLines,
    "",
    "## Audit",
    "",
    `- Created: ${item.audit.createdAt} by ${item.audit.createdBy}`,
    `- Updated: ${item.audit.updatedAt} by ${item.audit.updatedBy}`,
    `- Revision: ${item.audit.revision}`,
    ""
  ];
  return lines.join("\n");
}

function kindDetailSummary(item) {
  if (item.kind === "user_story") return { Actor: item.actor, Need: item.need, Value: item.value, "Acceptance criteria": item.acceptanceCriteria };
  if (item.kind === "capability") return { Outcome: item.outcome, Behavior: item.behavior, "Acceptance criteria": item.acceptanceCriteria };
  if (item.kind === "defect") return { "Observed behavior": item.observedBehavior, "Expected behavior": item.expectedBehavior, Reproduction: item.reproduction, Severity: item.severity };
  if (item.kind === "enabler") return { "Technical outcome": item.technicalOutcome, "Unlocked capabilities": item.unlockedCapabilities };
  if (item.kind === "spike") return { Question: item.question, Timebox: item.timebox, "Expected decision": item.expectedDecision };
  if (item.kind === "compliance") return { Obligation: item.obligation, Authority: item.authority, Deadline: item.deadline, Evidence: item.evidence };
  if (item.kind === "migration") return { "Source state": item.sourceState, "Target state": item.targetState, Rollback: item.rollback };
  if (item.kind === "operational") return { Procedure: item.procedure, Owner: item.owner, Evidence: item.evidence };
  return {};
}

export function compareReleaseItemProjection(item, currentReadme) {
  const expected = renderReleaseItemReadme(item);
  return { equal: expected === currentReadme, expected };
}
