// runtime/src/lib/tests/discovery-proposal-references.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { resolveSourceReferences } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-refs-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "sources"), { recursive: true });
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

const scopeId = "018f4d1e-0000-7000-8000-000000000001";
const confirmedId = "018f4d1e-0000-7000-8000-000000000002";
const updatedId = "018f4d1e-0000-7000-8000-000000000003";
const danglingId = "018f4d1e-0000-7000-8000-000000000004";

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

// resolves against an update/move entry in the SAME proposal -> ok
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "update", sourceId: updatedId, observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }],
    scopeCommands: [commandEntry(updatedId)]
  };
  assert.equal(resolveSourceReferences({ proposal, planningRoot }).ok, true);
}

// does NOT resolve against an add entry (no id yet) -- referencing it is always dangling
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "add", path: "docs/y/", family: "decision-sources", kind: "decision", role: "decision", authority: { standing: "authoritative", force: "normative" }, availability: "implemented", observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }],
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

console.log("discovery-proposal-references: resolves against confirmed catalog and same-proposal update/move, rejects add and truly dangling refs (including inside alternatives)");
