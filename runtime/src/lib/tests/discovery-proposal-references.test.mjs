// runtime/src/lib/tests/discovery-proposal-references.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { resolveSourceReferences } from "../discoveryProposal.mjs";

const scopeId = "018f4d1e-0000-7000-8000-000000000001";

// scopeCommands[].scopeId can only ever be an already-confirmed scope (a proposal's own scopes[]
// entries have no id yet), so every test below except the dedicated dangling-scope-ref case
// writes scopeId into the confirmed catalog up front -- otherwise every one of them would fail
// on the new scopeId check rather than on what it's actually testing.
function makeWorkspace({ confirmScope = true } = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-refs-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "sources"), { recursive: true });
  if (confirmScope) writeConfirmedScope(planningRoot, scopeId);
  return { planningRoot };
}

function writeConfirmedSource(planningRoot, id) {
  const dir = path.join(planningRoot, "sources", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "source.yml"), stringifyYaml({
    schemaVersion: 1, id, path: "docs/x/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "0".repeat(64), confirmedContentHash: "0".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000009" }
  }));
}

function writeConfirmedScope(planningRoot, id) {
  const dir = path.join(planningRoot, "scopes", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "scope.yml"), stringifyYaml({
    schemaVersion: 1, id, key: "api", label: "API", kind: "code", path: "api/", owner: null, commands: {}
  }));
}
const confirmedId = "018f4d1e-0000-7000-8000-000000000002";
const updatedId = "018f4d1e-0000-7000-8000-000000000003";
const danglingId = "018f4d1e-0000-7000-8000-000000000004";
const movedId = "018f4d1e-0000-7000-8000-000000000005";

function commandEntry(sourceId) {
  return {
    scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
    sourceRefs: [sourceId], sourceFingerprintAtSelection: { [sourceId]: "a".repeat(64) },
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  };
}

// resolves against an already-confirmed catalog source -> ok
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedSource(planningRoot, confirmedId);
  const proposal = { sources: [], scopeCommands: [commandEntry(confirmedId)] };
  assert.equal(resolveSourceReferences({ proposal, planningRoot }).ok, true);
}

// resolves against an update entry in the SAME proposal -> ok
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "update", sourceId: updatedId, observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }],
    scopeCommands: [commandEntry(updatedId)]
  };
  assert.equal(resolveSourceReferences({ proposal, planningRoot }).ok, true);
}

// resolves against a move entry in the SAME proposal -> ok
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "move", sourceId: movedId, fromPath: "docs/old/", path: "docs/new/", observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }],
    scopeCommands: [commandEntry(movedId)]
  };
  assert.equal(resolveSourceReferences({ proposal, planningRoot }).ok, true);
}

// does NOT resolve against an add entry (no id yet) -- referencing it is always dangling, even
// if a stray sourceId is attached directly to the add entry (bypassing the schema, which this
// function does not itself enforce -- the exclusion must be gated on entry.action, not on
// whether a sourceId field happens to be absent)
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{
      action: "add", sourceId: danglingId, path: "docs/y/", family: "decision-sources", kind: "decision",
      role: "decision", authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
      observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64)
    }],
    scopeCommands: [commandEntry(danglingId)]
  };
  const result = resolveSourceReferences({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "dangling_source_ref" && e.sourceId === danglingId));
}

// no match anywhere -> dangling
{
  const { planningRoot } = makeWorkspace();
  const proposal = { sources: [], scopeCommands: [commandEntry(danglingId)] };
  const result = resolveSourceReferences({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "dangling_source_ref" && e.sourceId === danglingId));
}

// dangling ref inside alternatives[] is caught too, not just the selected command
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedSource(planningRoot, confirmedId);
  const proposal = {
    sources: [],
    scopeCommands: [{
      ...commandEntry(confirmedId),
      alternatives: [{
        command: "./alt", sourceRefs: [danglingId], sourceFingerprintAtSelection: { [danglingId]: "a".repeat(64) },
        confidence: "medium", requiresEnvironment: false, requiresSecrets: false
      }]
    }]
  };
  const result = resolveSourceReferences({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "dangling_source_ref" && e.sourceId === danglingId));
}

// scopeId naming a scope that doesn't exist in the confirmed catalog -> dangling, rejected,
// even though every sourceRef in the command resolves fine
{
  const { planningRoot } = makeWorkspace({ confirmScope: false });
  writeConfirmedSource(planningRoot, confirmedId);
  const proposal = { sources: [], scopeCommands: [commandEntry(confirmedId)] };
  const result = resolveSourceReferences({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "dangling_scope_ref" && e.scopeId === scopeId));
}

console.log("discovery-proposal-references: resolves against confirmed catalog and same-proposal update/move (both tested independently), rejects add (even with a stray sourceId attached), truly dangling source refs (including inside alternatives), and dangling scope refs");
