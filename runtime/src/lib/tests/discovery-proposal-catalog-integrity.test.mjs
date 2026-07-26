// runtime/src/lib/tests/discovery-proposal-catalog-integrity.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { checkScopeProposals, checkSourcePathCollisions } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-catalog-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "scopes"), { recursive: true });
  fs.mkdirSync(path.join(planningRoot, "sources"), { recursive: true });
  return { workspaceRoot, planningRoot };
}

function writeConfirmedScope(planningRoot, id, key, scopePath) {
  const dir = path.join(planningRoot, "scopes", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "scope.yml"), stringifyYaml({
    schemaVersion: 1, id, key, label: key, kind: "code", path: scopePath, owner: null, commands: {}
  }));
}

function writeConfirmedSource(planningRoot, id, sourcePath) {
  const dir = path.join(planningRoot, "sources", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "source.yml"), stringifyYaml({
    schemaVersion: 1, id, path: sourcePath, family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "0".repeat(64), confirmedContentHash: "0".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000009" }
  }));
}

const scopeIdA = "018f4d1e-0000-7000-8000-000000000001";
const srcA = "018f4d1e-0000-7000-8000-000000000002";
const srcB = "018f4d1e-0000-7000-8000-000000000003";

// --- checkScopeProposals ---

// a new scope proposal with a key that isn't in the confirmed catalog and a path that stays
// inside the workspace -> ok
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const proposal = { scopes: [{ key: "web", label: "Web", kind: "code", path: "web/", owner: null }] };
  assert.equal(checkScopeProposals({ proposal, planningRoot, workspaceRoot }).ok, true);
}

// a new scope proposal reusing an already-confirmed key -> rejected
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  writeConfirmedScope(planningRoot, scopeIdA, "web", "web/");
  const proposal = { scopes: [{ key: "web", label: "Web again", kind: "code", path: "web2/", owner: null }] };
  const result = checkScopeProposals({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "scope_key_collision" && e.key === "web"));
}

// a new scope proposal whose path escapes the workspace -> rejected, never silently accepted
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const proposal = { scopes: [{ key: "web", label: "Web", kind: "code", path: "../../../etc", owner: null }] };
  const result = checkScopeProposals({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "untrusted_scope_path" && e.key === "web"));
}

// --- checkSourcePathCollisions ---

// an "add" landing on a path where an untouched confirmed source already lives -> rejected
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedSource(planningRoot, srcA, "docs/adr/");
  const proposal = {
    sources: [{
      action: "add", path: "docs/adr/", family: "decision-sources", kind: "decision", role: "decision",
      authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
      observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64)
    }]
  };
  const result = checkSourcePathCollisions({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "source_path_collision" && e.path === "docs/adr/"));
}

// two "move" actions landing on the same target path -> rejected
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  writeConfirmedSource(planningRoot, srcA, "docs/a/");
  writeConfirmedSource(planningRoot, srcB, "docs/b/");
  fs.mkdirSync(path.join(workspaceRoot, "docs", "merged"), { recursive: true });
  const proposal = {
    sources: [
      { action: "move", sourceId: srcA, fromPath: "docs/a/", path: "docs/merged/", observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) },
      { action: "move", sourceId: srcB, fromPath: "docs/b/", path: "docs/./merged", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }
    ]
  };
  const result = checkSourcePathCollisions({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "source_path_collision" && e.path === "docs/merged/"));
}

// aliases of the same live path (including an in-workspace symlink) are one occupancy, not
// independent source paths. Comparing raw catalog strings would accept this and break the
// uniqueness invariant used by later move detection.
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.symlinkSync("adr", path.join(workspaceRoot, "docs", "decisions"));
  writeConfirmedSource(planningRoot, srcA, "docs/adr/");
  const proposal = {
    sources: [{
      action: "add", path: "docs/decisions/", family: "decision-sources", kind: "decision", role: "decision",
      authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
      observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64)
    }]
  };
  const result = checkSourcePathCollisions({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) =>
    e.code === "source_path_collision"
    && e.paths.includes("docs/adr/")
    && e.paths.includes("docs/decisions/")
  ));
}

// a "move" does not collide with its OWN previous occupancy, since the source's old path is
// excluded (as displaced) before its new path is added
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedSource(planningRoot, srcA, "docs/a/");
  const proposal = {
    sources: [{ action: "move", sourceId: srcA, fromPath: "docs/a/", path: "docs/a-renamed/", observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }]
  };
  assert.equal(checkSourcePathCollisions({ proposal, planningRoot }).ok, true);
}

// a "remove" freeing up a path that an "add" then reuses in the SAME proposal -> ok, not a collision
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedSource(planningRoot, srcA, "docs/a/");
  const proposal = {
    sources: [
      { action: "remove", sourceId: srcA },
      {
        action: "add", path: "docs/a/", family: "decision-sources", kind: "decision", role: "decision",
        authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
        observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64)
      }
    ]
  };
  assert.equal(checkSourcePathCollisions({ proposal, planningRoot }).ok, true);
}

console.log("discovery-proposal-catalog-integrity: scope key collisions and path escapes are rejected, source path collisions (including lexical/symlink aliases) are rejected, and legitimate reuse of a freed path is not");
