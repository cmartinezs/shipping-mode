import { isUuidV7 } from "./ids.mjs";
import { releaseIntegrityFindings } from "./releaseStore.mjs";
import { revisionHash } from "./canonical.mjs";

export const RELEASE_POLICY_FINDING_CODES = Object.freeze({
  INVALID_REFERENCE: "INVALID_REFERENCE",
  AMBIGUOUS_REFERENCE: "AMBIGUOUS_REFERENCE",
  DUPLICATE_REFERENCE: "DUPLICATE_REFERENCE",
  SELF_REFERENCE: "SELF_REFERENCE",
  POLICY_VIOLATION: "POLICY_VIOLATION",
  CYCLE_DETECTED: "CYCLE_DETECTED",
  LANE_INVALID: "LANE_INVALID"
});

export function laneConfigFindings(config, laneId = null) {
  const findings = [];
  const releasePolicy = config?.policies?.release;
  const lanes = releasePolicy?.lanes;
  if (!releasePolicy || !Array.isArray(lanes) || lanes.length === 0) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.LANE_INVALID, message: "Project Context release lane catalog is missing or empty" });
    return findings;
  }
  const counts = new Map();
  for (const lane of lanes) counts.set(lane.id, (counts.get(lane.id) || 0) + 1);
  for (const [id, count] of counts) {
    if (count > 1) findings.push({ code: RELEASE_POLICY_FINDING_CODES.LANE_INVALID, message: `release lane ${id} is duplicated` });
  }
  if (!counts.has(releasePolicy.defaultLane)) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.LANE_INVALID, message: `default release lane ${releasePolicy.defaultLane} is not configured` });
  }
  if (laneId && !counts.has(laneId)) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.LANE_INVALID, message: `release lane ${laneId} is not configured` });
  }
  return findings;
}

export function assertValidLaneConfig(config, laneId = null) {
  const findings = laneConfigFindings(config, laneId);
  if (findings.length > 0) {
    const error = new Error(findings.map((finding) => `${finding.code}: ${finding.message}`).join("; "));
    error.code = "INVALID";
    throw error;
  }
}

function duplicateRefs(refs) {
  const seen = new Set();
  const duplicates = [];
  for (const ref of refs) {
    if (seen.has(ref)) duplicates.push(ref);
    seen.add(ref);
  }
  return duplicates;
}

function releaseRecordMap(releases, targetRelease = null, nextPolicy = null, nextLaneId = null) {
  const records = new Map();
  for (const release of releases) records.set(release.id, release);
  if (targetRelease) {
    records.set(targetRelease.id, {
      ...targetRelease,
      lane: { id: nextLaneId },
      policy: nextPolicy
    });
  }
  return records;
}

function validateReferencedRelease(records, sourceRelease, ref, findings, relationship) {
  if (!isUuidV7(ref)) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.INVALID_REFERENCE, message: `${relationship} must be UUIDv7: ${ref}` });
    return null;
  }
  if (ref === sourceRelease.id) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.SELF_REFERENCE, message: `release ${sourceRelease.id} cannot reference itself` });
    return null;
  }
  const release = records.get(ref);
  if (!release) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.INVALID_REFERENCE, message: `${relationship} does not resolve from ${sourceRelease.id}: ${ref}` });
    return null;
  }
  const integrity = releaseIntegrityFindings(release);
  if (!integrity.schemaValid || integrity.findings.length > 0) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.INVALID_REFERENCE, message: `${relationship} is structurally invalid from ${sourceRelease.id}: ${ref}`, findings: integrity.findings });
    return null;
  }
  if (release.status === "CANCELLED") {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `cancelled release cannot satisfy ${relationship} from ${sourceRelease.id}: ${ref}` });
    return null;
  }
  return release;
}

