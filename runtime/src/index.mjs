import fs from "node:fs";
import path from "node:path";
import { runInit, runConfigSet, runConfigScopeAdd } from "./commands/init.mjs";
import { runChangesetPropose, runChangesetValidate, runChangesetApprove, runChangesetApply } from "./commands/changesetCommand.mjs";
import { checkSchema } from "./commands/check.mjs";
import { runDiscoverScan, runDiscoverValidate } from "./commands/discover.mjs";
import { runDiscoveryPropose } from "./commands/discoveryChangeSet.mjs";
import { isUuidV7 } from "./lib/ids.mjs";
import { UsageError, StateError, StaleError } from "./lib/errors.mjs";
import { RecoveryRequiredError } from "./lib/journal.mjs";
import { LockHeldError } from "./lib/lock.mjs";
import { PathConfinementError } from "./lib/paths.mjs";

export { UsageError, StateError, StaleError, RecoveryRequiredError, LockHeldError, PathConfinementError };

const IN_SCOPE_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set"]);
const PROJECT_TYPES = new Set(["software", "non_software", "mixed", "unknown"]);

function requireProjectType(value) {
  if (value === undefined) return "unknown";
  if (!PROJECT_TYPES.has(value)) {
    throw new UsageError("--project-type must be one of software|non_software|mixed|unknown");
  }
  return value;
}

function notImplemented(command) {
  return {
    status: "NOT_IMPLEMENTED",
    command,
    corte: "0",
    message: "deferred to Corte N, see docs/plugin-redesign-release-flow/03-plan-incremental.md"
  };
}

function argsToOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) continue;
    const key = args[index].slice(2).replaceAll("-", "_");
    const next = args[index + 1];
    options[key] = next === undefined || next.startsWith("--") ? true : args[++index];
  }
  return options;
}

function requireOperationId(value) {
  if (!isUuidV7(value)) throw new UsageError(`invalid operation id: ${value}`);
  return value;
}

function requireExplicitBooleanOption(value, flagName) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new UsageError(`${flagName} requires explicit true or false`);
}

function readPayloadText(payloadFileArg, cwd, usage) {
  if (!payloadFileArg || payloadFileArg === true) throw new UsageError(usage);
  if (payloadFileArg === "-") return fs.readFileSync(0, "utf8");
  const resolved = path.resolve(cwd, payloadFileArg);
  if (!fs.existsSync(resolved)) throw new UsageError(`payload file not found: ${payloadFileArg}`);
  return fs.readFileSync(resolved, "utf8");
}

