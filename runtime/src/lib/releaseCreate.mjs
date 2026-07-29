import { revisionHash } from "./canonical.mjs";
import { isReleaseDisplayIdForUuid } from "./releaseIdentity.mjs";

export function releaseCreateRequestHash({ actor, requestSnapshot }) {
  return revisionHash({ actor, ...requestSnapshot });
}

function isCanonicalTrimmedString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

export function releaseCreateInvariantFindings(changeSet, operation = null, existingReleases = []) {
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

  const displayIdCollision = existingReleases.find((release) => release.id !== payload.id && release.displayId === payload.displayId);
  if (displayIdCollision) {
    findings.push(`release.create displayId ${payload.displayId} is already owned by release ${displayIdCollision.id}`);
  }

  for (const field of ["title", "objective", "laneId", "idempotencyKey"]) {
    if (!isCanonicalTrimmedString(payload[field])) {
      findings.push(`release.create payload.${field} must be a canonical non-blank trimmed string`);
    }
  }

  const snapshot = payload.requestSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    findings.push("release.create requestSnapshot must be a server-owned normalized object");
  } else {
    if (snapshot.title !== payload.title || snapshot.objective !== payload.objective || snapshot.slug !== payload.slug) {
      findings.push("release.create requestSnapshot business fields must match the resolved payload");
    }
    if (snapshot.laneId !== null && snapshot.laneId !== payload.laneId) {
      findings.push("release.create explicit requestSnapshot.laneId must match payload.laneId");
    }
    if (snapshot.policyMode !== null && snapshot.policyMode !== payload.policyMode) {
      findings.push("release.create explicit requestSnapshot.policyMode must match payload.policyMode");
    }
    const expectedRequestHash = releaseCreateRequestHash({ actor: payload.createdBy, requestSnapshot: snapshot });
    if (payload.idempotencyRequestHash !== expectedRequestHash) {
      findings.push("release.create idempotencyRequestHash does not match the normalized caller request snapshot");
    }
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
