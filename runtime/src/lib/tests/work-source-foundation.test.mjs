import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../commands/init.mjs";
import { runReleaseNew } from "../../commands/release.mjs";
import { proposeReleaseItemCreate, runItemImport } from "../../commands/item.mjs";
import { checkWorkSources } from "../../commands/check.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../../commands/changesetCommand.mjs";
import { readChangeSet, readOperation, writeChangeSet } from "../operationStore.mjs";
import { computePersistedChangeSetHash } from "../changeset.mjs";
import { parseYaml, stringifyYaml } from "../yaml.mjs";
import { buildWorkSourceRegistry } from "../workSourceProvider.mjs";
import { LocalRepositoryWorkSource } from "../localRepositoryWorkSource.mjs";
import { normalizeWorkSourceConfig, validateNormalizedWorkSourceItem } from "../workSourceImport.mjs";
import { validate } from "../schema.mjs";

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
    actor: "teacher",
    need: "an assessment brief",
    value: "consistent evaluation instructions",
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
    () => buildWorkSourceRegistry({ providerFactories: [() => ({ provider: "local_repository", contractVersion: 1, capabilities: ["discover"], discover() {} }), () => ({ provider: "local_repository", contractVersion: 1, capabilities: ["discover"], discover() {} })], sources: [] }),
    /duplicate Work Source provider/
  );
  assert.throws(
    () => buildWorkSourceRegistry({ providerFactories: [() => ({ provider: "broken", contractVersion: 1, capabilities: ["discover", "create"], discover() {} })], sources: [{ id: "source-a", provider: "broken", enabled: true, capabilities: ["create"], mapping_version: 1, import_policy: "import_snapshot", sync_mode: "import_only", options: {} }] }),
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


{
  const { workspaceRoot, planningRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  assert.throws(() => proposeReleaseItemCreate({
    planningRoot,
    releaseRef: release.releaseId,
    actor: "carlos",
    rawPayload: {
      kind: "user_story",
      title: "Forged provenance",
      actor: "teacher",
      need: "traceability",
      value: "trust",
      acceptanceCriteria: ["provenance is genuine"],
      sourceRefs: [{ sourceId: "forged", provider: "local_repository", role: "primary", itemId: "forged-1", path: "forged.yml", contentRevision: `sha256:${"a".repeat(64)}`, mappingVersion: 1 }]
    }
  }), /server-owned: sourceRefs/);
}

{
  const { workspaceRoot, planningRoot, operationsRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const proposed = runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "closed-schema", commandActor: "carlos" } });
  const changeSet = readChangeSet(operationsRoot, proposed.operationId);
  changeSet.payload.untrusted = true;
  assert.equal(validate("change-set", changeSet).valid, false, "work-source.import payload must remain closed");
}

{
  const { workspaceRoot, planningRoot, operationsRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const proposed = runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "config-stale", commandActor: "carlos" } });
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.work_sources[0].options.max_item_bytes = 65535;
  fs.writeFileSync(configPath, stringifyYaml(config));
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposed.operationId }).status, "STALE", "any Work Source configuration drift must stale the proposal");
}

