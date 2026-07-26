import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDiscoverScan } from "../discoverScan.mjs";
import { computeSourceFingerprint } from "../fingerprint.mjs";
import { validateDiscoveryProposal } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-validate-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  return { workspaceRoot, planningRoot };
}

// a fully valid, self-consistent proposal -> ok, with a normalized result usable by a later plan
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision");
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "adr"), { maxBytes: 1024 * 1024 });

  const proposal = {
    schemaVersion: 1,
    scanId: scan.scanId,
    baseRevision: scan.baseRevision,
    scanParameters: scan.scanParameters,
    scopes: [],
    sources: [{
      action: "add", path: "docs/adr/", family: "decision-sources", kind: "decision", role: "decision",
      authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
      observedFingerprint: real.fingerprint, observedContentHash: real.contentHash
    }],
    scopeCommands: [],
    diagnostics: []
  };

  const result = validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
  assert.equal(result.normalized.workspaceHash, scan.baseRevision.workspaceHash);
  assert.equal(result.normalized.scanParameters.maxSourceBytes, 1024 * 1024);
  assert.deepEqual(result.normalized.proposal, proposal);
}

// structural failure short-circuits before any live re-scan happens
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const malformedProposal = { schemaVersion: 1, notAValidShape: true };
  const result = validateDiscoveryProposal({ proposal: malformedProposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "schema_invalid"));
}

// consistency failure (stale) short-circuits before fingerprint/reference/drift checks run
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });
  const proposal = {
    schemaVersion: 1, scanId: scan.scanId, baseRevision: scan.baseRevision, scanParameters: scan.scanParameters,
    scopes: [], sources: [{ action: "remove", sourceId: "018f4d1e-0000-7000-8000-000000000099" }], scopeCommands: [], diagnostics: []
  };
  // NOTE (deviation from brief task-9-brief.md line 77): the brief's original fixture created
  // an empty `somewhere-new/` directory here. That name matches none of discoverScan.mjs's
  // SCOPE_MANIFEST_RULES/SOURCE_DIRECTORY_RULES patterns and is empty, so it is invisible to
  // computeWorkspaceHash -- runDiscoverScan produces an IDENTICAL workspaceHash before and
  // after, verifyWorkspaceConsistency passes, and the proposal falls through to step 4, which
  // then fails with unknown_source_id -- the exact opposite of what this block exists to prove.
  // Adding a real, recognized workspace artifact (README.md, a SOURCE_FILE_RULES entry) does
  // perturb the hash, exercising the intended "consistency gate short-circuits step 4" scenario.
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# unexpected addition since the scan\n");

  const result = validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "stale_proposal"));
  assert.equal(result.errors.some((e) => e.code === "unknown_source_id"), false, "step 4 must never run once step 3 already failed");
}

console.log("discovery-proposal-validate: fully valid proposals pass with a usable normalized result, and each gate short-circuits the ones after it");
