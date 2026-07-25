import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const cases = {
  config: {
    valid: { schemaVersion: 1, name: "demo", baseBranch: null, vcs: "none", scopeRefs: [] },
    invalid: { schemaVersion: 1, name: "", vcs: "none", scopeRefs: [] }
  },
  "plugin-lock": {
    valid: { schemaVersion: 1, pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` },
    invalid: { schemaVersion: 1, pluginVersion: "1.0.0" }
  },
  scope: {
    valid: { schemaVersion: 1, id: "018f0000-0000-7000-8000-000000000000", key: "backend", label: "Backend", kind: "code", path: "api/", owner: null },
    invalid: { schemaVersion: 1, id: "not-a-uuid", key: "Backend", label: "Backend", kind: "code", path: "api/" }
  },
  "change-set": {
    valid: {
      schemaVersion: 1, operationId: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", target: {},
      baseRevisions: {}, hash: "a".repeat(64),
      payload: { name: "demo", baseBranch: null, vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` }
    },
    invalid: {
      schemaVersion: 1, operationId: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", target: {},
      baseRevisions: {}, hash: "a".repeat(64),
      payload: { name: "demo" } // missing vcs/pluginVersion/templatePackFingerprint, required for this kind
    }
  },
  operation: {
    valid: {
      id: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", status: "PROPOSED", proposedBy: "carlos", proposedAt: "2026-07-24T00:00:00.000Z",
      reservedEvents: [{ eventId: "018f0000-0000-7000-8000-000000000001", type: "workspace.initialized" }], history: []
    },
    invalid: {
      id: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", status: "REJECTED", proposedBy: "carlos", proposedAt: "2026-07-24T00:00:00.000Z",
      reservedEvents: [{ eventId: "018f0000-0000-7000-8000-000000000001", type: "workspace.initialized" }], history: []
    }
  },
  event: {
    valid: { eventId: "018f0000-0000-7000-8000-000000000000", schemaVersion: 1, type: "workspace.initialized", aggregate: { type: "workspace", id: "018f0000-0000-7000-8000-000000000000" }, occurredAt: "2026-07-24T00:00:00.000Z", actor: "carlos", operationId: "018f0000-0000-7000-8000-000000000000", idempotencyKey: "k1", payload: {} },
    invalid: { eventId: "018f0000-0000-7000-8000-000000000000", schemaVersion: 1, type: "workspace.initialized", occurredAt: "2026-07-24T00:00:00.000Z", actor: "carlos", operationId: "018f0000-0000-7000-8000-000000000000", idempotencyKey: "k1", payload: {} }
  },
  result: {
    valid: { operationId: "018f0000-0000-7000-8000-000000000000", files: [{ target: "config.yml", contentHash: "a".repeat(64) }] },
    invalid: { operationId: "018f0000-0000-7000-8000-000000000000", files: [{ target: "config.yml" }] }
  }
};

for (const [schemaName, { valid, invalid }] of Object.entries(cases)) {
  const validResult = validate(schemaName, valid);
  assert.equal(validResult.valid, true, `${schemaName} valid fixture must pass: ${JSON.stringify(validResult.errors)}`);
  const invalidResult = validate(schemaName, invalid);
  assert.equal(invalidResult.valid, false, `${schemaName} invalid fixture must fail`);
}

// operation lifecycle metadata is state-owned and mandatory, not optional
// metadata merely constrained when present.
const opBase = {
  id: "018f0000-0000-7000-8000-000000000000",
  kind: "workspace.init",
  proposedBy: "carlos",
  proposedAt: "2026-07-24T00:00:00.000Z",
  reservedEvents: [{ eventId: "018f0000-0000-7000-8000-000000000001", type: "workspace.initialized" }],
  history: []
};
const validation = { validatedAt: "2026-07-24T00:00:01.000Z", changeSetHash: "a".repeat(64), errors: [] };
const approval = { actor: "carlos", approvedAt: "2026-07-24T00:00:02.000Z", changeSetHash: "a".repeat(64), selfApproval: true };
const filePlan = [{ target: "config.yml", stagedRelativePath: "config.yml", expectedBefore: "ABSENT", beforeContentHash: "ABSENT", beforeRevisionHash: "ABSENT", stagedContentHash: "b".repeat(64), stagedRevisionHash: "c".repeat(64) }];
const expectedEvents = [{ eventId: "018f0000-0000-7000-8000-000000000001", relativePath: "2026/07/018f0000-0000-7000-8000-000000000001.json", contentHash: "d".repeat(64), document: {} }];

const lifecycleInvalid = [
  { ...opBase, status: "VALIDATED" },
  { ...opBase, status: "APPROVED", validation },
  { ...opBase, status: "APPLYING", approval, filePlan, expectedEvents },
  { ...opBase, status: "APPLYING", validation, filePlan, expectedEvents },
  { ...opBase, status: "RECOVERY_REQUIRED" },
  { ...opBase, status: "RECOVERY_REQUIRED", conflict: null }
];
for (const fixture of lifecycleInvalid) {
  const result = validate("operation", fixture);
  assert.equal(result.valid, false, `operation ${fixture.status} fixture missing required state metadata must fail`);
}

console.log("schema fixtures: valid/invalid cases behave correctly for all 7 schemas, including kind-conditional payloads and operation state invariants");
