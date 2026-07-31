import { revisionHash } from "./canonical.mjs";
import { generateUuidV7, isUuidV7 } from "./ids.mjs";

const SECRET_KEY_PATTERN = /(token|secret|password|cookie|credential|authorization|auth|api[-_]?key|refresh)/i;
const PROVIDERS = new Set(["jira"]);
const TRANSPORTS = new Set(["mcp"]);
const OPERATIONS = new Set(["discover", "search", "get"]);
const CAPABILITIES = new Set(["discover", "search", "get"]);
const STATUSES = new Set(["OK", "NOT_FOUND", "UNAVAILABLE", "MISCONFIGURED", "MALFORMED"]);
const ALLOWED_PARAM_KEYS = new Set(["projectKeys", "itemRef", "queryText", "limit", "requestedFieldIds"]);
const MAX_BYTES = 256 * 1024;
const MAX_DEPTH = 8;
const MAX_COLLECTION = 128;

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function assertHash(value, field) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error(`${field} must be sha256 hash`);
}

function assertSafeJson(value, { field = "value", depth = 0 } = {}) {
  if (depth > MAX_DEPTH) throw new Error(`${field} exceeds depth limit`);
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${field} must not contain non-finite numbers`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION) throw new Error(`${field} exceeds collection limit`);
    for (const entry of value) assertSafeJson(entry, { field, depth: depth + 1 });
    return;
  }
  if (!value || typeof value !== "object") throw new Error(`${field} must be JSON-safe`);
  const keys = Object.keys(value);
  if (keys.length > MAX_COLLECTION) throw new Error(`${field} exceeds object key limit`);
  for (const key of keys) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`${field} contains secret-like key ${key}`);
    if (/raw.*payload|payload.*raw|rawJiraPayload/i.test(key)) throw new Error(`${field} contains raw provider payload key ${key}`);
    assertSafeJson(value[key], { field: `${field}.${key}`, depth: depth + 1 });
  }
}

function assertBounded(value, field) {
  assertSafeJson(value, { field });
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_BYTES) throw new Error(`${field} exceeds byte limit`);
}

function normalizeParams(params = {}) {
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("params must be an object");
  for (const key of Object.keys(params)) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`params contains secret-like key ${key}`);
    if (!ALLOWED_PARAM_KEYS.has(key)) throw new Error(`params.${key} is not allowed`);
  }
  const normalized = {};
  if (params.projectKeys !== undefined) normalized.projectKeys = normalizeStringArray(params.projectKeys, "params.projectKeys").sort();
  if (params.itemRef !== undefined) normalized.itemRef = requireString(params.itemRef, "params.itemRef");
  if (params.queryText !== undefined) normalized.queryText = String(params.queryText);
  if (params.limit !== undefined) {
    const limit = Number(params.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("params.limit must be between 1 and 100");
    normalized.limit = limit;
  }
  if (params.requestedFieldIds !== undefined) normalized.requestedFieldIds = normalizeStringArray(params.requestedFieldIds, "params.requestedFieldIds").sort();
  assertBounded(normalized, "params");
  return normalized;
}

function normalizeStringArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const values = value.map((entry) => requireString(entry, field));
  if (new Set(values).size !== values.length) throw new Error(`${field} cannot contain duplicates`);
  return values;
}

export function buildWorkSourceTransportRequest(input) {
  const provider = requireString(input.provider, "provider");
  if (!PROVIDERS.has(provider)) throw new Error(`provider is unsupported: ${provider}`);
  const transport = requireString(input.transport, "transport");
  if (!TRANSPORTS.has(transport)) throw new Error(`transport is unsupported: ${transport}`);
  const operation = requireString(input.operation, "operation");
  if (!OPERATIONS.has(operation)) throw new Error(`operation is unsupported: ${operation}`);
  const capability = requireString(input.capability, "capability");
  if (!CAPABILITIES.has(capability) || capability !== operation) throw new Error("capability must match the read operation");
  const request = {
    schemaVersion: 1,
    requestId: input.requestId || generateUuidV7(),
    provider,
    transport,
    connectionRef: requireString(input.connectionRef, "connectionRef"),
    sourceId: requireString(input.sourceId, "sourceId"),
    operation,
    capability,
    mappingVersion: Number(input.mappingVersion),
    configHash: requireString(input.configHash, "configHash"),
    params: normalizeParams(input.params || {})
  };
  if (!isUuidV7(request.requestId)) throw new Error("requestId must be UUIDv7");
  if (!Number.isInteger(request.mappingVersion) || request.mappingVersion < 1) throw new Error("mappingVersion must be a positive integer");
  assertHash(request.configHash, "configHash");
  return { ...request, requestHash: `sha256:${revisionHash(request)}` };
}

export function transportResponseFingerprint(response) {
  const { responseFingerprint, ...withoutFingerprint } = response || {};
  return `sha256:${revisionHash(withoutFingerprint)}`;
}

export function validateWorkSourceTransportResponse(request, response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("response must be an object");
  const allowed = new Set(["schemaVersion", "requestId", "requestHash", "provider", "transport", "connectionRef", "sourceId", "status", "items", "item", "findings", "observedAt", "responseFingerprint"]);
  for (const key of Object.keys(response)) {
    if (!allowed.has(key)) throw new Error(`response contains unknown property ${key}`);
  }
  if (response.schemaVersion !== 1) throw new Error("response.schemaVersion must be 1");
  for (const field of ["requestId", "requestHash", "provider", "transport", "connectionRef", "sourceId"]) {
    if (response[field] !== request[field]) throw new Error(`${field} mismatch`);
  }
  if (!STATUSES.has(response.status)) throw new Error(`status is unsupported: ${response.status}`);
  if (!Array.isArray(response.items)) throw new Error("response.items must be an array");
  if (response.items.length > MAX_COLLECTION) throw new Error("response.items exceeds collection limit");
  if (!Array.isArray(response.findings)) throw new Error("response.findings must be an array");
  if (response.findings.length > MAX_COLLECTION) throw new Error("response.findings exceeds collection limit");
  assertBounded(response.items, "response.items");
  assertBounded(response.item, "response.item");
  assertBounded(response.findings, "response.findings");
  assertHash(response.responseFingerprint, "responseFingerprint");
  const expectedFingerprint = transportResponseFingerprint(response);
  if (response.responseFingerprint !== expectedFingerprint) throw new Error("responseFingerprint mismatch");
  return structuredClone(response);
}
