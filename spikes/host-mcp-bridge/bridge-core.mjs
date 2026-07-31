import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BRIDGE_SCHEMA_VERSION = 1;
export const BRIDGE_RESULT_CODES = Object.freeze({
  CAPTURED: "BRIDGE_CAPTURED",
  UNAVAILABLE: "BRIDGE_UNAVAILABLE",
  TIMEOUT: "BRIDGE_TIMEOUT",
  CANCELLED: "BRIDGE_CANCELLED",
  AMBIGUOUS: "BRIDGE_AMBIGUOUS",
  INVALID: "BRIDGE_INVALID",
  EXPIRED: "BRIDGE_EXPIRED",
  REPLAYED: "BRIDGE_REPLAYED",
  RECOVERY_REQUIRED: "BRIDGE_RECOVERY_REQUIRED"
});

const REQUEST_TTL_MS = 2 * 60 * 1000;
const ENVELOPE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const SECRET_KEY_PATTERN = /(token|secret|password|cookie|credential|authorization|auth|api[-_]?key|refresh|session[-_]?key)/i;
const REQUEST_STATUS = Object.freeze({ PENDING: "PENDING", CONSUMED: "CONSUMED" });
const ENVELOPE_STATUS = Object.freeze({ CAPTURED: "CAPTURED", CONSUMED: "CONSUMED" });

export class BridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.details = details;
  }
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashCanonical(value) {
  return sha256Hex(canonicalJson(value));
}

export function hashString(value) {
  return sha256Hex(String(value));
}

export function generateUuidV7(now = new Date()) {
  const bytes = crypto.randomBytes(16);
  let timestamp = BigInt(now.getTime());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidV7(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseIso(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} must be an ISO timestamp`);
  return time;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} must be a non-blank string`);
  }
  return value.trim();
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} must be an object`);
  }
  return value;
}

function ensureInsideBridgeData(dataRoot, targetPath) {
  const resolvedRoot = path.resolve(dataRoot);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "bridge path escaped plugin data root");
  }
  return resolvedTarget;
}

function realProjectRoot(projectRoot) {
  const resolved = path.resolve(requireString(projectRoot, "projectRoot"));
  try {
    return fs.realpathSync(resolved);
  } catch {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `project root does not exist: ${projectRoot}`);
  }
}

export function projectRootHash(projectRoot) {
  return hashString(realProjectRoot(projectRoot));
}

export function bridgeRoot({ env = process.env, dataRoot = null } = {}) {
  const root = dataRoot || env.CLAUDE_PLUGIN_DATA || env.BRIDGE_SPIKE_DATA_ROOT;
  if (!root) {
    throw new BridgeError(BRIDGE_RESULT_CODES.UNAVAILABLE, "CLAUDE_PLUGIN_DATA is not set");
  }
  const resolved = path.resolve(root, "work-source-bridge");
  if (resolved.split(path.sep).includes(".planning")) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "bridge state must not live under .planning");
  }
  return resolved;
}

function pathsFor(root, requestId = null) {
  const base = {
    root,
    requests: path.join(root, "requests"),
    envelopes: path.join(root, "envelopes"),
    locks: path.join(root, "locks"),
    evidence: path.join(root, "evidence"),
    key: path.join(root, "bridge.key")
  };
  if (!requestId) return base;
  return {
    ...base,
    request: path.join(base.requests, `${requestId}.json`),
    envelope: path.join(base.envelopes, `${requestId}.json`),
    lock: path.join(base.locks, `${requestId}.lock`)
  };
}

function ensureBridgeDirectories(root) {
  for (const directory of ["requests", "envelopes", "locks", "evidence"]) {
    fs.mkdirSync(ensureInsideBridgeData(root, path.join(root, directory)), { recursive: true, mode: 0o700 });
  }
}

export function writeJsonAtomic(root, targetPath, value, { noOverwrite = false, crashAfterTemp = false } = {}) {
  ensureInsideBridgeData(root, targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const tempPath = ensureInsideBridgeData(root, `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(tempPath, bytes, { flag: "wx", mode: 0o600 });
  if (crashAfterTemp) {
    throw new BridgeError(BRIDGE_RESULT_CODES.RECOVERY_REQUIRED, "simulated crash after temporary write", { tempPath });
  }
  try {
    if (noOverwrite) fs.linkSync(tempPath, targetPath);
    else fs.renameSync(tempPath, targetPath);
  } finally {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Temporary cleanup is best effort. Later reads never trust temp files.
    }
  }
}

