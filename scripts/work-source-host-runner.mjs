#!/usr/bin/env node

import { cleanupExpiredHostWorkSourceInvocations, prepareHostWorkSourceInvocation, resumeHostWorkSourceInvocation } from "../runtime/src/lib/hostWorkSourceInvocation.mjs";

function parse(argv) {
  const [stage, ...rest] = argv;
  const options = { commandArgs: [] };
  let separator = rest.indexOf("--");
  const optionArgs = separator === -1 ? rest : rest.slice(0, separator);
  options.commandArgs = separator === -1 ? [] : rest.slice(separator + 1);
  for (let index = 0; index < optionArgs.length; index += 1) {
    const value = optionArgs[index];
    if (!value.startsWith("--")) throw new Error(`unsupported positional argument before --: ${value}`);
    const key = value.slice(2).replaceAll("-", "_");
    const next = optionArgs[index + 1];
    options[key] = next === undefined || next.startsWith("--") ? true : optionArgs[++index];
  }
  return { stage, options };
}

function pluginDataDir(options) {
  const value = options.plugin_data_dir || process.env.CLAUDE_PLUGIN_DATA;
  if (!value || value === true) throw new Error("--plugin-data-dir or CLAUDE_PLUGIN_DATA is required");
  return value;
}

function cwd(options) {
  const value = options.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!value || value === true) throw new Error("--cwd or CLAUDE_PROJECT_DIR is required");
  return value;
}

function command(options) {
  if (options.commandArgs.length === 0) throw new Error("command arguments are required after --");
  return { command: options.commandArgs[0], args: options.commandArgs.slice(1) };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(error) {
  output({ status: "HOST_INVOCATION_FAILED", error: error.message });
  process.exitCode = /UNAVAILABLE|NOT_REQUIRED/.test(error.message) ? 3 : 1;
}

try {
  const { stage, options } = parse(process.argv.slice(2));
  if (stage === "prepare") {
    const parsed = command(options);
    output(prepareHostWorkSourceInvocation({
      ...parsed,
      cwd: cwd(options),
      pluginDataDir: pluginDataDir(options),
      ttlMs: options.ttl_ms ? Number(options.ttl_ms) : undefined
    }));
  } else if (stage === "resume") {
    const parsed = command(options);
    if (!options.invocation_id || options.invocation_id === true) throw new Error("--invocation-id is required");
    output(resumeHostWorkSourceInvocation({
      invocationId: options.invocation_id,
      ...parsed,
      cwd: cwd(options),
      pluginDataDir: pluginDataDir(options)
    }));
  } else if (stage === "cleanup") {
    output(cleanupExpiredHostWorkSourceInvocations({ pluginDataDir: pluginDataDir(options) }));
  } else {
    throw new Error("usage: prepare|resume|cleanup --plugin-data-dir <dir> --cwd <workspace> -- <shipping-mode command...>");
  }
} catch (error) {
  fail(error);
}
