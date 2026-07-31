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
  cleanupExpiredRequests,
  consumeBridgeEnvelope,
  ensureBridgeKey,
  hashCanonical,
  loadBridgeState,
  prepareBridgeRequest,
  signEnvelope,
  verifyEnvelopeSignature,
  writeJsonAtomic
} from "../bridge-core.mjs";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-mode-bridge-"));
  const projectRoot = path.join(root, "project");
  const dataRoot = path.join(root, "plugin-data");
  fs.mkdirSync(projectRoot, { recursive: true });
  return { root, projectRoot, dataRoot };
}

function prepare({ dataRoot, projectRoot, input = { requestId: "probe-1", probe: "status" }, ttlMs = 120000, maxResponseBytes = 65536 } = {}) {
  return prepareBridgeRequest({
    dataRoot,
    operation: "get",
    server: "shipping-mode-readonly",
    tool: "mcp__shipping-mode-readonly__shipping_mode_readonly_probe",
    projectRoot,
    expectedInput: input,
    ttlMs,
    maxResponseBytes,
    now: new Date("2026-07-30T10:00:00.000Z")
  });
}

function eventFor(prepared, projectRoot, overrides = {}) {
  return {
    session_id: "session-a",
    cwd: projectRoot,
    tool_name: prepared.toolName,
    tool_input: prepared.toolInput,
    tool_response: { status: "ok", items: [{ id: "demo" }] },
    tool_use_id: "toolu_a",
    duration_ms: 12,
    ...overrides
  };
}

function captureAndState({ dataRoot, projectRoot, input, response } = {}) {
  const prepared = prepare({ dataRoot, projectRoot, input });
  const captured = capturePostToolUseEvent({
    dataRoot,
    rawEvent: eventFor(prepared, projectRoot, response === undefined ? {} : { tool_response: response }),
    now: new Date("2026-07-30T10:00:01.000Z")
  });
  assert.equal(captured.status, BRIDGE_RESULT_CODES.CAPTURED);
  return { prepared, state: loadBridgeState({ dataRoot, requestId: prepared.requestId }) };
}

function writeEnvelope(dataRoot, envelope) {
  const root = bridgeRoot({ dataRoot });
  writeJsonAtomic(root, path.join(root, "envelopes", `${envelope.requestId}.json`), envelope);
}

test("canonical request hashing ignores object key order", () => {
  assert.equal(hashCanonical({ b: 2, a: { y: 1, x: 2 } }), hashCanonical({ a: { x: 2, y: 1 }, b: 2 }));
});

test("prepare stores pending challenge under plugin data, not .planning", () => {
  const { dataRoot, projectRoot } = tempWorkspace();
  const prepared = prepare({ dataRoot, projectRoot, input: { z: 1, a: 2 } });
  const state = loadBridgeState({ dataRoot, requestId: prepared.requestId });
  assert.equal(state.request.status, "PENDING");
  assert.equal(state.request.expectedToolInputHash, hashCanonical({ a: 2, z: 1 }));
  assert.ok(state.root.includes("work-source-bridge"));
  assert.equal(state.root.includes(`${path.sep}.planning${path.sep}`), false);
  assert.equal("nonce" in prepared, false);
});

test("capture signs a valid HMAC envelope", () => {
  const { dataRoot, projectRoot } = tempWorkspace();
  const { prepared, state } = captureAndState({ dataRoot, projectRoot });
  const key = ensureBridgeKey(bridgeRoot({ dataRoot }));
  assert.equal(verifyEnvelopeSignature(state.envelope, key), true);
  assert.equal(state.envelope.requestId, prepared.requestId);
  assert.equal(state.envelope.toolResponseHash, hashCanonical(state.envelope.response));
});

test("modified HMAC is rejected and unequal length path remains non-throwing", () => {
  const { dataRoot, projectRoot } = tempWorkspace();
  const { state } = captureAndState({ dataRoot, projectRoot });
  const key = ensureBridgeKey(bridgeRoot({ dataRoot }));
  assert.equal(verifyEnvelopeSignature({ ...state.envelope, responseBytes: 999 }, key), false);
  assert.equal(verifyEnvelopeSignature({ ...state.envelope, signature: "hmac-sha256:bad" }, key), false);
});

test("consume verifies and marks envelope one-time", () => {
  const { dataRoot, projectRoot } = tempWorkspace();
  const { prepared } = captureAndState({ dataRoot, projectRoot });
  const consumed = consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T10:00:02.000Z") });
  assert.equal(consumed.status, "BRIDGE_CONSUMED");
  assert.deepEqual(consumed.response, { status: "ok", items: [{ id: "demo" }] });
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T10:00:03.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.REPLAYED
  );
});

