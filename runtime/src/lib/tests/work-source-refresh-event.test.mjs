import assert from "node:assert/strict";
import { eventTypeFor } from "../changeset.mjs";
import { buildExpectedEvent } from "../journal.mjs";
import { validate } from "../schema.mjs";
import { generateUuidV7 } from "../ids.mjs";

assert.equal(eventTypeFor("work-source.refresh"), "work-source.refreshed");
const operationId = generateUuidV7();
const event = buildExpectedEvent({
  eventId: generateUuidV7(),
  type: "work-source.refreshed",
  aggregate: { type: "release-item", id: generateUuidV7() },
  actor: "tester",
  operationId,
  idempotencyKey: "refresh-1",
  payload: {
    releaseItemId: generateUuidV7(),
    releaseId: generateUuidV7(),
    sourceId: "jira-gradeops",
    provider: "jira",
    sourceRevision: "rev-1",
    mappingVersion: 1,
    baselineId: generateUuidV7(),
    operationId,
    actor: "tester",
    idempotencyKey: "refresh-1",
    changeSetHash: "a".repeat(64),
    revisionAfter: `sha256:${"b".repeat(64)}`
  }
});
assert.equal(validate("event", event.document).valid, true);
console.log("work-source-refresh-event: bounded event contract pass");
