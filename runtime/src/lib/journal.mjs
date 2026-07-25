import fs from "node:fs";
import path from "node:path";
import { canonicalize, contentHash } from "./canonical.mjs";
import { confineUnder } from "./paths.mjs";
import { validate } from "./schema.mjs";

export class RecoveryRequiredError extends Error {}

function serializeEvent(document) {
  return `${JSON.stringify(canonicalize(document), null, 2)}\n`;
}

export function buildExpectedEvent({ eventId, type, aggregate, actor, operationId, idempotencyKey, payload, inputHash = null, outputHash = null, occurredAt = new Date().toISOString(), schemaVersion = 1 }) {
  const document = {
    eventId,
    schemaVersion,
    type,
    aggregate,
    occurredAt,
    actor,
    operationId,
    idempotencyKey,
    payload,
    inputHash,
    outputHash
  };
  const serialized = serializeEvent(document);
  const yyyy = occurredAt.slice(0, 4);
  const mm = occurredAt.slice(5, 7);
  return {
    eventId,
    relativePath: `${yyyy}/${mm}/${eventId}.json`,
    contentHash: contentHash(serialized),
    document
  };
}

export function writeEventIdempotent(eventsRoot, expectedEvent) {
  const schemaResult = validate("event", expectedEvent.document);
  if (!schemaResult.valid) {
    throw new Error(`event document is schema-invalid: ${schemaResult.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  }

  fs.mkdirSync(eventsRoot, { recursive: true }); // may be the first event this workspace has ever written
  const confinedPath = confineUnder(eventsRoot, expectedEvent.relativePath);

  const serialized = serializeEvent(expectedEvent.document);
  const recomputedHash = contentHash(serialized);
  if (recomputedHash !== expectedEvent.contentHash) {
    throw new Error(`expectedEvent.contentHash does not match its own document for ${expectedEvent.relativePath}`);
  }

  if (!fs.existsSync(confinedPath)) {
    fs.mkdirSync(path.dirname(confinedPath), { recursive: true });
    const tmpPath = `${confinedPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, serialized);
    fs.renameSync(tmpPath, confinedPath);
    return "CREATED";
  }

  const existingHash = contentHash(fs.readFileSync(confinedPath));
  if (existingHash === expectedEvent.contentHash) {
    return "ALREADY_APPLIED";
  }
  throw new RecoveryRequiredError(`event file ${expectedEvent.relativePath} exists with unexpected content`);
}
