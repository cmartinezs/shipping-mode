import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  BRIDGE_RESULT_CODES,
  BRIDGE_SCHEMA_VERSION,
  BridgeError,
  bridgeRoot,
  canonicalJson,
  cleanupExpiredRequests as cleanupBaseExpiredRequests,
  ensureBridgeKey,
  hashCanonical,
  hashString,
  isUuidV7,
  loadBridgeState,
  normalizeRequestInput,
  prepareBridgeRequest as prepareBaseRequest,
  projectRootHash,
  signEnvelope,
  verifyEnvelopeSignature,
  writeJsonAtomic
} from "./bridge-core.mjs";

const REQUEST_STATUS = Object.freeze({ PENDING: "PENDING", CONSUMED: "CONSUMED", EXPIRED: "EXPIRED" });
const ENVELOPE_STATUS = "CAPTURED";
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TTL_MS = 10 * 60 * 1000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10000;
const SECRET_KEY_PATTERN = /^(?:access[-_]?token|refresh[-_]?token|token|secret|password|passwd|cookie|set-cookie|credential|authorization|api[-_]?key|client[-_]?secret|private[-_]?key|session[-_]?(?:key|token))$/i;

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} must be a non-blank string`);
  }
  return value.trim();
}

function requirePositiveInteger(value, field, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function parseIso(value, field) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} must be an ISO timestamp`);
  return parsed;
}

function pathsFor(root, requestId) {
  return {
    request: path.join(root, "requests", `${requestId}.json`),
    envelope: path.join(root, "envelopes", `${requestId}.json`),
    lock: path.join(root, "locks", `${requestId}.lock`)
  };
}

function readJson(filePath, field) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} is not readable JSON: ${error.message}`);
  }
}

function listRequestFiles(root) {
  const directory = path.join(root, "requests");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => path.join(directory, entry));
}

function requireHostSession(env, explicitSessionId = null) {
  const sessionId = explicitSessionId || env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) {
    throw new BridgeError(BRIDGE_RESULT_CODES.UNAVAILABLE, "CLAUDE_CODE_SESSION_ID is not set; bridge commands must run inside one Claude Code session");
  }
  return requireString(sessionId, "sessionId");
}

function normalizeServerAndTool(serverValue, toolValue) {
  const server = requireString(serverValue, "server");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(server)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "server contains unsupported characters");
  }
  const suppliedTool = requireString(toolValue, "tool");
  if (suppliedTool.startsWith("mcp__")) {
    const prefix = `mcp__${server}__`;
    if (!suppliedTool.startsWith(prefix) || suppliedTool.length === prefix.length) {
      throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `full MCP tool name must belong to server ${server}`);
    }
    return { server, tool: suppliedTool.slice(prefix.length), toolName: suppliedTool };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(suppliedTool)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "tool contains unsupported characters");
  }
  return { server, tool: suppliedTool, toolName: `mcp__${server}__${suppliedTool}` };
}

function validateJsonTree(value, pathStack = [], state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "response contains too many JSON nodes");
  if (pathStack.length > MAX_JSON_DEPTH) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "response exceeds maximum JSON depth");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `response contains non-finite number at ${pathStack.join(".") || "$"}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonTree(entry, [...pathStack, String(index)], state));
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `response contains unsupported value at ${pathStack.join(".") || "$"}`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `secret-like key rejected at ${[...pathStack, key].join(".")}`);
    }
    validateJsonTree(child, [...pathStack, key], state);
  }
}

function boundedResponse(value, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  const response = value === undefined ? null : value;
  validateJsonTree(response);
  const serialized = JSON.stringify(response);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maxBytes) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `response exceeds ${maxBytes} bytes`);
  return { response, bytes };
}

function assertClosedObject(value, allowed, required, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} contains unsupported field ${key}`);
  }
  for (const key of required) {
    if (!(key in value)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} is missing ${key}`);
  }
}

