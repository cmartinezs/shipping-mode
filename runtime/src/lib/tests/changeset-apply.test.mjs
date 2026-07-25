import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, applyOperation } from "../changeset.mjs";
import { renderWorkspaceInit } from "../../commands/renderers.mjs";
import { readOperation, readResult } from "../operationStore.mjs";
import { parseYaml } from "../yaml.mjs";
import { StateError } from "../errors.mjs";

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-"));
const operationsRoot = path.join(planningRoot, "operations");
const payload = { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` };

const operationId = propose({
  operationsRoot, planningRoot, kind: "workspace.init", target: {},
  payload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"], actor: "carlos"
});
validateOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit });
approveOperation({ operationsRoot, planningRoot, operationId, actor: "carlos", allowSelfApproval: true });

const outcome = applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
assert.equal(outcome.status, "APPLIED");
assert.equal(outcome.files.length, 3);

assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")).name, "demo");
assert.equal(fs.readFileSync(path.join(planningRoot, ".gitignore"), "utf8"), ".runtime/\n");

const operation = readOperation(operationsRoot, operationId);
assert.equal(operation.status, "APPLIED");
assert.ok(operation.appliedAt);

const result = readResult(operationsRoot, operationId);
assert.equal(result.files.length, 3);

const eventFile = path.join(planningRoot, "events", operation.expectedEvents[0].relativePath);
assert.ok(fs.existsSync(eventFile));

assert.equal(fs.existsSync(path.join(planningRoot, ".runtime", "operations", operationId)), false, "staging residue must be cleaned up on a normal successful apply");

assert.throws(() => applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" }), StateError, "re-applying an already-APPLIED operation must fail cleanly, never re-run the sequence");

console.log("changeset-apply: all tests passed");
