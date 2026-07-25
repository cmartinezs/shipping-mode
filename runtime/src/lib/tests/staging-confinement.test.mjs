import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, applyOperation } from "../changeset.mjs";
import { renderWorkspaceInit } from "../../commands/renderers.mjs";
import { PathConfinementError } from "../paths.mjs";

const payload = { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` };

function approvedOperation() {
  const planningRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "staging-confine-")), ".planning");
  const operationsRoot = path.join(planningRoot, "operations");
  const operationId = propose({
    operationsRoot,
    planningRoot,
    kind: "workspace.init",
    target: {},
    payload,
    targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"],
    actor: "carlos"
  });
  validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
  approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true });
  return { planningRoot, operationsRoot, operationId };
}

{
  const { planningRoot, operationsRoot, operationId } = approvedOperation();
  const runtimeRoot = path.join(planningRoot, ".runtime");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "staging-outside-root-"));
  fs.symlinkSync(outside, path.join(runtimeRoot, "operations"));
  assert.throws(
    () => applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" }),
    PathConfinementError
  );
  assert.deepEqual(fs.readdirSync(outside), []);
}

{
  const { planningRoot, operationsRoot, operationId } = approvedOperation();
  const runtimeOperations = path.join(planningRoot, ".runtime", "operations");
  fs.mkdirSync(runtimeOperations);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "staging-outside-operation-"));
  fs.symlinkSync(outside, path.join(runtimeOperations, operationId));
  assert.throws(
    () => applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" }),
    PathConfinementError
  );
  assert.deepEqual(fs.readdirSync(outside), []);
}

console.log("staging-confinement: runtime staging roots cannot be redirected by symlinks");