function cycleFindings(graph, label) {
  const findings = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(id) {
    if (visiting.has(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.CYCLE_DETECTED, message: `${label} cycle detected: ${cycle.join(" -> ")}` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const next of [...(graph.get(id) || [])].sort()) {
      if (graph.has(next)) visit(next);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of [...graph.keys()].sort()) visit(id);
  return findings;
}

function strictSequenceCatalogFindings(records) {
  const findings = [];
  const laneMembers = new Map();
  const graph = new Map();
  const successorOwners = new Map();
  const releases = [...records.values()]
    .filter((release) => release.status !== "CANCELLED" && release.policy?.mode === "strict_sequence")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const release of releases) {
    const previousRefs = release.policy.previousReleaseRefs || [];
    const dependencyRefs = release.policy.dependencyRefs || [];
    if (dependencyRefs.length > 0) {
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `strict_sequence release ${release.id} cannot use dependencyRefs` });
    }
    if (previousRefs.length > 1) {
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `strict_sequence release ${release.id} allows at most one previousReleaseRef` });
    }
    for (const duplicate of duplicateRefs(previousRefs)) {
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.DUPLICATE_REFERENCE, message: `duplicate previousReleaseRef on ${release.id}: ${duplicate}` });
    }
    const laneId = release.lane?.id;
    if (!laneMembers.has(laneId)) laneMembers.set(laneId, []);
    laneMembers.get(laneId).push(release);
    graph.set(release.id, []);

    if (previousRefs.length === 1) {
      const predecessor = validateReferencedRelease(records, release, previousRefs[0], findings, "previousReleaseRef");
      if (!predecessor) continue;
      if (predecessor.policy?.mode !== "strict_sequence") {
        findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `strict_sequence predecessor ${predecessor.id} for ${release.id} must also use strict_sequence` });
      }
      if (predecessor.lane?.id !== laneId) {
        findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `strict_sequence predecessor ${predecessor.id} for ${release.id} must be in lane ${laneId}` });
      }
      graph.get(release.id).push(predecessor.id);
      const owners = successorOwners.get(predecessor.id) || [];
      owners.push(release.id);
      successorOwners.set(predecessor.id, owners);
    }
  }

  for (const [laneId, members] of [...laneMembers.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))) {
    const roots = members.filter((release) => (release.policy.previousReleaseRefs || []).length === 0);
    if (roots.length !== 1) {
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `strict_sequence lane ${laneId} must contain exactly one non-cancelled root; found ${roots.length}` });
    }
  }
  for (const [predecessorId, successors] of successorOwners) {
    if (successors.length > 1) {
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `strict_sequence predecessor ${predecessorId} has multiple non-cancelled successors: ${successors.sort().join(", ")}` });
    }
  }
  findings.push(...cycleFindings(graph, "strict_sequence"));
  return findings;
}

function dependencyGraphCatalogFindings(records) {
  const findings = [];
  const graph = new Map();
  const releases = [...records.values()]
    .filter((release) => release.status !== "CANCELLED" && release.policy?.mode === "dependency_graph")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const release of releases) {
    const previousRefs = release.policy.previousReleaseRefs || [];
    const dependencyRefs = release.policy.dependencyRefs || [];
    if (previousRefs.length > 0) {
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `dependency_graph release ${release.id} cannot use previousReleaseRefs` });
    }
    for (const duplicate of duplicateRefs(dependencyRefs)) {
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.DUPLICATE_REFERENCE, message: `duplicate dependencyRef on ${release.id}: ${duplicate}` });
    }
    graph.set(release.id, []);
    for (const ref of dependencyRefs) {
      const dependency = validateReferencedRelease(records, release, ref, findings, "dependencyRef");
      if (dependency) graph.get(release.id).push(dependency.id);
    }
  }
  findings.push(...cycleFindings(graph, "dependency_graph"));
  return findings;
}

export function releaseCatalogPolicyFindings(releases) {
  const records = releaseRecordMap(releases);
  const findings = [];
  for (const release of [...records.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!["strict_sequence", "dependency_graph"].includes(release.policy?.mode)) {
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `unsupported release policy mode on ${release.id}: ${release.policy?.mode}` });
    }
  }
  findings.push(...strictSequenceCatalogFindings(records));
  findings.push(...dependencyGraphCatalogFindings(records));
  const unique = new Map();
  for (const finding of findings) unique.set(`${finding.code}:${finding.message}`, finding);
  return [...unique.values()].sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`));
}

export function releasePolicyFindings({ releases, targetRelease, nextPolicy, nextLaneId }) {
  if (!["strict_sequence", "dependency_graph"].includes(nextPolicy?.mode)) {
    return [{ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `unsupported release policy mode: ${nextPolicy?.mode}` }];
  }
  const records = releaseRecordMap(releases, targetRelease, nextPolicy, nextLaneId);
  return releaseCatalogPolicyFindings([...records.values()]);
}

export function assertReleasePolicyValid(args) {
  const findings = releasePolicyFindings(args);
  if (findings.length > 0) {
    const error = new Error(findings.map((finding) => `${finding.code}: ${finding.message}`).join("; "));
    error.code = "INVALID";
    throw error;
  }
}

export function releasePolicyRequestHash({ actor, requestSnapshot }) {
  return revisionHash({ actor, requestSnapshot });
}
