import { revisionHash } from "./canonical.mjs";
import { isReleaseDisplayIdForUuid } from "./releaseIdentity.mjs";

export function releaseCreateRequestHash({ actor, title, objective, laneId, policyMode, slug }) {
  return revisionHash({
    actor,
    title,
    objective,
    laneId: laneId ?? null,
    policyMode: policyMode ?? null,
    slug: slug ?? null
  });
}

function isCanonicalTrimmedString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

export function releaseCreateInvariantFindings(changeSet, operation = null) {
  const findings = [];
  const payload = changeSet.payload;

  if (payload.operationId !== changeSet.operationId) {
    findings.push(`release.create payload.operationId ${payload.operationId} does not match ChangeSet operationId ${changeSet.operationId}`);
  }

  const targetKeys = Object.keys(changeSet.target || {}).sort();
  if (targetKeys.length !== 1 || targetKeys[0] !== "releaseId" || changeSet.target.releaseId !== payload.id) {
    findings.push("release.create target must contain exactly releaseId equal to payload.id");
  }

  if (!isReleaseDisplayIdForUuid(payload.id, payload.displayId)) {
    findings.push(`release.create displayId ${payload.displayId} is not derived from release UUIDv7 ${payload.id}`);
  }

  for (const field of ["title", "objective", "laneId", "idempotencyKey"]) {
    if (!isCanonicalTrimmedString(payload[field])) {
      findings.push(`release.create payload.${field} must be a canonical non-blank trimmed string`);
    }
  }

  const expectedRequestHash = releaseCreateRequestHash({
    actor: payload.createdBy,
    title: payload.title,
    objective: payload.objective,
    laneId: payload.laneId,
    policyMode: payload.policyMode,
    slug: payload.slug
  });
  if (payload.idempotencyRequestHash !== expectedRequestHash) {
    findings.push("release.create idempotencyRequestHash does not match the normalized request snapshot");
  }

  if (payload.createdAt !== payload.updatedAt) {
    findings.push("release.create createdAt and updatedAt must be identical at creation");
  }
  if (payload.createdBy !== payload.updatedBy) {
    findings.push("release.create createdBy and updatedBy must be identical at creation");
  }

  if (operation) {
    if (operation.id !== changeSet.operationId) {
      findings.push(`release.create operation.id ${operation.id} does not match ChangeSet operationId ${changeSet.operationId}`);
    }
    if (payload.createdAt !== operation.proposedAt || payload.updatedAt !== operation.proposedAt) {
      findings.push("release.create timestamps must match the server-owned operation proposedAt value");
    }
    if (payload.createdBy !== operation.proposedBy || payload.updatedBy !== operation.proposedBy) {
      findings.push("release.create actors must match the server-owned operation proposedBy value");
    }
  }

  return findings;
}
