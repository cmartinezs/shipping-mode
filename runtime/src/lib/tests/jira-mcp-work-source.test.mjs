import assert from "node:assert/strict";
import path from "node:path";
import { normalizeWorkSourceConfig, validateNormalizedWorkSourceItem } from "../workSourceImport.mjs";
import { mapJiraTransportItem } from "../workSourceMapping.mjs";
import { FakeWorkSourceTransport } from "./fakes/fakeWorkSourceTransport.mjs";
import { buildWorkSourceTransportRequest } from "../workSourceTransportPort.mjs";

const config = {
  work_sources: [{
    id: "jira-gradeops",
    provider: "jira",
    transport: "mcp",
    enabled: true,
    connection_ref: "atlassian",
    mapping_version: 1,
    mapping_profile: "jira-gradeops-v1",
    import_policy: "external_authoritative",
    sync_mode: "pull",
    capabilities: ["discover", "search", "get"],
    options: {
      project_keys: ["GRADE"],
      query_scope: { mode: "project_keys_and_text", max_results: 50 },
      allowed_issue_types: ["Story", "Bug", "Spike"],
      field_map: {
        Story: { kind: "user_story", actor: "customfield_10101", need: "customfield_10102", value: "customfield_10103", acceptanceCriteria: "customfield_10104" },
        Bug: { kind: "defect", observedBehavior: "customfield_10201", expectedBehavior: "customfield_10202", reproduction: "customfield_10203", severity: "priority" },
        Spike: { kind: "spike", question: "summary", timebox: "customfield_10301", expectedDecision: "customfield_10302" }
      }
    }
  }]
};
const [source] = normalizeWorkSourceConfig({ config, workspaceRoot: process.cwd() });
const fake = new FakeWorkSourceTransport({ fixturePath: path.resolve("runtime/src/lib/tests/fixtures/jira-mcp/v1/scenarios.json") });
const request = buildWorkSourceTransportRequest({
  provider: "jira",
  transport: "mcp",
  connectionRef: "atlassian",
  sourceId: "jira-gradeops",
  operation: "get",
  capability: "get",
  mappingVersion: 1,
  configHash: `sha256:${"a".repeat(64)}`,
  params: { itemRef: "GRADE-142", requestedFieldIds: ["summary"], limit: 1 }
});

const response = fake.execute(request);
const story = mapJiraTransportItem({ source, transportItem: response.item, responseFingerprint: response.responseFingerprint, observedAt: response.observedAt });
assert.equal(story.itemId, "GRADE-142");
assert.equal(story.type, "user_story");
assert.equal(story.title, "Import assessment brief");
assert.equal(story.description.text, "Import an assessment brief from Jira.");
assert.deepEqual(story.fields, { actor: "teacher", need: "assessment brief", value: "consistent grading" });
assert.deepEqual(story.acceptanceCriteria, [{ id: "ac-1", text: "The brief imports" }]);
assert.deepEqual(story.dependencies, []);
assert.equal(validateNormalizedWorkSourceItem(story).valid, true);

const bug = mapJiraTransportItem({
  source,
  transportItem: fake.execute(request, { scenario: "search" }).items[0],
  responseFingerprint: response.responseFingerprint,
  observedAt: response.observedAt
});
assert.equal(bug.type, "defect");
assert.equal(bug.description, null);
assert.deepEqual(bug.acceptanceCriteria, []);
assert.equal(bug.fields.severity, "high");
assert.equal(validateNormalizedWorkSourceItem(bug).valid, true);

assert.throws(() => mapJiraTransportItem({ source, transportItem: { ...response.item, issueType: "Task" }, responseFingerprint: response.responseFingerprint, observedAt: response.observedAt }), /issue type Task is not mapped/);
assert.throws(() => mapJiraTransportItem({ source, transportItem: fake.execute(request, { scenario: "required-field-missing" }).item, responseFingerprint: response.responseFingerprint, observedAt: response.observedAt }), /missing required mapped field/);
assert.throws(() => mapJiraTransportItem({ source, transportItem: { ...response.item, url: "https://user:pass@example.atlassian.net/browse/GRADE-142" }, responseFingerprint: response.responseFingerprint, observedAt: response.observedAt }), /URL must not contain credentials/);
assert.throws(() => mapJiraTransportItem({ source, transportItem: { ...response.item, rawJiraPayload: {} }, responseFingerprint: response.responseFingerprint, observedAt: response.observedAt }), /raw provider payload/);

console.log("jira-mcp-work-source: closed Jira mapping passes");
