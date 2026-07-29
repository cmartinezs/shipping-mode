import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../init.mjs";
import { runChangesetApprove, runChangesetApply, runChangesetValidate } from "../changesetCommand.mjs";
import { runReleaseNew, runReleaseStatus } from "../release.mjs";
import { readChangeSet, readOperation } from "../../lib/operationStore.mjs";
import { parseYaml, stringifyYaml } from "../../lib/yaml.mjs";
import { listReservedReleaseDocuments } from "../../lib/releaseStore.mjs";

function initializedWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "release-core-review-"));
  const planningRoot = path.join(workspace, ".planning");
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "release-review", vcs: "none", actor: "tester" } });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "tester", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "tester" });
  return { workspace, planningRoot, operationsRoot };
}

// The idempotency request is caller intent, not mutable Project Context defaults.
{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const first = runReleaseNew({ planningRoot, args: { title: "Stable retry", objective: "Survive policy drift", idempotencyKey: "stable-retry", actor: "tester" } });
  const firstChangeSet = readChangeSet(operationsRoot, first.operationId);
  assert.deepEqual(firstChangeSet.payload.requestSnapshot, { title: "Stable retry", objective: "Survive policy drift", laneId: null, policyMode: null, slug: null });
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.policies.release.defaultLane = "hotfix";
  config.policies.release.mode = "dependency_graph";
  fs.writeFileSync(configPath, stringifyYaml(config));
  const retry = runReleaseNew({ planningRoot, args: { title: "Stable retry", objective: "Survive policy drift", idempotencyKey: "stable-retry", actor: "tester" } });
  assert.equal(retry.operationId, first.operationId);
  assert.equal(retry.releaseId, first.releaseId);
  assert.equal(retry.idempotent, true);
  assert.throws(() => runReleaseNew({ planningRoot, args: { title: "Stable retry", objective: "Survive policy drift", laneId: "hotfix", idempotencyKey: "stable-retry", actor: "tester" } }), /different release\.create request/);
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: first.operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId: first.operationId, actor: "tester", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: first.operationId, actor: "tester" });
  const status = runReleaseStatus({ planningRoot, reference: first.releaseId });
  assert.equal(status.release.laneId, "main", "the original resolved policy snapshot must survive later config changes");
  assert.equal(status.release.policyMode, "strict_sequence");
  assert.deepEqual(status.refs.previousReleaseRefs, []);
  assert.deepEqual(status.refs.dependencyRefs, []);
}

// Pending release.create operations reserve their identities before canonical apply.
{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const pending = runReleaseNew({ planningRoot, args: { title: "Pending", objective: "Reserve identity", idempotencyKey: "pending-reservation", actor: "tester" } });
  const reservations = listReservedReleaseDocuments(operationsRoot);
  assert.ok(reservations.some((entry) => entry.id === pending.releaseId && entry.displayId === pending.displayId));
  assert.equal(readOperation(operationsRoot, pending.operationId).status, "PROPOSED");
}

// A corrupted pending release ChangeSet makes identity/idempotency state unknowable and must fail closed.
{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const pending = runReleaseNew({ planningRoot, args: { title: "Corrupt pending", objective: "Fail closed", idempotencyKey: "corrupt-key", actor: "tester" } });
  fs.writeFileSync(path.join(operationsRoot, pending.operationId, "change-set.json"), "{not-json\n");
  assert.throws(() => runReleaseNew({ planningRoot, args: { title: "Another release", objective: "Must not bypass corruption", idempotencyKey: "another-key", actor: "tester" } }), /cannot establish release\.create idempotency/);
}

console.log("release-core-review: caller-intent idempotency, locked identity reservations and complete status refs pass");
