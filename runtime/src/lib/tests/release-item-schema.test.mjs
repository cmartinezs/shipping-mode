import assert from "node:assert/strict";
import { validate } from "../schema.mjs";
import { generateUuidV7 } from "../ids.mjs";
import { releaseItemDisplayIdForUuid } from "../releaseItemIdentity.mjs";
import { updateReleaseItemRevision } from "../releaseItemStore.mjs";

const releaseId = generateUuidV7();

const kindFields = {
  user_story: { actor: "teacher", need: "track work", value: "predictability", acceptanceCriteria: ["status is visible"] },
  capability: { outcome: "planning visible", behavior: "shows item state", acceptanceCriteria: ["state is queryable"] },
  defect: { observedBehavior: "status lies", expectedBehavior: "status is true", reproduction: "run check", severity: "high" },
  enabler: { technicalOutcome: "core model exists", unlockedCapabilities: ["work packages can attach"] },
  spike: { question: "which parser", timebox: "2d", expectedDecision: "choose schema path" },
  compliance: { obligation: "audit", authority: "policy", deadline: "2026-08-01", evidence: ["control"] },
  migration: { sourceState: "old", targetState: "new", rollback: "restore old" },
  operational: { procedure: "runbook", owner: "ops", evidence: ["log"] }
};

function item(kind, overrides = {}) {
  const id = generateUuidV7();
  return updateReleaseItemRevision({
    schemaVersion: 1,
    id,
    displayId: releaseItemDisplayIdForUuid(id),
    displayIdStatus: "ACTIVE",
    releaseId,
    slug: null,
    kind,
    title: `${kind} title`,
    description: null,
    status: "DRAFT",
    dependencies: [],
    sourceRefs: [],
    resolution: null,
    audit: { createdAt: "2026-07-29T00:00:00.000Z", createdBy: "carlos", updatedAt: "2026-07-29T00:00:00.000Z", updatedBy: "carlos", operationId: generateUuidV7() },
    ...kindFields[kind],
    ...overrides
  });
}

for (const kind of Object.keys(kindFields)) {
  assert.equal(validate("release-item", item(kind)).valid, true, `${kind} fixture must be valid`);
  const required = Object.keys(kindFields[kind])[0];
  const missing = item(kind);
  delete missing[required];
  assert.equal(validate("release-item", missing).valid, false, `${kind} must reject missing required field ${required}`);
  assert.equal(validate("release-item", { ...item(kind), unexpected: true }).valid, false, `${kind} must reject unknown properties`);
}

assert.equal(validate("release-item", item("user_story", { observedBehavior: "wrong-kind field" })).valid, false, "fields from another kind must be rejected");
assert.equal(validate("release-item", item("user_story", { acceptanceCriteria: ["same", "same"] })).valid, false, "duplicate arrays must be rejected");
assert.equal(validate("release-item", item("defect", { severity: "urgent" })).valid, false, "invalid enums must be rejected");
assert.equal(validate("release-item", item("spike", { question: "" })).valid, false, "blank required strings must be rejected");
assert.equal(validate("release-item", item("user_story", { status: "SKIPPED" })).valid, false, "SKIPPED is not a Release Item status");
assert.equal(validate("release-item", item("user_story", { sourceRefs: [{ sourceId: "local-backlog", provider: "local_repository", role: "primary", path: "docs/backlog.md", contentRevision: `sha256:${"a".repeat(64)}`, mappingVersion: 1 }] })).valid, true, "closed local sourceRefs are supported");

console.log("release-item-schema: conditional kind schema and closed trust boundary pass");
