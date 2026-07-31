#!/usr/bin/env node

import path from "node:path";
import { capturePostToolUseEvent, BridgeError, BRIDGE_RESULT_CODES } from "./bridge-verified.mjs";

function pluginDataDirectory(argv) {
  const index = argv.indexOf("--plugin-data-dir");
  const value = index >= 0 ? argv[index + 1] : null;
  if (typeof value !== "string" || value.trim() === "" || value.startsWith("--")) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "--plugin-data-dir requires a non-blank directory");
  }
  if (value.includes("${CLAUDE_PLUGIN_DATA}")) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "--plugin-data-dir placeholder was not resolved");
  }
  const resolved = path.resolve(value.trim());
  if (resolved.split(path.sep).includes(".planning")) {
    throw new BridgeError(BRIDGE_RESULT_CODES.INVALID, "--plugin-data-dir must not point inside .planning");
  }
  return resolved;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const dataRoot = pluginDataDirectory(process.argv.slice(2));
    const rawEvent = input.trim() ? JSON.parse(input) : {};
    const result = capturePostToolUseEvent({ dataRoot, rawEvent });
    if (result.captured) {
      process.stderr.write(`shipping-mode bridge captured ${result.requestId} ${result.toolName} ${result.responseBytes} bytes\n`);
    }
  } catch (error) {
    const status = error instanceof BridgeError ? error.code : BRIDGE_RESULT_CODES.INVALID;
    process.stderr.write(`shipping-mode bridge ${status}: ${error.message}\n`);
    if (status !== BRIDGE_RESULT_CODES.UNAVAILABLE) process.exitCode = 1;
  }
});
