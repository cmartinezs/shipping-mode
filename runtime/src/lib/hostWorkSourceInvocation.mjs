import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dispatch } from "../index.mjs";
import { revisionHash } from "./canonical.mjs";
import { generateUuidV7, isUuidV7 } from "./ids.mjs";
import { normalizeWorkSourceConfig, readValidatedWorkSourceConfig } from "./workSourceImport.mjs";
import { transportResponseFingerprint, workSourceTransportRequestBinding } from "./workSourceTransportPort.mjs";
import { atlassianMcpActionForRequest, normalizeAtlassianMcpResponse } from "./atlassianMcpHostAdapter.mjs";
import { prepareBridgeRequest, cleanupExpiredRequests } from "../../../spikes/host-mcp-bridge/bridge-verified.mjs";
import { hashString, projectRootHash } from "../../../spikes/host-mcp-bridge/bridge-core.mjs";
import { consumeBridgeEnvelope } from "../../../spikes/host-mcp-bridge/bridge-consume.mjs";

const INVOCATION_SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const MAX_TTL_MS = 10 * 60 * 1000;

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function invocationsRoot(pluginDataDir) {
  const root = path.resolve(requireString(pluginDataDir, "pluginDataDir"));
  if (root.split(path.sep).includes(".planning")) throw new Error("host invocation data must not point inside .planning");
  return path.join(root, "work-source-host-invocations");
}

function ensureKey(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const keyPath = path.join(root, "host-invocation.key");
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });
  return fs.readFileSync(keyPath, "utf8").trim();
}

function sign(record, key) {
  const { signature, ...unsigned } = record;
  return `hmac-sha256:${crypto.createHmac("sha256", key).update(JSON.stringify(unsigned)).digest("hex")}`;
}

function writeRecord(root, record, { noOverwrite = false } = {}) {
  const key = ensureKey(root);
  const signed = { ...record, signature: sign(record, key) };
  const filePath = path.join(root, `${record.invocationId}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(signed, null, 2)}\n`, { flag: noOverwrite ? "wx" : "w", mode: 0o600 });
  return signed;
}

function readRecord(root, invocationId) {
  if (!isUuidV7(invocationId)) throw new Error("invocationId must be UUIDv7");
  const record = JSON.parse(fs.readFileSync(path.join(root, `${invocationId}.json`), "utf8"));
  const expected = sign(record, ensureKey(root));
  if (record.signature !== expected) throw new Error("host invocation signature mismatch");
  return record;
}

function commandHash(command, args) {
  return `sha256:${revisionHash({ command, args })}`;
}

function sourcesById(cwd) {
  const planningRoot = path.join(cwd, ".planning");
  const config = readValidatedWorkSourceConfig(planningRoot);
  return new Map(normalizeWorkSourceConfig({ config, workspaceRoot: cwd }).map((source) => [source.id, source]));
}

class CollectingWorkSourceTransport {
  constructor() {
    this.requests = [];
  }

  execute(request) {
    this.requests.push(structuredClone(request));
    const response = {
      schemaVersion: 1,
      requestId: request.requestId,
      requestHash: request.requestHash,
      provider: request.provider,
      transport: request.transport,
      connectionRef: request.connectionRef,
      sourceId: request.sourceId,
      status: "UNAVAILABLE",
      items: [],
      item: null,
      findings: [{ code: "HOST_INVOCATION_PREPARE", severity: "warning", message: "host orchestration prepare collected the request without executing provider IO" }],
      observedAt: new Date(0).toISOString()
    };
    response.responseFingerprint = transportResponseFingerprint(response);
    return response;
  }
}

class BoundWorkSourceTransport {
  constructor(records, responses) {
    this.recordsByBinding = new Map(records.map((record) => [record.requestBindingHash, record]));
    this.responsesByRequestId = new Map(responses.map((response) => [response.requestId, response]));
    this.consumed = new Set();
  }

  reserveRequestId(input) {
    const binding = workSourceTransportRequestBinding(input);
    const record = this.recordsByBinding.get(binding);
    if (!record) throw new Error("HOST_UNKNOWN_REQUEST: no prepared request matches runtime request binding");
    return record.requestId;
  }

