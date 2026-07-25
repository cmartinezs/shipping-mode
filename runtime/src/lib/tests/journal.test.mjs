import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateUuidV7 } from "../ids.mjs";
import { PathConfinementError } from "../paths.mjs";
import { buildExpectedEvent, writeEventIdempotent, RecoveryRequiredError } from "../journal.mjs";

const operationId = generateUuidV7();
const eventId = generateUuidV7();
const expected = buildExpectedEvent({
  eventId,
  type: "workspace.initialized",
  aggregate: { type: "workspace", id: operationId },
  actor: "carlos",
  operationId,
  idempotencyKey: "k1",
  payload: { name: "demo" },
  occurredAt: "2026-07-24T00:00:00.000Z"
});

assert.equal(expected.eventId, eventId, "buildExpectedEvent must use the reserved eventId it was given, never mint its own");
assert.match(expected.relativePath, /^\d{4}\/\d{2}\/[0-9a-f-]+\.json$/);
assert.ok(expected.contentHash);
assert.equal(expected.document.type, "workspace.initialized");
assert.equal(expected.document.eventId, eventId);
assert.equal(expected.document.occurredAt, "2026-07-24T00:00:00.000Z", "occurredAt must be fixed, never recomputed at write time");

const eventsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "journal-"));

const first = writeEventIdempotent(eventsRoot, expected);
assert.equal(first, "CREATED");

const second = writeEventIdempotent(eventsRoot, expected);
assert.equal(second, "ALREADY_APPLIED", "writing the exact same expected event twice must be a no-op");

// same eventId/relativePath as the already-written `expected` event, but a
// different payload -- built via buildExpectedEvent so its contentHash is
// genuinely self-consistent with its own (tampered) document, exercising
// the disk-comparison mismatch path rather than the internal
// contentHash-vs-document self-consistency check
const tamperedContent = buildExpectedEvent({
  eventId, type: "workspace.initialized", aggregate: { type: "workspace", id: operationId }, actor: "carlos",
  operationId, idempotencyKey: "k1", payload: { name: "different" }, occurredAt: "2026-07-24T00:00:00.000Z"
});
assert.throws(() => writeEventIdempotent(eventsRoot, tamperedContent), RecoveryRequiredError, "an event file that exists with different content must never be silently overwritten");

// an expectedEvent whose contentHash doesn't match its own document is an
// internal-consistency violation and must be rejected before any disk access
const inconsistent = { ...expected, relativePath: "2026/07/inconsistent.json", contentHash: "0".repeat(64) };
assert.throws(() => writeEventIdempotent(eventsRoot, inconsistent), /contentHash/i);

// relativePath must be confined under eventsRoot
const escaping = { ...expected, relativePath: "../../../etc/passwd" };
assert.throws(() => writeEventIdempotent(eventsRoot, escaping), PathConfinementError);

// a schema-invalid document (missing a required field) must never be written
const schemaInvalid = { ...expected, relativePath: "2026/07/schema-invalid.json", document: { ...expected.document, actor: undefined } };
assert.throws(() => writeEventIdempotent(eventsRoot, schemaInvalid), /event/i);
assert.equal(fs.existsSync(path.join(eventsRoot, "2026", "07", "schema-invalid.json")), false, "a schema-invalid event must never reach disk");

// eventsRoot itself may not exist yet -- true for a fresh workspace's very
// first event -- writeEventIdempotent must create it, not throw on a missing root
const freshEventsRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "journal-fresh-")), "events");
assert.equal(fs.existsSync(freshEventsRoot), false);
const secondExpected = buildExpectedEvent({
  eventId: generateUuidV7(),
  type: "workspace.initialized", aggregate: { type: "workspace", id: operationId }, actor: "carlos",
  operationId, idempotencyKey: "k2", payload: {}, occurredAt: "2026-07-24T00:00:00.000Z"
});
assert.equal(writeEventIdempotent(freshEventsRoot, secondExpected), "CREATED");

console.log("journal: all tests passed");