test("request TTL and cleanup mark stale pending challenges expired", () => {
  const { dataRoot, projectRoot } = tempWorkspace();
  const prepared = prepare({ dataRoot, projectRoot, ttlMs: 1 });
  assert.equal(
    capturePostToolUseEvent({ dataRoot, rawEvent: eventFor(prepared, projectRoot), now: new Date("2026-07-30T10:00:01.000Z") }).status,
    BRIDGE_RESULT_CODES.UNAVAILABLE
  );
  const cleaned = cleanupExpiredRequests({ dataRoot, now: new Date("2026-07-30T10:00:01.000Z") });
  assert.equal(cleaned.expiredRequests, 1);
});

test("session binding rejects a re-signed envelope from another session", () => {
  const { dataRoot, projectRoot } = tempWorkspace();
  const { prepared, state } = captureAndState({ dataRoot, projectRoot });
  const key = ensureBridgeKey(bridgeRoot({ dataRoot }));
  const tampered = { ...state.envelope, sessionId: "session-b", signature: null };
  tampered.signature = signEnvelope(tampered, key);
  writeEnvelope(dataRoot, tampered);
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot, now: new Date("2026-07-30T10:00:02.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /host capture/.test(error.message)
  );
});

test("project, tool and input bindings reject mismatches", () => {
  const { dataRoot, projectRoot, root } = tempWorkspace();
  const otherProject = path.join(root, "other");
  fs.mkdirSync(otherProject);
  const prepared = prepare({ dataRoot, projectRoot, input: { requestId: "x", probe: "one" } });
  assert.equal(capturePostToolUseEvent({
    dataRoot,
    rawEvent: eventFor(prepared, projectRoot, { tool_input: { requestId: "x", probe: "two" } }),
    now: new Date("2026-07-30T10:00:01.000Z")
  }).status, BRIDGE_RESULT_CODES.UNAVAILABLE);
  assert.equal(capturePostToolUseEvent({
    dataRoot,
    rawEvent: eventFor(prepared, projectRoot, { tool_name: "mcp__other__tool" }),
    now: new Date("2026-07-30T10:00:01.000Z")
  }).status, BRIDGE_RESULT_CODES.UNAVAILABLE);
  capturePostToolUseEvent({ dataRoot, rawEvent: eventFor(prepared, projectRoot), now: new Date("2026-07-30T10:00:01.000Z") });
  assert.throws(
    () => consumeBridgeEnvelope({ dataRoot, requestId: prepared.requestId, projectRoot: otherProject, now: new Date("2026-07-30T10:00:02.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /project root/.test(error.message)
  );
});

test("size limit and secret-like keys are rejected before envelope publication", () => {
  const { dataRoot, projectRoot } = tempWorkspace();
  const tooLarge = prepare({ dataRoot, projectRoot, maxResponseBytes: 8 });
  assert.throws(
    () => capturePostToolUseEvent({ dataRoot, rawEvent: eventFor(tooLarge, projectRoot, { tool_response: { status: "too-large" } }), now: new Date("2026-07-30T10:00:01.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /exceeds/.test(error.message)
  );
  const secret = prepare({ dataRoot, projectRoot, input: { requestId: "s", probe: "secret" } });
  assert.throws(
    () => capturePostToolUseEvent({ dataRoot, rawEvent: eventFor(secret, projectRoot, { tool_response: { access_token: "nope" } }), now: new Date("2026-07-30T10:00:01.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID && /secret-like/.test(error.message)
  );
});

test("fake PostToolUse event with malformed response is rejected deterministically", () => {
  const { dataRoot, projectRoot } = tempWorkspace();
  const prepared = prepare({ dataRoot, projectRoot });
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => capturePostToolUseEvent({ dataRoot, rawEvent: eventFor(prepared, projectRoot, { tool_response: cyclic }), now: new Date("2026-07-30T10:00:01.000Z") }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.INVALID
  );
});

test("atomic write creates complete JSON and simulated crash leaves temp only", () => {
  const { dataRoot } = tempWorkspace();
  const root = bridgeRoot({ dataRoot });
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, "requests", "atomic.json");
  writeJsonAtomic(root, target, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { ok: true });
  assert.throws(
    () => writeJsonAtomic(root, path.join(root, "requests", "crash.json"), { ok: false }, { crashAfterTemp: true }),
    (error) => error instanceof BridgeError && error.code === BRIDGE_RESULT_CODES.RECOVERY_REQUIRED
  );
  assert.equal(fs.existsSync(path.join(root, "requests", "crash.json")), false);
});