export function dispatch(command, args, cwd, runtimeContext = null) {
  const planningRoot = path.join(cwd, ".planning");
  const operationsRoot = path.join(planningRoot, "operations");

  if (command === "init") {
    const options = argsToOptions(args);
    if (!options.name || !options.actor) throw new UsageError("init requires --name and --actor");
    return runInit({ planningRoot, args: { name: options.name, projectType: requireProjectType(options.project_type), vcs: options.vcs, baseBranch: options.base_branch, actor: options.actor } });
  }

  if (command === "config") {
    const [stage, ...rest] = args;
    if (stage === "set") {
      const options = argsToOptions(rest);
      if (!options.name || !options.actor) throw new UsageError("config set requires --name and --actor");
      return runConfigSet({ planningRoot, args: { name: options.name, actor: options.actor } });
    }
    if (stage === "scope" && rest[0] === "add") {
      const options = argsToOptions(rest.slice(1));
      if (!options.key || !options.label || !options.kind || !options.path || !options.actor) {
        throw new UsageError("config scope add requires --key, --label, --kind, --path, --actor");
      }
      return runConfigScopeAdd({ planningRoot, args: { key: options.key, label: options.label, kind: options.kind, path: options.path, owner: options.owner, actor: options.actor } });
    }
    if (stage === "scope" && rest[0] === "set-command") {
      const options = argsToOptions(rest.slice(1));
      if (!options.scope_id || !options.role || !options.command || !options.actor) {
        throw new UsageError("config scope set-command requires --scope-id, --role, --command, --requires-environment, --requires-secrets, --actor");
      }
      if (options.requires_environment === undefined || options.requires_secrets === undefined) {
        throw new UsageError("config scope set-command requires explicit --requires-environment true|false and --requires-secrets true|false");
      }
      const payloadText = JSON.stringify({
        scopeId: options.scope_id,
        role: options.role,
        command: options.command,
        requiresEnvironment: requireExplicitBooleanOption(options.requires_environment, "--requires-environment"),
        requiresSecrets: requireExplicitBooleanOption(options.requires_secrets, "--requires-secrets")
      });
      return runChangesetPropose({ planningRoot, kind: "scope.command.set", payloadText, actor: options.actor });
    }
    if (stage === "autonomy" && rest[0] === "set") {
      const options = argsToOptions(rest.slice(1));
      if (!options.actor) throw new UsageError("config autonomy set requires --actor");
      const payloadText = readPayloadText(options.file || (options.stdin ? "-" : undefined), cwd, "config autonomy set requires --file <path> or --stdin");
      return runChangesetPropose({ planningRoot, kind: "config.autonomy.set", payloadText, actor: options.actor });
    }
    return notImplemented(`config ${stage || ""}`.trim());
  }

  if (command === "changeset") {
    const [stage, ...rest] = args;
    if (stage === "propose") {
      const options = argsToOptions(rest);
      if (!IN_SCOPE_KINDS.has(options.kind)) return notImplemented(`changeset propose --kind ${options.kind}`);
      if (!options.actor) throw new UsageError("changeset propose requires --actor");
      const payloadText = readPayloadText(options.payload_file, cwd, "changeset propose requires --payload-file <file|->");
      return runChangesetPropose({ planningRoot, kind: options.kind, payloadText, actor: options.actor });
    }
    if (stage === "validate") {
      const operationId = requireOperationId(rest[0]);
      return runChangesetValidate({ planningRoot, operationsRoot, operationId });
    }
    if (stage === "approve") {
      const operationId = requireOperationId(rest[0]);
      const options = argsToOptions(rest.slice(1));
      if (!options.actor) throw new UsageError("changeset approve requires --actor");
      return runChangesetApprove({
        operationsRoot,
        planningRoot,
        operationId,
        actor: options.actor,
        allowSelfApproval: Boolean(options.allow_self_approval),
        mode: options.mode || "human",
        authorizationContext: runtimeContext?.authorizationContext || null
      });
    }
    if (stage === "apply") {
      const operationId = requireOperationId(rest[0]);
      const options = argsToOptions(rest.slice(1));
      if (!options.actor) throw new UsageError("changeset apply requires --actor");
      return runChangesetApply({ planningRoot, operationsRoot, operationId, actor: options.actor });
    }
    return notImplemented(`changeset ${stage || ""}`.trim());
  }

  if (command === "check") {
    const [stage] = args;
    if (stage === "schema") return checkSchema({ planningRoot });
    return notImplemented(`check ${stage || ""}`.trim());
  }

  if (command === "discover") {
    const [stage, ...rest] = args;
    if (stage === "scan") {
      const options = argsToOptions(rest);
      const workspaceRoot = cwd;
      const scanArgs = { planningRoot, workspaceRoot };
      if (options.max_source_bytes !== undefined) {
        const parsed = Number(options.max_source_bytes);
        if (!Number.isInteger(parsed)) throw new UsageError(`--max-source-bytes must be an integer, got ${options.max_source_bytes}`);
        scanArgs.maxSourceBytes = parsed;
      }
      return runDiscoverScan(scanArgs);
    }
    if (stage === "validate") {
      const options = argsToOptions(rest);
      const proposalText = readPayloadText(options.file || (options.stdin ? "-" : undefined), cwd, "discover validate requires --file <path> or --stdin");
      return runDiscoverValidate({ planningRoot, workspaceRoot: cwd, proposalText });
    }
    if (stage === "propose") {
      const options = argsToOptions(rest);
      if (!options.actor) throw new UsageError("discover propose requires --actor");
      const proposalText = readPayloadText(options.file || (options.stdin ? "-" : undefined), cwd, "discover propose requires --file <path> or --stdin");
      return runDiscoveryPropose({ planningRoot, workspaceRoot: cwd, proposalText, actor: options.actor });
    }
    return notImplemented(`discover ${stage || ""}`.trim());
  }

  return notImplemented(command);
}
