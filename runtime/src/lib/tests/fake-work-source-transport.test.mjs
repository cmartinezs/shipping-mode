import assert from "node:assert/strict";
import path from "node:path";
import { buildWorkSourceTransportRequest } from "../workSourceTransportPort.mjs";
import { FakeWorkSourceTransport } from "./fakes/fakeWorkSourceTransport.mjs";

const fixturePath = path.resolve("runtime/src/lib/tests/fixtures/jira-mcp/v1/scenarios.json");
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

const fake = new FakeWorkSourceTransport({ fixturePath });
assert.equal(fake.execute(request).status, "OK");
assert.equal(fake.execute(request, { scenario: "not-found" }).status, "NOT_FOUND");
assert.equal(fake.execute(request, { scenario: "unavailable" }).status, "UNAVAILABLE");
assert.equal(fake.execute(request, { scenario: "timeout" }).status, "UNAVAILABLE");
assert.equal(fake.execute(request, { scenario: "cancelled" }).status, "UNAVAILABLE");
assert.equal(fake.execute(request, { scenario: "malformed" }).status, "MALFORMED");
assert.equal(fake.execute(request, { scenario: "required-field-missing" }).item.externalId, "GRADE-144");
assert.throws(() => fake.execute(request, { scenario: "request-mismatch" }), /requestId mismatch/);
assert.throws(() => fake.execute(request, { scenario: "fingerprint-mismatch" }), /responseFingerprint mismatch/);
assert.throws(() => fake.execute(request, { scenario: "response-oversized" }), /byte limit/);
assert.equal(fake.requests.length, 10);

const discoverRequest = buildWorkSourceTransportRequest({ ...request, operation: "discover", capability: "discover", params: { projectKeys: ["GRADE"], limit: 50 } });
const searchRequest = buildWorkSourceTransportRequest({ ...request, operation: "search", capability: "search", params: { queryText: "rubric", projectKeys: ["GRADE"], limit: 50 } });
assert.deepEqual(new FakeWorkSourceTransport({ fixturePath }).execute(discoverRequest).items.map((item) => item.externalId), ["GRADE-142"]);
assert.deepEqual(new FakeWorkSourceTransport({ fixturePath }).execute(searchRequest).items.map((item) => item.externalId), ["GRADE-143"]);

console.log("fake-work-source-transport: Jira MCP fixtures pass");
