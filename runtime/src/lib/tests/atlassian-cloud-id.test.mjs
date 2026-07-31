import assert from "node:assert/strict";
import { atlassianMcpActionForRequest } from "../atlassianMcpHostAdapter.mjs";

const request = {
  provider: "jira",
  transport: "mcp",
  connectionRef: "atlassian",
  sourceId: "jira-gradeops",
  operation: "get",
  capability: "get",
  mappingVersion: 1,
  params: {
    itemRef: "GRADE-142",
    requestedFieldIds: ["summary"],
    limit: 1
  }
};

const source = {
  id: "jira-gradeops",
  provider: "jira",
  transport: "mcp",
  connectionRef: "atlassian",
  mappingVersion: 1,
  options: {
    project_keys: ["GRADE"],
    query_scope: { mode: "project_keys_and_text", max_results: 50 },
    allowed_issue_types: ["Story"],
    field_map: {
      Story: { kind: "user_story" }
    }
  }
};

const siteUrl = "https://example.atlassian.net";
const uuid = "11111111-2222-4333-8444-555555555555";

assert.throws(
  () => atlassianMcpActionForRequest({ request, source, env: { SHIPPING_MODE_ATLASSIAN_CLOUD_ID: siteUrl } }),
  /cloudId must be a UUID/i
);

assert.throws(
  () => atlassianMcpActionForRequest({ request, source: { ...source, cloudId: siteUrl }, env: { SHIPPING_MODE_ATLASSIAN_CLOUD_ID: uuid } }),
  /cloudId must be a UUID/i
);

assert.equal(
  atlassianMcpActionForRequest({ request, source, env: { SHIPPING_MODE_ATLASSIAN_CLOUD_ID: uuid } }).input.cloudId,
  uuid
);

console.log("atlassian-cloud-id: UUID-only contract pass");
