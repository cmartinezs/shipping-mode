import { revisionHash } from "./canonical.mjs";
import { transportResponseFingerprint, validateWorkSourceTransportResponse } from "./workSourceTransportPort.mjs";

const SECRET_KEY_PATTERN = /(token|secret|password|cookie|credential|authorization|auth|api[-_]?key|refresh|session[-_]?key)/i;
const READ_OPERATIONS = new Set(["discover", "search", "get"]);
const BASE_SELECTORS = new Set(["summary", "description", "status", "priority", "labels", "parent", "epic", "links", "assignee"]);
const JIRA_BASE_FIELDS = ["assignee", "description", "issuelinks", "issuetype", "labels", "parent", "priority", "status", "summary", "updated"];
const MAX_QUERY_CHARS = 120;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_ITEMS = 100;
const MAX_DEPTH = 10;
const MAX_KEYS = 128;

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function assertSafeJson(value, field = "value", depth = 0) {
  if (depth > MAX_DEPTH) throw new Error(`${field} exceeds depth limit`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${field} contains non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_KEYS) throw new Error(`${field} exceeds collection limit`);
    value.forEach((entry, index) => assertSafeJson(entry, `${field}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${field} must be JSON-safe`);
  const keys = Object.keys(value);
  if (keys.length > MAX_KEYS) throw new Error(`${field} exceeds object key limit`);
  for (const key of keys) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`${field} contains secret-like key ${key}`);
    if (/^raw|raw$|payload/i.test(key)) throw new Error(`${field} contains raw provider payload key ${key}`);
    assertSafeJson(value[key], `${field}.${key}`, depth + 1);
  }
}

function assertBounded(value, field) {
  assertSafeJson(value, field);
  if (Buffer.byteLength(JSON.stringify(value ?? null), "utf8") > MAX_RESPONSE_BYTES) throw new Error(`${field} exceeds byte limit`);
}

function sourceAllowedFieldIds(source) {
  assertSafeJson(source?.options || {}, "source.options");
  const fields = new Set(BASE_SELECTORS);
  for (const mapping of Object.values(source.options.field_map || {})) {
    for (const [name, selector] of Object.entries(mapping)) {
      if (name !== "kind") fields.add(selector);
    }
  }
  return fields;
}

function mcpFieldsForSource(source) {
  const fields = new Set(JIRA_BASE_FIELDS);
  for (const field of sourceAllowedFieldIds(source)) {
    if (/^customfield_[0-9]{1,10}$/.test(field)) fields.add(field);
  }
  return [...fields].sort();
}

function assertRequestMatchesSource(request, source) {
  if (request.provider !== "jira" || request.transport !== "mcp") throw new Error("Atlassian MCP adapter only supports Jira MCP transport");
  if (source.provider !== "jira" || source.id !== request.sourceId || source.connectionRef !== request.connectionRef) throw new Error("request/source binding mismatch");
  if (!READ_OPERATIONS.has(request.operation) || request.capability !== request.operation) throw new Error("mutating or mismatched capability rejected");
  if (source.mappingVersion !== request.mappingVersion) throw new Error("request/source mapping mismatch");
}

function normalizeProjectKeys(keys, source) {
  const configured = new Set(source.options.project_keys || []);
  const values = keys === undefined ? [...configured] : keys;
  if (!Array.isArray(values) || values.length === 0) throw new Error("projectKeys must be a non-empty array");
  const normalized = values.map((key) => requireString(key, "projectKeys"));
  for (const key of normalized) {
    if (!configured.has(key)) throw new Error(`project key ${key} is not configured`);
  }
  return normalized.sort();
}

function normalizeLimit(value, source) {
  const limit = Number(value ?? source.options.query_scope.max_results);
  const max = Number(source.options.query_scope.max_results);
  if (!Number.isInteger(limit) || limit < 1 || limit > Math.min(max, MAX_ITEMS)) throw new Error("limit exceeds configured bound");
  return limit;
}

function escapeJqlString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function normalizeQueryText(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (text.length > MAX_QUERY_CHARS) throw new Error("query text exceeds bound");
  if (/\b(project|issuekey|key|updated|status|order\s+by)\b\s*(=|in|~|>|<)/i.test(text)) throw new Error("query text must not contain arbitrary JQL");
  return text;
}

function projectJql(projectKeys) {
  return `project in (${projectKeys.map((key) => `"${escapeJqlString(key)}"`).join(", ")})`;
}

function normalizeRequestedFields(request, source) {
  const requested = request.params.requestedFieldIds || [];
  if (!Array.isArray(requested)) throw new Error("requestedFieldIds must be an array");
  const allowed = sourceAllowedFieldIds(source);
  for (const field of requested) {
    if (!allowed.has(field)) throw new Error(`field selector ${field} is not allowed by mapping profile`);
  }
  return [...requested].sort();
}

