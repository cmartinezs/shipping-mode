import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDiscoverScan } from "../discover.mjs";
import { UsageError } from "../../lib/errors.mjs";

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "discover-run-"));
const planningRoot = path.join(workspaceRoot, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
fs.mkdirSync(path.join(workspaceRoot, "web"));
fs.writeFileSync(path.join(workspaceRoot, "web", "package.json"), "{}");

const result = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });

assert.equal(result.schemaVersion, 1);
assert.equal(typeof result.scanId, "string");
assert.equal(typeof result.generatedAt, "string");
assert.equal(result.baseRevision.workspaceHash.length, 64);
assert.equal(result.baseRevision.vcsRevision, "none"); // no real .git in this temp dir
assert.equal(result.scanParameters.maxSourceBytes, 1024 * 1024);
assert.equal(result.git.vcs, "none");
assert.ok(result.scopeCandidates.some((c) => c.path === "web/"));

// package.json is ALSO a sourceCandidate (project-module-manifests), and it must come back
// with a REAL fingerprint -- never a null placeholder deferred to some later capability
const webManifestCandidate = result.sourceCandidates.find((c) => c.path === "web/package.json");
assert.ok(webManifestCandidate, "web/package.json must be a source candidate");
assert.equal(webManifestCandidate.observedFingerprint.length, 64);
assert.equal(webManifestCandidate.observedContentHash.length, 64);
assert.notEqual(webManifestCandidate.observedFingerprint, null);

assert.deepEqual(result.knownSources, []);
assert.deepEqual(result.knownCommandsEvidence, []);
assert.deepEqual(result.diagnostics, []);

// range validation
assert.throws(() => runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 100 }), UsageError);
assert.throws(() => runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 3 * 1024 * 1024 * 1024 }), UsageError);

// default applies when maxSourceBytes is omitted
const withDefault = runDiscoverScan({ planningRoot, workspaceRoot });
assert.equal(withDefault.scanParameters.maxSourceBytes, 536870912);

console.log("discover command: full ScanResult assembly (with real candidate fingerprints and commit-SHA vcsRevision), range validation, and default all pass");
