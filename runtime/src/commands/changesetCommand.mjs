import fs from "node:fs";
import path from "node:path";
import { validateOperation, approveOperation, applyOperation, propose } from "../lib/changeset.mjs";
import { generateUuidV7 } from "../lib/ids.mjs";
import { renderWorkspaceInit, renderConfigUpdate, renderConfigAutonomySet, renderScopeAdd, renderScopeCommandSet, renderDiscoveryPropose } from "./renderers.mjs";
import { readChangeSet, readOperation } from "../lib/operationStore.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { prepareProposal } from "./proposalPreparation.mjs";
import { UsageError } from "../lib/errors.mjs";
import { confineRuntimeWritePath } from "../lib/paths.mjs";
import { readConfirmedSources, readConfirmedScopes } from "../lib/discoverScan.mjs";

function readCurrentConfig(planningRoot) {
  const configPath = confineRuntimeWritePath(planningRoot, "config.yml");
  return fs.existsSync(configPath) ? parseYaml(fs.readFileSync(configPath, "utf8")) : null;
}

function renderFor(kind, payload, currentConfig, workspaceRoot, { currentSources = [], currentScopes = [], approvalMode = "human" } = {}) {
  if (kind === "workspace.init") return renderWorkspaceInit(payload);
  if (kind === "config.update") return renderConfigUpdate(payload, currentConfig, { knownSourceIds: currentSources.map((source) => source.id) });
  if (kind === "config.autonomy.set") return renderConfigAutonomySet(payload, currentConfig);
  if (kind === "scope.add") return renderScopeAdd(payload, currentConfig, workspaceRoot);
  if (kind === "scope.command.set") {
    const currentScope = currentScopes.find((scope) => scope.id === payload.scopeId);
    return renderScopeCommandSet(payload, currentScope);
  }
  if (kind === "discovery.propose") return renderDiscoveryPropose(payload, currentConfig, workspaceRoot, { currentSources, currentScopes, approvalMode });
  throw new UsageError(`unsupported changeset kind: ${kind}`);
}

export function runChangesetPropose({ planningRoot, kind, payloadText, actor }) {
  let rawPayload;
  try {
    const trimmed = payloadText.trim();
    rawPayload = trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(trimmed);
  } catch (error) {
    throw new UsageError(`invalid payload: ${error.message}`);
  }
  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new UsageError("changeset payload must be a mapping/object");
  }
  const runtimeContext = {};
  if (kind === "scope.command.set") {
    runtimeContext.operationId = generateUuidV7();
    runtimeContext.actor = actor;
    runtimeContext.proposedAt = new Date().toISOString();
  }
  const { payload, targetFiles } = prepareProposal(kind, rawPayload, runtimeContext);
  const operationsRoot = path.join(planningRoot, "operations");
  const operationId = propose({
    operationsRoot,
    planningRoot,
    kind,
    target: {},
    payload,
    targetFiles,
    actor,
    operationId: runtimeContext.operationId || null,
    proposedAt: runtimeContext.proposedAt || null
  });
  return { operationId };
}

export function runChangesetValidate({ planningRoot, operationsRoot, operationId }) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  const currentConfig = changeSet.kind === "workspace.init" ? null : readCurrentConfig(planningRoot);
  const render = (payload) => renderFor(changeSet.kind, payload, currentConfig, path.dirname(planningRoot), { currentSources: readConfirmedSources(planningRoot), currentScopes: readConfirmedScopes(planningRoot) });
  validateOperation({ operationsRoot, planningRoot, operationId, render });
  const operation = readOperation(operationsRoot, operationId);
  return { status: operation.status, errors: operation.validation?.errors || [] };
}

export function runChangesetApprove({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval, mode = "human", authorizationContext = null }) {
  approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval: Boolean(allowSelfApproval), mode, authorizationContext });
  return { status: readOperation(operationsRoot, operationId).status };
}

export function runChangesetApply({ planningRoot, operationsRoot, operationId, actor }) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  const operation = readOperation(operationsRoot, operationId);
  const currentConfig = changeSet.kind === "workspace.init" ? null : readCurrentConfig(planningRoot);
  const render = (payload) => renderFor(changeSet.kind, payload, currentConfig, path.dirname(planningRoot), { currentSources: readConfirmedSources(planningRoot), currentScopes: readConfirmedScopes(planningRoot), approvalMode: operation.approval?.mode || "human" });
  return applyOperation({ operationsRoot, planningRoot, operationId, actor, render });
}
