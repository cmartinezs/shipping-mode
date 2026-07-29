export function renderReleaseReadme(release) {
  const policyPreviousLines = release.policy.previousReleaseRefs.length === 0 ? ["- none"] : release.policy.previousReleaseRefs.map((ref) => `- ${ref}`);
  const policyDependencyLines = release.policy.dependencyRefs.length === 0 ? ["- none"] : release.policy.dependencyRefs.map((ref) => `- ${ref}`);
  const scopeLines = release.scopeRefs.length === 0
    ? ["- none"]
    : release.scopeRefs.map((ref) => `- ${ref.scopeId}: ready=${ref.readiness.ready ? "yes" : "no"} task=${ref.guides.find((guide) => guide.kind === "task")?.revision || "none"} test=${ref.guides.find((guide) => guide.kind === "test")?.revision || "none"}`);
  const executionContextLines = (release.executionContextRefs || []).length === 0 ? ["- none"] : release.executionContextRefs.map((ref) => `- ${ref}`);
  const environmentLines = (release.environmentRefs || []).length === 0 ? ["- none"] : release.environmentRefs.map((ref) => `- ${ref}`);
  const itemLines = release.itemRefs.length === 0 ? ["- none"] : release.itemRefs.map((ref) => `- ${ref}`);
  const blockerLines = release.blockers.length === 0 ? ["- none"] : release.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.summary}`);
  const riskLines = release.risks.length === 0 ? ["- none"] : release.risks.map((risk) => `- ${risk.level}: ${risk.summary}`);
  const deploymentLines = release.deploymentEvents.length === 0 ? ["- none"] : release.deploymentEvents.map((event) => `- ${event.id}: ${event.status} ${event.environmentRef}${event.executionContextRef ? ` via ${event.executionContextRef}` : ""}`);
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
    "## Policy Refs",
    "",
    "Previous Release Refs:",
    "",
    ...policyPreviousLines,
    "",
    "Dependency Refs:",
    "",
    ...policyDependencyLines,
    "",
    "## Scope Refs",
    "",
    ...scopeLines,
    "",
    "## Execution Context Refs",
    "",
    ...executionContextLines,
    "",
    "## Environment Refs",
    "",
    ...environmentLines,
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
