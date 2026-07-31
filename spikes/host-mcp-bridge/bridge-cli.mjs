#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { consumeBridgeEnvelope } from "./bridge-consume.mjs";
import {
  BridgeError,
  cleanupExpiredRequests,
  inspectBridgeMetadata,
  prepareBridgeRequest
} from "./bridge-verified.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      options._.push(value);
      continue;
    }
    const key = value.slice(2).replaceAll("-", "_");
    const next = rest[index + 1];
    options[key] = next === undefined || next.startsWith("--") ? true : rest[++index];
  }
  return { command, options };
}

function readExpectedInput(filePath) {
  if (!filePath || filePath === true) throw new BridgeError("BRIDGE_INVALID", "--expected-input-file is required");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requireDirectoryOption(value, optionName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BridgeError("BRIDGE_INVALID", `${optionName} requires a non-blank directory`);
  }
  const resolved = path.resolve(value.trim());
  if (resolved.split(path.sep).includes(".planning")) {
    throw new BridgeError("BRIDGE_INVALID", `${optionName} must not point inside .planning`);
  }
  return resolved;
}

function dataRootOption(options) {
  if (options.plugin_data_dir) {
    return requireDirectoryOption(options.plugin_data_dir, "--plugin-data-dir");
  }
  if (!options.data_root) return undefined;
  if (process.env.BRIDGE_SPIKE_ALLOW_DATA_ROOT !== "1") {
    throw new BridgeError("BRIDGE_INVALID", "--data-root is test-only and requires BRIDGE_SPIKE_ALLOW_DATA_ROOT=1");
  }
  return requireDirectoryOption(options.data_root, "--data-root");
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(error) {
  const status = error instanceof BridgeError ? error.code : "BRIDGE_INVALID";
  output({ status, error: error.message });
  process.exitCode = status === "BRIDGE_UNAVAILABLE" ? 3 : 1;
}

const { command, options } = parseArgs(process.argv.slice(2));

try {
  const dataRoot = dataRootOption(options);
  if (command === "prepare") {
    output(prepareBridgeRequest({
      dataRoot,
      operation: options.operation,
      server: options.server,
      tool: options.tool,
      projectRoot: options.project_root,
      expectedInput: readExpectedInput(options.expected_input_file),
      ttlMs: options.ttl_ms ? Number(options.ttl_ms) : undefined,
      maxResponseBytes: options.max_response_bytes ? Number(options.max_response_bytes) : undefined
    }));
  } else if (command === "consume") {
    output(consumeBridgeEnvelope({
      dataRoot,
      requestId: options.request_id,
      projectRoot: options.project_root
    }));
  } else if (command === "cleanup-expired") {
    output(cleanupExpiredRequests({ dataRoot }));
  } else if (command === "inspect") {
    output(inspectBridgeMetadata({ dataRoot, requestId: options.request_id }));
  } else {
    throw new BridgeError("BRIDGE_INVALID", "usage: prepare|consume|cleanup-expired|inspect");
  }
} catch (error) {
  fail(error);
}
