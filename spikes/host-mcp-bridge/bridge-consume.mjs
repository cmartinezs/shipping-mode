import {
  BRIDGE_RESULT_CODES,
  BridgeError,
  consumeBridgeEnvelope as consumeSuccessfulEnvelope,
  loadBridgeState
} from "./bridge-verified.mjs";
import { hashString, projectRootHash } from "./bridge-core.mjs";

function requireSession(env, explicitSessionId) {
  const sessionId = explicitSessionId || env.CLAUDE_CODE_SESSION_ID;
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new BridgeError(BRIDGE_RESULT_CODES.UNAVAILABLE, "CLAUDE_CODE_SESSION_ID is not set; consume must run inside the preparing Claude Code session");
  }
  return sessionId.trim();
}

function throwRecordedFailure({ request, env, sessionId, projectRoot, now }) {
  if (!request?.failure) return;
  const hostSessionId = requireSession(env, sessionId);
  if (request.status === "CONSUMED") throw new BridgeError(BRIDGE_RESULT_CODES.REPLAYED, "request was already consumed");
  if (request.status !== "PENDING" || Date.parse(request.expiresAt) <= now.getTime()) {
    throw new BridgeError(BRIDGE_RESULT_CODES.EXPIRED, "failed bridge request is no longer pending");
  }
  if (hashString(hostSessionId) !== request.expectedSessionIdHash || request.failure.sessionId !== hostSessionId) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "failed tool session binding mismatch");
  }
  if (projectRootHash(projectRoot) !== request.projectRootHash) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "failed tool project root binding mismatch");
  }
  if (request.failure.toolName !== request.expectedToolName || request.failure.toolInputHash !== request.expectedToolInputHash) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "failed tool request binding mismatch");
  }
  throw new BridgeError(request.failure.code, `MCP tool did not complete successfully: ${request.failure.code}`);
}

export function consumeBridgeEnvelope({ dataRoot, env = process.env, sessionId = null, requestId, projectRoot, now = new Date() }) {
  const state = loadBridgeState({ dataRoot, env, requestId });
  throwRecordedFailure({ request: state.request, env, sessionId, projectRoot, now });
  return consumeSuccessfulEnvelope({ dataRoot, env, sessionId, requestId, projectRoot, now });
}
