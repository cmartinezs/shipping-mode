import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../init.mjs";
import { runChangesetApprove, runChangesetApply, runChangesetValidate } from "../changesetCommand.mjs";
import { checkGuides } from "../checkGuides.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "check-guides-"));
const planningRoot = path.join(workspace, ".planning");
const operationsRoot = path.join(planningRoot, "operations");
const init = runInit({ planningRoot, args: { name: "check-guides", vcs: "none", actor: "tester" } });
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId }).status, "VALIDATED");
runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "tester", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "tester" });

const configPath = path.join(planningRoot, "config.yml");
const before = fs.readFileSync(configPath);
const beforeMtime = fs.statSync(configPath).mtimeMs;
const result = checkGuides({ planningRoot, workspaceRoot: workspace, policyMode: "strict" });
assert.equal(result.status, "PASS");
assert.deepEqual(fs.readFileSync(configPath), before, "check guides must not rewrite config");
assert.equal(fs.statSync(configPath).mtimeMs, beforeMtime, "check guides must be query-only");
assert.equal(fs.readdirSync(operationsRoot).length, 1, "check guides must not create an operation");
console.log("check-guides: initialized workspace, query-only behavior and stable PASS pass");
