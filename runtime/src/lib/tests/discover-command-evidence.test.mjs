import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { computeCommandEvidence } from "../discoverScan.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "discover-evidence-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "scopes"), { recursive: true });
  return { planningRoot };
}

function writeScope(planningRoot, scopeId, commands) {
  const dir = path.join(planningRoot, "scopes", scopeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "scope.yml"), stringifyYaml({
    schemaVersion: 1, id: scopeId, key: "api", label: "API", kind: "code", path: "api/", owner: null, commands
  }));
}

const srcA = "018f4d1e-0000-7000-8000-0000000000a1";
const srcB = "018f4d1e-0000-7000-8000-0000000000a2";

// declared command -> not-evidence-backed, regardless of any drift data
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b1";
  writeScope(planningRoot, scopeId, {
    test: { command: "./x", method: "declared", declaredBy: "carlos", declaredAt: "2026-07-25T10:00:00Z", declaredOperationId: "018f4d1e-0000-7000-8000-0000000000c1", requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  const result = computeCommandEvidence({ planningRoot, knownSourceDrift: [] });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "test");
  assert.equal(entry.evidenceState, "not-evidence-backed");
  assert.deepEqual(entry.reasons, []);
}

// current: no drift on the referenced source. confirmedFingerprint and observedFingerprint
// are both supplied explicitly and equal -- this fixture must never rely on a fallback from
// one to the other (Task 8 always provides both as real, independent fields now)
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b2";
  writeScope(planningRoot, scopeId, {
    build: { command: "./y", method: "reviewed", confidence: "high", sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "a".repeat(64) }, requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  const result = computeCommandEvidence({
    planningRoot,
    knownSourceDrift: [{ sourceId: srcA, driftState: "unchanged", confirmedFingerprint: "a".repeat(64), observedFingerprint: "a".repeat(64) }]
  });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "build");
  assert.equal(entry.evidenceState, "current");
}

// evidence-missing: referenced source has no drift entry at all (never existed / path unresolvable)
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b3";
  writeScope(planningRoot, scopeId, {
    build: { command: "./y", method: "reviewed", confidence: "high", sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "a".repeat(64) }, requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  const result = computeCommandEvidence({ planningRoot, knownSourceDrift: [] });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "build");
  assert.equal(entry.evidenceState, "evidence-missing");
}

// evidence-updated: catalog's confirmed fingerprint moved past the command's selection snapshot,
// but live workspace still matches the catalog (no live drift)
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b4";
  writeScope(planningRoot, scopeId, {
    build: { command: "./y", method: "reviewed", confidence: "high", sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "old".padEnd(64, "0") }, requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  // driftState "unchanged" means catalog.confirmedFingerprint === live observed; the value itself differs from the selection snapshot
  const result = computeCommandEvidence({
    planningRoot,
    knownSourceDrift: [{ sourceId: srcA, driftState: "unchanged", observedFingerprint: "new".padEnd(64, "0"), confirmedFingerprint: "new".padEnd(64, "0") }]
  });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "build");
  assert.equal(entry.evidenceState, "evidence-updated");
  assert.deepEqual(entry.reasons, ["catalog-advanced-since-selection"]);
}

// evidence-drifted outranks evidence-updated when both apply
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b5";
  writeScope(planningRoot, scopeId, {
    build: { command: "./y", method: "reviewed", confidence: "high", sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "old".padEnd(64, "0") }, requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  const result = computeCommandEvidence({
    planningRoot,
    knownSourceDrift: [{ sourceId: srcA, driftState: "changed", observedFingerprint: "live".padEnd(64, "0"), confirmedFingerprint: "new".padEnd(64, "0") }]
  });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "build");
  assert.equal(entry.evidenceState, "evidence-drifted");
  assert.deepEqual(entry.reasons.sort(), ["catalog-advanced-since-selection", "live-source-differs-from-catalog"].sort());
}

console.log("discover-command-evidence: not-evidence-backed, current, evidence-missing, evidence-updated, evidence-drifted precedence all pass");
