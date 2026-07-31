import path from "node:path";
import { consumeBridgeEnvelope } from "../../../spikes/host-mcp-bridge/bridge-consume.mjs";
import { validateWorkSourceTransportResponse } from "./workSourceTransportPort.mjs";

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function resolvePluginDataDir(value, env) {
  const dir = value || env.CLAUDE_PLUGIN_DATA;
  if (!dir) throw new Error("CLAUDE_PLUGIN_DATA is required for HostWorkSourceTransport");
  const resolved = path.resolve(dir);
  if (resolved.split(path.sep).includes(".planning")) throw new Error("HostWorkSourceTransport plugin data dir must not point inside .planning");
  return resolved;
}

export class HostWorkSourceTransport {
  constructor({ projectRoot, pluginDataDir = null, requestId = null, env = process.env, sessionId = null } = {}) {
    this.projectRoot = requireString(projectRoot, "projectRoot");
    this.pluginDataDir = resolvePluginDataDir(pluginDataDir, env);
    this.requestId = requestId;
    this.env = env;
    this.sessionId = sessionId;
  }

  execute(request) {
    const requestId = this.requestId || request.requestId;
    const consumed = consumeBridgeEnvelope({
      dataRoot: this.pluginDataDir,
      env: this.env,
      sessionId: this.sessionId,
      requestId,
      projectRoot: this.projectRoot
    });
    const response = consumed?.response ?? consumed?.envelope?.response ?? null;
    if (!response || typeof response !== "object") throw new Error("BRIDGE_MALFORMED: host bridge did not return a transport response DTO");
    return validateWorkSourceTransportResponse(request, response);
  }
}