{
  const { workspaceRoot, planningRoot } = initializedWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "real-backlog"), { recursive: true });
  fs.symlinkSync(path.join(workspaceRoot, "real-backlog"), path.join(workspaceRoot, "linked-backlog"), "dir");
  configureLocalSource(planningRoot, { roots: ["linked-backlog"] });
  assert.throws(() => normalizeWorkSourceConfig({ config: parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")), workspaceRoot }), /symlink component rejected/);
}

{
  const { workspaceRoot, planningRoot } = initializedWorkspace();
  configureLocalSource(planningRoot, { roots: ["."], options: { file_globs: ["*"], max_item_bytes: 65536 } });
  writeLocalItem(workspaceRoot);
  fs.writeFileSync(path.join(planningRoot, "internal.work-source.yml"), stringifyYaml({
    schemaVersion: 1, id: "internal", type: "user_story", title: "Internal", description: "must be ignored", actor: "runtime", need: "privacy", value: "isolation", acceptanceCriteria: ["ignored"], status: "todo", priority: "low"
  }));
  const result = checkWorkSources({ planningRoot, workspaceRoot });
  assert.equal(result.status, "FAIL", "the workspace root is rejected before provider discovery");
  assert.match(result.findings.join("\n"), /SOURCE_MISCONFIGURED/);
}

{
  const { workspaceRoot, planningRoot } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot, "invalid.work-source.yml", { actor: undefined });
  const result = checkWorkSources({ planningRoot, workspaceRoot });
  assert.equal(result.status, "FAIL", "check work-sources must execute provider discovery and expose invalid source items");
  assert.match(result.findings.join("\n"), /actor must be a non-blank string/);
}

{
  const { workspaceRoot, planningRoot, operationsRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const imported = runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "move-1", commandActor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: imported.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: imported.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: imported.operationId, actor: "carlos" });
  fs.renameSync(path.join(workspaceRoot, "backlog", "story.work-source.yml"), path.join(workspaceRoot, "backlog", "moved.work-source.yml"));
  assert.throws(() => runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "move-2", commandActor: "carlos" } }), /already imported as primary/, "stable local item id must survive path moves");
}

{
  const external = {
    schemaVersion: 1,
    sourceId: "jira-gradeops",
    provider: "jira",
    itemId: "GRADE-142",
    url: "https://example.invalid/browse/GRADE-142",
    type: "capability",
    title: "External capability",
    description: { format: "plain", text: "External normalized item" },
    acceptanceCriteria: [{ id: "ac-1", text: "It imports" }],
    status: { normalized: "todo", providerStatus: "To Do" },
    priority: { normalized: "high", providerPriority: "High" },
    labels: [], relationships: [], dependencies: [], assignee: null, owner: null,
    fields: { outcome: "Imported capability", behavior: "Preserve provider-neutral semantics" },
    revision: { externalRevision: "10042", updatedAt: "2026-07-30T00:00:00Z" },
    mappingVersion: 1, metadata: {},
    trace: { kind: "external", externalId: "GRADE-142", observedAt: "2026-07-30T00:00:00Z", responseFingerprint: `sha256:${"a".repeat(64)}`, evidence: { responseBytes: 1024, bounded: true } }
  };
  assert.equal(validateNormalizedWorkSourceItem(external).valid, true, "normalized schema must remain usable by the future Jira adapter without local revision fields");
  assert.equal(validateNormalizedWorkSourceItem({ ...external, description: null }).valid, true, "external providers may expose nullable description without fabricated text");
  assert.equal(validateNormalizedWorkSourceItem({ ...external, acceptanceCriteria: [] }).valid, false, "capability still requires acceptance criteria");
  const defect = {
    ...external,
    type: "defect",
    acceptanceCriteria: [],
    fields: { observedBehavior: "wrong output", expectedBehavior: "right output", reproduction: "open issue", severity: "high" }
  };
  assert.equal(validateNormalizedWorkSourceItem(defect).valid, true, "non-story/capability kinds may have empty acceptance criteria");
  assert.equal(validateNormalizedWorkSourceItem({ ...external, trace: { ...external.trace, rawJiraPayload: { key: "GRADE-142" } } }).valid, false, "external trace must reject raw Jira payload fields");
  assert.equal(validateNormalizedWorkSourceItem({ ...external, trace: { ...external.trace, evidence: { bearerToken: "secret" } } }).valid, false, "external trace evidence must reject secret-like keys");
  assert.equal(validateNormalizedWorkSourceItem({ ...external, trace: { ...external.trace, evidence: { items: Array.from({ length: 33 }, (_, index) => index) } } }).valid, false, "external trace evidence must remain bounded");
}

console.log("work-source-foundation: registry, local provider, import, stale detection and checks pass");
