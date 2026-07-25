import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { computeSourceFingerprint } from "../fingerprint.mjs";
import { computeKnownSourceDrift } from "../discoverScan.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "discover-drift-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "sources"), { recursive: true });
  return { workspaceRoot, planningRoot };
}

function writeSource(planningRoot, id, overrides) {
  const dir = path.join(planningRoot, "sources", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "source.yml"), stringifyYaml({
    schemaVersion: 1, id, path: "docs/adr/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "0".repeat(64), confirmedContentHash: "0".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000009" },
    ...overrides
  }));
}

// unchanged -- and confirmedFingerprint/confirmedContentHash are present and distinct
// from observedFingerprint/observedContentHash as their own explicit fields
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const id = "018f4d1e-0000-7000-8000-000000000001";
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "adr"), { maxBytes: 1024 });
  writeSource(planningRoot, id, { confirmedFingerprint: real.fingerprint, confirmedContentHash: real.contentHash });

  const { results, diagnostics } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: 1024 });
  const entry = results.find((d) => d.sourceId === id);
  assert.equal(entry.driftState, "unchanged");
  assert.equal(entry.freshness, "current");
  assert.equal(entry.confirmedFingerprint, real.fingerprint);
  assert.equal(entry.observedFingerprint, real.fingerprint);
  assert.equal(entry.confirmedContentHash, real.contentHash);
  assert.deepEqual(diagnostics, []);
}

// changed -- confirmedFingerprint (catalog) and observedFingerprint (live) must be reported
// as the two distinct values they are, never one standing in for the other
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const id = "018f4d1e-0000-7000-8000-000000000002";
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision v2");
  writeSource(planningRoot, id); // confirmedFingerprint stays the all-zero placeholder, guaranteed to differ from the live one

  const { results } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: 1024 });
  const entry = results.find((d) => d.sourceId === id);
  assert.equal(entry.driftState, "changed");
  assert.equal(entry.freshness, "stale");
  assert.equal(entry.confirmedFingerprint, "0".repeat(64));
  assert.notEqual(entry.observedFingerprint, entry.confirmedFingerprint);
}

// missing (no moved candidate available) -- freshness must be ABSENT, not the string "unknown"
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const id = "018f4d1e-0000-7000-8000-000000000003";
  writeSource(planningRoot, id); // docs/adr/ never created in workspaceRoot

  const { results } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: 1024 });
  const entry = results.find((d) => d.sourceId === id);
  assert.equal(entry.driftState, "missing");
  assert.equal("freshness" in entry, false, "freshness must be absent for missing, not the literal string \"unknown\" -- driftState already says everything unambiguously");
  assert.equal(entry.observedAtPath, null);
}

// moved: source path gone, but a source candidate elsewhere has the exact same contentHash
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const id = "018f4d1e-0000-7000-8000-000000000004";
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new-adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new-adr", "0001.md"), "decision");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "new-adr"), { maxBytes: 1024 });
  writeSource(planningRoot, id, { confirmedContentHash: real.contentHash }); // path still "docs/adr/", which does not exist

  const { results, fingerprintedSourceCandidates } = computeKnownSourceDrift({
    planningRoot, workspaceRoot,
    sourceCandidates: [{ path: "docs/new-adr/", candidateFamilies: ["decision-sources"], ruleIds: [] }],
    maxSourceBytes: 1024
  });
  const entry = results.find((d) => d.sourceId === id);
  assert.equal(entry.driftState, "moved");
  assert.equal("freshness" in entry, false);
  assert.equal(entry.observedAtPath, "docs/new-adr/");
  // the candidate itself comes back fully fingerprinted -- this is the SAME computation the
  // ScanResult's sourceCandidates output (Task 11) reuses, not a separate later step
  const candidate = fingerprintedSourceCandidates.find((c) => c.path === "docs/new-adr/");
  assert.equal(candidate.observedContentHash, real.contentHash);
  assert.equal(candidate.observedFingerprint, real.fingerprint);
}

// a confirmed source that has become unreadable/oversized produces a diagnostic and does
// NOT crash the whole call -- the rest of the confirmed sources still get processed
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const okId = "018f4d1e-0000-7000-8000-000000000005";
  const brokenId = "018f4d1e-0000-7000-8000-000000000006";
  fs.mkdirSync(path.join(workspaceRoot, "docs", "ok"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "ok", "0001.md"), "fine");
  const okReal = computeSourceFingerprint(path.join(workspaceRoot, "docs", "ok"), { maxBytes: 1024 });
  writeSource(planningRoot, okId, { path: "docs/ok/", confirmedFingerprint: okReal.fingerprint, confirmedContentHash: okReal.contentHash });

  fs.mkdirSync(path.join(workspaceRoot, "docs", "broken"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "broken", "huge.md"), "0123456789"); // 10 bytes
  writeSource(planningRoot, brokenId, { path: "docs/broken/" });

  const { results, diagnostics } = computeKnownSourceDrift({
    planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: 5 // smaller than the 10-byte broken source
  });
  assert.ok(results.find((r) => r.sourceId === okId && r.driftState === "unchanged"), "the healthy source must still be processed normally");
  assert.equal(results.find((r) => r.sourceId === brokenId), undefined, "the broken source must not appear in results");
  assert.ok(diagnostics.some((d) => d.code === "source_too_large" && d.sourceId === brokenId), "the broken source must produce a diagnostic instead of crashing the call");
}

// SECURITY: a confirmed source with a manipulated/corrupted path that escapes the workspace
// (e.g. "../../secret") must never be read -- confineScopePath must reject it, caught here as
// a diagnostic (this task's own per-item contract), never a crash and never a silent read
// outside the workspace
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "discover-drift-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "should never be read by discovery");
  const escapingId = "018f4d1e-0000-7000-8000-000000000007";
  const relativeEscape = path.relative(workspaceRoot, outside); // e.g. "../../tmp/discover-drift-outside-XXXX"
  writeSource(planningRoot, escapingId, { path: relativeEscape });

  const { results, diagnostics } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: 1024 });
  assert.equal(results.find((r) => r.sourceId === escapingId), undefined, "an escaping source must never appear in results");
  assert.ok(diagnostics.some((d) => d.code === "untrusted_source_path" && d.sourceId === escapingId), "the escape must be reported as a diagnostic");
}

console.log("discover-drift: unchanged, changed, missing, moved (with confirmedFingerprint/observedFingerprint kept distinct, freshness absent for missing/moved), per-item diagnostic-not-crash, and path-escape rejection all pass");
