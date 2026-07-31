import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BRIDGE_RESULT_CODES,
  loadBridgeState,
  prepareBridgeRequest
} from "../bridge-verified.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const successHook = path.resolve(testDir, "../capture-post-tool-use.mjs");
const failureHook = path.resolve(testDir, "../capture-post-tool-failure.mjs");

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-mode-hook-cli-"));
  const projectRoot = path.join(root, "project");
  const dataRoot = path.join(root, "plugin-data");
  fs.mkdirSync(projectRoot, { recursive: true });
  return { projectRoot, dataRoot };
}

function prepare({ projectRoot, dataRoot, sessionId }) {
  return prepareBridgeRequest({
    dataRoot,
    env: { CLAUDE_CODE_SESSION_ID: sessionId },
    operation: "get",
    server: "p4fs",
    tool: "mcp__p4fs__read_text_file",
    projectRoot,
    expectedInput: { path: path.join(projectRoot, "package.json") }
  });
}

function runHook(script, dataRoot, sessionId, event) {
  return spawnSync(process.execPath, [script, "--plugin-data-dir", dataRoot], {
    encoding: "utf8",
    input: JSON.stringify(event),
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ID: sessionId,
      CLAUDE_PLUGIN_DATA: ""
    }
  });
}

function baseEvent(prepared, projectRoot, sessionId) {
  return {
    session_id: sessionId,
    cwd: projectRoot,
    tool_name: prepared.toolName,
    tool_input: prepared.toolInput,
    tool_use_id: `toolu-${sessionId}`,
    duration_ms: 7
  };
}

test("PostToolUse hook captures through explicit plugin data argument when env export is absent", () => {
  const { projectRoot, dataRoot } = workspace();
  const sessionId = "session-success-hook-cli";
  const prepared = prepare({ projectRoot, dataRoot, sessionId });
  const result = runHook(successHook, dataRoot, sessionId, {
    ...baseEvent(prepared, projectRoot, sessionId),
    tool_response: { content: [{ type: "text", text: "readonly result" }], isError: false }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /shipping-mode bridge captured/);
  const state = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  assert.equal(state.envelope?.status, "CAPTURED");
  assert.equal(state.request?.capture?.sessionId, sessionId);
});

test("PostToolUseFailure hook records normalized failure through explicit plugin data argument", () => {
  const { projectRoot, dataRoot } = workspace();
  const sessionId = "session-failure-hook-cli";
  const prepared = prepare({ projectRoot, dataRoot, sessionId });
  const result = runHook(failureHook, dataRoot, sessionId, {
    ...baseEvent(prepared, projectRoot, sessionId),
    error: "Access denied outside allowed directories",
    is_interrupt: false
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /shipping-mode bridge BRIDGE_UNAVAILABLE/);
  const state = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  assert.equal(state.envelope, null);
  assert.equal(state.request?.failure?.code, BRIDGE_RESULT_CODES.UNAVAILABLE);
  assert.equal("error" in state.request.failure, false);
});
