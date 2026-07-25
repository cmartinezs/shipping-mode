#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dispatch, UsageError, StateError, StaleError, RecoveryRequiredError, LockHeldError, PathConfinementError
} from "../runtime/dist/shipping-mode.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const args = process.argv.slice(2);

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function exitCodeForValue(value) {
  if (value?.status === "NOT_IMPLEMENTED") return 3;
  if (["INVALID", "STALE", "RECOVERY_REQUIRED", "FAIL", "NOT_INITIALIZED"].includes(value?.status)) return 1;
  return 0;
}

function exitCodeForError(error) {
  if (error instanceof UsageError) return 1;
  if (error instanceof StateError) return 1;
  if (error instanceof StaleError) return 1;
  if (error instanceof RecoveryRequiredError) return 1;
  if (error instanceof LockHeldError) return 1;
  if (error instanceof PathConfinementError) return 1;
  return 2;
}

if (args[0] === "--version") {
  output({ product: manifest.name, version: manifest.version });
} else if (args[0] === "--help" || args.length === 0) {
  output({
    product: manifest.name,
    version: manifest.version,
    commands: [
      "init --name <name> [--base-branch <b>] [--vcs git|none] --actor <actor>",
      "config set --name <name> --actor <actor>",
      "config scope add --key <slug> --label <label> --kind code|non_code --path <path> [--owner <o>] --actor <actor>",
      "changeset propose --kind <workspace.init|config.update|scope.add> --payload-file <file|-> --actor <actor>",
      "changeset validate <operation-id>",
      "changeset approve <operation-id> --actor <actor> [--allow-self-approval]",
      "changeset apply <operation-id> --actor <actor>",
      "check schema",
      "--help", "--version"
    ]
  });
} else {
  try {
    const result = dispatch(args[0], args.slice(1), process.cwd());
    output({ product: manifest.name, ...result });
    process.exitCode = exitCodeForValue(result);
  } catch (error) {
    output({ product: manifest.name, error: error.message });
    process.exitCode = exitCodeForError(error);
  }
}
