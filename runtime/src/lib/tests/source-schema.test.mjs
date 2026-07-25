import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const validSource = {
  schemaVersion: 1,
  id: "018f4d1e-0000-7000-8000-000000000001",
  path: "docs/04-architecture/",
  family: "technical-sources",
  kind: "architecture",
  role: "canonical",
  authority: { standing: "authoritative", force: "normative" },
  availability: "mixed",
  confirmedFingerprint: "a".repeat(64),
  confirmedContentHash: "b".repeat(64),
  provenance: {
    discoveredBy: "discover-scan",
    confirmedBy: "carlos",
    confirmedAt: "2026-07-25T10:00:00Z",
    confirmedOperationId: "018f4d1e-0000-7000-8000-000000000002"
  }
};

assert.equal(validate("source", validSource).valid, true);

const missingRequired = { ...validSource };
delete missingRequired.family;
assert.equal(validate("source", missingRequired).valid, false);

const badFamily = { ...validSource, family: "not-a-real-family" };
assert.equal(validate("source", badFamily).valid, false);

const badAuthorityStanding = { ...validSource, authority: { standing: "unknown", force: "normative" } };
assert.equal(validate("source", badAuthorityStanding).valid, false, "standing must be contextual|supporting|authoritative, not unknown");

const extraStatusField = { ...validSource, status: "confirmed" };
assert.equal(validate("source", extraStatusField).valid, false, "no status/freshness/driftState field is ever persisted on a confirmed source");

const extraFreshnessField = { ...validSource, freshness: "current" };
assert.equal(validate("source", extraFreshnessField).valid, false);

console.log("source-schema: valid source passes, missing/invalid enum/forbidden-extra fields all rejected");
