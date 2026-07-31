import assert from "node:assert/strict";
import { generateUuidV7 } from "../ids.mjs";
import { requestedFieldIds } from "../jiraMcpWorkSource.mjs";
import { refreshedItem } from "../workSourceRefresh.mjs";
import { sourceSyncAggregateRevision } from "../sourceSyncRevision.mjs";

const source = {
  id: "jira-gradeops",
  provider: "jira",
  transport: "mcp",
  connectionRef: "atlassian",
  enabled: true,
  roots: [],
  mappingVersion: 1,
  mappingProfile: "jira-gradeops-v1",
  importPolicy: "external_authoritative",
  syncMode: "pull",
  capabilities: ["discover", "search", "get"],
  options: {
    project_keys: ["GRADE"],
    query_scope: { mode: "project_keys_and_text", max_results: 50 },
    allowed_issue_types: ["Story"],
    field_map: {
      Story: {
        kind: "user_story",
        actor: "customfield_10101",
        need: "customfield_10102",
        value: "customfield_10103",
        acceptanceCriteria: "customfield_10104"
      }
    }
  }
};

const requested = requestedFieldIds(source);
assert.equal(requested.includes("user_story"), false, "mapping kind values are not Jira field selectors");
assert.equal(requested.includes("customfield_10101"), true);
assert.equal(requested.includes("customfield_10104"), true);

const syncedAt = "2026-07-31T12:00:00.000Z";
const baselineId = generateUuidV7();
const item = {
  schemaVersion: 1,
  id: generateUuidV7(),
  displayId: "RI-TEST",
  displayIdStatus: "ACTIVE",
  releaseId: generateUuidV7(),
  slug: null,
  title: "Original title",
  description: "Original description",
  kind: "user_story",
  status: "DRAFT",
  dependencies: [],
  sourceRefs: [{
    sourceId: source.id,
    provider: "jira",
    role: "primary",
    externalId: "GRADE-142",
    externalRevision: "10041",
    fingerprint: `sha256:${"a".repeat(64)}`,
    mappingVersion: 1,
    importedAt: "2026-07-30T12:00:00.000Z"
  }],
  sourceSync: null,
  resolution: null,
  actor: "Teacher",
  need: "Grade submissions",
  value: "Reduce manual work",
  acceptanceCriteria: ["Old criterion"],
  audit: {
    createdAt: "2026-07-30T12:00:00.000Z",
    createdBy: "tester",
    updatedAt: "2026-07-30T12:00:00.000Z",
    updatedBy: "tester",
    operationId: generateUuidV7(),
    revision: `sha256:${"b".repeat(64)}`
  }
};

const normalizedItem = {
  itemId: "GRADE-142",
  type: "user_story",
  title: "Remote title",
  description: { format: "plain", text: "Remote description" },
  acceptanceCriteria: [
    { id: "ac-1", text: "First criterion" },
    { id: "ac-2", text: "Second criterion" }
  ],
  fields: {
    actor: "Instructor",
    need: "Review submissions",
    value: "Save grading time"
  },
  revision: {
    externalRevision: "10042",
    fingerprint: `sha256:${"c".repeat(64)}`
  }
};

const args = {
  item,
  source,
  normalizedItem,
  actor: "tester",
  operationId: generateUuidV7(),
  syncedAt,
  baselineId
};
const first = refreshedItem(args);
const second = refreshedItem(args);

assert.deepEqual(first, second, "rendering the same refresh reservation must be deterministic");
assert.equal(first.sourceSync.baselines[0].baselineId, baselineId);
assert.deepEqual(first.acceptanceCriteria, ["First criterion", "Second criterion"]);
assert.equal(first.sourceSync.baselines[0].aggregateRevisionAtSync, sourceSyncAggregateRevision(first));

console.log("work-source-plan4-regressions: deterministic baseline, aggregate binding, criteria and Jira fields pass");
