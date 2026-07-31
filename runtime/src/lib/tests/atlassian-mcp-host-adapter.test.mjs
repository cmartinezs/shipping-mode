import assert from "node:assert/strict";
import { buildWorkSourceTransportRequest } from "../workSourceTransportPort.mjs";
import { atlassianMcpActionForRequest, normalizeAtlassianMcpResponse } from "../atlassianMcpHostAdapter.mjs";

const source = {
  id: "jira-gradeops",
  provider: "jira",
  transport: "mcp",
  connectionRef: "atlassian",
  mappingVersion: 1,
  mappingProfile: "jira-gradeops-v1",
  options: {
    project_keys: ["GRADE"],
    query_scope: { mode: "project_keys_and_text", max_results: 50 },
    allowed_issue_types: ["Story", "Bug"],
    field_map: {
      Story: { kind: "user_story", actor: "customfield_10101", need: "customfield_10102", value: "customfield_10103", acceptanceCriteria: "customfield_10104" },
      Bug: { kind: "defect", observedBehavior: "customfield_10201", expectedBehavior: "customfield_10202", reproduction: "customfield_10203", severity: "priority" }
    }
  }
};
const env = { SHIPPING_MODE_ATLASSIAN_CLOUD_ID: "11111111-2222-4333-8444-555555555555" };

function request(operation, params) {
  return buildWorkSourceTransportRequest({
    provider: "jira",
    transport: "mcp",
    connectionRef: "atlassian",
    sourceId: "jira-gradeops",
    operation,
    capability: operation,
    mappingVersion: 1,
    configHash: `sha256:${"a".repeat(64)}`,
    params
  });
}

const getRequest = request("get", { itemRef: "GRADE-142", requestedFieldIds: ["summary", "customfield_10101"], limit: 1 });
const getAction = atlassianMcpActionForRequest({ request: getRequest, source, env });
assert.equal(getAction.server, "atlassian");
assert.equal(getAction.toolName, "mcp__atlassian__getJiraIssue");
assert.equal(getAction.input.cloudId, env.SHIPPING_MODE_ATLASSIAN_CLOUD_ID);
assert.equal(getAction.input.issueIdOrKey, "GRADE-142");
assert.ok(getAction.input.fields.includes("customfield_10101"));
assert.ok(getAction.input.fields.includes("issuelinks"));
assert.equal(getAction.input.fields.includes("links"), false);

const searchAction = atlassianMcpActionForRequest({ request: request("search", { projectKeys: ["GRADE"], queryText: "rubric review", limit: 10 }), source, env });
assert.equal(searchAction.toolName, "mcp__atlassian__searchJiraIssuesUsingJql");
assert.equal(searchAction.input.jql, 'project in ("GRADE") AND text ~ "rubric review" ORDER BY updated DESC');
assert.equal(searchAction.input.maxResults, 10);
assert.ok(searchAction.input.fields.includes("customfield_10104"));

const discoverAction = atlassianMcpActionForRequest({ request: request("discover", { projectKeys: ["GRADE"], limit: 5 }), source, env });
assert.equal(discoverAction.input.jql, 'project in ("GRADE") ORDER BY updated DESC');
assert.equal(discoverAction.input.maxResults, 5);

assert.throws(() => atlassianMcpActionForRequest({ request: { ...getRequest, capability: "update" }, source, env }), /mutating|capability/i);
assert.throws(() => atlassianMcpActionForRequest({ request: request("search", { projectKeys: ["GRADE"], queryText: "project = OTHER", limit: 10 }), source, env }), /JQL|query/i);
assert.throws(() => atlassianMcpActionForRequest({ request: request("get", { itemRef: "OTHER-142", requestedFieldIds: ["summary"], limit: 1 }), source, env }), /not configured/i);
assert.throws(() => atlassianMcpActionForRequest({ request: request("get", { itemRef: "GRADE-0 OR project=OTHER", requestedFieldIds: ["summary"], limit: 1 }), source, env }), /exact Jira issue key/i);
assert.throws(() => atlassianMcpActionForRequest({ request: request("get", { itemRef: "GRADE-142", requestedFieldIds: ["customfield_99999"], limit: 1 }), source, env }), /field selector/i);
assert.throws(() => atlassianMcpActionForRequest({ request: getRequest, source: { ...source, options: { ...source.options, access_token: "secret" } }, env }), /secret-like/i);
assert.throws(() => atlassianMcpActionForRequest({ request: getRequest, source, env: {} }), /cloudId/i);

const rawIssue = {
  expand: "renderedFields,names,schema",
  id: "10042",
  key: "GRADE-142",
  self: "https://api.atlassian.com/ex/jira/111/rest/api/3/issue/10042",
  fields: {
    summary: "Import assessment brief",
    description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Import an assessment brief from Jira." }] }] },
    issuetype: { name: "Story" },
    status: { name: "To Do" },
    priority: { name: "High" },
    labels: ["assessment"],
    updated: "2026-07-30T12:00:00.000Z",
    customfield_10101: "teacher",
    customfield_10102: "assessment brief",
    customfield_10103: "consistent grading",
    customfield_10104: [{ type: "paragraph", content: [{ type: "text", text: "The brief imports" }] }]
  }
};
const normalized = normalizeAtlassianMcpResponse({ request: getRequest, action: getAction, rawResponse: rawIssue, source, observedAt: "2026-07-30T12:01:00.000Z" });
assert.equal(normalized.status, "OK");
assert.equal(normalized.item.externalId, "GRADE-142");
assert.equal(normalized.item.issueType, "Story");
assert.equal(normalized.item.fields.customfield_10101, "teacher");
assert.deepEqual(normalized.item.fields.customfield_10104, ["The brief imports"]);
assert.match(normalized.responseFingerprint, /^sha256:[0-9a-f]{64}$/);

const searchRequest = request("search", { projectKeys: ["GRADE"], queryText: "assessment", limit: 10 });
const currentSearchResponse = { issues: { totalCount: 1, nodes: [rawIssue], webUrl: "https://example.atlassian.net/issues" } };
const normalizedSearch = normalizeAtlassianMcpResponse({ request: searchRequest, action: atlassianMcpActionForRequest({ request: searchRequest, source, env }), rawResponse: currentSearchResponse, source });
assert.equal(normalizedSearch.status, "OK");
assert.equal(normalizedSearch.items.length, 1);

const wrapped = { content: [{ type: "text", text: JSON.stringify(rawIssue) }], isError: false };
assert.equal(normalizeAtlassianMcpResponse({ request: getRequest, action: getAction, rawResponse: wrapped, source }).item.externalId, "GRADE-142");
assert.throws(() => normalizeAtlassianMcpResponse({ request: getRequest, action: getAction, rawResponse: { data: rawIssue }, source }), /wrapper|unsupported/i);
assert.throws(() => normalizeAtlassianMcpResponse({ request: getRequest, action: getAction, rawResponse: { ...rawIssue, truncated: true }, source }), /truncated|unsupported/i);
assert.throws(() => normalizeAtlassianMcpResponse({ request: getRequest, action: getAction, rawResponse: { ...rawIssue, fields: { ...rawIssue.fields, description: "x".repeat(300 * 1024) } }, source }), /byte/i);

console.log("atlassian-mcp-host-adapter: current Atlassian Rovo MCP mapping and normalization pass");