  execute(request) {
    const binding = workSourceTransportRequestBinding(request);
    const record = this.recordsByBinding.get(binding);
    if (!record) throw new Error("HOST_UNKNOWN_REQUEST: no prepared request matches runtime request binding");
    if (record.requestId !== request.requestId || record.requestHash !== request.requestHash) throw new Error("HOST_REQUEST_MISMATCH: prepared request hash mismatch");
    if (this.consumed.has(request.requestId)) throw new Error("HOST_DUPLICATE_REQUEST: runtime requested the same transport response twice");
    const response = this.responsesByRequestId.get(request.requestId);
    if (!response) throw new Error("HOST_RESPONSE_MISSING: no normalized response for request");
    this.consumed.add(request.requestId);
    return structuredClone(response);
  }

  assertAllConsumed() {
    const missing = [...this.responsesByRequestId.keys()].filter((requestId) => !this.consumed.has(requestId));
    if (missing.length > 0) throw new Error(`HOST_RESPONSE_SURPLUS: normalized response was not consumed: ${missing.join(",")}`);
  }
}

function collectRequests({ command, args, cwd }) {
  const collector = new CollectingWorkSourceTransport();
  try {
    dispatch(command, args, cwd, { workSourceTransport: collector });
  } catch (error) {
    if (collector.requests.length === 0) throw error;
  }
  const unique = new Map();
  for (const request of collector.requests) {
    if (request.provider !== "jira" || request.transport !== "mcp") continue;
    if (unique.has(request.requestId) || unique.has(request.requestHash)) throw new Error("HOST_DUPLICATE_REQUEST: duplicate canonical request collected");
    unique.set(request.requestId, request);
    unique.set(request.requestHash, request);
  }
  return [...new Set([...unique.values()])].sort((left, right) => `${left.sourceId}:${left.operation}:${left.requestHash}`.localeCompare(`${right.sourceId}:${right.operation}:${right.requestHash}`));
}

export function prepareHostWorkSourceInvocation({ command, args, cwd, pluginDataDir, env = process.env, now = new Date(), ttlMs = DEFAULT_TTL_MS }) {
  const ttl = Number(ttlMs);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_MS) throw new Error("ttlMs is out of bounds");
  const root = invocationsRoot(pluginDataDir);
  cleanupExpiredHostWorkSourceInvocations({ pluginDataDir, now });
  cleanupExpiredRequests({ dataRoot: pluginDataDir, env, now });
  const projectRoot = path.resolve(cwd);
  const sourceMap = sourcesById(projectRoot);
  const requests = collectRequests({ command, args, cwd: projectRoot });
  if (requests.length === 0) return { status: "HOST_INVOCATION_NOT_REQUIRED", actions: [] };
  const invocationId = generateUuidV7(now.getTime());
  const expiresAt = new Date(now.getTime() + ttl).toISOString();
  const records = [];
  const actions = [];
  for (const request of requests) {
    const source = sourceMap.get(request.sourceId);
    if (!source) throw new Error(`source not found for request ${request.sourceId}`);
    const action = atlassianMcpActionForRequest({ request, source });
    const bridge = prepareBridgeRequest({
      dataRoot: pluginDataDir,
      env,
      sessionId: env.CLAUDE_CODE_SESSION_ID,
      requestId: request.requestId,
      operation: request.operation,
      server: action.server,
      tool: action.tool,
      projectRoot,
      expectedInput: action.input,
      now,
      ttlMs: ttl,
      maxResponseBytes: 256 * 1024
    });
    records.push({
      request,
      requestId: request.requestId,
      requestHash: request.requestHash,
      requestBindingHash: workSourceTransportRequestBinding(request),
      sourceId: request.sourceId,
      action: { server: action.server, tool: action.tool, toolName: action.toolName, inputHash: action.inputHash, bridgeRequestId: bridge.requestId }
    });
    actions.push({ requestId: request.requestId, requestHash: request.requestHash, operation: request.operation, server: action.server, tool: action.tool, toolName: action.toolName, input: action.input });
  }
  writeRecord(root, {
    schemaVersion: INVOCATION_SCHEMA_VERSION,
    invocationId,
    status: "PREPARED",
    createdAt: now.toISOString(),
    expiresAt,
    consumedAt: null,
    sessionIdHash: hashString(env.CLAUDE_CODE_SESSION_ID || ""),
    projectRootHash: projectRootHash(projectRoot),
    command: { name: command, argsHash: commandHash(command, args) },
    requests: records
  }, { noOverwrite: true });
  return { status: "HOST_INVOCATION_PREPARED", invocationId, expiresAt, actions };
}

