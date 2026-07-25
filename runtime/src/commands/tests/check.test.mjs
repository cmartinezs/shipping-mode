import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkSchema } from "../check.mjs";
import { propose, validateOperation, approveOperation, __prepareApplyForTests } from "../../lib/changeset.mjs";
import { acquireWorkspaceLock } from "../../lib/lock.mjs";
import { renderConfigUpdate } from "../renderers.mjs";
import { parseYaml } from "../../lib/yaml.mjs";

// uninitialized workspace
{
  const planningRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "check-uninit-")), ".planning");
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "NOT_INITIALIZED");
  assert.ok(result.findings.length > 0);
}

// initialized but missing plugin.lock.yml -- must be a finding, not a silent PASS
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-missing-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("plugin.lock.yml")));
}

// fully valid workspace -- PASS, and check schema never writes anything
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-valid-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const beforeMtime = fs.statSync(path.join(planningRoot, "config.yml")).mtimeMs;
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.findings, []);
  assert.equal(fs.statSync(path.join(planningRoot, "config.yml")).mtimeMs, beforeMtime, "check schema must never write to config.yml");
}

// invalid config.yml -- FAIL with a finding
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-invalid-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: \"\"\nvcs: git\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.length > 0);
}

// malformed YAML -- FAIL with an explicit finding, exit 1 via the normal
// data-driven status mapping, never an uncaught parse exception (exit 2)
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-malformed-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "name: demo\nname: duplicate-key-is-a-parse-error\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("config.yml") && f.toLowerCase().includes("parse")));
}

// a symlink under scopes/ must be reported, never followed or silently ignored
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-scope-symlink-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const scopesRoot = path.join(planningRoot, "scopes");
  fs.mkdirSync(scopesRoot, { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "check-scope-outside-"));
  const scopeId = "018f0000-0000-7000-8000-000000000003";
  fs.symlinkSync(outside, path.join(scopesRoot, scopeId));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes(scopeId) && f.toLowerCase().includes("symlink")));
}

// an invalid (non-UUIDv7) entry under scopes/ must be reported, not silently skipped
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-scope-invalid-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  fs.mkdirSync(path.join(planningRoot, "scopes", "not-a-uuid"), { recursive: true });
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("not-a-uuid")));
}

// reports pending operations without touching them
//
// Built via the real propose/validate/approve/prepareApply pipeline rather
// than a hand-rolled operation object: operation.schema.json's per-status
// invariants (Task 6) require APPLYING operations to carry populated
// validation/approval/filePlan/expectedEvents, which a minimal hand-built
// fixture can't satisfy -- checkSchema correctly treats a schema-invalid
// operation as a finding, not a pending operation, so a fixture that isn't
// genuinely schema-valid would never exercise this path.
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-pending-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const operationsRoot = path.join(planningRoot, "operations");

  const currentConfig = parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"));
  const render = (payload) => renderConfigUpdate(payload, currentConfig);
  const operationId = propose({
    operationsRoot, planningRoot, kind: "config.update", target: {},
    payload: { name: "renamed" }, targetFiles: ["config.yml"], actor: "carlos"
  });
  validateOperation({ operationsRoot, planningRoot, operationId, render });
  approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true });
  const lock = acquireWorkspaceLock(planningRoot, operationId);
  __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render, actor: "carlos" });
  lock.release();

  const result = checkSchema({ planningRoot });
  assert.equal(result.pendingOperations.length, 1);
  assert.equal(result.pendingOperations[0].status, "APPLYING");
  assert.equal(result.pendingOperations[0].operationId, operationId);

  const rawAfter = fs.readFileSync(path.join(operationsRoot, operationId, "operation.yml"), "utf8");
  assert.ok(rawAfter.includes("APPLYING"), "checkSchema must never mutate the operation while inspecting it");
}

// corrupt operation.yml must be reported as a finding, never silently
// skipped and never rewritten (Revision 4 note 6)
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-corrupt-op-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const operationsRoot = path.join(planningRoot, "operations");
  const corruptId = "018f0000-0000-7000-8000-000000000006";
  fs.mkdirSync(path.join(operationsRoot, corruptId), { recursive: true });
  fs.writeFileSync(path.join(operationsRoot, corruptId, "operation.yml"), "not: [valid, yaml, at all\n");
  const rawBefore = fs.readFileSync(path.join(operationsRoot, corruptId, "operation.yml"), "utf8");

  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes(corruptId)), "corrupt operation metadata must be reported as a finding, not silently skipped");
  const rawAfter = fs.readFileSync(path.join(operationsRoot, corruptId, "operation.yml"), "utf8");
  assert.equal(rawAfter, rawBefore, "check schema must never rewrite operation.yml, corrupt or not");
}

console.log("check: all tests passed");
