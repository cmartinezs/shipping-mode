import assert from "node:assert/strict";
import { validate } from "../schema.mjs";
import { generateUuidV7 } from "../ids.mjs";
import { releaseItemDisplayIdForUuid } from "../releaseItemIdentity.mjs";
import { updateReleaseItemRevision } from "../releaseItemStore.mjs";
import { normalizeReleaseItemCreateRequest } from "../releaseItemCreate.mjs";

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

const localRef = { sourceId: "local-backlog", provider: "local_repository", role: "primary", itemId: "local-story-1", path: "docs/backlog.md", contentRevision: `sha256:${"a".repeat(64)}`, mappingVersion: 1, importedAt: "2026-07-30T00:00:00.000Z" };
const externalRef = { sourceId: "jira-main", provider: "jira", role: "primary", externalId: "ABC-1", externalRevision: "100", mappingVersion: 1, importedAt: "2026-07-30T00:00:00.000Z" };
assert.equal(validate("release-item", item("user_story", { sourceRefs: [localRef] })).valid, true, "closed local sourceRefs are supported");
assert.equal(validate("release-item", item("user_story", { sourceRefs: [externalRef] })).valid, true, "closed external sourceRefs are supported");
assert.equal(validate("release-item", item("user_story", { sourceRefs: [{ ...localRef, contentRevision: undefined }] })).valid, false, "local sourceRefs require revision evidence");
assert.equal(validate("release-item", item("user_story", { sourceRefs: [{ ...externalRef, path: "docs/issue.md" }] })).valid, false, "external providers cannot use local path locators");
assert.equal(validate("release-item", item("user_story", { sourceRefs: [{ ...localRef, importedAt: undefined }] })).valid, false, "sourceRefs require server-owned import timestamps");
assert.equal(validate("release-item", item("user_story", { sourceRefs: [{ ...externalRef, itemId: "local-style-id" }] })).valid, false, "external sourceRefs cannot mix local item identity");
assert.equal(validate("release-item", item("user_story", { status: "DONE", resolution: { type: "CANCELLED", reason: "wrong", approvedBy: "carlos", approvedAt: "2026-07-29T00:00:00.000Z", riskAccepted: false, replacementId: null, operationId: generateUuidV7(), provenance: { source: "manual", revision: "1" } } })).valid, false, "resolution type must match terminal status");
assert.equal(validate("release-item", item("user_story", { status: "SUPERSEDED", resolution: { type: "SUPERSEDED", reason: "replaced", approvedBy: "carlos", approvedAt: "2026-07-29T00:00:00.000Z", riskAccepted: false, replacementId: null, operationId: generateUuidV7(), provenance: { source: "manual", revision: "1" } } })).valid, false, "SUPERSEDED requires a replacement ID");
assert.equal(validate("release-item", item("user_story")).valid, true, "legacy Release Items without sourceSync remain valid");
const sourceSync = {
  schemaVersion: 1,
  baselines: [{
    baselineId: generateUuidV7(),
    sourceRefIdentityHash: `sha256:${"b".repeat(64)}`,
    role: "primary",
    sourceId: "jira-main",
    provider: "jira",
    locator: { externalId: "ABC-1" },
    sourceRevision: "100",
    mappingVersion: 1,
    mappingProfile: "jira-main-v1",
    configHash: `sha256:${"c".repeat(64)}`,
    managedFields: ["/kind", "/title", "/description", "/actor", "/need", "/value", "/acceptanceCriteria"],
    managedSnapshot: { kind: "user_story", title: "user_story title", description: null, actor: "teacher", need: "track work", value: "predictability", acceptanceCriteria: ["status is visible"] },
    managedSnapshotHash: `sha256:${"d".repeat(64)}`,
    aggregateRevisionAtSync: `sha256:${"e".repeat(64)}`,
    syncedAt: "2026-07-30T00:00:00.000Z",
    syncedBy: "carlos"
  }]
};
assert.equal(validate("release-item", item("user_story", { sourceRefs: [externalRef], sourceSync })).valid, true, "sourceSync baseline is optional, closed and schema-valid");
assert.equal(validate("release-item", item("user_story", { sourceRefs: [externalRef], sourceSync: { ...sourceSync, rawJiraPayload: {} } })).valid, false, "sourceSync rejects raw provider payload");
assert.equal(validate("release-item", item("user_story", { sourceRefs: [externalRef], sourceSync: { schemaVersion: 1, baselines: [{ ...sourceSync.baselines[0], syncedAt: undefined }] } })).valid, false, "sourceSync baselines require syncedAt");
const sourceRequest = { kind: "spike", title: "Source", question: "Q", timebox: "1d", expectedDecision: "D", sourceRefs: [localRef], idempotencyKey: "source" };
assert.throws(() => normalizeReleaseItemCreateRequest(sourceRequest, { actor: "carlos", defaultIdempotencyKey: "default", releaseId }), /server-owned: sourceRefs/, "manual Release Item creation cannot forge source provenance");

console.log("release-item-schema: conditional kind schema and closed trust boundary pass");
