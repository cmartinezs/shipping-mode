import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { consumeBridgeEnvelope } from "../bridge-consume.mjs";
import {
  BRIDGE_RESULT_CODES,
  BridgeError,
  capturePostToolFailureEvent,
  capturePostToolUseEvent,
  inspectBridgeMetadata,
  loadBridgeState,
  prepareBridgeRequest
} from "../bridge-verified.mjs";
import { bridgeRoot, writeJsonAtomic } from "../bridge-core.mjs";

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-mode-bridge-hardening-"));
  const projectRoot = path.join(root, "project");
  const dataRoot = path.join(root, "plugin-data");
  fs.mkdirSync(projectRoot, { recursive: true });
  return { root, projectRoot, dataRoot };
}

function env(sessionId) {
  return { CLAUDE_CODE_SESSION_ID: sessionId };
}

function prepare({ dataRoot, projectRoot, sessionId = "session-a", input = { probe: "status" }, tool = "readonly_probe" }) {
  return prepareBridgeRequest({
    dataRoot,
    env: env(sessionId),
    operation: "get",
    server: "shipping-mode-readonly",
    tool,
    projectRoot,
    expectedInput: input,
    now: new Date("2026-07-30T20:00:00.000Z")
  });
}

function event(prepared, projectRoot, sessionId = "session-a", response = { status: "ok", author: { name: "demo" } }) {
  return {
    session_id: sessionId,
    cwd: projectRoot,
    tool_name: prepared.toolName,
    tool_input: prepared.toolInput,
    tool_response: response,
    tool_use_id: `toolu-${sessionId}`,
    duration_ms: 5
  };
}

test("prepare requires and persists a Claude Code session binding", () => {
  const { dataRoot, projectRoot } = workspace();
  assert.throws(
    () => prepareBridgeRequest({ dataRoot, env: {}, operation: "get", server: "s", tool: "t", projectRoot, expectedInput: {} }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.UNAVAILABLE
  );
  const prepared = prepare({ dataRoot, projectRoot });
  const state = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  assert.match(state.request.expectedSessionIdHash, /^[0-9a-f]{64}$/);
  assert.equal(prepared.expectedSessionIdHash, state.request.expectedSessionIdHash);
});

test("capture is bound to the preparing session before envelope publication", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare({ dataRoot, projectRoot, sessionId: "session-a" });
  assert.throws(
    () => capturePostToolUseEvent({ dataRoot, env: env("session-b"), rawEvent: event(prepared, projectRoot, "session-a"), now: new Date("2026-07-30T20:00:01.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /hook session/.test(error.message)
  );
  assert.equal(loadBridgeState({ dataRoot, requestId: prepared.requestId }).envelope, null);
});

test("same tool and input in two sessions are not ambiguous", () => {
  const { dataRoot, projectRoot } = workspace();
  const first = prepare({ dataRoot, projectRoot, sessionId: "session-a" });
  prepare({ dataRoot, projectRoot, sessionId: "session-b" });
  const captured = capturePostToolUseEvent({
    dataRoot,
    env: env("session-a"),
    rawEvent: event(first, projectRoot, "session-a"),
    now: new Date("2026-07-30T20:00:01.000Z")
  });
  assert.equal(captured.status, BRIDGE_RESULT_CODES.CAPTURED);
});

test("full MCP tool name must belong to the declared server", () => {
  const { dataRoot, projectRoot } = workspace();
  assert.throws(
    () => prepare({ dataRoot, projectRoot, tool: "mcp__other__readonly_probe" }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /belong to server/.test(error.message)
  );
});

test("secret key detection is bounded without rejecting legitimate author fields", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare({ dataRoot, projectRoot });
  const captured = capturePostToolUseEvent({
    dataRoot,
    env: env("session-a"),
    rawEvent: event(prepared, projectRoot),
    now: new Date("2026-07-30T20:00:01.000Z")
  });
  assert.equal(captured.status, BRIDGE_RESULT_CODES.CAPTURED);

  const second = prepare({ dataRoot, projectRoot, input: { probe: "secret" } });
  assert.throws(
    () => capturePostToolUseEvent({
      dataRoot,
      env: env("session-a"),
      rawEvent: event(second, projectRoot, "session-a", { access_token: "nope" }),
      now: new Date("2026-07-30T20:00:01.000Z")
    }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /secret-like/.test(error.message)
  );
});

test("failed MCP calls are bound to the challenge and normalized without persisting raw errors", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare({ dataRoot, projectRoot });
  const result = capturePostToolFailureEvent({
    dataRoot,
    env: env("session-a"),
    rawEvent: {
      session_id: "session-a",
      cwd: projectRoot,
      tool_name: prepared.toolName,
      tool_input: prepared.toolInput,
      tool_use_id: "toolu-failed",
      error: "connection timed out with private details",
      is_interrupt: false,
      duration_ms: 1000
    },
    now: new Date("2026-07-30T20:00:01.000Z")
  });
  assert.equal(result.status, BRIDGE_RESULT_CODES.TIMEOUT);
  const state = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  assert.equal(state.request.failure.code, BRIDGE_RESULT_CODES.TIMEOUT);
  assert.equal("error" in state.request.failure, false);
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, env: env("session-a"), requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T20:00:02.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.TIMEOUT
  );
});

test("consume atomically updates only canonical request state and leaves signed envelope immutable", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare({ dataRoot, projectRoot });
  capturePostToolUseEvent({ dataRoot, env: env("session-a"), rawEvent: event(prepared, projectRoot), now: new Date("2026-07-30T20:00:01.000Z") });
  const before = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  const envelopeBytes = JSON.stringify(before.envelope);
  const consumed = consumeBridgeEnvelope({
    dataRoot,
    env: env("session-a"),
    requestId: prepared.requestId,
    projectRoot,
    now: new Date("2026-07-30T20:00:02.000Z")
  });
  assert.equal(consumed.status, "BRIDGE_CONSUMED");
  const after = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  assert.equal(JSON.stringify(after.envelope), envelopeBytes);
  assert.equal(after.envelope.status, "CAPTURED");
  assert.equal(after.request.status, "CONSUMED");
  assert.match(after.request.consumedEnvelopeHash, /^[0-9a-f]{64}$/);
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, env: env("session-a"), requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T20:00:03.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.REPLAYED
  );
});

