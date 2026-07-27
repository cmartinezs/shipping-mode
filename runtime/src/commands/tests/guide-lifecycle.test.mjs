import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../init.mjs";
import { runChangesetPropose, runChangesetValidate, runChangesetApprove, runChangesetApply } from "../changesetCommand.mjs";
import { readOperation } from "../../lib/operationStore.mjs";
import { parseYaml } from "../../lib/yaml.mjs";
import { validate } from "../../lib/schema.mjs";
import { checkSchema } from "../check.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "guide-lifecycle-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
const operationsRoot = path.join(planningRoot, "operations");
const sourceId = "018f0000-0000-7000-8000-000000000011";

function finish(operationId) {
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "carlos", allowSelfApproval: true });
  assert.equal(runChangesetApply({ planningRoot, operationsRoot, operationId, actor: "carlos" }).status, "APPLIED");
}

const init = runInit({ planningRoot, args: { name: "guide-demo", vcs: "git", actor: "carlos" } });
finish(init.operationId);

fs.mkdirSync(path.join(planningRoot, "sources", sourceId), { recursive: true });
fs.writeFileSync(path.join(planningRoot, "sources", sourceId, "source.yml"), `schemaVersion: 1\nid: ${sourceId}\npath: docs/guide.md\nfamily: technical-sources\nkind: testing\nrole: canonical\nauthority:\n  standing: authoritative\n  force: normative\navailability: implemented\nconfirmedFingerprint: ${"a".repeat(64)}\nconfirmedContentHash: ${"b".repeat(64)}\nprovenance:\n  discoveredBy: test\n  confirmedBy: test\n  confirmedAt: 2026-07-27T00:00:00Z\n  confirmedOperationId: ${init.operationId}\n`);

const scope = runChangesetPropose({
  planningRoot,
  kind: "scope.add",
  actor: "carlos",
  payloadText: JSON.stringify({ id: "018f0000-0000-7000-8000-000000000021", key: "api", label: "API", kind: "code", path: "src/" })
});
finish(scope.operationId);
const scopeId = "018f0000-0000-7000-8000-000000000021";

const document = {
  sourceRefs: [sourceId],
  sections: [{ id: "constraints", kind: "rules", required: true, entries: [{ key: "boundary", value: "api" }] }],
  openGaps: []
};

function proposeGuide(action, extra = {}) {
  return runChangesetPropose({
    planningRoot,
    kind: "guide.update",
    actor: "guide-agent",
    payloadText: JSON.stringify({ scopeId, guideKind: "task", action, ...extra })
  });
}

const generated = proposeGuide("generate", { document });
const generatedOperation = readOperation(operationsRoot, generated.operationId);
assert.equal(generatedOperation.kind, "guide.update");
finish(generated.operationId);

let scopeDocument = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(scopeDocument.guides.task.status, "generated");
assert.equal(scopeDocument.guides.task.scopeId, scopeId);
assert.equal(scopeDocument.guides.task.path, "task-guide.yml");
assert.ok(scopeDocument.guides.task.revision.startsWith("sha256:"));
assert.equal(scopeDocument.guides.task.approval, null);
assert.ok(parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "task-guide.yml"), "utf8")).id);
assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")).documentation.gaps.length, 1, "generation must not resolve the Corte 0 guide gap");

const reviewed = proposeGuide("submit_review");
finish(reviewed.operationId);
scopeDocument = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(scopeDocument.guides.task.status, "reviewed");

const approve = proposeGuide("approve");
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: approve.operationId }).status, "VALIDATED");
assert.throws(() => runChangesetApprove({ planningRoot, operationsRoot, operationId: approve.operationId, actor: "anything", mode: "autonomous" }), /human approval mode/);
runChangesetApprove({ planningRoot, operationsRoot, operationId: approve.operationId, actor: "reviewer", allowSelfApproval: false, mode: "human" });
assert.equal(runChangesetApply({ planningRoot, operationsRoot, operationId: approve.operationId, actor: "reviewer" }).status, "APPLIED");
scopeDocument = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(scopeDocument.guides.task.status, "approved");
assert.equal(scopeDocument.guides.task.approval.actor, "reviewer");
assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")).documentation.gaps.length, 1, "one approved guide is insufficient to resolve the Scope gap");

const stale = proposeGuide("mark_stale", { reason: "source drift detected" });
finish(stale.operationId);
scopeDocument = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(scopeDocument.guides.task.status, "stale");
assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")).documentation.gaps.length, 1, "staleness must restore the guide gap");

const regenerated = proposeGuide("regenerate", { document });
finish(regenerated.operationId);
scopeDocument = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(scopeDocument.guides.task.status, "generated");
const reviewedAgain = proposeGuide("submit_review");
finish(reviewedAgain.operationId);
const rejected = proposeGuide("reject", { reason: "insufficient source coverage" });
finish(rejected.operationId);
scopeDocument = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(scopeDocument.guides.task.status, "rejected");
const regeneratedAfterRejection = proposeGuide("regenerate", { document });
finish(regeneratedAfterRejection.operationId);
scopeDocument = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "scope.yml"), "utf8"));
assert.equal(scopeDocument.guides.task.status, "generated");

assert.equal(checkSchema({ planningRoot }).status, "PASS");
const guide = parseYaml(fs.readFileSync(path.join(planningRoot, "scopes", scopeId, "task-guide.yml"), "utf8"));
assert.equal(validate("guide", guide).valid, true);
assert.equal(fs.existsSync(path.join(planningRoot, "scopes", scopeId, "task-guide.md")), false, "Plan 1 must not create Markdown projections");

console.log("guide-lifecycle: schema, server-owned identity, finite transitions, human approval binding, gap retention, autonomous rejection, and query-only integrity pass");
