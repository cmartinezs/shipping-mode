import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../commands/init.mjs";
import { runReleaseNew } from "../../commands/release.mjs";
import { runItemImport } from "../../commands/item.mjs";
import { checkWorkSources } from "../../commands/check.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../../commands/changesetCommand.mjs";
import { readChangeSet, readOperation, writeChangeSet } from "../operationStore.mjs";
import { computePersistedChangeSetHash } from "../changeset.mjs";
import { parseYaml, stringifyYaml } from "../yaml.mjs";
import { buildWorkSourceRegistry } from "../workSourceProvider.mjs";
import { LocalRepositoryWorkSource } from "../localRepositoryWorkSource.mjs";
import { normalizeWorkSourceConfig, validateNormalizedWorkSourceItem } from "../workSourceImport.mjs";

function initializedWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "work-source-foundation-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "work-sources", vcs: "git", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "carlos" });
  const release = runReleaseNew({ planningRoot, args: { title: "Release", objective: "Import local work", idempotencyKey: "release", actor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: release.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: release.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: release.operationId, actor: "carlos" });
  return { workspaceRoot, planningRoot, operationsRoot, release };
}

function configureLocalSource(planningRoot, source = {}) {
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
    options: { file_globs: ["*.work-source.yml"], max_item_bytes: 65536 },
    ...source
  }];
  fs.writeFileSync(configPath, stringifyYaml(config));
}

function writeLocalItem(workspaceRoot, fileName = "story.work-source.yml", overrides = {}) {
  const backlog = path.join(workspaceRoot, "backlog");
  fs.mkdirSync(backlog, { recursive: true });
  const document = {
    schemaVersion: 1,
    id: "story-1",
    type: "user_story",
    title: "Import assessment brief",
    description: { format: "markdown", text: "As a teacher I need an assessment brief." },
    acceptanceCriteria: [{ id: "ac-1", text: "The brief is persisted." }],
    status: "todo",
    priority: "high",
    labels: ["assessment"],
    relationships: [{ type: "related", target: "requirement-1" }],
    dependencies: [{ type: "blocks", target: "story-0" }],
    owner: "academics",
    metadata: { trace: "fixture" },
    ...overrides
  };
  fs.writeFileSync(path.join(backlog, fileName), stringifyYaml(document));
  return document;
}

{
  assert.throws(
    () => buildWorkSourceRegistry({ providerFactories: [() => ({ provider: "local_repository", capabilities: ["discover"], discover() {} }), () => ({ provider: "local_repository", capabilities: ["discover"], discover() {} })], sources: [] }),
    /duplicate Work Source provider/
  );
  assert.throws(
    () => buildWorkSourceRegistry({ providerFactories: [() => ({ provider: "broken", capabilities: ["discover", "create"], discover() {} })], sources: [{ id: "source-a", provider: "broken", enabled: true, capabilities: ["create"], mapping_version: 1, import_policy: "import_snapshot", sync_mode: "import_only", options: {} }] }),
    /declares capability create without implementation/
  );
}

{
  const { workspaceRoot, planningRoot } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const config = parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"));
  const sources = normalizeWorkSourceConfig({ config, workspaceRoot });
  assert.equal(sources[0].id, "local-backlog");
  const registry = buildWorkSourceRegistry({ providerFactories: [() => new LocalRepositoryWorkSource({ workspaceRoot })], sources });
  assert.deepEqual(registry.listSources().map((source) => source.id), ["local-backlog"]);
  const provider = registry.resolve("local-backlog", "get");
  const discovered = provider.discover({ source: sources[0] });
  assert.deepEqual(discovered.items.map((item) => item.itemId), ["story-1"]);
  const searched = provider.search({ source: sources[0], query: "assessment" });
  assert.deepEqual(searched.items.map((item) => item.itemId), ["story-1"]);
  const normalized = provider.get({ source: sources[0], itemRef: "story-1" }).item;
  assert.equal(normalized.sourceId, "local-backlog");
  assert.equal(normalized.provider, "local_repository");
  assert.equal(normalized.type, "user_story");
  assert.equal(validateNormalizedWorkSourceItem(normalized).valid, true);
  assert.equal(Object.hasOwn(normalized, "rawPayload"), false);
}

