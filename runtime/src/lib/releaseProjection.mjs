export function renderReleaseReadme(release) {
  const scopeLines = release.scopeRefs.length === 0 ? ["- none"] : release.scopeRefs.map((ref) => `- ${ref.scopeId}`);
  const itemLines = release.itemRefs.length === 0 ? ["- none"] : release.itemRefs.map((ref) => `- ${ref}`);
  const blockerLines = release.blockers.length === 0 ? ["- none"] : release.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.summary}`);
  const riskLines = release.risks.length === 0 ? ["- none"] : release.risks.map((risk) => `- ${risk.level}: ${risk.summary}`);
  const deploymentLines = release.deploymentEvents.length === 0 ? ["- none"] : release.deploymentEvents.map((event) => `- ${event.status}: ${event.environmentRef}`);
  const lines = [
    `# ${release.displayId} ${release.title}`,
    "",
    "## Identity",
    "",
    `- ID: ${release.id}`,
    `- Display ID: ${release.displayId}`,
    `- Display ID status: ${release.displayIdStatus}`,
    `- Slug: ${release.slug || "none"}`,
    "",
    "## Objective",
    "",
    release.objective,
    "",
    "## Lifecycle",
    "",
    `- Status: ${release.status}`,
    `- Lane: ${release.lane.id}`,
    `- Policy: ${release.policy.mode}`,
    "",
    "## Scope Refs",
    "",
    ...scopeLines,
    "",
    "## Item Refs",
    "",
    ...itemLines,
    "",
    "## Blockers",
    "",
    ...blockerLines,
    "",
    "## Risks",
    "",
    ...riskLines,
    "",
    "## Deployment Events",
    "",
    ...deploymentLines,
    "",
    "## Finalization",
    "",
    `- Completed: ${release.finalization.completed ? "yes" : "no"}`,
    `- Retrospective: ${release.finalization.retrospectiveStatus}`,
    "",
    "## Audit",
    "",
    `- Created: ${release.audit.createdAt} by ${release.audit.createdBy}`,
    `- Updated: ${release.audit.updatedAt} by ${release.audit.updatedBy}`,
    `- Revision: ${release.audit.revision}`,
    ""
  ];
  return `${lines.join("\n")}`;
}

export function compareReleaseReadme(release, currentReadme) {
  const expected = renderReleaseReadme(release);
  return {
    equal: expected === currentReadme,
    expected
  };
}