function readJsonFile(filePath, field) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `${field} is not readable JSON: ${error.message}`);
  }
}

function listJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => path.join(directory, entry));
}

export function ensureBridgeKey(root) {
  ensureBridgeDirectories(root);
  const keyPath = pathsFor(root).key;
  if (!fs.existsSync(keyPath)) {
    const key = crypto.randomBytes(32).toString("base64url");
    const fd = fs.openSync(keyPath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, `${key}\n`, "utf8");
    } finally {
      fs.closeSync(fd);
    }
  }
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // Some platforms do not support POSIX modes; the spike records this limit.
  }
  const key = fs.readFileSync(keyPath, "utf8").trim();
  if (!key) throw new BridgeError(BRIDGE_RESULT_CODES.UNAVAILABLE, "bridge key is empty");
  return Buffer.from(key, "utf8");
}

function hmacPayload(envelope) {
  const { signature, ...unsigned } = envelope;
  return canonicalJson(unsigned);
}

export function signEnvelope(envelope, key) {
  return `hmac-sha256:${crypto.createHmac("sha256", key).update(hmacPayload(envelope)).digest("hex")}`;
}

export function verifyEnvelopeSignature(envelope, key) {
  if (typeof envelope.signature !== "string" || !envelope.signature.startsWith("hmac-sha256:")) return false;
  const expected = signEnvelope({ ...envelope, signature: null }, key);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(envelope.signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function assertNoSecretLikeKeys(value, { pathStack = [] } = {}) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretLikeKeys(entry, { pathStack: [...pathStack, String(index)] }));
    return;
  }
  if (typeof value !== "object") {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `response contains unsupported value at ${pathStack.join(".") || "$"}`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `secret-like key rejected at ${[...pathStack, key].join(".")}`);
    }
    assertNoSecretLikeKeys(child, { pathStack: [...pathStack, key] });
  }
}

function assertJsonSafe(value) {
  try {
    JSON.stringify(value);
  } catch {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "response is not JSON-safe");
  }
}

export function boundedResponse(value, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  const response = value === undefined ? null : value;
  assertJsonSafe(response);
  assertNoSecretLikeKeys(response);
  const bytes = Buffer.byteLength(JSON.stringify(response), "utf8");
  if (bytes > maxBytes) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `response exceeds ${maxBytes} bytes`);
  }
  return { response, bytes };
}

function expectedToolName({ server, tool }) {
  if (tool.startsWith("mcp__")) return tool;
  return `mcp__${server}__${tool}`;
}

function normalizeOperation(value) {
  const operation = requireString(value, "operation");
  if (!["discover", "search", "get"].includes(operation)) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "operation must be discover, search or get");
  }
  return operation;
}

export function normalizeRequestInput(input) {
  assertJsonSafe(input);
  assertNoSecretLikeKeys(input);
  return canonicalize(input);
}

