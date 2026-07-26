import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { computeSourceFingerprint } from "../fingerprint.mjs";
import { verifySourceFingerprints } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-fp-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "sources"), { recursive: true });
  return { workspaceRoot, planningRoot };
}

function writeConfirmedSource(planningRoot, id, overrides) {
  const dir = path.join(planningRoot, "sources", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "source.yml"), stringifyYaml({
    schemaVersion: 1, id, path: "docs/old/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "0".repeat(64), confirmedContentHash: "0".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000009" },
    ...overrides
  }));
}

const idAdd = "018f4d1e-0000-7000-8000-000000000001"; // unused for "add" (no sourceId), kept for readability
const idUpdate = "018f4d1e-0000-7000-8000-000000000002";
const idMove = "018f4d1e-0000-7000-8000-000000000003";

// add: claimed fingerprint matches live observation -> ok
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "adr"), { maxBytes: 1024 * 1024 });

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "add", path: "docs/adr/", observedFingerprint: real.fingerprint, observedContentHash: real.contentHash }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
}

// add: claimed fingerprint does NOT match live observation -> rejected (the skill cannot fabricate a value)
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision");

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "add", path: "docs/adr/", observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "fingerprint_mismatch"));
}

// add: path escapes the workspace -> rejected, never read
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "add", path: "../../etc", observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "untrusted_source_path"));
}

// update: resolves the path from the CONFIRMED catalog (update never carries path), fingerprint verified
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "old"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "old", "0001.md"), "updated content");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "old"), { maxBytes: 1024 * 1024 });
  writeConfirmedSource(planningRoot, idUpdate);

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "update", sourceId: idUpdate, observedFingerprint: real.fingerprint, observedContentHash: real.contentHash }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
}

// update: sourceId not in the confirmed catalog at all -> rejected
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "update", sourceId: idUpdate, observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unknown_source_id"));
}

// move: fromPath must match the confirmed source's ACTUAL registered path
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new", "0001.md"), "moved content");
  writeConfirmedSource(planningRoot, idMove); // registered path is "docs/old/"

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "move", sourceId: idMove, fromPath: "docs/somewhere-else/", path: "docs/new/", observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "move_frompath_mismatch"));
}

// move: the OLD path must actually be gone -- claiming a move while the old content is still there is rejected
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "old"), { recursive: true }); // still exists!
  fs.writeFileSync(path.join(workspaceRoot, "docs", "old", "0001.md"), "still here");
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new", "0001.md"), "moved content");
  writeConfirmedSource(planningRoot, idMove, { confirmedContentHash: "irrelevant-for-this-case".padEnd(64, "0") });

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "move", sourceId: idMove, fromPath: "docs/old/", path: "docs/new/", observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "move_source_still_exists"));
}

// move: contentHash must match the CONFIRMED contentHash -- a "move" that changes content is not a move
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new", "0001.md"), "genuinely different content");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "new"), { maxBytes: 1024 * 1024 });
  writeConfirmedSource(planningRoot, idMove, { confirmedContentHash: "0".repeat(64) }); // does not equal real.contentHash

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "move", sourceId: idMove, fromPath: "docs/old/", path: "docs/new/", observedFingerprint: real.fingerprint, observedContentHash: real.contentHash }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "move_content_mismatch"));
}

// move: fully legitimate move -- fromPath matches, old path gone, content preserved, live fingerprint matches claim
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new", "0001.md"), "preserved content");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "new"), { maxBytes: 1024 * 1024 });
  writeConfirmedSource(planningRoot, idMove, { confirmedContentHash: real.contentHash });

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "move", sourceId: idMove, fromPath: "docs/old/", path: "docs/new/", observedFingerprint: real.fingerprint, observedContentHash: real.contentHash }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
}

// remove: no fingerprint claim to verify at all -- always structurally fine at this step
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const proposal = { scanParameters: { maxSourceBytes: 1024 * 1024 }, sources: [{ action: "remove", sourceId: idMove }] };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
}

console.log("discovery-proposal-fingerprints: add/update/move/remove fingerprint re-verification, path confinement, and move identity checks all pass");
