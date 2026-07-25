import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkSchema } from "../check.mjs";
import { stringifyYaml } from "../../lib/yaml.mjs";

function writeValidCanonical(planningRoot) {
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
}

{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-id-"));
  writeValidCanonical(planningRoot);
  const directoryId = "018f0000-0000-7000-8000-000000000001";
  const recordedId = "018f0000-0000-7000-8000-000000000002";
  const eventId = "018f0000-0000-7000-8000-000000000003";
  const operationDir = path.join(planningRoot, "operations", directoryId);
  fs.mkdirSync(operationDir, { recursive: true });
  fs.writeFileSync(path.join(operationDir, "operation.yml"), stringifyYaml({
    id: recordedId,
    kind: "workspace.init",
    status: "PROPOSED",
    proposedBy: "carlos",
    proposedAt: "2026-07-25T00:00:00.000Z",
    reservedEvents: [{ eventId, type: "workspace.initialized" }],
    history: [{ at: "2026-07-25T00:00:00.000Z", from: null, to: "PROPOSED", actor: "carlos", reason: null }]
  }));

  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.includes("does not match its directory")));
}

{
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "check-root-link-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "check-root-target-"));
  writeValidCanonical(outside);
  const planningRoot = path.join(workspace, ".planning");
  fs.symlinkSync(outside, planningRoot);
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.includes("trusted roots")));
}

console.log("check-integrity: relational identity and trusted-root checks pass");