export function prepareBridgeRequest({
  dataRoot,
  env = process.env,
  operation,
  server,
  tool,
  projectRoot,
  expectedInput,
  now = new Date(),
  ttlMs = REQUEST_TTL_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
}) {
  const root = bridgeRoot({ env, dataRoot });
  ensureBridgeDirectories(root);
  ensureBridgeKey(root);
  const normalizedInput = normalizeRequestInput(expectedInput);
  const requestId = generateUuidV7(now);
  const nonce = crypto.randomBytes(32).toString("base64url");
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const request = {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    requestId,
    nonce,
    nonceHash: hashString(nonce),
    createdAt,
    expiresAt,
    consumedAt: null,
    status: REQUEST_STATUS.PENDING,
    projectRootHash: projectRootHash(projectRoot),
    expectedServer: requireString(server, "server"),
    expectedTool: requireString(tool, "tool"),
    expectedToolName: expectedToolName({ server: requireString(server, "server"), tool: requireString(tool, "tool") }),
    expectedToolInputHash: hashCanonical(normalizedInput),
    operation: normalizeOperation(operation),
    maxResponseBytes,
    capture: null,
    recoveryRequired: false
  };
  writeJsonAtomic(root, pathsFor(root, requestId).request, request, { noOverwrite: true });
  return {
    status: "BRIDGE_PREPARED",
    requestId,
    expiresAt,
    operation: request.operation,
    server: request.expectedServer,
    tool: request.expectedTool,
    toolName: request.expectedToolName,
    toolInput: normalizedInput,
    projectRootHash: request.projectRootHash,
    expectedToolInputHash: request.expectedToolInputHash,
    bridgeDataDirectory: root
  };
}

function readRequest(root, requestId) {
  if (!isUuidV7(requestId)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request id must be UUIDv7");
  const requestPath = pathsFor(root, requestId).request;
  if (!fs.existsSync(requestPath)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `request not found: ${requestId}`);
  const request = readJsonFile(requestPath, "request");
  if (request.requestId !== requestId || request.schemaVersion !== BRIDGE_SCHEMA_VERSION) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request identity or schema version mismatch");
  }
  return request;
}

function updateRequest(root, request) {
  writeJsonAtomic(root, pathsFor(root, request.requestId).request, request);
}

function readEnvelope(root, requestId) {
  const envelopePath = pathsFor(root, requestId).envelope;
  if (!fs.existsSync(envelopePath)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `envelope not found: ${requestId}`);
  return readJsonFile(envelopePath, "envelope");
}

function updateEnvelope(root, envelope) {
  writeJsonAtomic(root, pathsFor(root, envelope.requestId).envelope, envelope);
}

function validateRequestPending(request, now = new Date()) {
  if (request.status !== REQUEST_STATUS.PENDING) throw new BridgeError(BRIDGE_RESULT_CODES.REPLAYED, "request is not pending");
  if (parseIso(request.expiresAt, "request.expiresAt") <= now.getTime()) {
    throw new BridgeError(BRIDGE_RESULT_CODES.EXPIRED, "request expired");
  }
}

function eventToolInput(event) {
  return event.tool_input ?? event.toolInput ?? {};
}

function eventToolResponse(event) {
  return event.tool_response ?? event.toolResponse ?? event.tool_result ?? event.toolResult ?? null;
}

function normalizeHookEvent(rawEvent, now = new Date()) {
  const event = requireObject(rawEvent, "hook event");
  const sessionId = requireString(event.session_id ?? event.sessionId, "session_id");
  const cwd = requireString(event.cwd, "cwd");
  const toolName = requireString(event.tool_name ?? event.toolName, "tool_name");
  const toolUseId = requireString(event.tool_use_id ?? event.toolUseId, "tool_use_id");
  const durationMs = Number(event.duration_ms ?? event.durationMs ?? 0);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "duration_ms must be non-negative");
  }
  return {
    sessionId,
    cwd,
    toolName,
    toolInput: normalizeRequestInput(eventToolInput(event)),
    toolResponse: eventToolResponse(event),
    toolUseId,
    durationMs,
    capturedAt: now.toISOString()
  };
}

function matchingRequests(root, event, now = new Date()) {
  const cwdHash = projectRootHash(event.cwd);
  return listJsonFiles(pathsFor(root).requests)
    .map((filePath) => readJsonFile(filePath, "request"))
    .filter((request) => request.schemaVersion === BRIDGE_SCHEMA_VERSION)
    .filter((request) => request.status === REQUEST_STATUS.PENDING)
    .filter((request) => parseIso(request.expiresAt, "request.expiresAt") > now.getTime())
    .filter((request) => request.projectRootHash === cwdHash)
    .filter((request) => request.expectedToolName === event.toolName || request.expectedTool === event.toolName)
    .filter((request) => request.expectedToolInputHash === hashCanonical(event.toolInput));
}

