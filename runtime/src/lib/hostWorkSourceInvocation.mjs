import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dispatch } from "../index.mjs";
import { revisionHash } from "./canonical.mjs";
import { generateUuidV7, isUuidV7 } from "./ids.mjs";
import { normalizeWorkSourceConfig, readValidatedWorkSourceConfig } from "./workSourceImport.mjs";
import { resolveReleaseReference } from "./releaseStore.mjs";
import { resolveReleaseItemReference } from "./releaseItemStore.mjs";
import { transportResponseFingerprint, validateWorkSourceTransportResponse, workSourceTransportRequestBinding } from "./workSourceTransportPort.mjs";
import { atlassianMcpActionForRequest, normalizeAtlassianMcpResponse } from "./atlassianMcpHostAdapter.mjs";
import { prepareBridgeRequest, cleanupExpiredRequests, loadBridgeState, verifyEnvelopeSignature, hashCanonical } from "../../../spikes/host-mcp-bridge/bridge-verified.mjs";
import { ensureBridgeKey, hashString, projectRootHash, writeJsonAtomic } from "../../../spikes/host-mcp-bridge/bridge-core.mjs";
import { consumeBridgeEnvelope } from "../../../spikes/host-mcp-bridge/bridge-consume.mjs";

const INVOCATION_SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const MAX_TTL_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 64;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const RECORD_STATUSES = new Set(["PREPARED", "READY", "CONSUMED", "EXPIRED"]);

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
  if (!fs.existsSync(keyPath)) {
    try {
      const fd = fs.openSync(keyPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${crypto.randomBytes(32).toString("base64url")}\n`, "utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const key = fs.readFileSync(keyPath, "utf8").trim();
  if (!key) throw new Error("host invocation key is empty");
  return key;
}

function sign(record, key) {
  const { signature, ...unsigned } = record;
  return `hmac-sha256:${crypto.createHmac("sha256", key).update(revisionHash(unsigned)).digest("hex")}`;
}

function validateRecordShape(record) {
  const allowed = new Set(["schemaVersion", "invocationId", "status", "createdAt", "expiresAt", "consumedAt", "readyAt", "expiredAt", "sessionIdHash", "projectRootHash", "command", "requests", "normalizedResponses", "resultHash", "signature"]);
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("host invocation record must be an object");
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`host invocation record contains unsupported field ${key}`);
  if (record.schemaVersion !== INVOCATION_SCHEMA_VERSION || !isUuidV7(record.invocationId)) throw new Error("host invocation identity or schema mismatch");
  if (!RECORD_STATUSES.has(record.status)) throw new Error("host invocation status is invalid");
  if (!Array.isArray(record.requests) || record.requests.length < 1 || record.requests.length > MAX_REQUESTS) throw new Error("host invocation request count is invalid");
  if (record.normalizedResponses !== null && record.normalizedResponses !== undefined && !Array.isArray(record.normalizedResponses)) throw new Error("host invocation normalizedResponses must be an array or null");
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_RECORD_BYTES) throw new Error("host invocation record exceeds byte limit");
  return record;
}

function writeRecord(root, record, { noOverwrite = false } = {}) {
  const key = ensureKey(root);
  const signed = validateRecordShape({ ...record, signature: sign(record, key) });
  writeJsonAtomic(root, path.join(root, `${record.invocationId}.json`), signed, { noOverwrite });
  return signed;
}

function readRecord(root, invocationId) {
  if (!isUuidV7(invocationId)) throw new Error("invocationId must be UUIDv7");
  const record = validateRecordShape(JSON.parse(fs.readFileSync(path.join(root, `${invocationId}.json`), "utf8")));
  const expected = sign(record, ensureKey(root));
  const left = Buffer.from(record.signature || "", "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error("host invocation signature mismatch");
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

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] || null;
}

function stableCommandArgs(command, args, invocationId) {
  const normalized = [...args];
  const mutatingHostCommand = command === "item" && ["import", "refresh"].includes(normalized[0]);
  if (mutatingHostCommand && !normalized.includes("--idempotency-key")) {
    normalized.push("--idempotency-key", `host-invocation-${invocationId}`);
  }
  return normalized;
}

function commandNeedsExternalHost({ command, args, cwd, sourceMap }) {
  if (command !== "item") return true;
  if (args[0] === "import") {
    const sourceText = optionValue(args, "--source");
    if (!sourceText || !sourceText.includes(":")) return true;
    const source = sourceMap.get(sourceText.slice(0, sourceText.indexOf(":")));
    return !source || source.provider === "jira";
  }
  if (args[0] === "refresh") {
    const releaseResolution = resolveReleaseReference(path.join(cwd, ".planning"), args[1]);
    if (releaseResolution.status !== "FOUND") return true;
    const itemResolution = resolveReleaseItemReference(path.join(cwd, ".planning"), releaseResolution.release.id, args[2]);
    if (itemResolution.status !== "FOUND") return true;
    const primary = (itemResolution.item.sourceRefs || []).filter((ref) => ref.role === "primary");
    if (primary.length !== 1) return true;
    const source = sourceMap.get(primary[0].sourceId);
    return !source || source.provider === "jira";
  }
  return false;
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
    this.responsesByRequestId = new Map(responses.map((entry) => [entry.requestId, entry.response]));
    this.used = new Set();
  }

  reserveRequestId(input) {
    const record = this.recordsByBinding.get(workSourceTransportRequestBinding(input));
    if (!record) throw new Error("HOST_UNKNOWN_REQUEST: no prepared request matches runtime request binding");
    return record.requestId;
  }

  execute(request) {
    const record = this.recordsByBinding.get(workSourceTransportRequestBinding(request));
    if (!record) throw new Error("HOST_UNKNOWN_REQUEST: no prepared request matches runtime request binding");
    if (record.requestId !== request.requestId || record.requestHash !== request.requestHash) throw new Error("HOST_REQUEST_MISMATCH: prepared request hash mismatch");
    const response = this.responsesByRequestId.get(request.requestId);
    if (!response) throw new Error("HOST_RESPONSE_MISSING: no normalized response for request");
    this.used.add(request.requestId);
    return structuredClone(response);
  }

  assertAllConsumed() {
    const missing = [...this.responsesByRequestId.keys()].filter((requestId) => !this.used.has(requestId));
    if (missing.length > 0) throw new Error(`HOST_RESPONSE_SURPLUS: normalized response was not consumed: ${missing.join(",")}`);
  }
}

function expectedPreparationFailure(error) {
  return /SOURCE_UNAVAILABLE|approved host transport bridge|HOST_INVOCATION_PREPARE/i.test(error?.message || "");
}

function collectRequests({ command, args, cwd }) {
  const collector = new CollectingWorkSourceTransport();
  try {
    dispatch(command, args, cwd, { workSourceTransport: collector });
  } catch (error) {
    if (collector.requests.length === 0 || !expectedPreparationFailure(error)) throw error;
  }
  const uniqueByBinding = new Map();
  for (const request of collector.requests) {
    if (request.provider !== "jira" || request.transport !== "mcp") continue;
    const binding = workSourceTransportRequestBinding(request);
    if (!uniqueByBinding.has(binding)) uniqueByBinding.set(binding, request);
  }
  const requests = [...uniqueByBinding.values()].sort((left, right) => `${left.sourceId}:${left.operation}:${workSourceTransportRequestBinding(left)}`.localeCompare(`${right.sourceId}:${right.operation}:${workSourceTransportRequestBinding(right)}`));
  if (requests.length > MAX_REQUESTS) throw new Error("HOST_REQUEST_LIMIT: host invocation has too many requests");
  return requests;
}

function verifyBridgeEvidence({ pluginDataDir, env, projectRoot, requestRecord, now }) {
  const state = loadBridgeState({ dataRoot: pluginDataDir, env, requestId: requestRecord.requestId });
  const request = state.request;
  const envelope = state.envelope;
  if (!request || !envelope) throw new Error(`HOST_RESPONSE_MISSING: bridge evidence is missing for ${requestRecord.requestId}`);
  if (request.failure) throw new Error(`HOST_MCP_FAILURE: ${request.failure.code}`);
  if (!new Set(["PENDING", "CONSUMED"]).has(request.status)) throw new Error("HOST_BRIDGE_STATE_INVALID: bridge request is not recoverable");
  if (request.expectedSessionIdHash !== hashString(env.CLAUDE_CODE_SESSION_ID || "") || envelope.sessionId !== env.CLAUDE_CODE_SESSION_ID) throw new Error("HOST_SESSION_MISMATCH: bridge evidence belongs to another session");
  if (request.projectRootHash !== projectRootHash(projectRoot) || envelope.projectRootHash !== request.projectRootHash) throw new Error("HOST_PROJECT_MISMATCH: bridge evidence belongs to another project");
  if (request.expectedToolName !== requestRecord.action.toolName || envelope.toolName !== requestRecord.action.toolName) throw new Error("HOST_TOOL_MISMATCH: consumed bridge tool mismatch");
  const expectedInputHash = requestRecord.action.inputHash.replace(/^sha256:/, "");
  if (request.expectedToolInputHash !== expectedInputHash || envelope.toolInputHash !== expectedInputHash) throw new Error("HOST_INPUT_MISMATCH: bridge input hash mismatch");
  if (envelope.requestId !== requestRecord.requestId || envelope.nonceHash !== request.nonceHash) throw new Error("HOST_REQUEST_MISMATCH: bridge request/envelope mismatch");
  if (hashCanonical(envelope.response) !== envelope.toolResponseHash) throw new Error("HOST_RESPONSE_MISMATCH: bridge response hash mismatch");
  if (!verifyEnvelopeSignature(envelope, ensureBridgeKey(state.root))) throw new Error("HOST_RESPONSE_MISMATCH: bridge envelope signature invalid");
  const envelopeHash = hashCanonical(envelope);
  if (request.status === "CONSUMED" && request.consumedEnvelopeHash !== envelopeHash) throw new Error("HOST_RECOVERY_REQUIRED: consumed bridge evidence hash mismatch");
  if (request.status === "PENDING" && (Date.parse(request.expiresAt) <= now.getTime() || Date.parse(envelope.expiresAt) <= now.getTime())) throw new Error("HOST_INVOCATION_EXPIRED: bridge evidence expired");
  return { status: request.status, response: envelope.response, capturedAt: envelope.capturedAt, envelopeHash };
}

function readyResponses({ record, sourceMap, pluginDataDir, env, projectRoot, now }) {
  const normalizedResponses = [];
  for (const requestRecord of record.requests) {
    const source = sourceMap.get(requestRecord.sourceId);
    if (!source) throw new Error(`source not found for request ${requestRecord.sourceId}`);
    const action = atlassianMcpActionForRequest({ request: requestRecord.request, source, env });
    if (action.toolName !== requestRecord.action.toolName || action.inputHash !== requestRecord.action.inputHash) throw new Error("HOST_ACTION_MISMATCH: MCP action changed since prepare");
    const evidence = verifyBridgeEvidence({ pluginDataDir, env, projectRoot, requestRecord, now });
    const response = normalizeAtlassianMcpResponse({ request: requestRecord.request, action, rawResponse: evidence.response, source, observedAt: evidence.capturedAt || now.toISOString() });
    normalizedResponses.push({ requestId: requestRecord.requestId, requestHash: requestRecord.requestHash, envelopeHash: evidence.envelopeHash, response });
  }
  return normalizedResponses;
}

function validateReadyResponses(record) {
  if (!Array.isArray(record.normalizedResponses) || record.normalizedResponses.length !== record.requests.length) throw new Error("HOST_RECOVERY_REQUIRED: ready response set is incomplete");
  const byRequest = new Map(record.requests.map((entry) => [entry.requestId, entry]));
  return record.normalizedResponses.map((entry) => {
    const requestRecord = byRequest.get(entry.requestId);
    if (!requestRecord || entry.requestHash !== requestRecord.requestHash) throw new Error("HOST_RECOVERY_REQUIRED: normalized response binding mismatch");
    return { ...entry, response: validateWorkSourceTransportResponse(requestRecord.request, entry.response) };
  });
}

export function prepareHostWorkSourceInvocation({ command, args, cwd, pluginDataDir, env = process.env, now = new Date(), ttlMs = DEFAULT_TTL_MS }) {
  const ttl = Number(ttlMs);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_MS) throw new Error("ttlMs is out of bounds");
  requireString(env.CLAUDE_CODE_SESSION_ID, "CLAUDE_CODE_SESSION_ID");
  const root = invocationsRoot(pluginDataDir);
  cleanupExpiredHostWorkSourceInvocations({ pluginDataDir, now });
  cleanupExpiredRequests({ dataRoot: pluginDataDir, env, now });
  const projectRoot = path.resolve(cwd);
  const sourceMap = sourcesById(projectRoot);
  if (!commandNeedsExternalHost({ command, args, cwd: projectRoot, sourceMap })) return { status: "HOST_INVOCATION_NOT_REQUIRED", actions: [] };
  const invocationId = generateUuidV7(now.getTime());
  const effectiveArgs = stableCommandArgs(command, args, invocationId);
  const requests = collectRequests({ command, args: effectiveArgs, cwd: projectRoot });
  if (requests.length === 0) return { status: "HOST_INVOCATION_NOT_REQUIRED", actions: [] };
  const expiresAt = new Date(now.getTime() + ttl).toISOString();
  const records = [];
  const actions = [];
  for (const request of requests) {
    const source = sourceMap.get(request.sourceId);
    if (!source) throw new Error(`source not found for request ${request.sourceId}`);
    const action = atlassianMcpActionForRequest({ request, source, env });
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
    readyAt: null,
    sessionIdHash: hashString(env.CLAUDE_CODE_SESSION_ID),
    projectRootHash: projectRootHash(projectRoot),
    command: { name: command, argsHash: commandHash(command, args), effectiveArgsHash: commandHash(command, effectiveArgs) },
    requests: records,
    normalizedResponses: null,
    resultHash: null
  }, { noOverwrite: true });
  return { status: "HOST_INVOCATION_PREPARED", invocationId, expiresAt, actions };
}

export function resumeHostWorkSourceInvocation({ invocationId, command, args, cwd, pluginDataDir, env = process.env, now = new Date() }) {
  const root = invocationsRoot(pluginDataDir);
  const projectRoot = path.resolve(cwd);
  let record = readRecord(root, invocationId);
  if (record.status === "CONSUMED") throw new Error("HOST_INVOCATION_REPLAYED: invocation was already resumed");
  if (record.status === "EXPIRED" || Date.parse(record.expiresAt) <= now.getTime()) throw new Error("HOST_INVOCATION_EXPIRED: invocation expired");
  if (record.sessionIdHash !== hashString(env.CLAUDE_CODE_SESSION_ID || "")) throw new Error("HOST_SESSION_MISMATCH: invocation belongs to another session");
  if (record.projectRootHash !== projectRootHash(projectRoot)) throw new Error("HOST_PROJECT_MISMATCH: invocation belongs to another project");
  if (record.command.name !== command || record.command.argsHash !== commandHash(command, args)) throw new Error("HOST_COMMAND_MISMATCH: invocation belongs to another command");
  const effectiveArgs = stableCommandArgs(command, args, invocationId);
  if (record.command.effectiveArgsHash !== commandHash(command, effectiveArgs)) throw new Error("HOST_COMMAND_MISMATCH: effective command binding changed");
  const sourceMap = sourcesById(projectRoot);
  if (record.status === "PREPARED") {
    const normalizedResponses = readyResponses({ record, sourceMap, pluginDataDir, env, projectRoot, now });
    record = writeRecord(root, { ...record, status: "READY", readyAt: now.toISOString(), normalizedResponses });
  }
  const normalizedResponses = validateReadyResponses(record);
  for (const requestRecord of record.requests) {
    const expected = normalizedResponses.find((entry) => entry.requestId === requestRecord.requestId);
    const evidence = verifyBridgeEvidence({ pluginDataDir, env, projectRoot, requestRecord, now });
    if (evidence.envelopeHash !== expected.envelopeHash) throw new Error("HOST_RECOVERY_REQUIRED: bridge evidence changed after normalization");
    if (evidence.status === "PENDING") {
      const consumed = consumeBridgeEnvelope({ dataRoot: pluginDataDir, env, sessionId: env.CLAUDE_CODE_SESSION_ID, requestId: requestRecord.requestId, projectRoot, now });
      if (hashCanonical(consumed.response) !== hashCanonical(evidence.response)) throw new Error("HOST_RECOVERY_REQUIRED: consumed response changed after normalization");
    }
  }
  const transport = new BoundWorkSourceTransport(record.requests, normalizedResponses);
  const result = dispatch(command, effectiveArgs, projectRoot, { workSourceTransport: transport });
  transport.assertAllConsumed();
  writeRecord(root, { ...record, status: "CONSUMED", consumedAt: now.toISOString(), resultHash: `sha256:${revisionHash(result)}` });
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
    if (["PREPARED", "READY"].includes(record.status) && Date.parse(record.expiresAt) <= now.getTime()) {
      writeRecord(root, { ...record, status: "EXPIRED", expiredAt: now.toISOString() });
      expiredInvocations += 1;
    }
  }
  return { status: "HOST_INVOCATIONS_CLEANED", expiredInvocations };
}