const REQUEST_REQUIRED_FIELDS = new Set([
  "schemaVersion", "requestId", "nonce", "nonceHash", "createdAt", "expiresAt", "consumedAt", "status",
  "projectRootHash", "expectedServer", "expectedTool", "expectedToolName", "expectedToolInputHash",
  "expectedSessionIdHash", "operation", "maxResponseBytes", "capture", "failure", "consumedEnvelopeHash", "recoveryRequired"
]);
const REQUEST_ALLOWED_FIELDS = new Set([...REQUEST_REQUIRED_FIELDS, "expiredAt"]);

const ENVELOPE_FIELDS = new Set([
  "schemaVersion", "requestId", "status", "nonceHash", "sessionId", "projectRootHash", "expectedServer",
  "expectedTool", "toolName", "toolUseId", "toolInputHash", "toolResponseHash", "capturedAt", "expiresAt",
  "responseBytes", "durationMs", "response", "signature"
]);

function validateRequestShape(request) {
  assertClosedObject(request, REQUEST_ALLOWED_FIELDS, REQUEST_REQUIRED_FIELDS, "request");
  if (request.schemaVersion !== BRIDGE_SCHEMA_VERSION || !isUuidV7(request.requestId)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request identity or schema version mismatch");
  }
  if (!Object.values(REQUEST_STATUS).includes(request.status)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request status is invalid");
  if (!/^[0-9a-f]{64}$/.test(request.nonceHash) || !/^[0-9a-f]{64}$/.test(request.projectRootHash) || !/^[0-9a-f]{64}$/.test(request.expectedToolInputHash) || !/^[0-9a-f]{64}$/.test(request.expectedSessionIdHash)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request hash field is invalid");
  }
  if (hashString(request.nonce) !== request.nonceHash) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request nonce hash mismatch");
  requirePositiveInteger(request.maxResponseBytes, "request.maxResponseBytes", MAX_RESPONSE_BYTES);
  parseIso(request.createdAt, "request.createdAt");
  parseIso(request.expiresAt, "request.expiresAt");
  return request;
}

function validateEnvelopeShape(envelope) {
  assertClosedObject(envelope, ENVELOPE_FIELDS, ENVELOPE_FIELDS, "envelope");
  if (envelope.schemaVersion !== BRIDGE_SCHEMA_VERSION || !isUuidV7(envelope.requestId) || envelope.status !== ENVELOPE_STATUS) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "envelope identity, schema version or status is invalid");
  }
  if (!/^hmac-sha256:[0-9a-f]{64}$/.test(envelope.signature)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "envelope signature format is invalid");
  return envelope;
}

