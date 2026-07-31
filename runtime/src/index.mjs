import fs from "node:fs";
import path from "node:path";
import { runInit, runConfigSet, runConfigScopeAdd } from "./commands/init.mjs";
import { runChangesetPropose, runChangesetValidate, runChangesetApprove, runChangesetApply } from "./commands/changesetCommand.mjs";
import { checkSchema, checkRelease, checkWorkSources, checkSourceDrift } from "./commands/check.mjs";
import { checkGuides } from "./commands/checkGuides.mjs";
import { runReleaseNew, runReleaseStatus, runReleasePolicyConfigure, runReleaseScopeSet, runReleaseRefsSet, runReleaseDeploymentRecord, runReleaseFinalize } from "./commands/release.mjs";
import { runCheckItem, runCheckWorkPackage, runItemCreate, runItemImport, runItemRefresh, runItemPackageAdd, runItemPackageStatus, runItemStatus } from "./commands/item.mjs";
import { runDiscoverScan, runDiscoverValidate } from "./commands/discover.mjs";
import { runDiscoveryPropose } from "./commands/discoveryChangeSet.mjs";
import { isUuidV7 } from "./lib/ids.mjs";
import { UsageError, StateError, StaleError } from "./lib/errors.mjs";
import { RecoveryRequiredError } from "./lib/journal.mjs";
import { LockHeldError } from "./lib/lock.mjs";
import { PathConfinementError } from "./lib/paths.mjs";
import { evaluateCondition } from "./lib/guideEvaluator.mjs";
import { renderGuideMarkdown, compareGuideProjection } from "./lib/guideProjection.mjs";
import { evaluateGuideHealth, evaluateGuideReadiness } from "./lib/guideHealth.mjs";

export { UsageError, StateError, StaleError, RecoveryRequiredError, LockHeldError, PathConfinementError, evaluateCondition, renderGuideMarkdown, compareGuideProjection, evaluateGuideHealth, evaluateGuideReadiness };

const IN_SCOPE_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set", "scope.generator.set", "guide.update", "release.create", "release.policy.configure", "release.scopeRefs.set", "release.operationalRefs.set", "release.deployment.record", "release.finalization.complete", "release-item.create", "work-package.create", "work-source.import", "work-source.refresh"]);
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

function splitCsv(value) {
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseCheckReleaseArgs(args) {
  let reference = null;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--format") {
      const format = args[++index];
      if (!format || format.startsWith("--")) throw new UsageError("check release --format requires json");
      if (format !== "json") throw new UsageError("check release --format must be json");
      continue;
    }
    if (value.startsWith("--")) throw new UsageError(`check release does not support option ${value}`);
    if (reference !== null) throw new UsageError("check release accepts at most one id-or-display-id");
    reference = value;
  }
  return reference;
}

function parseCheckItemArgs(args) {
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--format") {
      const format = args[++index];
      if (!format || format.startsWith("--")) throw new UsageError("check item --format requires json");
      if (format !== "json") throw new UsageError("check item --format must be json");
      continue;
    }
    if (value.startsWith("--")) throw new UsageError(`check item does not support option ${value}`);
    positional.push(value);
  }
  if (positional.length !== 2) throw new UsageError("check item requires <release-id-or-display-id> <item-id-or-display-id>");
  return { releaseRef: positional[0], itemRef: positional[1] };
}

