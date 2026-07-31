import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BRIDGE_RESULT_CODES,
  BridgeError,
  bridgeRoot,
  capturePostToolUseEvent,
  consumeBridgeEnvelope,
  ensureBridgeKey,
  loadBridgeState,
  prepareBridgeRequest,
  signEnvelope,
  writeJsonAtomic
} from "../bridge-core.mjs";

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-mode-bridge-adv-"));
  const projectRoot = path.join(root, "project");
  const dataRoot = path.join(root, "plugin-data");
  fs.mkdirSync(projectRoot, { recursive: true });
  return { root, projectRoot, dataRoot };
}

function prepare(dataRoot, projectRoot, input = { requestId: "adv", probe: "readonly" }) {
  return prepareBridgeRequest({
    dataRoot,
    operation: "get",
    server: "shipping-mode-readonly",
    tool: "mcp__shipping-mode-readonly__shipping_mode_readonly_probe",
    projectRoot,
    expectedInput: input,
    now: new Date("2026-07-30T11:00:00.000Z")
  });
}

function event(prepared, projectRoot, overrides = {}) {
  return {
    session_id: "session-adv",
    cwd: projectRoot,
    tool_name: prepared.toolName,
    tool_input: prepared.toolInput,
    tool_response: { content: [{ type: "text", text: "{\"ok\":true}" }], isError: false },
    tool_use_id: "toolu_adv",
    duration_ms: 4,
    ...overrides
  };
}

function publishUnsignedManualEnvelope(dataRoot, request, response = { manual: true }) {
  const envelope = {
    schemaVersion: 1,
    requestId: request.requestId,
    status: "CAPTURED",
    nonceHash: request.nonceHash,
    sessionId: "manual-session",
    projectRootHash: request.projectRootHash,
    expectedServer: request.expectedServer,
    expectedTool: request.expectedTool,
    toolName: request.expectedToolName,
    toolUseId: "manual-tool-use",
    toolInputHash: request.expectedToolInputHash,
    toolResponseHash: "0".repeat(64),
    capturedAt: "2026-07-30T11:00:01.000Z",
    expiresAt: "2026-07-30T11:02:00.000Z",
    responseBytes: JSON.stringify(response).length,
    durationMs: 1,
    response,
    signature: "hmac-sha256:".padEnd(76, "0")
  };
  writeJsonAtomic(bridgeRoot({ dataRoot }), path.join(bridgeRoot({ dataRoot }), "envelopes", `${request.requestId}.json`), envelope);
}

test("raw manual payload and unsigned envelope are rejected fail-closed", () => {
  const { dataRoot, projectRoot } = workspace();
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: "01985410-9000-7000-8000-000000000000", projectRoot }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID
  );
  const prepared = prepare(dataRoot, projectRoot);
  const state = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  publishUnsignedManualEnvelope(dataRoot, state.request);
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T11:00:02.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.RECOVERY_REQUIRED
  );
});

test("incorrect signature is rejected after host capture metadata exists", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare(dataRoot, projectRoot);
  capturePostToolUseEvent({ dataRoot, rawEvent: event(prepared, projectRoot), now: new Date("2026-07-30T11:00:01.000Z") });
  const state = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  writeJsonAtomic(bridgeRoot({ dataRoot }), path.join(bridgeRoot({ dataRoot }), "envelopes", `${prepared.requestId}.json`), {
    ...state.envelope,
    signature: "hmac-sha256:".padEnd(76, "f")
  });
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T11:00:02.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /signature/.test(error.message)
  );
});

test("expired envelope and already consumed envelope are rejected", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare(dataRoot, projectRoot);
  capturePostToolUseEvent({ dataRoot, rawEvent: event(prepared, projectRoot), now: new Date("2026-07-30T11:00:01.000Z") });
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T11:03:00.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.EXPIRED
  );

  const second = prepare(dataRoot, projectRoot, { requestId: "adv-2", probe: "readonly" });
  capturePostToolUseEvent({ dataRoot, rawEvent: event(second, projectRoot), now: new Date("2026-07-30T11:00:01.000Z") });
  consumeBridgeEnvelope({ dataRoot, requestId: second.requestId, projectRoot, now: new Date("2026-07-30T11:00:02.000Z") });
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: second.requestId, projectRoot, now: new Date("2026-07-30T11:00:03.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.REPLAYED
  );
});

test("multiple matching pending challenges are ambiguous", () => {
  const { dataRoot, projectRoot } = workspace();
  const first = prepare(dataRoot, projectRoot);
  prepare(dataRoot, projectRoot);
  assert.throws(
    () => capturePostToolUseEvent({ dataRoot, rawEvent: event(first, projectRoot), now: new Date("2026-07-30T11:00:01.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.AMBIGUOUS
  );
});

test("concurrent capture and concurrent consume fail closed", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare(dataRoot, projectRoot);
  capturePostToolUseEvent({ dataRoot, rawEvent: event(prepared, projectRoot), now: new Date("2026-07-30T11:00:01.000Z") });
  assert.throws(
    () => capturePostToolUseEvent({ dataRoot, rawEvent: event(prepared, projectRoot, { tool_use_id: "toolu_adv_2" }), now: new Date("2026-07-30T11:00:02.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.REPLAYED
  );
  const lockPath = path.join(bridgeRoot({ dataRoot }), "locks", `${prepared.requestId}.lock`);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, "held\n");
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T11:00:03.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.RECOVERY_REQUIRED
  );
  fs.rmSync(lockPath, { force: true });
});

test("crash after envelope publication requires recovery", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare(dataRoot, projectRoot);
  assert.throws(
    () => capturePostToolUseEvent({
      dataRoot,
      rawEvent: event(prepared, projectRoot),
      now: new Date("2026-07-30T11:00:01.000Z"),
      crashAfterEnvelope: true
    }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.RECOVERY_REQUIRED
  );
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T11:00:02.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.RECOVERY_REQUIRED
  );
});

test("re-signed envelope for another tool is rejected by request capture binding", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare(dataRoot, projectRoot);
  capturePostToolUseEvent({ dataRoot, rawEvent: event(prepared, projectRoot), now: new Date("2026-07-30T11:00:01.000Z") });
  const state = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  const key = ensureBridgeKey(bridgeRoot({ dataRoot }));
  const tampered = { ...state.envelope, toolName: "mcp__other__read", signature: null };
  tampered.signature = signEnvelope(tampered, key);
  writeJsonAtomic(bridgeRoot({ dataRoot }), path.join(bridgeRoot({ dataRoot }), "envelopes", `${prepared.requestId}.json`), tampered);
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T11:00:02.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /host capture/.test(error.message)
  );
});