export function atlassianMcpActionForRequest({ request, source }) {
  assertRequestMatchesSource(request, source);
  if (request.operation === "get") {
    const fields = normalizeRequestedFields(request, source);
    return {
      schemaVersion: 1,
      server: "atlassian",
      tool: "jira_get_issue",
      toolName: "mcp__atlassian__jira_get_issue",
      input: { issue_key: requireString(request.params.itemRef, "params.itemRef"), fields },
      inputHash: `sha256:${revisionHash({ issue_key: request.params.itemRef, fields })}`
    };
  }
  const projectKeys = normalizeProjectKeys(request.params.projectKeys, source);
  const limit = normalizeLimit(request.params.limit, source);
  const queryText = normalizeQueryText(request.params.queryText);
  const jql = `${projectJql(projectKeys)}${queryText ? ` AND text ~ "${escapeJqlString(queryText)}"` : ""} ORDER BY updated DESC`;
  const input = { jql, limit, fields: mcpFieldsForSource(source) };
  return {
    schemaVersion: 1,
    server: "atlassian",
    tool: "jira_search",
    toolName: "mcp__atlassian__jira_search",
    input,
    inputHash: `sha256:${revisionHash(input)}`
  };
}

function rejectTruncated(value, field = "response") {
  if (!value || typeof value !== "object") return;
  if (value.truncated === true || value.isTruncated === true) throw new Error(`${field} is truncated`);
  for (const child of Array.isArray(value) ? value : Object.values(value)) rejectTruncated(child, field);
}

function scalarText(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((entry) => scalarText(entry, field)).filter(Boolean).join("\n") || null;
  if (typeof value === "object" && Array.isArray(value.content)) return value.content.map((entry) => scalarText(entry, field)).filter(Boolean).join("\n") || null;
  if (typeof value === "object" && typeof value.text === "string") return value.text;
  throw new Error(`${field} cannot be normalized deterministically`);
}

function fieldName(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.name === "string") return value.name;
  if (typeof value === "object" && typeof value.displayName === "string") return value.displayName;
  return String(value);
}

function normalizeExternalRef(value) {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object") return value.key || value.id || value.name;
  return undefined;
}

function normalizeIssue(issue, source) {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) throw new Error("Jira issue must be an object");
  const allowedTop = new Set(["id", "key", "self", "fields"]);
  for (const key of Object.keys(issue)) {
    if (!allowedTop.has(key)) throw new Error(`unsupported Jira issue wrapper field ${key}`);
  }
  const fields = issue.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Jira issue fields must be an object");
  const allowed = sourceAllowedFieldIds(source);
  const customFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/^customfield_[0-9]{1,10}$/.test(key)) {
      if (allowed.has(key)) customFields[key] = value;
      continue;
    }
    if (!["summary", "description", "issuetype", "status", "priority", "labels", "parent", "issuelinks", "assignee", "updated"].includes(key)) {
      throw new Error(`unsupported Jira field ${key}`);
    }
  }
  const links = Array.isArray(fields.issuelinks)
    ? fields.issuelinks.map((link) => normalizeExternalRef(link.outwardIssue || link.inwardIssue || link)).filter(Boolean)
    : [];
  const normalized = {
    externalId: requireString(issue.key, "issue.key"),
    issueType: requireString(fieldName(fields.issuetype), "fields.issuetype"),
    summary: requireString(fields.summary, "fields.summary"),
    description: scalarText(fields.description, "fields.description"),
    status: fieldName(fields.status),
    priority: fieldName(fields.priority),
    labels: Array.isArray(fields.labels) ? fields.labels.map((entry) => requireString(entry, "fields.labels")) : [],
    parent: normalizeExternalRef(fields.parent) || null,
    epic: null,
    links,
    assignee: fieldName(fields.assignee) || null,
    revision: fields.updated || `sha256:${revisionHash({ key: issue.key, fields })}`,
    updatedAt: fields.updated || null,
    fields: customFields
  };
  assertBounded(normalized, "normalized Jira item");
  return normalized;
}

function issueListForAction(rawResponse, action) {
  if (action.tool === "jira_get_issue") return { items: [], item: rawResponse };
  if (!rawResponse || typeof rawResponse !== "object" || Array.isArray(rawResponse)) throw new Error("Jira search response must be an object");
  const allowed = new Set(["issues", "startAt", "maxResults", "total", "isLast"]);
  for (const key of Object.keys(rawResponse)) {
    if (!allowed.has(key)) throw new Error(`unsupported Jira search wrapper field ${key}`);
  }
  if (!Array.isArray(rawResponse.issues)) throw new Error("Jira search response issues must be an array");
  if (rawResponse.issues.length > MAX_ITEMS) throw new Error("Jira search response exceeds item limit");
  return { items: rawResponse.issues, item: null };
}

export function normalizeAtlassianMcpResponse({ request, action, rawResponse, source, observedAt = new Date().toISOString() }) {
  assertRequestMatchesSource(request, source);
  if (action.toolName !== (request.operation === "get" ? "mcp__atlassian__jira_get_issue" : "mcp__atlassian__jira_search")) throw new Error("action/request tool mismatch");
  assertBounded(rawResponse, "Atlassian MCP response");
  rejectTruncated(rawResponse);
  const selected = issueListForAction(rawResponse, action);
  const item = selected.item ? normalizeIssue(selected.item, source) : null;
  const items = selected.items.map((entry) => normalizeIssue(entry, source)).sort((left, right) => left.externalId.localeCompare(right.externalId));
  const response = {
    schemaVersion: 1,
    requestId: request.requestId,
    requestHash: request.requestHash,
    provider: request.provider,
    transport: request.transport,
    connectionRef: request.connectionRef,
    sourceId: request.sourceId,
    status: item || items.length > 0 ? "OK" : "NOT_FOUND",
    items,
    item,
    findings: [],
    observedAt
  };
  response.responseFingerprint = transportResponseFingerprint(response);
  return validateWorkSourceTransportResponse(request, response);
}
