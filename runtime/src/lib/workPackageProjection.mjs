import { canonicalize } from "./canonical.mjs";

function json(value) {
  return JSON.stringify(canonicalize(value));
}

function list(values, none = "- none") {
  return values.length === 0 ? [none] : values.map((value) => `- ${typeof value === "string" ? value : json(value)}`);
}

export function renderWorkPackageReadme(pkg) {
  const lines = [
    `# ${pkg.displayId} ${pkg.title}`,
    "",
    "## Identity",
    "",
    `- ID: ${pkg.id}`,
    `- Display ID: ${pkg.displayId}`,
    `- Display ID status: ${pkg.displayIdStatus}`,
    `- Release ID: ${pkg.releaseId}`,
    `- Release Item ID: ${pkg.releaseItemId}`,
    `- Scope ID: ${pkg.scopeId}`,
    "",
    "## Summary",
    "",
    `- Status: ${pkg.status}`,
    `- Commitment: ${pkg.commitment}`,
    `- Description: ${pkg.description || "none"}`,
    "",
    "## Design",
    "",
    pkg.design || "none",
    "",
    "## Interfaces",
    "",
    ...list(pkg.interfaces),
    "",
    "## Contracts",
    "",
    ...list(pkg.contracts),
    "",
    "## Dependencies",
    "",
    ...list(pkg.dependencies),
    "",
    "## Guide Refs",
    "",
    ...list(pkg.guideRefs.map((ref) => ({ kind: ref.kind, id: ref.id, revision: ref.revision, contentHash: ref.contentHash, state: ref.state, usable: ref.usable }))),
    "",
    "## Gate Requirements",
    "",
    ...list(pkg.gateRequirements),
    "",
    "## Risks",
    "",
    ...list(pkg.risks),
    "",
    "## Blockers",
    "",
    ...list(pkg.blockers),
    "",
    "## Resolution",
    "",
    ...(pkg.resolution === null ? ["- none"] : list([pkg.resolution])),
    "",
    "## Audit",
    "",
    `- Created: ${pkg.audit.createdAt} by ${pkg.audit.createdBy}`,
    `- Updated: ${pkg.audit.updatedAt} by ${pkg.audit.updatedBy}`,
    `- Operation ID: ${pkg.audit.operationId}`,
    `- Revision: ${pkg.audit.revision}`,
    ""
  ];
  return lines.join("\n");
}

export function compareWorkPackageProjection(pkg, currentReadme) {
  const expected = renderWorkPackageReadme(pkg);
  return { equal: expected === currentReadme, expected };
}
