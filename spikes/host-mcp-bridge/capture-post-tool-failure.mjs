#!/usr/bin/env node

import { capturePostToolFailureEvent, BridgeError, BRIDGE_RESULT_CODES } from "./bridge-verified.mjs";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const rawEvent = input.trim() ? JSON.parse(input) : {};
    const result = capturePostToolFailureEvent({ rawEvent });
    if (result.requestId) {
      process.stderr.write(`shipping-mode bridge ${result.status} ${result.requestId}\n`);
    }
  } catch (error) {
    const status = error instanceof BridgeError ? error.code : BRIDGE_RESULT_CODES.INVALID;
    process.stderr.write(`shipping-mode bridge ${status}: ${error.message}\n`);
    if (status !== BRIDGE_RESULT_CODES.UNAVAILABLE) process.exitCode = 1;
  }
});
