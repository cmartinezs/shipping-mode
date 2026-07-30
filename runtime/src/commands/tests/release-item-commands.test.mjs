import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../init.mjs";
import { runReleaseNew } from "../release.mjs";
import { runCheckItem, runItemCreate, runItemStatus } from "../item.mjs";
import { checkSchema, checkRelease } from "../check.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../changesetCommand.mjs";
import { readChangeSet, readOperation, writeChangeSet } from "../../lib/operationStore.mjs";
import { computePersistedChangeSetHash } from "../../lib/changeset.mjs";
import { parseYaml, stringifyYaml } from "../../lib/yaml.mjs";
import { generateUuidV7, isUuidV7 } from "../../lib/ids.mjs";
import { renderReleaseReadme } from "../../lib/releaseProjection.mjs";
import { renderReleaseItemReadme } from "../../lib/releaseItemProjection.mjs";
import { updateReleaseRevision } from "../../lib/releaseMutations.mjs";

function initializedWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-item-commands-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "items", vcs: "git", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos" });
  const release = runReleaseNew({ planningRoot, args: { title: "Release", objective: "Release Item tests", idempotencyKey: "release", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: release.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: release.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: release.operationId, actor: "carlos" });
  return { workspaceRoot, planningRoot, operationsRoot, release };
}

function createStory(planningRoot, operationsRoot, releaseRef, key, dependencies = "") {
  const proposal = runItemCreate({
    planningRoot,
    releaseRef,
    args: {
      kind: "user_story",
      title: `Story ${key}`,
      commandActor: "carlos",
      actor: "teacher",
      need: "create release items",
      value: "traceable scope",
      acceptanceCriteria: ["item is queryable"],
      dependencyRefs: dependencies,
      idempotencyKey: key
    }
  });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: proposal.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: proposal.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: proposal.operationId, actor: "carlos" });
  return proposal;
}

function tamperChangeSet(operationsRoot, operationId, mutate) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  mutate(changeSet);
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  writeChangeSet(operationsRoot, operationId, changeSet);
}

{
  const { planningRoot, operationsRoot, release } = initializedWorkspace();
  const proposal = runItemCreate({
    planningRoot,
    releaseRef: release.displayId,
    args: {
      kind: "user_story",
      title: "Manual story",
      description: "Created by item create",
      slug: "decorative-story",
      commandActor: "carlos",
      actor: "teacher",
      need: "plan item work",
      value: "safe decomposition",
      acceptanceCriteria: ["ChangeSet exists"],
      idempotencyKey: "manual-story"
    }
  });
  assert.ok(isUuidV7(proposal.itemId));
  assert.match(proposal.displayId, /^RI-[0-9A-HJKMNP-TV-Z]{8}$/);
  const itemPath = path.join(planningRoot, "releases", release.releaseId, "items", proposal.itemId, "release-item.yml");
  assert.equal(fs.existsSync(itemPath), false, "item create must only propose");
  const changeSet = readChangeSet(operationsRoot, proposal.operationId);
  assert.equal(changeSet.kind, "release-item.create");
  assert.equal(changeSet.payload.releaseId, release.releaseId);
  assert.equal(changeSet.payload.parentRevision, parseYaml(fs.readFileSync(path.join(planningRoot, "releases", release.releaseId, "release.yml"), "utf8")).audit.revision);
  assert.deepEqual(changeSet.payload.targetPaths.sort(), [`releases/${release.releaseId}/items/${proposal.itemId}/README.md`, `releases/${release.releaseId}/items/${proposal.itemId}/release-item.yml`].sort());
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposal.operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId: proposal.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: proposal.operationId, actor: "carlos" });
  assert.equal(fs.existsSync(itemPath), true);
  assert.equal(fs.existsSync(path.join(planningRoot, "releases", release.releaseId, "items", proposal.itemId, "README.md")), true);
  const item = parseYaml(fs.readFileSync(itemPath, "utf8"));
  assert.equal(item.releaseId, release.releaseId);
  assert.equal(item.status, "DRAFT");
  assert.equal(item.displayId, proposal.displayId);
  assert.deepEqual(item.sourceRefs, []);
  assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "releases", release.releaseId, "release.yml"), "utf8")).itemRefs.length, 0, "release.itemRefs is not mutated as a second source of truth");
  const event = readOperation(operationsRoot, proposal.operationId).expectedEvents[0];
  assert.equal(event.document.type, "release-item.created");
  assert.equal(event.document.aggregate.id, proposal.itemId);
  assert.equal(event.document.payload.releaseId, release.releaseId);
  assert.equal(event.document.payload.displayId, proposal.displayId);
  const status = runItemStatus({ planningRoot, releaseRef: release.displayId, itemRef: proposal.displayId });
  assert.equal(status.status, "FOUND");
  assert.equal(status.item.id, proposal.itemId);
  assert.equal(status.derivedHealth.completion.status, "unavailable");
  assert.equal(runCheckItem({ planningRoot, releaseRef: release.displayId, itemRef: proposal.displayId }).status, "PASS");
  const itemReadmePath = path.join(planningRoot, "releases", release.releaseId, "items", proposal.itemId, "README.md");
  fs.appendFileSync(itemReadmePath, "drift
");
  assert.equal(runItemStatus({ planningRoot, releaseRef: release.releaseId, itemRef: proposal.itemId }).status, "FOUND", "status resolution remains FOUND when live health fails");
  assert.equal(runCheckItem({ planningRoot, releaseRef: release.releaseId, itemRef: proposal.itemId }).status, "FAIL", "check item must expose health failure with a failing check status");
  fs.writeFileSync(itemReadmePath, renderReleaseItemReadme(item));
  const operationsBefore = fs.readdirSync(path.join(planningRoot, "operations")).length;
  runItemStatus({ planningRoot, releaseRef: release.releaseId, itemRef: proposal.itemId });
  runCheckItem({ planningRoot, releaseRef: release.releaseId, itemRef: proposal.itemId });
  checkSchema({ planningRoot });
  assert.equal(fs.readdirSync(path.join(planningRoot, "operations")).length, operationsBefore, "item status and checks must be query-only");
  const releaseCheck = checkRelease({ planningRoot, reference: release.releaseId });
  assert.equal(releaseCheck.releases[0].derivedHealth.dimensions.find((entry) => entry.id === "releaseItems").status, "valid");
  assert.equal(releaseCheck.releases[0].completion.complete, false);
}

