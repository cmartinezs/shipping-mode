import { revisionHash } from "./canonical.mjs";
import { transportResponseFingerprint, validateWorkSourceTransportResponse } from "./workSourceTransportPort.mjs";

const SECRET_KEY_PATTERN = /(token|secret|password|cookie|credential|authorization|auth|api[-_]?key|refresh|session[-_]?key)/i;
const READ_OPERATIONS = new Set(["discover", "search", "get"]);
const BASE_SELECTORS = new Set(["summary", "description", "status", "priority", "labels", "parent", "epic", "links", "assignee"]);
const JIRA_BASE_FIELDS = ["assignee", "description", "issuelinks", "issuetype", "labels", "parent", "priority", "status", "summary", "updated"];
const GET_TOOL = "getJiraIssue";
const SEARCH_TOOL = "searchJiraIssuesUsingJql";
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

function normalizeCloudId(source, env) {
  const value = requireString(source.cloudId || env.SHIPPING_MODE_ATLASSIAN_CLOUD_ID, "Atlassian cloudId");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Atlassian cloudId must be a UUID or an https atlassian.net site URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Atlassian cloudId site URL must be a credential-free https origin");
  }
  if (!url.hostname.toLowerCase().endsWith(".atlassian.net")) throw new Error("Atlassian cloudId site URL must belong to atlassian.net");
  return url.origin;
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

function normalizeIssueKey(value, source) {
  const issueKey = requireString(value, "params.itemRef");
  const match = /^([A-Z][A-Z0-9_]{1,31})-([1-9][0-9]*)$/.exec(issueKey);
  if (!match) throw new Error("params.itemRef must be an exact Jira issue key");
  if (!(source.options.project_keys || []).includes(match[1])) throw new Error(`Jira issue key project ${match[1]} is not configured`);
  return issueKey;
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

export function atlassianMcpActionForRequest({ request, source, env = process.env }) {
  assertRequestMatchesSource(request, source);
  const cloudId = normalizeCloudId(source, env);
  if (request.operation === "get") {
    normalizeRequestedFields(request, source);
    const input = {
      cloudId,
      issueIdOrKey: normalizeIssueKey(request.params.itemRef, source),
      fields: mcpFieldsForSource(source)
    };
    return {
      schemaVersion: 1,
      server: "atlassian",
      tool: GET_TOOL,
      toolName: `mcp__atlassian__${GET_TOOL}`,
      input,
      inputHash: `sha256:${revisionHash(input)}`
    };
  }
  const projectKeys = normalizeProjectKeys(request.params.projectKeys, source);
  const maxResults = normalizeLimit(request.params.limit, source);
  const queryText = normalizeQueryText(request.params.queryText);
  const jql = `${projectJql(projectKeys)}${queryText ? ` AND text ~ "${escapeJqlString(queryText)}"` : ""} ORDER BY updated DESC`;
  const input = { cloudId, jql, maxResults, fields: mcpFieldsForSource(source) };
  return {
    schemaVersion: 1,
    server: "atlassian",
    tool: SEARCH_TOOL,
    toolName: `mcp__atlassian__${SEARCH_TOOL}`,
    input,
    inputHash: `sha256:${revisionHash(input)}`
  };
}

function rejectTruncated(value, field = "response") {
  if (!value || typeof value !== "object") return;
  if (value.truncated === true || value.isTruncated === true) throw new Error(`${field} is truncated`);
  for (const child of Array.isArray(value) ? value : Object.values(value)) rejectTruncated(child, field);
}

function unwrapStandardMcpResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.content)) return value;
  const allowed = new Set(["content", "isError", "is_error", "structuredContent", "structured_content"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`unsupported MCP result wrapper field ${key}`);
  if (value.isError === true || value.is_error === true) throw new Error("Atlassian MCP tool returned an error result");
  const structured = value.structuredContent ?? value.structured_content;
  if (structured !== undefined) {
    if (!structured || typeof structured !== "object" || Array.isArray(structured)) throw new Error("MCP structuredContent must be an object");
    return structured;
  }
  if (value.content.length !== 1 || value.content[0]?.type !== "text" || typeof value.content[0].text !== "string") {
    throw new Error("Atlassian MCP result must contain exactly one JSON text block");
  }
  try {
    return JSON.parse(value.content[0].text);
  } catch {
    throw new Error("Atlassian MCP text response is not deterministic JSON");
  }
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

function normalizeMappedValue(value, field) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((entry, index) => scalarText(entry, `${field}[${index}]`)).filter((entry) => entry !== null);
  if (typeof value === "object") return scalarText(value, field);
  return value;
}

function normalizeIssue(issue, source) {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) throw new Error("Jira issue must be an object");
  const allowedTop = new Set(["expand", "id", "key", "self", "fields", "names", "schema"]);
  for (const key of Object.keys(issue)) {
    if (!allowedTop.has(key)) throw new Error(`unsupported Jira issue wrapper field ${key}`);
  }
  const fields = issue.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Jira issue fields must be an object");
  const allowed = sourceAllowedFieldIds(source);
  const customFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/^customfield_[0-9]{1,10}$/.test(key)) {
      if (allowed.has(key)) customFields[key] = normalizeMappedValue(value, `fields.${key}`);
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
  if (action.tool === GET_TOOL) return { items: [], item: rawResponse };
  if (!rawResponse || typeof rawResponse !== "object" || Array.isArray(rawResponse)) throw new Error("Jira search response must be an object");
  const allowed = new Set(["issues", "nextPageToken"]);
  for (const key of Object.keys(rawResponse)) {
    if (!allowed.has(key)) throw new Error(`unsupported Jira search wrapper field ${key}`);
  }
  if (Array.isArray(rawResponse.issues)) {
    if (rawResponse.issues.length > MAX_ITEMS) throw new Error("Jira search response exceeds item limit");
    return { items: rawResponse.issues, item: null };
  }
  const issueCollection = rawResponse.issues;
  if (!issueCollection || typeof issueCollection !== "object" || Array.isArray(issueCollection)) throw new Error("Jira search response issues must be an object");
  const collectionAllowed = new Set(["nodes", "totalCount", "webUrl"]);
  for (const key of Object.keys(issueCollection)) if (!collectionAllowed.has(key)) throw new Error(`unsupported Jira search collection field ${key}`);
  if (!Array.isArray(issueCollection.nodes)) throw new Error("Jira search response issues.nodes must be an array");
  if (issueCollection.nodes.length > MAX_ITEMS) throw new Error("Jira search response exceeds item limit");
  return { items: issueCollection.nodes, item: null };
}

export function normalizeAtlassianMcpResponse({ request, action, rawResponse, source, observedAt = new Date().toISOString() }) {
  assertRequestMatchesSource(request, source);
  const expectedToolName = request.operation === "get" ? `mcp__atlassian__${GET_TOOL}` : `mcp__atlassian__${SEARCH_TOOL}`;
  if (action.toolName !== expectedToolName) throw new Error("action/request tool mismatch");
  const unwrapped = unwrapStandardMcpResult(rawResponse);
  assertBounded(unwrapped, "Atlassian MCP response");
  rejectTruncated(unwrapped);
  const selected = issueListForAction(unwrapped, action);
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
