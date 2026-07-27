import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, applyOperation } from "../changeset.mjs";
import { renderWorkspaceInit } from "../../commands/renderers.mjs";
import { readOperation, readResult } from "../operationStore.mjs";
import { parseYaml } from "../yaml.mjs";
import { StateError } from "../errors.mjs";
import { BOOTSTRAP_CANONICAL_DIRECTORIES } from "../bootstrapTopology.mjs";

const INIT_TARGET_FILES = ["config.yml", "plugin.lock.yml", ".gitignore", ...BOOTSTRAP_CANONICAL_DIRECTORIES];

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-"));
const operationsRoot = path.join(planningRoot, "operations");
const payload = { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` };

const operationId = propose({
  operationsRoot, planningRoot, kind: "workspace.init", target: {},
  payload, targetFiles: INIT_TARGET_FILES, actor: "carlos"
});
validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true });

const outcome = applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
assert.equal(outcome.status, "APPLIED");
assert.equal(outcome.files.length, INIT_TARGET_FILES.length);

assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")).name, "demo");
assert.equal(fs.readFileSync(path.join(planningRoot, ".gitignore"), "utf8"), ".runtime/\n");

const operation = readOperation(operationsRoot, operationId);
assert.equal(operation.status, "APPLIED");
assert.ok(operation.appliedAt);

const result = readResult(operationsRoot, operationId);
assert.equal(result.files.length, INIT_TARGET_FILES.length);

const eventFile = path.join(planningRoot, "events", operation.expectedEvents[0].relativePath);
assert.ok(fs.existsSync(eventFile));

assert.equal(fs.existsSync(path.join(planningRoot, ".runtime", "operations", operationId)), false, "staging residue must be cleaned up on a normal successful apply");

assert.throws(() => applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" }), StateError, "re-applying an already-APPLIED operation must fail cleanly, never re-run the sequence");

{
  const deleteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-delete-"));
  const deleteOperationsRoot = path.join(deleteRoot, "operations");
  const sourceId = "018f0000-0000-7000-8000-000000000111";
  const sourceRelative = `sources/${sourceId}/source.yml`;
  fs.mkdirSync(path.join(deleteRoot, "sources", sourceId), { recursive: true });
  fs.writeFileSync(path.join(deleteRoot, sourceRelative), "schemaVersion: 1\n");

  const deleteOperationId = propose({
    operationsRoot: deleteOperationsRoot,
    planningRoot: deleteRoot,
    kind: "config.update",
    target: {},
    payload: { name: "delete-source" },
    targetFiles: [sourceRelative],
    actor: "carlos"
  });
  const renderDelete = () => new Map([[sourceRelative, null]]);
  validateOperation({ operationsRoot: deleteOperationsRoot, planningRoot: deleteRoot, operationId: deleteOperationId, render: renderDelete });
  approveOperation({ operationsRoot: deleteOperationsRoot, planningRoot: deleteRoot, operationId: deleteOperationId, actor: "carlos", allowSelfApproval: true });
  const deleteOutcome = applyOperation({ operationsRoot: deleteOperationsRoot, planningRoot: deleteRoot, operationId: deleteOperationId, render: renderDelete, actor: "carlos" });
  assert.equal(deleteOutcome.status, "APPLIED");
  assert.equal(fs.existsSync(path.join(deleteRoot, sourceRelative)), false, "delete file plan entries must remove canonical files");
  assert.deepEqual(readResult(deleteOperationsRoot, deleteOperationId).files, [{ target: sourceRelative, action: "delete", contentHash: "ABSENT" }]);
}

console.log("changeset-apply: all tests passed");
