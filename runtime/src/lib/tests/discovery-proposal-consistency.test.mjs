import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDiscoverScan } from "../discoverScan.mjs";
import { verifyWorkspaceConsistency } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-consistency-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "web"));
  fs.writeFileSync(path.join(workspaceRoot, "web", "package.json"), "{}");
  return { workspaceRoot, planningRoot };
}

// workspace unchanged since the scan that produced the proposal -> ok
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });
  const proposal = { baseRevision: scan.baseRevision, scanParameters: scan.scanParameters };

  const result = verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
  assert.equal(result.freshScan.baseRevision.workspaceHash, scan.baseRevision.workspaceHash);
}

// workspace changed after the scan -> stale_proposal
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });
  const proposal = { baseRevision: scan.baseRevision, scanParameters: scan.scanParameters };

  fs.writeFileSync(path.join(workspaceRoot, "web", "package.json"), '{"changed": true}');

  const result = verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "stale_proposal"));
}

// re-observation uses the proposal's OWN scanParameters, never a silently different default
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 2 * 1024 * 1024 }); // non-default
  const proposal = { baseRevision: scan.baseRevision, scanParameters: scan.scanParameters };

  const result = verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true, "re-observing with the proposal's own 2 MiB cap must reproduce the same workspaceHash");
}

console.log("discovery-proposal-consistency: unchanged workspace passes, changed workspace is rejected as stale, and re-observation always uses the proposal's own scanParameters");
