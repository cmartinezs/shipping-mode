import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../init.mjs";
import { runChangesetPropose, runChangesetValidate, runChangesetApprove, runChangesetApply } from "../changesetCommand.mjs";
import { parseYaml } from "../../lib/yaml.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "scope-generator-set-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
const operationsRoot = path.join(planningRoot, "operations");
function finish(operationId) {
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "reviewer", allowSelfApproval: true });
  assert.equal(runChangesetApply({ planningRoot, operationsRoot, operationId, actor: "reviewer" }).status, "APPLIED");
}
const init = runInit({ planningRoot, args: { name: "generator-config", vcs: "git", actor: "test-user" } }); finish(init.operationId);
const scopeId = "018f0000-0000-7000-8000-000000000021";
const scope = runChangesetPropose({ planningRoot, kind: "scope.add", actor: "test-user", payloadText: JSON.stringify({ id: scopeId, key: "api", label: "API", kind: "code", path: "src/" }) }); finish(scope.operationId);
fs.writeFileSync(path.join(workspace, "guide-generator.mjs"), "#!/usr/bin/env node\nprocess.stdout.write('{}');\n");
fs.chmodSync(path.join(workspace, "guide-generator.mjs"), 0o755);
const set = runChangesetPropose({ planningRoot, kind: "scope.generator.set", actor: "test-user", payloadText: JSON.stringify({ scopeId, guideKind: "task", generator: { version: "1.0.0", executable: "guide-generator.mjs", args: [], timeoutMs: 1000, maxOutputBytes: 4096 } }) });
finish(set.operationId);
let persisted = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(persisted.customGenerators.task.version, "1.0.0");
const remove = runChangesetPropose({ planningRoot, kind: "scope.generator.set", actor: "test-user", payloadText: JSON.stringify({ scopeId, guideKind: "task", generator: null }) });
finish(remove.operationId);
persisted = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(persisted.customGenerators, undefined);
console.log("scope-generator-set: narrow ChangeSet configuration and removal pass");