function parseCheckWorkPackageArgs(args) {
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--format") {
      const format = args[++index];
      if (!format || format.startsWith("--")) throw new UsageError("check work-package --format requires json");
      if (format !== "json") throw new UsageError("check work-package --format must be json");
      continue;
    }
    if (value.startsWith("--")) throw new UsageError(`check work-package does not support option ${value}`);
    positional.push(value);
  }
  if (positional.length !== 3) throw new UsageError("check work-package requires <release-id-or-display-id> <item-id-or-display-id> <work-package-id-or-display-id>");
  return { releaseRef: positional[0], itemRef: positional[1], packageRef: positional[2] };
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
      return runChangesetValidate({ planningRoot, operationsRoot, operationId, runtimeContext });
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
      return runChangesetApply({ planningRoot, operationsRoot, operationId, actor: options.actor, runtimeContext });
    }
    return notImplemented(`changeset ${stage || ""}`.trim());
  }

  if (command === "release") {
    const [stage, ...rest] = args;
    if (stage === "new") {
      const options = argsToOptions(rest);
      if (!options.title || !options.objective || !options.actor) throw new UsageError("release new requires --title, --objective and --actor");
      return runReleaseNew({
        planningRoot,
        args: {
          title: options.title,
          objective: options.objective,
          laneId: options.lane_id,
          policyMode: options.policy_mode,
          slug: options.slug,
          idempotencyKey: options.idempotency_key,
          actor: options.actor
        }
      });
    }
    if (stage === "status") {
      const reference = rest[0];
      if (!reference) throw new UsageError("release status requires <id-or-display-id>");
      return runReleaseStatus({ planningRoot, reference });
    }
    if (stage === "policy" && rest[0] === "configure") {
      const reference = rest[1];
      const options = argsToOptions(rest.slice(2));
      if (!reference || !options.actor) throw new UsageError("release policy configure requires <id-or-display-id> and --actor");
      return runReleasePolicyConfigure({
        planningRoot,
        args: {
          releaseRef: reference,
          laneId: options.lane_id,
          policyMode: options.policy_mode,
          previousReleaseRefs: options.previous_release_refs,
          dependencyRefs: options.dependency_refs,
          idempotencyKey: options.idempotency_key,
          actor: options.actor
        }
      });
    }
    if (stage === "scope" && rest[0] === "set") {
      const reference = rest[1];
      const options = argsToOptions(rest.slice(2));
      if (!reference || !options.actor) throw new UsageError("release scope set requires <id-or-display-id>, --scope-ids and --actor");
      return runReleaseScopeSet({ planningRoot, args: { releaseRef: reference, scopeIds: options.scope_ids, policyMode: options.policy_mode, idempotencyKey: options.idempotency_key, actor: options.actor } });
    }
    if (stage === "refs" && rest[0] === "set") {
      const reference = rest[1];
      const options = argsToOptions(rest.slice(2));
      if (!reference || !options.actor) throw new UsageError("release refs set requires <id-or-display-id> and --actor");
      return runReleaseRefsSet({ planningRoot, args: { releaseRef: reference, executionContextRefs: options.execution_context_refs, environmentRefs: options.environment_refs, idempotencyKey: options.idempotency_key, actor: options.actor } });
    }
    if (stage === "deployment" && rest[0] === "record") {
      const reference = rest[1];
      const options = argsToOptions(rest.slice(2));
      if (!reference || !options.environment_ref || !options.status || !options.actor) throw new UsageError("release deployment record requires <id-or-display-id>, --environment-ref, --status and --actor");
      return runReleaseDeploymentRecord({
        planningRoot,
        args: {
          releaseRef: reference,
          environmentRef: options.environment_ref,
          executionContextRef: options.execution_context_ref,
          status: options.status,
          artifactRefs: options.artifact_refs,
          evidenceRefs: options.evidence_refs,
          completedAt: options.completed_at,
          idempotencyKey: options.idempotency_key,
          actor: options.actor
        }
      });
    }
    if (stage === "finalize") {
      const reference = rest[0];
      const options = argsToOptions(rest.slice(1));
      if (!reference || !options.actor) throw new UsageError("release finalize requires <id-or-display-id> and --actor");
      return runReleaseFinalize({ planningRoot, args: { releaseRef: reference, retrospectiveStatus: options.retrospective_status, idempotencyKey: options.idempotency_key, actor: options.actor } });
    }
    return notImplemented(`release ${stage || ""}`.trim());
  }

  if (command === "item") {
    const [stage, ...rest] = args;
    if (stage === "create") {
      const releaseRef = rest[0];
      const options = argsToOptions(rest.slice(1));
      if (!releaseRef || !options.kind || !options.title || !options.actor) throw new UsageError("item create requires <release-id-or-display-id>, --kind, --title and --actor");
      return runItemCreate({
        planningRoot,
        releaseRef,
        args: {
          kind: options.kind,
          title: options.title,
          description: options.description,
          dependencyRefs: options.dependency_refs,
          slug: options.slug,
          idempotencyKey: options.idempotency_key,
          commandActor: options.actor,
          actor: options.item_actor,
          need: options.need,
          value: options.value,
          acceptanceCriteria: options.acceptance_criteria === undefined ? undefined : splitCsv(options.acceptance_criteria),
          outcome: options.outcome,
          behavior: options.behavior,
          observedBehavior: options.observed_behavior,
          expectedBehavior: options.expected_behavior,
          reproduction: options.reproduction,
          severity: options.severity,
          technicalOutcome: options.technical_outcome,
          unlockedCapabilities: options.unlocked_capabilities === undefined ? undefined : splitCsv(options.unlocked_capabilities),
          question: options.question,
          timebox: options.timebox,
          expectedDecision: options.expected_decision,
          obligation: options.obligation,
          authority: options.authority,
          deadline: options.deadline,
          evidence: options.evidence === undefined ? undefined : splitCsv(options.evidence),
          sourceState: options.source_state,
          targetState: options.target_state,
          rollback: options.rollback,
          procedure: options.procedure,
          owner: options.owner
        }
      });
    }
    if (stage === "package" && rest[0] === "add") {
      const releaseRef = rest[1];
      const itemRef = rest[2];
      const options = argsToOptions(rest.slice(3));
      if (!releaseRef || !itemRef || !options.scope_id || !options.commitment || !options.title || !options.actor) {
        throw new UsageError("item package add requires <release-id-or-display-id> <item-id-or-display-id>, --scope-id, --commitment, --title and --actor");
      }
      return runItemPackageAdd({
        planningRoot,
        releaseRef,
        itemRef,
        args: {
          scopeId: options.scope_id,
          commitment: options.commitment,
          title: options.title,
          description: options.description,
          design: options.design,
          dependencyRefs: options.dependencies,
          idempotencyKey: options.idempotency_key,
          commandActor: options.actor
        }
      });
    }
    if (stage === "import") {
      const releaseRef = rest[0];
      const options = argsToOptions(rest.slice(1));
      if (!releaseRef || !options.source || !options.actor) throw new UsageError("item import requires <release-id-or-display-id>, --source <source-id:item-id-or-path> and --actor");
      return runItemImport({
        planningRoot,
        releaseRef,
        args: {
          sourceRef: options.source,
          idempotencyKey: options.idempotency_key,
          commandActor: options.actor
        },
        runtimeContext
      });
    }
    if (stage === "refresh") {
      const releaseRef = rest[0];
      const itemRef = rest[1];
      const options = argsToOptions(rest.slice(2));
      if (!releaseRef || !itemRef || !options.actor) throw new UsageError("item refresh requires <release-id-or-display-id> <item-id-or-display-id> and --actor");
      return runItemRefresh({ planningRoot, releaseRef, itemRef, args: { commandActor: options.actor, idempotencyKey: options.idempotency_key }, runtimeContext });
    }
    if (stage === "package" && rest[0] === "status") {
      const releaseRef = rest[1];
      const itemRef = rest[2];
      const packageRef = rest[3];
      if (!releaseRef || !itemRef || !packageRef) throw new UsageError("item package status requires <release-id-or-display-id> <item-id-or-display-id> <work-package-id-or-display-id>");
      return runItemPackageStatus({ planningRoot, releaseRef, itemRef, packageRef });
    }
    if (stage === "status") {
      const releaseRef = rest[0];
      const itemRef = rest[1];
      if (!releaseRef || !itemRef) throw new UsageError("item status requires <release-id-or-display-id> <item-id-or-display-id>");
      return runItemStatus({ planningRoot, releaseRef, itemRef });
    }
    return notImplemented(`item ${stage || ""}`.trim());
  }

  if (command === "check") {
    const [stage, ...rest] = args;
    if (stage === "schema") return checkSchema({ planningRoot });
    if (stage === "release") return checkRelease({ planningRoot, reference: parseCheckReleaseArgs(rest) });
    if (stage === "item") {
      const parsed = parseCheckItemArgs(rest);
      return runCheckItem({ planningRoot, releaseRef: parsed.releaseRef, itemRef: parsed.itemRef });
    }
    if (stage === "work-package") {
      const parsed = parseCheckWorkPackageArgs(rest);
      return runCheckWorkPackage({ planningRoot, releaseRef: parsed.releaseRef, itemRef: parsed.itemRef, packageRef: parsed.packageRef });
    }
    if (stage === "work-sources") {
      for (let index = 0; index < rest.length; index += 1) {
        if (rest[index] === "--format") {
          const format = rest[++index];
          if (!format || format.startsWith("--")) throw new UsageError("check work-sources --format requires json");
          if (format !== "json") throw new UsageError("check work-sources --format must be json");
          continue;
        }
        throw new UsageError(`check work-sources does not support argument ${rest[index]}`);
      }
      return checkWorkSources({ planningRoot, workspaceRoot: cwd });
    }
    if (stage === "source-drift") {
      let reference = null;
      for (let index = 0; index < rest.length; index += 1) {
        if (rest[index] === "--format") {
          const format = rest[++index];
          if (format !== "json") throw new UsageError("check source-drift --format must be json");
          continue;
        }
        if (rest[index].startsWith("--")) throw new UsageError(`check source-drift does not support argument ${rest[index]}`);
        if (reference !== null) throw new UsageError("check source-drift accepts at most one release reference");
        reference = rest[index];
      }
      return checkSourceDrift({ planningRoot, reference, runtimeContext });
    }
    if (stage === "guides") {
      const options = argsToOptions(rest);
      return checkGuides({ planningRoot, workspaceRoot: cwd, scopeId: options.scope_id || null, policyMode: options.mode || "strict" });
    }
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