function buildEnvelope({ request, event, key, now = new Date() }) {
  const { response, bytes } = boundedResponse(event.toolResponse, request.maxResponseBytes);
  const capturedAt = event.capturedAt || now.toISOString();
  const envelope = {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    requestId: request.requestId,
    status: ENVELOPE_STATUS.CAPTURED,
    nonceHash: request.nonceHash,
    sessionId: event.sessionId,
    projectRootHash: request.projectRootHash,
    expectedServer: request.expectedServer,
    expectedTool: request.expectedTool,
    toolName: event.toolName,
    toolUseId: event.toolUseId,
    toolInputHash: hashCanonical(event.toolInput),
    toolResponseHash: hashCanonical(response),
    capturedAt,
    expiresAt: new Date(Math.min(parseIso(request.expiresAt, "request.expiresAt"), now.getTime() + ENVELOPE_TTL_MS)).toISOString(),
    responseBytes: bytes,
    durationMs: event.durationMs,
    response,
    signature: null
  };
  envelope.signature = signEnvelope(envelope, key);
  return envelope;
}

export function capturePostToolUseEvent({
  dataRoot,
  env = process.env,
  rawEvent,
  now = new Date(),
  crashAfterEnvelope = false
}) {
  const root = bridgeRoot({ env, dataRoot });
  ensureBridgeDirectories(root);
  const event = normalizeHookEvent(rawEvent, now);
  const matches = matchingRequests(root, event, now);
  if (matches.length === 0) {
    return { status: BRIDGE_RESULT_CODES.UNAVAILABLE, captured: false, reason: "no matching pending challenge" };
  }
  if (matches.length > 1) {
    throw new BridgeError(BRIDGE_RESULT_CODES.AMBIGUOUS, "multiple pending challenges match tool event", { matchCount: matches.length });
  }
  const request = matches[0];
  validateRequestPending(request, now);
  if (request.capture) throw new BridgeError(BRIDGE_RESULT_CODES.REPLAYED, "request already has a captured envelope");
  const key = ensureBridgeKey(root);
  const envelope = buildEnvelope({ request, event, key, now });
  writeJsonAtomic(root, pathsFor(root, request.requestId).envelope, envelope, { noOverwrite: true });
  if (crashAfterEnvelope) {
    const recovery = { ...request, recoveryRequired: true };
    updateRequest(root, recovery);
    throw new BridgeError(BRIDGE_RESULT_CODES.RECOVERY_REQUIRED, "simulated crash after envelope publication");
  }
  updateRequest(root, {
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
  return {
    status: BRIDGE_RESULT_CODES.CAPTURED,
    captured: true,
    requestId: request.requestId,
    toolName: event.toolName,
    responseBytes: envelope.responseBytes,
    envelopeFingerprint: hashCanonical({ ...envelope, response: undefined, signature: undefined })
  };
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
  return {
    release() {
      try {
        if (fs.readFileSync(lockPath, "utf8").trim() === token) fs.rmSync(lockPath, { force: true });
      } catch {
        // Lock cleanup is best effort. A stale lock is surfaced as recovery.
      }
    }
  };
}

function assertEnvelopeShape(envelope) {
  const required = [
    "schemaVersion", "requestId", "status", "nonceHash", "sessionId", "projectRootHash",
    "toolName", "toolUseId", "toolInputHash", "toolResponseHash", "capturedAt",
    "expiresAt", "responseBytes", "response", "signature"
  ];
  for (const field of required) {
    if (!(field in envelope)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, `envelope missing ${field}`);
  }
  if (envelope.schemaVersion !== BRIDGE_SCHEMA_VERSION) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "envelope schema version mismatch");
  if (envelope.status !== ENVELOPE_STATUS.CAPTURED) throw new BridgeError(BRIDGE_RESULT_CODES.REPLAYED, "envelope is not captured");
}

function verifyEnvelopeAgainstRequest({ request, envelope, projectRoot, now, key }) {
  assertEnvelopeShape(envelope);
  validateRequestPending(request, now);
  if (request.recoveryRequired) throw new BridgeError(BRIDGE_RESULT_CODES.RECOVERY_REQUIRED, "request is marked recovery-required");
  if (!request.capture) throw new BridgeError(BRIDGE_RESULT_CODES.RECOVERY_REQUIRED, "request has envelope without capture metadata");
  if (envelope.requestId !== request.requestId) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "request/envelope id mismatch");
  if (envelope.nonceHash !== hashString(request.nonce)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "nonce binding mismatch");
  if (envelope.projectRootHash !== projectRootHash(projectRoot) || envelope.projectRootHash !== request.projectRootHash) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "project root binding mismatch");
  }
  if (envelope.expectedServer !== request.expectedServer || envelope.expectedTool !== request.expectedTool) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "server/tool binding mismatch");
  }
  if (envelope.toolName !== request.capture.toolName || envelope.toolUseId !== request.capture.toolUseId || envelope.sessionId !== request.capture.sessionId) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "host capture binding mismatch");
  }
  if (envelope.toolInputHash !== request.expectedToolInputHash || envelope.toolInputHash !== request.capture.toolInputHash) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "tool input binding mismatch");
  }
  const { bytes } = boundedResponse(envelope.response, request.maxResponseBytes);
  if (bytes !== envelope.responseBytes) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "response byte count mismatch");
  if (hashCanonical(envelope.response) !== envelope.toolResponseHash || envelope.toolResponseHash !== request.capture.toolResponseHash) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "response fingerprint mismatch");
  }
  if (parseIso(envelope.expiresAt, "envelope.expiresAt") <= now.getTime()) {
    throw new BridgeError(BRIDGE_RESULT_CODES.EXPIRED, "envelope expired");
  }
  if (!verifyEnvelopeSignature(envelope, key)) throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "envelope signature invalid");
}

