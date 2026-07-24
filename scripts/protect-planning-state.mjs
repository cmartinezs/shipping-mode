#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOCK_MESSAGE = "Direct writes to .planning/** are prohibited.\nUse <product-cli> to produce and apply a ChangeSet.";
const FAIL_CLOSED_MESSAGE = "Planning-state protection unavailable.\nNode.js 20+ is required. Tool call denied.";
const defaultContext = {
  workspaceRoot: path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd()),
  approvedLauncher: process.env.PRODUCT_CLI_NAME || "<product-cli>"
};

function deny(reason = BLOCK_MESSAGE) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}

function isWithin(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function realPathIfPresent(target) {
  return fs.existsSync(target) ? fs.realpathSync.native(target) : null;
}

function realPathThroughExistingAncestor(target) {
  let candidate = path.resolve(target);
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
  return path.resolve(fs.realpathSync.native(candidate), path.relative(candidate, target));
}

function touchesPlanning(target, context) {
  const planningRoot = path.resolve(context.workspaceRoot, ".planning");
  const absoluteTarget = path.resolve(context.workspaceRoot, target);

  // Keep this lexical when .planning has not been created yet. Resolving the
  // nearest existing ancestor would incorrectly classify the whole workspace.
  if (isWithin(absoluteTarget, planningRoot)) return true;

  const realPlanning = realPathIfPresent(planningRoot);
  const realTarget = realPathThroughExistingAncestor(absoluteTarget);
  return Boolean(realPlanning && realTarget && isWithin(realTarget, realPlanning));
}

function inputPath(toolInput) {
  return toolInput?.file_path || toolInput?.path || toolInput?.target_file || null;
}

function hasPlanningToken(command) {
  return /(?:^|[\s"'=(:,;&|<>])(?:\.\.?[\\/])*\.planning(?:[\\/\s"'=:,;&|<>)]|$)/i.test(command)
    || /[\\/]\.planning(?:[\\/]|$)/i.test(command);
}

function tokenizeSafely(command) {
  const tokens = [];
  let token = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (token) { tokens.push(token); token = ""; }
    } else {
      token += char;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

export function isStandaloneApprovedLauncher(command, approvedLauncher) {
  if (/[;&|><`\n]|\$\(/.test(command)) return false;
  const tokens = tokenizeSafely(command);
  return tokens.length > 0 && tokens[0] === approvedLauncher;
}

function containsWriteOperation(command) {
  return /[<>]/.test(command)
    || /(?:^|[\s;&|()])(?:tee|cp|mv|rm|install|mkdir|touch)(?=$|[\s;&|()])/i.test(command)
    || /(?:sed|perl)\s+-[^\n]*i(?:\s|$)/i.test(command)
    || /(?:^|[\s;&|()])(?:python|python3|node|deno|ruby|php|npm|npx|bash|sh|zsh|fish)\b/i.test(command);
}

export function evaluate(payload, context = defaultContext) {
  const toolName = payload?.tool_name;
  const toolInput = payload?.tool_input || {};

  if (toolName === "Write" || toolName === "Edit") {
    const target = inputPath(toolInput);
    return target && touchesPlanning(target, context) ? deny() : null;
  }

  if (toolName === "Bash") {
    const command = String(toolInput.command || "");
    const firstToken = tokenizeSafely(command)[0];
    if (firstToken === context.approvedLauncher && /[;&|><`\n]|\$\(/.test(command)) return deny();
    if (hasPlanningToken(command) && containsWriteOperation(command)
      && !isStandaloneApprovedLauncher(command, context.approvedLauncher)) return deny();
  }
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try {
      if (Number(process.versions.node.split(".")[0]) < 20) throw new Error(FAIL_CLOSED_MESSAGE);
      const result = evaluate(JSON.parse(input));
      if (result) process.stdout.write(JSON.stringify(result));
    } catch (error) {
      process.stderr.write(`${FAIL_CLOSED_MESSAGE}\n`);
      process.stdout.write(JSON.stringify(deny(FAIL_CLOSED_MESSAGE)));
      process.exitCode = 2;
    }
  });
}
