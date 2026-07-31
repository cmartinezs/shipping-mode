import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../commands/init.mjs";
import { runReleaseNew } from "../../commands/release.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../../commands/changesetCommand.mjs";
import { parseYaml, stringifyYaml } from "../yaml.mjs";
import { readChangeSet } from "../operationStore.mjs";
import { capturePostToolUseEvent } from "../../../../spikes/host-mcp-bridge/bridge-verified.mjs";
import { consumeBridgeEnvelope } from "../../../../spikes/host-mcp-bridge/bridge-consume.mjs";
import { prepareHostWorkSourceInvocation, resumeHostWorkSourceInvocation, cleanupExpiredHostWorkSourceInvocations } from "../hostWorkSourceInvocation.mjs";

function workspace({ includeLocal = false } = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "host-work-source-invocation-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  const init = runInit({ planningRoot, args: { name: "host", vcs: "git", actor: "tester" } });
  const operationsRoot = path.join(planningRoot, "operations");
  runChangesetValidate({ planningRoot, operationsRoot, operationId: init.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: init.operationId, actor: "tester", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: init.operationId, actor: "tester" });
  const release = runReleaseNew({ planningRoot, args: { title: "Host Release", objective: "Host orchestration", idempotencyKey: "release", actor: "tester" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: release.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: release.operationId, actor: "tester", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: release.operationId, actor: "tester" });
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.work_sources = [{
    id: "jira-gradeops",
    provider: "jira",
    transport: "mcp",
    enabled: true,
    connection_ref: "atlassian",
    mapping_version: 1,
    mapping_profile: "jira-gradeops-v1",
    import_policy: "external_authoritative",
    sync_mode: "pull",
    capabilities: ["discover", "search", "get"],
    options: {
      project_keys: ["GRADE"],
      query_scope: { mode: "project_keys_and_text", max_results: 50 },
      allowed_issue_types: ["Story"],
      field_map: {
        Story: { kind: "user_story", actor: "customfield_10101", need: "customfield_10102", value: "customfield_10103", acceptanceCriteria: "customfield_10104" }
      }
    }
  }];
  if (includeLocal) {
    fs.mkdirSync(path.join(workspaceRoot, "local-items"));
    config.work_sources.push({
      id: "local-items",
      provider: "local_repository",
      enabled: true,
      roots: ["local-items"],
      import_policy: "import_snapshot",
      sync_mode: "import_only",
      mapping_version: 1,
      capabilities: ["discover", "search", "get"],
      options: { file_globs: ["**/*.md"], max_item_bytes: 65536 }
    });
  }
  fs.writeFileSync(configPath, stringifyYaml(config));
  return { workspaceRoot, planningRoot, operationsRoot, release };
}

const env = {
  CLAUDE_CODE_SESSION_ID: "session-a",
  SHIPPING_MODE_ATLASSIAN_CLOUD_ID: "11111111-2222-4333-8444-555555555555"
};

function issueResponse() {
  return {
    id: "10042",
    key: "GRADE-142",
    fields: {
      summary: "Import assessment brief",
      description: "Import an assessment brief from Jira.",
      issuetype: { name: "Story" },
      status: { name: "To Do" },
      priority: { name: "High" },
      labels: ["assessment"],
      updated: "2026-07-30T12:00:01.000Z",
      customfield_10101: "teacher",
      customfield_10102: "assessment brief",
      customfield_10103: "consistent grading",
      customfield_10104: ["The brief imports"]
    }
  };
}

function capture({ prepared, pluginDataDir, workspaceRoot, toolUseId = "toolu_host_1", now = "2026-07-30T12:00:01.000Z" }) {
  capturePostToolUseEvent({
    dataRoot: pluginDataDir,
    env,
    rawEvent: {
      session_id: env.CLAUDE_CODE_SESSION_ID,
      cwd: workspaceRoot,
      tool_name: prepared.actions[0].toolName,
      tool_use_id: toolUseId,
      tool_input: prepared.actions[0].input,
      tool_response: issueResponse()
    },
    now: new Date(now)
  });
}

const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-mode-plugin-data-"));
const { workspaceRoot, planningRoot, operationsRoot, release } = workspace();
const command = "item";
const args = ["import", release.releaseId, "--source", "jira-gradeops:GRADE-142", "--actor", "tester"];
const beforePlanning = fs.readdirSync(planningRoot, { recursive: true }).sort();
const prepared = prepareHostWorkSourceInvocation({ command, args, cwd: workspaceRoot, pluginDataDir, env, now: new Date("2026-07-30T12:00:00.000Z") });
assert.equal(prepared.status, "HOST_INVOCATION_PREPARED");
assert.equal(prepared.actions.length, 1);
assert.equal(prepared.actions[0].toolName, "mcp__atlassian__getJiraIssue");
assert.equal(prepared.actions[0].input.cloudId, env.SHIPPING_MODE_ATLASSIAN_CLOUD_ID);
assert.deepEqual(fs.readdirSync(planningRoot, { recursive: true }).sort(), beforePlanning, "prepare must not write under .planning");

capture({ prepared, pluginDataDir, workspaceRoot });
const resumed = resumeHostWorkSourceInvocation({ invocationId: prepared.invocationId, command, args, cwd: workspaceRoot, pluginDataDir, env, now: new Date("2026-07-30T12:00:02.000Z") });
assert.equal(resumed.status, "HOST_INVOCATION_RESUMED");
assert.equal(resumed.result.operationStatus, "PROPOSED");
assert.equal(fs.existsSync(path.join(planningRoot, "operations", resumed.result.operationId)), true);
assert.equal(readChangeSet(operationsRoot, resumed.result.operationId).kind, "work-source.import");
assert.throws(() => resumeHostWorkSourceInvocation({ invocationId: prepared.invocationId, command, args, cwd: workspaceRoot, pluginDataDir, env }), /HOST_INVOCATION_REPLAYED/);

const recoveryPluginData = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-mode-plugin-recovery-"));
const recoveryWorkspace = workspace();
const recoveryArgs = ["import", recoveryWorkspace.release.releaseId, "--source", "jira-gradeops:GRADE-142", "--actor", "tester"];
const recoveryPrepared = prepareHostWorkSourceInvocation({ command, args: recoveryArgs, cwd: recoveryWorkspace.workspaceRoot, pluginDataDir: recoveryPluginData, env, now: new Date("2026-07-30T12:05:00.000Z") });
capture({ prepared: recoveryPrepared, pluginDataDir: recoveryPluginData, workspaceRoot: recoveryWorkspace.workspaceRoot, toolUseId: "toolu_recovery", now: "2026-07-30T12:05:01.000Z" });
consumeBridgeEnvelope({ dataRoot: recoveryPluginData, env, sessionId: env.CLAUDE_CODE_SESSION_ID, requestId: recoveryPrepared.actions[0].requestId, projectRoot: recoveryWorkspace.workspaceRoot, now: new Date("2026-07-30T12:05:02.000Z") });
const recovered = resumeHostWorkSourceInvocation({ invocationId: recoveryPrepared.invocationId, command, args: recoveryArgs, cwd: recoveryWorkspace.workspaceRoot, pluginDataDir: recoveryPluginData, env, now: new Date("2026-07-30T12:05:03.000Z") });
assert.equal(recovered.status, "HOST_INVOCATION_RESUMED", "resume must recover when the bridge envelope was already consumed before invocation state advanced");
assert.equal(recovered.result.operationStatus, "PROPOSED");

const localPluginData = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-mode-plugin-local-"));
const localWorkspace = workspace({ includeLocal: true });
const localBefore = fs.readdirSync(localWorkspace.planningRoot, { recursive: true }).sort();
const localPrepared = prepareHostWorkSourceInvocation({
  command,
  args: ["import", localWorkspace.release.releaseId, "--source", "local-items:sample.md", "--actor", "tester"],
  cwd: localWorkspace.workspaceRoot,
  pluginDataDir: localPluginData,
  env,
  now: new Date("2026-07-30T12:07:00.000Z")
});
assert.equal(localPrepared.status, "HOST_INVOCATION_NOT_REQUIRED");
assert.deepEqual(fs.readdirSync(localWorkspace.planningRoot, { recursive: true }).sort(), localBefore, "host PREPARE must never execute a local import");

const expired = prepareHostWorkSourceInvocation({ command, args, cwd: workspaceRoot, pluginDataDir, env, now: new Date("2026-07-30T12:10:00.000Z"), ttlMs: 1 });
assert.throws(() => resumeHostWorkSourceInvocation({ invocationId: expired.invocationId, command, args, cwd: workspaceRoot, pluginDataDir, env, now: new Date("2026-07-30T12:10:01.000Z") }), /expired/i);
assert.equal(cleanupExpiredHostWorkSourceInvocations({ pluginDataDir, now: new Date("2026-07-30T12:10:02.000Z") }).expiredInvocations >= 1, true);

console.log("host-work-source-invocation: prepare/capture/recovery/resume lifecycle pass");