export function consumeBridgeEnvelope({ dataRoot, env = process.env, requestId, projectRoot, now = new Date() }) {
  const root = bridgeRoot({ env, dataRoot });
  ensureBridgeDirectories(root);
  const lock = acquireLock(root, requestId);
  try {
    const request = readRequest(root, requestId);
    const envelope = readEnvelope(root, requestId);
    const key = ensureBridgeKey(root);
    verifyEnvelopeAgainstRequest({ request, envelope, projectRoot, now, key });
    const consumedAt = now.toISOString();
    updateEnvelope(root, { ...envelope, status: ENVELOPE_STATUS.CONSUMED, consumedAt });
    updateRequest(root, { ...request, status: REQUEST_STATUS.CONSUMED, consumedAt });
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
    lock.release();
  }
}

export function cleanupExpiredRequests({ dataRoot, env = process.env, now = new Date() }) {
  const root = bridgeRoot({ env, dataRoot });
  ensureBridgeDirectories(root);
  let removed = 0;
  for (const filePath of listJsonFiles(pathsFor(root).requests)) {
    const request = readJsonFile(filePath, "request");
    if (request.status === REQUEST_STATUS.PENDING && parseIso(request.expiresAt, "request.expiresAt") <= now.getTime()) {
      const archived = { ...request, status: "EXPIRED", expiredAt: now.toISOString() };
      writeJsonAtomic(root, filePath, archived);
      removed += 1;
    }
  }
  return { status: "BRIDGE_CLEANED", expiredRequests: removed };
}

export function loadBridgeState({ dataRoot, env = process.env, requestId }) {
  const root = bridgeRoot({ env, dataRoot });
  const state = { root };
  if (requestId) {
    const requestPath = pathsFor(root, requestId).request;
    const envelopePath = pathsFor(root, requestId).envelope;
    state.request = fs.existsSync(requestPath) ? readJsonFile(requestPath, "request") : null;
    state.envelope = fs.existsSync(envelopePath) ? readJsonFile(envelopePath, "envelope") : null;
  }
  return state;
}
