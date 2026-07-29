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

function releaseRecordMap(releases, targetRelease, nextPolicy, nextLaneId) {
  const records = new Map();
  for (const release of releases) records.set(release.id, release);
  records.set(targetRelease.id, {
    ...targetRelease,
    lane: { id: nextLaneId },
    policy: nextPolicy
  });
  return records;
}

function validateReferencedRelease(records, ref, targetId, findings) {
  if (!isUuidV7(ref)) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.INVALID_REFERENCE, message: `release reference must be UUIDv7: ${ref}` });
    return null;
  }
  if (ref === targetId) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.SELF_REFERENCE, message: "release cannot reference itself" });
    return null;
  }
  const release = records.get(ref);
  if (!release) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.INVALID_REFERENCE, message: `release reference does not resolve: ${ref}` });
    return null;
  }
  const integrity = releaseIntegrityFindings(release);
  if (!integrity.schemaValid || integrity.findings.length > 0) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.INVALID_REFERENCE, message: `release reference is structurally invalid: ${ref}`, findings: integrity.findings });
    return null;
  }
  if (release.status === "CANCELLED") {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `cancelled release cannot satisfy a release dependency: ${ref}` });
    return null;
  }
  return release;
}

function strictSequenceFindings(records, targetRelease, nextPolicy, nextLaneId) {
  const findings = [];
  const previousRefs = nextPolicy.previousReleaseRefs || [];
  if ((nextPolicy.dependencyRefs || []).length > 0) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: "strict_sequence releases cannot use dependencyRefs" });
  }
  if (previousRefs.length > 1) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: "strict_sequence allows at most one previousReleaseRef" });
  }
  for (const duplicate of duplicateRefs(previousRefs)) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.DUPLICATE_REFERENCE, message: `duplicate previousReleaseRef: ${duplicate}` });
  }

  const sameLane = [...records.values()]
    .filter((release) => release.id !== targetRelease.id)
    .filter((release) => release.lane?.id === nextLaneId && release.status !== "CANCELLED" && release.policy?.mode === "strict_sequence")
    .sort((left, right) => left.id.localeCompare(right.id));

  if (previousRefs.length === 0) {
    if (sameLane.length > 0) {
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: "strict_sequence requires one predecessor when the lane already has a non-cancelled release" });
    }
    return findings;
  }

  const predecessor = validateReferencedRelease(records, previousRefs[0], targetRelease.id, findings);
  if (!predecessor) return findings;
  if (predecessor.policy.mode !== "strict_sequence") {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: "strict_sequence predecessor must also use strict_sequence" });
  }
  if (predecessor.lane.id !== nextLaneId) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: "strict_sequence predecessor must be in the same lane" });
  }
  const existingSuccessor = sameLane.find((release) => (release.policy.previousReleaseRefs || []).includes(predecessor.id));
  if (existingSuccessor) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `strict_sequence predecessor already has successor ${existingSuccessor.id}` });
  }
  return findings;
}

function dependencyGraphFindings(records, targetRelease, nextPolicy) {
  const findings = [];
  const dependencyRefs = nextPolicy.dependencyRefs || [];
  if ((nextPolicy.previousReleaseRefs || []).length > 0) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: "dependency_graph releases cannot use previousReleaseRefs" });
  }
  for (const duplicate of duplicateRefs(dependencyRefs)) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.DUPLICATE_REFERENCE, message: `duplicate dependencyRef: ${duplicate}` });
  }
  for (const ref of dependencyRefs) validateReferencedRelease(records, ref, targetRelease.id, findings);

  const graph = new Map();
  for (const release of [...records.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    graph.set(release.id, release.policy?.mode === "dependency_graph" ? [...(release.policy.dependencyRefs || [])].sort() : []);
  }
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(id) {
    if (visiting.has(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      findings.push({ code: RELEASE_POLICY_FINDING_CODES.CYCLE_DETECTED, message: `dependency graph cycle detected: ${cycle.join(" -> ")}` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const next of graph.get(id) || []) {
      if (records.has(next)) visit(next);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }
  visit(targetRelease.id);
  return findings;
}

export function releasePolicyFindings({ releases, targetRelease, nextPolicy, nextLaneId }) {
  const findings = [];
  if (!["strict_sequence", "dependency_graph"].includes(nextPolicy?.mode)) {
    findings.push({ code: RELEASE_POLICY_FINDING_CODES.POLICY_VIOLATION, message: `unsupported release policy mode: ${nextPolicy?.mode}` });
    return findings;
  }
  const records = releaseRecordMap(releases, targetRelease, nextPolicy, nextLaneId);
  if (nextPolicy.mode === "strict_sequence") {
    findings.push(...strictSequenceFindings(records, targetRelease, nextPolicy, nextLaneId));
  } else {
    findings.push(...dependencyGraphFindings(records, targetRelease, nextPolicy));
  }
  return findings.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`));
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