export function resumeHostWorkSourceInvocation({ invocationId, command, args, cwd, pluginDataDir, env = process.env, now = new Date() }) {
  const root = invocationsRoot(pluginDataDir);
  const projectRoot = path.resolve(cwd);
  const record = readRecord(root, invocationId);
  if (record.status !== "PREPARED") throw new Error("HOST_INVOCATION_REPLAYED: invocation was already resumed");
  if (Date.parse(record.expiresAt) <= now.getTime()) throw new Error("HOST_INVOCATION_EXPIRED: invocation expired");
  if (record.sessionIdHash !== hashString(env.CLAUDE_CODE_SESSION_ID || "")) throw new Error("HOST_SESSION_MISMATCH: invocation belongs to another session");
  if (record.projectRootHash !== projectRootHash(projectRoot)) throw new Error("HOST_PROJECT_MISMATCH: invocation belongs to another project");
  if (record.command.name !== command || record.command.argsHash !== commandHash(command, args)) throw new Error("HOST_COMMAND_MISMATCH: invocation belongs to another command");
  const sourceMap = sourcesById(projectRoot);
  const responses = [];
  for (const requestRecord of record.requests) {
    const source = sourceMap.get(requestRecord.sourceId);
    if (!source) throw new Error(`source not found for request ${requestRecord.sourceId}`);
    const action = atlassianMcpActionForRequest({ request: requestRecord.request, source });
    if (action.toolName !== requestRecord.action.toolName || action.inputHash !== requestRecord.action.inputHash) throw new Error("HOST_ACTION_MISMATCH: MCP action changed since prepare");
    const consumed = consumeBridgeEnvelope({
      dataRoot: pluginDataDir,
      env,
      sessionId: env.CLAUDE_CODE_SESSION_ID,
      requestId: requestRecord.requestId,
      projectRoot,
      now
    });
    if (consumed.toolName !== requestRecord.action.toolName) throw new Error("HOST_TOOL_MISMATCH: consumed bridge tool mismatch");
    responses.push(normalizeAtlassianMcpResponse({ request: requestRecord.request, action, rawResponse: consumed.response, source, observedAt: consumed.capturedAt || now.toISOString() }));
  }
  const transport = new BoundWorkSourceTransport(record.requests, responses);
  const result = dispatch(command, args, projectRoot, { workSourceTransport: transport });
  transport.assertAllConsumed();
  writeRecord(root, { ...record, status: "CONSUMED", consumedAt: now.toISOString() });
  return { status: "HOST_INVOCATION_RESUMED", invocationId, result };
}

export function cleanupExpiredHostWorkSourceInvocations({ pluginDataDir, now = new Date() }) {
  const root = invocationsRoot(pluginDataDir);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  let expiredInvocations = 0;
  for (const entry of fs.readdirSync(root).sort()) {
    if (!entry.endsWith(".json")) continue;
    const invocationId = entry.slice(0, -5);
    let record;
    try {
      record = readRecord(root, invocationId);
    } catch {
      continue;
    }
    if (record.status === "PREPARED" && Date.parse(record.expiresAt) <= now.getTime()) {
      writeRecord(root, { ...record, status: "EXPIRED", expiredAt: now.toISOString() });
      expiredInvocations += 1;
    }
  }
  return { status: "HOST_INVOCATIONS_CLEANED", expiredInvocations };
}
