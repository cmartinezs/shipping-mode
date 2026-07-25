import fs from "node:fs";
import path from "node:path";
import { canonicalize, contentHash } from "./canonical.mjs";
import { confineWritePath, ensureDirectoryTree } from "./paths.mjs";
import { createFileAtomic } from "./safeFs.mjs";
import { validate } from "./schema.mjs";

export class RecoveryRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "RecoveryRequiredError";
  }
}

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

  const planningRoot = path.dirname(eventsRoot);
  ensureDirectoryTree(planningRoot, path.basename(eventsRoot));
  const confinedPath = confineWritePath(eventsRoot, expectedEvent.relativePath);

  const serialized = serializeEvent(expectedEvent.document);
  const recomputedHash = contentHash(serialized);
  if (recomputedHash !== expectedEvent.contentHash) {
    throw new Error(`expectedEvent.contentHash does not match its own document for ${expectedEvent.relativePath}`);
  }

  if (!fs.existsSync(confinedPath)) {
    try {
      createFileAtomic(eventsRoot, expectedEvent.relativePath, serialized);
      return "CREATED";
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // A concurrent external publisher may have won. Fall through to the
      // same content-hash check used for ordinary idempotent retries.
    }
  }

  const existingPath = confineWritePath(eventsRoot, expectedEvent.relativePath);
  const existingHash = contentHash(fs.readFileSync(existingPath));
  if (existingHash === expectedEvent.contentHash) {
    return "ALREADY_APPLIED";
  }
  throw new RecoveryRequiredError(`event file ${expectedEvent.relativePath} exists with unexpected content`);
}