function readRequest(root, requestId) {
  if (!isUuidV7(requestId)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request id must be UUIDv7");
  const filePath = pathsFor(root, requestId).request;
  if (!fs.existsSync(filePath)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `request not found: ${requestId}`);
  const request = validateRequestShape(readJson(filePath, "request"));
  if (request.requestId !== requestId) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request id mismatch");
  return request;
}

function readEnvelope(root, requestId) {
  const filePath = pathsFor(root, requestId).envelope;
  if (!fs.existsSync(filePath)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `envelope not found: ${requestId}`);
  return validateEnvelopeShape(readJson(filePath, "envelope"));
}

function acquireLock(root, requestId) {
  const lockPath = pathsFor(root, requestId).lock;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const token = `${process.pid}:${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(lockPath, `${token}\n`, { flag: "wx", mode: 0o600 });
  } catch {
    throw new BridgeError(BRIDGE_RESULT_CODES.RECOVERY_REQUIRED, "bridge request lock is held");
  }
  return () => {
    try {
      if (fs.readFileSync(lockPath, "utf8").trim() === token) fs.rmSync(lockPath, { force: true });
    } catch {
      // Stale locks are intentionally surfaced as recovery-required on the next attempt.
    }
  };
}

function eventToolResponse(event) {
  return event.tool_response ?? event.toolResponse ?? event.tool_result ?? event.toolResult ?? null;
}

function normalizeHookEvent(rawEvent, env, now) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "hook event must be an object");
  }
  const sessionId = requireString(rawEvent.session_id ?? rawEvent.sessionId, "session_id");
  const hostSessionId = requireHostSession(env);
  if (sessionId !== hostSessionId) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "hook session does not match CLAUDE_CODE_SESSION_ID");
  const durationMs = Number(rawEvent.duration_ms ?? rawEvent.durationMs ?? 0);
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "duration_ms must be non-negative");
  return {
    sessionId,
    cwd: requireString(rawEvent.cwd, "cwd"),
    toolName: requireString(rawEvent.tool_name ?? rawEvent.toolName, "tool_name"),
    toolInput: normalizeRequestInput(rawEvent.tool_input ?? rawEvent.toolInput ?? {}),
    toolResponse: eventToolResponse(rawEvent),
    toolUseId: requireString(rawEvent.tool_use_id ?? rawEvent.toolUseId, "tool_use_id"),
    durationMs,
    capturedAt: now.toISOString()
  };
}

export function prepareBridgeRequest({ env = process.env, sessionId = null, server, tool, ttlMs = 120000, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES, ...rest }) {
  const hostSessionId = requireHostSession(env, sessionId);
  const ttl = requirePositiveInteger(ttlMs, "ttlMs", MAX_TTL_MS);
  const maxBytes = requirePositiveInteger(maxResponseBytes, "maxResponseBytes", MAX_RESPONSE_BYTES);
  const normalizedTool = normalizeServerAndTool(server, tool);
  const prepared = prepareBaseRequest({
    ...rest,
    env,
    server: normalizedTool.server,
    tool: normalizedTool.tool,
    ttlMs: ttl,
    maxResponseBytes: maxBytes
  });
  const root = bridgeRoot({ env, dataRoot: rest.dataRoot });
  const state = loadBridgeState({ env, dataRoot: rest.dataRoot, requestId: prepared.requestId });
  const request = {
    ...state.request,
    expectedSessionIdHash: hashString(hostSessionId),
    failure: null,
    consumedEnvelopeHash: null
  };
  writeJsonAtomic(root, pathsFor(root, prepared.requestId).request, request);
  return {
    ...prepared,
    tool: normalizedTool.tool,
    toolName: normalizedTool.toolName,
    expectedSessionIdHash: request.expectedSessionIdHash
  };
}

function matchingRequestsForEvent(root, event, now) {
  const cwdHash = projectRootHash(event.cwd);
  const eventInputHash = hashCanonical(event.toolInput);
  const eventSessionHash = hashString(event.sessionId);
  const matches = listRequestFiles(root)
    .map((filePath) => validateRequestShape(readJson(filePath, "request")))
    .filter((request) => request.status === REQUEST_STATUS.PENDING)
    .filter((request) => request.failure === null)
    .filter((request) => parseIso(request.expiresAt, "request.expiresAt") > now.getTime())
    .filter((request) => request.projectRootHash === cwdHash)
    .filter((request) => request.expectedSessionIdHash === eventSessionHash)
    .filter((request) => request.expectedToolName === event.toolName)
    .filter((request) => request.expectedToolInputHash === eventInputHash);
  return { matches, eventInputHash };
}

export function capturePostToolUseEvent({ dataRoot, env = process.env, rawEvent, now = new Date() }) {
  const root = bridgeRoot({ env, dataRoot });
  const event = normalizeHookEvent(rawEvent, env, now);
  const { matches, eventInputHash } = matchingRequestsForEvent(root, event, now);
  if (matches.length === 0) return { status: BRIDGE_RESULT_CODES.UNAVAILABLE, captured: false, reason: "no matching pending challenge" };
  if (matches.length > 1) throw new BridgeError(BRIDGE_RESULT_CODES.AMBIGUOUS, "multiple pending challenges match tool event", { matchCount: matches.length });
  const request = matches[0];
  const { response, bytes } = boundedResponse(event.toolResponse, request.maxResponseBytes);
  const envelope = {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    requestId: request.requestId,
    status: ENVELOPE_STATUS,
    nonceHash: request.nonceHash,
    sessionId: event.sessionId,
    projectRootHash: request.projectRootHash,
    expectedServer: request.expectedServer,
    expectedTool: request.expectedTool,
    toolName: event.toolName,
    toolUseId: event.toolUseId,
    toolInputHash: eventInputHash,
    toolResponseHash: hashCanonical(response),
    capturedAt: event.capturedAt,
    expiresAt: new Date(Math.min(parseIso(request.expiresAt, "request.expiresAt"), now.getTime() + 120000)).toISOString(),
    responseBytes: bytes,
    durationMs: event.durationMs,
    response,
    signature: null
  };
  envelope.signature = signEnvelope(envelope, ensureBridgeKey(root));
  try {
    writeJsonAtomic(root, pathsFor(root, request.requestId).envelope, envelope, { noOverwrite: true });
  } catch (error) {
    if (error?.code === "EEXIST") throw new BridgeError(BRIDGE_RESULT_CODES.REPLAYED, "request already has a captured envelope");
    throw error;
  }
  try {
    writeJsonAtomic(root, pathsFor(root, request.requestId).request, {
      ...request,
      capture: {
        sessionId: event.sessionId,
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        toolInputHash: envelope.toolInputHash,
        toolResponseHash: envelope.toolResponseHash,
        envelopePath: `envelopes/${request.requestId}.json`,
        capturedAt: envelope.capturedAt
      }
    });
  } catch {
    // The signed envelope is canonical evidence. Consume can recover capture metadata from it.
  }
  return {
    status: BRIDGE_RESULT_CODES.CAPTURED,
    captured: true,
    requestId: request.requestId,
    toolName: event.toolName,
    responseBytes: envelope.responseBytes,
    envelopeFingerprint: hashCanonical({ ...envelope, response: undefined, signature: undefined })
  };
}

export function capturePostToolFailureEvent({ dataRoot, env = process.env, rawEvent, now = new Date() }) {
  const root = bridgeRoot({ env, dataRoot });
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "hook failure event must be an object");
  }
  const event = normalizeHookEvent({
    ...rawEvent,
    tool_response: null
  }, env, now);
  const { matches, eventInputHash } = matchingRequestsForEvent(root, event, now);
  if (matches.length === 0) return { status: BRIDGE_RESULT_CODES.UNAVAILABLE, captured: false, reason: "no matching pending challenge" };
  if (matches.length > 1) throw new BridgeError(BRIDGE_RESULT_CODES.AMBIGUOUS, "multiple pending challenges match failed tool event", { matchCount: matches.length });
  const request = matches[0];
  const isInterrupt = rawEvent.is_interrupt === true || rawEvent.isInterrupt === true;
  const errorText = typeof rawEvent.error === "string" ? rawEvent.error : "tool execution failed";
  const code = isInterrupt
    ? BRIDGE_RESULT_CODES.CANCELLED
    : /timeout|timed out/i.test(errorText)
      ? BRIDGE_RESULT_CODES.TIMEOUT
      : BRIDGE_RESULT_CODES.UNAVAILABLE;
  writeJsonAtomic(root, pathsFor(root, request.requestId).request, {
    ...request,
    failure: {
      code,
      sessionId: event.sessionId,
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      toolInputHash: eventInputHash,
      occurredAt: now.toISOString(),
      errorHash: hashString(errorText)
    }
  });
  return { status: code, captured: false, requestId: request.requestId };
}

function verifyEnvelope({ request, envelope, projectRoot, sessionId, now, key }) {
  if (request.failure) throw new BridgeError(request.failure.code, `MCP tool did not complete successfully: ${request.failure.code}`);
  if (request.status === REQUEST_STATUS.CONSUMED) throw new BridgeError(BRIDGE_RESULT_CODES.REPLAYED, "request was already consumed");
  if (request.status !== REQUEST_STATUS.PENDING) throw new BridgeError(BRIDGE_RESULT_CODES.EXPIRED, "request is not pending");
  if (parseIso(request.expiresAt, "request.expiresAt") <= now.getTime() || parseIso(envelope.expiresAt, "envelope.expiresAt") <= now.getTime()) {
    throw new BridgeError(BRIDGE_RESULT_CODES.EXPIRED, "request or envelope expired");
  }
  if (envelope.requestId !== request.requestId || envelope.nonceHash !== request.nonceHash) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request/envelope binding mismatch");
  if (hashString(sessionId) !== request.expectedSessionIdHash || envelope.sessionId !== sessionId) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "session binding mismatch");
  if (envelope.projectRootHash !== request.projectRootHash || envelope.projectRootHash !== projectRootHash(projectRoot)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "project root binding mismatch");
  if (envelope.expectedServer !== request.expectedServer || envelope.expectedTool !== request.expectedTool || envelope.toolName !== request.expectedToolName) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "server/tool binding mismatch");
  if (envelope.toolInputHash !== request.expectedToolInputHash) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "tool input binding mismatch");
  const { bytes } = boundedResponse(envelope.response, request.maxResponseBytes);
  if (bytes !== envelope.responseBytes || hashCanonical(envelope.response) !== envelope.toolResponseHash) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "response binding mismatch");
  if (!verifyEnvelopeSignature(envelope, key)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "envelope signature invalid");
}

export function consumeBridgeEnvelope({ dataRoot, env = process.env, sessionId = null, requestId, projectRoot, now = new Date() }) {
  const root = bridgeRoot({ env, dataRoot });
  const hostSessionId = requireHostSession(env, sessionId);
  const release = acquireLock(root, requestId);
  try {
    const request = readRequest(root, requestId);
    const envelope = readEnvelope(root, requestId);
    verifyEnvelope({ request, envelope, projectRoot, sessionId: hostSessionId, now, key: ensureBridgeKey(root) });
    const consumedAt = now.toISOString();
    const consumedEnvelopeHash = hashCanonical(envelope);
    const capture = request.capture || {
      sessionId: envelope.sessionId,
      toolUseId: envelope.toolUseId,
      toolName: envelope.toolName,
      toolInputHash: envelope.toolInputHash,
      toolResponseHash: envelope.toolResponseHash,
      envelopePath: `envelopes/${request.requestId}.json`,
      capturedAt: envelope.capturedAt
    };
    writeJsonAtomic(root, pathsFor(root, requestId).request, {
      ...request,
      status: REQUEST_STATUS.CONSUMED,
      consumedAt,
      capture,
      consumedEnvelopeHash,
      recoveryRequired: false
    });
    return {
      status: "BRIDGE_CONSUMED",
      requestId,
      result: BRIDGE_RESULT_CODES.CAPTURED,
      toolName: envelope.toolName,
      toolUseId: envelope.toolUseId,
      capturedAt: envelope.capturedAt,
      consumedAt,
      responseBytes: envelope.responseBytes,
      responseFingerprint: envelope.toolResponseHash,
      response: envelope.response
    };
  } finally {
    release();
  }
}

export function cleanupExpiredRequests(options) {
  return cleanupBaseExpiredRequests(options);
}

export function inspectBridgeMetadata({ dataRoot, env = process.env, requestId }) {
  const state = loadBridgeState({ dataRoot, env, requestId });
  if (!requestId) return { root: state.root };
  const request = state.request ? {
    ...state.request,
    nonce: "[redacted]"
  } : null;
  const envelope = state.envelope ? {
    ...state.envelope,
    response: "[redacted]",
    signature: "[redacted]"
  } : null;
  return { root: state.root, request, envelope };
}

export { BRIDGE_RESULT_CODES, BridgeError, canonicalJson, hashCanonical, loadBridgeState, signEnvelope, verifyEnvelopeSignature };