{
  const { workspaceRoot, planningRoot, operationsRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const proposed = runItemImport({
    planningRoot,
    releaseRef: release.releaseId,
    args: { sourceRef: "local-backlog:story-1", idempotencyKey: "import-story-1", commandActor: "carlos" }
  });
  const retry = runItemImport({
    planningRoot,
    releaseRef: release.releaseId,
    args: { sourceRef: "local-backlog:story-1", idempotencyKey: "import-story-1", commandActor: "carlos" }
  });
  assert.equal(retry.operationId, proposed.operationId);
  assert.equal(retry.itemId, proposed.itemId);
  assert.equal(proposed.operationStatus, "PROPOSED");
  const changeSet = readChangeSet(operationsRoot, proposed.operationId);
  assert.equal(changeSet.kind, "work-source.import");
  assert.equal(changeSet.payload.source.sourceId, "local-backlog");
  assert.equal(changeSet.payload.normalizedItem.itemId, "story-1");
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposed.operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId: proposed.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: proposed.operationId, actor: "carlos" });
  const item = parseYaml(fs.readFileSync(path.join(planningRoot, "releases", release.releaseId, "items", proposed.itemId, "release-item.yml"), "utf8"));
  assert.equal(item.kind, "user_story");
  assert.equal(item.sourceRefs.length, 1);
  assert.equal(item.sourceRefs[0].role, "primary");
  assert.equal(item.sourceRefs[0].sourceId, "local-backlog");
  assert.equal(item.sourceRefs[0].path, "backlog/story.work-source.yml");
  assert.match(item.sourceRefs[0].importedAt, /^\d{4}-\d{2}-\d{2}T/);
  const event = readOperation(operationsRoot, proposed.operationId).expectedEvents[0].document;
  assert.equal(event.type, "work-source.imported");
  assert.equal(event.payload.sourceItemRef, "story-1");
  assert.equal(event.payload.sourceRevision, item.sourceRefs[0].contentRevision);

  assert.throws(
    () => runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "import-story-1-other", commandActor: "carlos" } }),
    /already imported as primary/
  );
}

{
  const { workspaceRoot, planningRoot, operationsRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const proposed = runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "stale", commandActor: "carlos" } });
  writeLocalItem(workspaceRoot, "story.work-source.yml", { title: "Changed title" });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposed.operationId }).status, "STALE");
}

{
  const { workspaceRoot, planningRoot, operationsRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const proposed = runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "tamper", commandActor: "carlos" } });
  const changeSet = readChangeSet(operationsRoot, proposed.operationId);
  changeSet.payload.source.sourceId = "other";
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  writeChangeSet(operationsRoot, proposed.operationId, changeSet);
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposed.operationId }).status, "INVALID", "server-owned source resolution tampering must be rejected even with recomputed hash");
}

{
  const { workspaceRoot, planningRoot } = initializedWorkspace();
  configureLocalSource(planningRoot, { roots: ["../outside"] });
  assert.throws(() => normalizeWorkSourceConfig({ config: parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")), workspaceRoot }), /root must remain inside the workspace/);
  configureLocalSource(planningRoot, { roots: [".planning"] });
  assert.throws(() => normalizeWorkSourceConfig({ config: parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")), workspaceRoot }), /must not point inside \.planning/);
  configureLocalSource(planningRoot, { enabled: false });
  const before = fs.readdirSync(path.join(planningRoot, "operations")).length;
  const result = checkWorkSources({ planningRoot, workspaceRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.sources[0].enabled, false);
  assert.equal(fs.readdirSync(path.join(planningRoot, "operations")).length, before, "check work-sources must be query-only");
}

console.log("work-source-foundation: registry, local provider, import, stale detection and checks pass");
