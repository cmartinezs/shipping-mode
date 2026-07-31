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
import { prepareHostWorkSourceInvocation, resumeHostWorkSourceInvocation, cleanupExpiredHostWorkSourceInvocations } from "../hostWorkSourceInvocation.mjs";

function workspace() {
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
  fs.writeFileSync(configPath, stringifyYaml(config));
  return { workspaceRoot, planningRoot, operationsRoot, release };
}

const env = { CLAUDE_CODE_SESSION_ID: "session-a" };
const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-mode-plugin-data-"));
const { workspaceRoot, planningRoot, operationsRoot, release } = workspace();
const command = "item";
const args = ["import", release.releaseId, "--source", "jira-gradeops:GRADE-142", "--actor", "tester"];
const beforePlanning = fs.readdirSync(planningRoot, { recursive: true }).sort();
const prepared = prepareHostWorkSourceInvocation({ command, args, cwd: workspaceRoot, pluginDataDir, env, now: new Date("2026-07-30T12:00:00.000Z") });
assert.equal(prepared.status, "HOST_INVOCATION_PREPARED");
assert.equal(prepared.actions.length, 1);
assert.equal(prepared.actions[0].toolName, "mcp__atlassian__jira_get_issue");
assert.deepEqual(fs.readdirSync(planningRoot, { recursive: true }).sort(), beforePlanning, "prepare must not write under .planning");

const issue = {
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
capturePostToolUseEvent({
  dataRoot: pluginDataDir,
  env,
  rawEvent: {
    session_id: "session-a",
    cwd: workspaceRoot,
    tool_name: prepared.actions[0].toolName,
    tool_use_id: "toolu_host_1",
    tool_input: prepared.actions[0].input,
    tool_response: issue
  },
  now: new Date("2026-07-30T12:00:01.000Z")
});

const resumed = resumeHostWorkSourceInvocation({ invocationId: prepared.invocationId, command, args, cwd: workspaceRoot, pluginDataDir, env, now: new Date("2026-07-30T12:00:02.000Z") });
assert.equal(resumed.status, "HOST_INVOCATION_RESUMED");
assert.equal(resumed.result.operationStatus, "PROPOSED");
assert.equal(fs.existsSync(path.join(planningRoot, "operations", resumed.result.operationId)), true);
assert.equal(readChangeSet(operationsRoot, resumed.result.operationId).kind, "work-source.import");
assert.throws(() => resumeHostWorkSourceInvocation({ invocationId: prepared.invocationId, command, args, cwd: workspaceRoot, pluginDataDir, env }), /HOST_INVOCATION_REPLAYED|BRIDGE_REPLAYED/);

const expired = prepareHostWorkSourceInvocation({ command, args, cwd: workspaceRoot, pluginDataDir, env, now: new Date("2026-07-30T12:10:00.000Z"), ttlMs: 1 });
assert.throws(() => resumeHostWorkSourceInvocation({ invocationId: expired.invocationId, command, args, cwd: workspaceRoot, pluginDataDir, env, now: new Date("2026-07-30T12:10:01.000Z") }), /expired/i);
assert.equal(cleanupExpiredHostWorkSourceInvocations({ pluginDataDir, now: new Date("2026-07-30T12:10:02.000Z") }).expiredInvocations >= 1, true);

console.log("host-work-source-invocation: prepare/capture/resume lifecycle pass");
