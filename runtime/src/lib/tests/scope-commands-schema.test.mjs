import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const baseScope = {
  schemaVersion: 1,
  id: "018f4d1e-0000-7000-8000-000000000001",
  key: "api",
  label: "API",
  kind: "code",
  path: "api/",
  owner: null
};

const declaredCommand = {
  command: "./mvnw test",
  method: "declared",
  declaredBy: "carlos",
  declaredAt: "2026-07-25T10:00:00Z",
  declaredOperationId: "018f4d1e-0000-7000-8000-000000000002",
  requiresEnvironment: false,
  requiresSecrets: false,
  alternatives: []
};
assert.equal(validate("scope", { ...baseScope, commands: { test: declaredCommand } }).valid, true);

// declared forbids sourceRefs/confidence
const declaredWithSourceRefs = { ...declaredCommand, sourceRefs: ["018f4d1e-0000-7000-8000-000000000003"] };
assert.equal(validate("scope", { ...baseScope, commands: { test: declaredWithSourceRefs } }).valid, false);

// declared must have empty alternatives
assert.equal(validate("scope", { ...baseScope, commands: { test: { ...declaredCommand, alternatives: [{ command: "x" }] } } }).valid, false);

const reviewedCommand = {
  command: "./mvnw package",
  method: "reviewed",
  confidence: "high",
  sourceRefs: ["018f4d1e-0000-7000-8000-000000000004"],
  sourceFingerprintAtSelection: { "018f4d1e-0000-7000-8000-000000000004": "c".repeat(64) },
  requiresEnvironment: false,
  requiresSecrets: false,
  alternatives: [
    {
      command: "npm run build",
      sourceRefs: ["018f4d1e-0000-7000-8000-000000000005"],
      sourceFingerprintAtSelection: { "018f4d1e-0000-7000-8000-000000000005": "d".repeat(64) },
      confidence: "medium",
      requiresEnvironment: false,
      requiresSecrets: false
    }
  ]
};
assert.equal(validate("scope", { ...baseScope, commands: { build: reviewedCommand } }).valid, true);

// duplicate sourceRefs rejected
const dupRefs = { ...reviewedCommand, sourceRefs: ["018f4d1e-0000-7000-8000-000000000004", "018f4d1e-0000-7000-8000-000000000004"] };
assert.equal(validate("scope", { ...baseScope, commands: { build: dupRefs } }).valid, false);

// NOTE: "sourceFingerprintAtSelection keys must exactly match sourceRefs" is NOT asserted
// here. Plain JSON Schema's additionalProperties/propertyNames can constrain what a key
// LOOKS like, but cannot express "this object's key set equals that array's contents" as a
// cross-field constraint -- there is no schema shape that makes this pass. That check is a
// real, implemented relational check (not deferred, not skipped) in Task 13, exercised
// against actual scope.yml fixtures via check schema, where application code can compare
// the two sets directly. Asserting it here, against the schema alone, would be a test that
// can never pass no matter what the schema says -- exactly the contradiction to avoid.

// custom role must not reuse a well-known name
assert.equal(validate("scope", { ...baseScope, commands: { custom: { test: reviewedCommand } } }).valid, false);

// custom role name pattern
assert.equal(validate("scope", { ...baseScope, commands: { custom: { e2e: reviewedCommand } } }).valid, true);
assert.equal(validate("scope", { ...baseScope, commands: { custom: { "Not_Valid!": reviewedCommand } } }).valid, false);

console.log("scope-commands-schema: declared/inferred|reviewed union, sourceRefs set rules, custom role rules all pass");
