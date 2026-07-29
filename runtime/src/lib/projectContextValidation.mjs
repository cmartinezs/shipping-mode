import path from "node:path";

export function projectContextConsistencyFindings(config, { knownSourceIds = null } = {}) {
  const findings = [];
  if (!config || typeof config !== "object") return findings;

  if (config.project?.name !== config.name) {
    findings.push("config.yml: project.name must match compatibility field name");
  }

  const scopeRefIds = new Set((config.scopeRefs || []).map((entry) => entry.id));
  for (const enabledId of config.scopeCatalog?.enabled || []) {
    if (!scopeRefIds.has(enabledId)) {
      findings.push(`config.yml: scopeCatalog.enabled references unknown scope id ${enabledId}`);
    }
  }

  const documentation = config.documentation;
  const knownSources = knownSourceIds === null ? null : new Set(knownSourceIds);
  for (const sourceId of documentation?.source_refs || []) {
    if (knownSources && !knownSources.has(sourceId)) {
      findings.push(`config.yml: documentation.source_refs references unknown source id ${sourceId}`);
    }
  }
  const gapIds = new Set();
  for (const gap of documentation?.gaps || []) {
    if (gapIds.has(gap.id)) findings.push(`config.yml: duplicate documentation gap id ${gap.id}`);
    gapIds.add(gap.id);
    if (gap.scope_ref && !scopeRefIds.has(gap.scope_ref)) {
      findings.push(`config.yml: documentation gap ${gap.id} references unknown scope id ${gap.scope_ref}`);
    }
    for (const sourceId of gap.source_refs || []) {
      if (knownSources && !knownSources.has(sourceId)) {
        findings.push(`config.yml: documentation gap ${gap.id} references unknown source id ${sourceId}`);
      }
    }
  }

  const git = config.git;
  if (git) {
    if ((git.enabled ? "git" : "none") !== config.vcs) {
      findings.push("config.yml: git.enabled must agree with compatibility field vcs");
    }
    if (!git.enabled && git.provider !== "none") {
      findings.push("config.yml: disabled Git policy must use provider none");
    }
    const workBase = git.branches?.work_base ?? null;
    if ((config.baseBranch ?? null) !== workBase) {
      findings.push("config.yml: git.branches.work_base must match compatibility field baseBranch");
    }
    const integration = git.branches?.integration;
    const production = git.branches?.production;
    const promotion = git.pull_requests?.promotion;
    if (git.pull_requests?.work_target && integration && git.pull_requests.work_target !== integration) {
      findings.push("config.yml: git.pull_requests.work_target must match git.branches.integration");
    }
    if (promotion?.source && integration && promotion.source !== integration) {
      findings.push("config.yml: Git promotion source must match integration branch");
    }
    if (promotion?.target && production && promotion.target !== production) {
      findings.push("config.yml: Git promotion target must match production branch");
    }
  }

  const releasePolicy = config.policies?.release;
  if (releasePolicy) {
    const laneOwners = new Set();
    for (const lane of releasePolicy.lanes || []) {
      if (laneOwners.has(lane.id)) findings.push(`config.yml: duplicate release lane id ${lane.id}`);
      laneOwners.add(lane.id);
    }
    if (!laneOwners.has(releasePolicy.defaultLane)) {
      findings.push(`config.yml: policies.release.defaultLane ${releasePolicy.defaultLane} is not configured in policies.release.lanes`);
    }
  }

  const ids = new Set();
  for (const source of config.work_sources || []) {
    if (ids.has(source.id)) findings.push(`config.yml: duplicate work source id ${source.id}`);
    ids.add(source.id);

    if (source.provider === "local_repository" && source.transport && source.transport !== "filesystem") {
      findings.push(`config.yml: local_repository work source ${source.id} must use filesystem transport`);
    }
    if (source.provider !== "local_repository" && source.transport === "filesystem") {
      findings.push(`config.yml: non-local work source ${source.id} cannot use filesystem transport`);
    }
    for (const root of source.roots || []) {
      const segments = root.split(/[\\/]+/);
      if (path.posix.isAbsolute(root) || path.win32.isAbsolute(root) || segments.includes("..")) {
        findings.push(`config.yml: work source ${source.id} root must remain inside the workspace`);
      }
    }
    if (source.transport === "mcp" && !source.mcp_connection_ref) {
      findings.push(`config.yml: MCP work source ${source.id} requires an opaque mcp_connection_ref`);
    }
    if (source.mcp_connection_ref && source.transport !== "mcp") {
      findings.push(`config.yml: work source ${source.id} mcp_connection_ref requires mcp transport`);
    }
    if (source.mcp_connection_ref && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.mcp_connection_ref)) {
      findings.push(`config.yml: work source ${source.id} has an invalid opaque connection reference`);
    }
  }

  return findings;
}

export function assertProjectContextConsistency(config, options = {}) {
  const findings = projectContextConsistencyFindings(config, options);
  if (findings.length > 0) throw new Error(findings.join("; "));
}