{
  const { planningRoot, operationsRoot, release } = initializedWorkspace();
  const exact = runItemCreate({ planningRoot, releaseRef: release.releaseId, args: { kind: "spike", title: "Spike", question: "Q", timebox: "1d", expectedDecision: "D", idempotencyKey: "spike", commandActor: "carlos" } });
  const retry = runItemCreate({ planningRoot, releaseRef: release.releaseId, args: { kind: "spike", title: "Spike", question: "Q", timebox: "1d", expectedDecision: "D", idempotencyKey: "spike", commandActor: "carlos" } });
  assert.equal(retry.operationId, exact.operationId);
  assert.equal(retry.itemId, exact.itemId);
  const secondRelease = runReleaseNew({ planningRoot, args: { title: "Second Release", objective: "Idempotency target binding", idempotencyKey: "release-two", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: secondRelease.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: secondRelease.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: secondRelease.operationId, actor: "carlos" });
  assert.throws(
    () => runItemCreate({ planningRoot, releaseRef: secondRelease.releaseId, args: { kind: "spike", title: "Spike", question: "Q", timebox: "1d", expectedDecision: "D", idempotencyKey: "spike", commandActor: "carlos" } }),
    /idempotency key spike was already used for a different release-item\.create request/,
    "the same item intent under a different parent Release must not reuse the first Operation"
  );
  assert.throws(
    () => runItemCreate({ planningRoot, releaseRef: release.releaseId, args: { kind: "spike", title: "Different", question: "Q", timebox: "1d", expectedDecision: "D", idempotencyKey: "spike", commandActor: "carlos" } }),
    /idempotency key spike was already used for a different release-item\.create request/
  );
  tamperChangeSet(operationsRoot, exact.operationId, (changeSet) => {
    changeSet.payload.displayId = "RI-00000000";
  });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: exact.operationId }).status, "INVALID", "tampering server-owned display ID must be rejected even if public hash is recalculated");
}

{
  const { planningRoot, operationsRoot, release } = initializedWorkspace();
  const first = createStory(planningRoot, operationsRoot, release.releaseId, "first");
  const second = createStory(planningRoot, operationsRoot, release.releaseId, "second", first.itemId);
  assert.equal(runItemStatus({ planningRoot, releaseRef: release.releaseId, itemRef: second.displayId }).derivedHealth.aggregate.valid, true);
  assert.throws(
    () => runItemCreate({ planningRoot, releaseRef: release.releaseId, args: { kind: "user_story", title: "bad dep", commandActor: "carlos", actor: "teacher", need: "n", value: "v", acceptanceCriteria: ["a"], dependencyRefs: generateUuidV7(), idempotencyKey: "bad-dep" } }),
    /dependency .* does not resolve/
  );
  const firstPath = path.join(planningRoot, "releases", release.releaseId, "items", first.itemId, "release-item.yml");
  const firstDoc = parseYaml(fs.readFileSync(firstPath, "utf8"));
  firstDoc.dependencies = [second.itemId];
  fs.writeFileSync(firstPath, stringifyYaml(firstDoc));
  assert.equal(checkSchema({ planningRoot }).status, "FAIL", "dependency cycles must block schema health");
}

{
  const { planningRoot, operationsRoot, release } = initializedWorkspace();
  const releasePath = path.join(planningRoot, "releases", release.releaseId, "release.yml");
  const releaseDoc = parseYaml(fs.readFileSync(releasePath, "utf8"));
  const closed = updateReleaseRevision({ ...releaseDoc, status: "CANCELLED" });
  fs.writeFileSync(releasePath, stringifyYaml(closed));
  fs.writeFileSync(path.join(planningRoot, "releases", release.releaseId, "README.md"), renderReleaseReadme(closed));
  assert.throws(
    () => runItemCreate({ planningRoot, releaseRef: release.releaseId, args: { kind: "spike", title: "blocked", question: "Q", timebox: "1d", expectedDecision: "D", idempotencyKey: "blocked", commandActor: "carlos" } }),
    /allowed only for Release DRAFT/
  );
  assert.equal(fs.readdirSync(operationsRoot).filter((id) => readOperation(operationsRoot, id).kind === "release-item.create").length, 0);
}

console.log("release-item-commands: ChangeSet creation, idempotency, status, dependencies and parent guards pass");
