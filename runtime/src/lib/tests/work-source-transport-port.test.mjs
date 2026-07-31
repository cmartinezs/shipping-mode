import assert from "node:assert/strict";
import { buildWorkSourceTransportRequest, validateWorkSourceTransportResponse, transportResponseFingerprint } from "../workSourceTransportPort.mjs";

const base = {
  provider: "jira",
  transport: "mcp",
  connectionRef: "atlassian",
  sourceId: "jira-gradeops",
  operation: "get",
  capability: "get",
  mappingVersion: 1,
  configHash: `sha256:${"a".repeat(64)}`,
  params: { itemRef: "GRADE-142", requestedFieldIds: ["summary", "customfield_10101"], limit: 1 }
};

const request = buildWorkSourceTransportRequest(base);
assert.match(request.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
assert.match(request.requestHash, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(request.params.requestedFieldIds, ["customfield_10101", "summary"]);
assert.throws(() => buildWorkSourceTransportRequest({ ...base, params: { itemRef: "GRADE-142", token: "secret" } }), /secret-like/);
assert.throws(() => buildWorkSourceTransportRequest({ ...base, params: { itemRef: "GRADE-142", jql: "project = GRADE" } }), /not allowed/);
assert.throws(() => buildWorkSourceTransportRequest({ ...base, capability: "update" }), /capability must match/);

const response = {
  schemaVersion: 1,
  requestId: request.requestId,
  requestHash: request.requestHash,
  provider: "jira",
  transport: "mcp",
  connectionRef: "atlassian",
  sourceId: "jira-gradeops",
  status: "OK",
  items: [],
  item: null,
  findings: [],
  observedAt: "2026-07-30T00:00:00.000Z"
};
const fingerprint = transportResponseFingerprint(response);
const validated = validateWorkSourceTransportResponse(request, { ...response, responseFingerprint: fingerprint });
assert.equal(validated.status, "OK");
assert.equal(validated.responseFingerprint, fingerprint);
assert.throws(() => validateWorkSourceTransportResponse(request, { ...response, requestHash: `sha256:${"b".repeat(64)}`, responseFingerprint: fingerprint }), /requestHash mismatch/);
assert.throws(() => validateWorkSourceTransportResponse(request, { ...response, responseFingerprint: `sha256:${"b".repeat(64)}` }), /responseFingerprint mismatch/);
assert.throws(() => validateWorkSourceTransportResponse(request, { ...response, status: "FOUND", responseFingerprint: fingerprint }), /status is unsupported/);
assert.throws(() => validateWorkSourceTransportResponse(request, { ...response, item: { rawJiraPayload: { key: "GRADE-142" } }, responseFingerprint: transportResponseFingerprint({ ...response, item: { rawJiraPayload: { key: "GRADE-142" } } }) }), /unknown property|secret-like|raw/i);

console.log("work-source-transport-port: request and response binding pass");
