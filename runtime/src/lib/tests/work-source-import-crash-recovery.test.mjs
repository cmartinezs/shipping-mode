import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../commands/init.mjs";
import { runReleaseNew } from "../../commands/release.mjs";
import { runItemImport } from "../../commands/item.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../../commands/changesetCommand.mjs";
import { renderWorkSourceImportChangeSet } from "../../commands/renderers.mjs";
import { applyOperation } from "../changeset.mjs";
import { setFaultCheckpoint, clearFaultCheckpoint, SimulatedCrashError } from "../faultInjection.mjs";
import { recoverWorkspace } from "../mutation.mjs";
import { readOperation } from "../operationStore.mjs";
import { parseYaml, stringifyYaml } from "../yaml.mjs";

function approvedImportOperation() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "work-source-crash-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "work-source-crash", vcs: "git", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos" });

  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.work_sources = [{
    id: "local-backlog",
    provider: "local_repository",
    enabled: true,
    roots: ["backlog"],
    mapping_version: 1,
    import_policy: "import_snapshot",
    sync_mode: "import_only",
    capabilities: ["discover", "search", "get"],
    options: { file_globs: ["*.work-source.yml"], max_item_bytes: 65536 }
  }];
  fs.writeFileSync(configPath, stringifyYaml(config));
  fs.mkdirSync(path.join(workspaceRoot, "backlog"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "backlog", "story.work-source.yml"), stringifyYaml({
    schemaVersion: 1,
    id: "story-1",
    type: "user_story",
    title: "Crash import",
    description: { format: "plain", text: "Import must recover." },
    actor: "operator",
    need: "recoverable imports",
    value: "durable provenance",
    acceptanceCriteria: [{ id: "ac-1", text: "No duplicate event." }],
    status: "todo",
    priority: "medium"
  }));

  const release = runReleaseNew({ planningRoot, args: { title: "Release", objective: "Crash import", idempotencyKey: "release", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: release.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: release.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: release.operationId, actor: "carlos" });
  const imported = runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "import", commandActor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: imported.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: imported.operationId, actor: "carlos", allowSelfApproval: true });
  return { planningRoot, operationsRoot, operationId: imported.operationId, releaseId: release.releaseId, itemId: imported.itemId };
}

function crashAt(boundary, planningRoot, operationsRoot, operationId) {
  setFaultCheckpoint(boundary);
  assert.throws(
    () => applyOperation({ operationsRoot, planningRoot, operationId, render: (payload) => renderWorkSourceImportChangeSet(payload, planningRoot), actor: "carlos" }),
    SimulatedCrashError
  );
  clearFaultCheckpoint();
}

{
  const { planningRoot, operationsRoot, operationId, releaseId, itemId } = approvedImportOperation();
  const reservedEventId = readOperation(operationsRoot, operationId).reservedEvents[0].eventId;
  crashAt("AFTER_MANIFEST", planningRoot, operationsRoot, operationId);
  assert.equal(readOperation(operationsRoot, operationId).status, "APPROVED");
  const retry = applyOperation({ operationsRoot, planningRoot, operationId, render: (payload) => renderWorkSourceImportChangeSet(payload, planningRoot), actor: "carlos" });
  assert.equal(retry.status, "APPLIED");
  assert.equal(readOperation(operationsRoot, operationId).expectedEvents[0].eventId, reservedEventId);
  assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseId, "items", itemId, "release-item.yml")), true);
}

for (const boundary of ["AFTER_FIRST_RENAME", "AFTER_RESULT", "AFTER_FIRST_EVENT"]) {
  const { planningRoot, operationsRoot, operationId, releaseId, itemId } = approvedImportOperation();
  crashAt(boundary, planningRoot, operationsRoot, operationId);
  const outcomes = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(outcomes.find((entry) => entry.operationId === operationId)?.outcome, "COMPLETED");
  const operation = readOperation(operationsRoot, operationId);
  assert.equal(operation.status, "APPLIED");
  assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseId, "items", itemId, "release-item.yml")), true);
  const eventPath = path.join(planningRoot, "events", operation.expectedEvents[0].relativePath);
  assert.equal(fs.existsSync(eventPath), true);
  const eventBefore = fs.readFileSync(eventPath, "utf8");
  recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(fs.readFileSync(eventPath, "utf8"), eventBefore, "recovery must not duplicate or rewrite work-source.imported events");
  assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseId, "release.yml")), true, "import recovery must not remove or rewrite release.yml");
}

console.log("work-source-import-crash-recovery: import retries and recovers without duplicates");