test("consume recovers capture metadata from a valid immutable envelope", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare({ dataRoot, projectRoot });
  capturePostToolUseEvent({ dataRoot, env: env("session-a"), rawEvent: event(prepared, projectRoot), now: new Date("2026-07-30T20:00:01.000Z") });
  const state = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  const requestPath = path.join(bridgeRoot({ dataRoot }), "requests", `${prepared.requestId}.json`);
  writeJsonAtomic(bridgeRoot({ dataRoot }), requestPath, { ...state.request, capture: null, recoveryRequired: true });
  const consumed = consumeBridgeEnvelope({ dataRoot, env: env("session-a"), requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T20:00:02.000Z") });
  assert.equal(consumed.status, "BRIDGE_CONSUMED");
  assert.equal(loadBridgeState({ dataRoot, requestId: prepared.requestId }).request.capture.sessionId, "session-a");
});

test("consume rejects a different session and inspect redacts nonce, response and signature", () => {
  const { dataRoot, projectRoot } = workspace();
  const prepared = prepare({ dataRoot, projectRoot });
  capturePostToolUseEvent({ dataRoot, env: env("session-a"), rawEvent: event(prepared, projectRoot), now: new Date("2026-07-30T20:00:01.000Z") });
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, env: env("session-b"), requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T20:00:02.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /session binding/.test(error.message)
  );
  const inspected = inspectBridgeMetadata({ dataRoot, requestId: prepared.requestId });
  assert.equal(inspected.request.nonce, "[redacted]");
  assert.equal(inspected.envelope.response, "[redacted]");
  assert.equal(inspected.envelope.signature, "[redacted]");
});
