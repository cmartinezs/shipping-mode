import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, __prepareApplyForTests, computePersistedChangeSetHash } from "../changeset.mjs";
import { acquireWorkspaceLock } from "../lock.mjs";
import { renderWorkspaceInit } from "../../commands/renderers.mjs";
import { readOperation } from "../operationStore.mjs";
import { StaleError } from "../errors.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES } from "../bootstrapTopology.mjs";

const INIT_TARGET_FILES = ["config.yml", "plugin.lock.yml", ".gitignore", ...BOOTSTRAP_CANONICAL_DIRECTORIES];

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-prepare-"));
const operationsRoot = path.join(planningRoot, "operations");
const payload = { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` };

const operationId = propose({
  operationsRoot, planningRoot, kind: "workspace.init", target: {},
  payload, targetFiles: INIT_TARGET_FILES, actor: "carlos"
});
validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true });

const lock = acquireWorkspaceLock(planningRoot, operationId);
const { filePlan, expectedEvents } = __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });

assert.equal(filePlan.length, INIT_TARGET_FILES.length);
for (const entry of filePlan) {
  assert.equal(entry.expectedBefore, "ABSENT");
  assert.ok(entry.stagedContentHash);
  if (entry.action === "write") {
    assert.ok(fs.existsSync(path.join(planningRoot, ".runtime", "operations", operationId, "staged", entry.stagedRelativePath)));
  }
}
assert.equal(expectedEvents.length, 1);
assert.equal(readOperation(operationsRoot, operationId).status, "APPLYING");

lock.release();

// tampering: change-set edited after approve (payload + a matching new hash)
// -- internally consistent, but different from what validate/approve saw --
// must be caught by the three-way hash check, never silently applied
{
  const planningRoot2 = fs.mkdtempSync(path.join(os.tmpdir(), "apply-prepare-tamper-"));
  const operationsRoot2 = path.join(planningRoot2, "operations");
  const operationId2 = propose({
    operationsRoot: operationsRoot2, planningRoot: planningRoot2, kind: "workspace.init", target: {},
    payload, targetFiles: INIT_TARGET_FILES, actor: "carlos"
  });
  validateOperation({ operationsRoot: operationsRoot2, planningRoot: planningRoot2, operationId: operationId2, render: renderWorkspaceInit });
  approveOperation({ operationsRoot: operationsRoot2, planningRoot: planningRoot2, operationId: operationId2, actor: "carlos", allowSelfApproval: true });

  const changeSetPath = path.join(operationsRoot2, operationId2, "change-set.json");
  const changeSet = JSON.parse(fs.readFileSync(changeSetPath, "utf8"));
  changeSet.payload.name = "renamed-after-approve";
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  fs.writeFileSync(changeSetPath, JSON.stringify(changeSet, null, 2));

  const lock2 = acquireWorkspaceLock(planningRoot2, operationId2);
  assert.throws(
    () => __prepareApplyForTests({ operationsRoot: operationsRoot2, planningRoot: planningRoot2, operationId: operationId2, render: renderWorkspaceInit, actor: "carlos" }),
    StaleError,
    "a change-set edited after approve must never reach staging"
  );
  lock2.release();
  assert.equal(readOperation(operationsRoot2, operationId2).status, "STALE");
}

console.log("changeset-apply-prepare: all tests passed");
