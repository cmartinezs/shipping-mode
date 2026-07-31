import fs from "node:fs";
import path from "node:path";
import { validateOperation, approveOperation, applyOperation, propose } from "../lib/changeset.mjs";
import { generateUuidV7 } from "../lib/ids.mjs";
import { renderWorkspaceInit, renderConfigUpdate, renderConfigAutonomySet, renderScopeAdd, renderScopeCommandSet, renderScopeGeneratorSet, renderDiscoveryPropose, renderGuideUpdate, renderReleaseCreate, renderReleasePlan2Mutation, renderReleaseItemCreateChangeSet, renderWorkPackageCreateChangeSet, renderWorkSourceImportChangeSet } from "./renderers.mjs";
import { readChangeSet, readOperation } from "../lib/operationStore.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { prepareProposal } from "./proposalPreparation.mjs";
import { UsageError } from "../lib/errors.mjs";
import { confineRuntimeWritePath } from "../lib/paths.mjs";
import { readConfirmedSources, readConfirmedScopes } from "../lib/discoverScan.mjs";
import { generateGuideOutput } from "../lib/guideGeneration.mjs";
import { revisionHash } from "../lib/canonical.mjs";
import { proposeReleaseCreate, proposeReleasePlan2Mutation } from "./release.mjs";
import { proposeReleaseItemCreate, proposeWorkPackageCreate, proposeWorkSourceImport } from "./item.mjs";
import { renderWorkSourceRefresh } from "../lib/workSourceRefresh.mjs";

function readCurrentConfig(planningRoot) {
  const configPath = confineRuntimeWritePath(planningRoot, "config.yml");
  return fs.existsSync(configPath) ? parseYaml(fs.readFileSync(configPath, "utf8")) : null;
}

function renderFor(kind, payload, currentConfig, workspaceRoot, planningRoot, { currentSources = [], currentScopes = [], approvalMode = "human", approval = null, proposedAt = null } = {}) {
  if (kind === "workspace.init") return renderWorkspaceInit(payload);
  if (kind === "config.update") return renderConfigUpdate(payload, currentConfig, { knownSourceIds: currentSources.map((source) => source.id) });
  if (kind === "config.autonomy.set") return renderConfigAutonomySet(payload, currentConfig);
  if (kind === "scope.add") return renderScopeAdd(payload, currentConfig, workspaceRoot);
  if (kind === "scope.command.set") {
    const currentScope = currentScopes.find((scope) => scope.id === payload.scopeId);
    return renderScopeCommandSet(payload, currentScope);
  }
  if (kind === "scope.generator.set") {
    const currentScope = currentScopes.find((scope) => scope.id === payload.scopeId);
    return renderScopeGeneratorSet(payload, currentScope, workspaceRoot);
  }
  if (kind === "discovery.propose") return renderDiscoveryPropose(payload, currentConfig, workspaceRoot, { currentSources, currentScopes, approvalMode });
  if (kind === "guide.update") return renderGuideUpdate(payload, currentConfig, planningRoot, { currentSources, proposedAt: payload.proposedAt || proposedAt || new Date().toISOString(), approval });
  if (kind === "release.create") return renderReleaseCreate(payload);
  if (kind === "release-item.create") return renderReleaseItemCreateChangeSet(payload, planningRoot);
  if (kind === "work-source.import") return renderWorkSourceImportChangeSet(payload, planningRoot);
  if (kind === "work-source.refresh") return renderWorkSourceRefresh(payload, { planningRoot });
  if (kind === "work-package.create") return renderWorkPackageCreateChangeSet(payload, planningRoot);
  if (kind.startsWith("release.")) return renderReleasePlan2Mutation(kind, payload, planningRoot, workspaceRoot, currentConfig);
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
  if (kind === "guide.update" && ["generate", "regenerate"].includes(rawPayload.action)) {
    if (rawPayload.generationEvidence !== undefined) throw new UsageError("generationEvidence is server-owned");
    if (rawPayload.document === undefined) {
      const config = readCurrentConfig(planningRoot);
      const scope = readConfirmedScopes(planningRoot).find((candidate) => candidate.id === rawPayload.scopeId);
      if (!scope) throw new UsageError(`guide scope not found: ${rawPayload.scopeId}`);
      let generated;
      try {
        generated = generateGuideOutput({ workspaceRoot: path.dirname(planningRoot), scope, guideKind: rawPayload.guideKind, sources: readConfirmedSources(planningRoot), config });
      } catch (error) {
        throw new UsageError(error.message);
      }
      rawPayload = { ...rawPayload, document: generated.document, generationEvidence: generated.evidence };
    } else {
      rawPayload = {
        ...rawPayload,
        generationEvidence: {
          generationMethod: "manual",
          generatorVersion: "shipping-mode:manual-guide-input/1",
          generatorFingerprint: null,
          generationInputHash: revisionHash({ scopeId: rawPayload.scopeId, guideKind: rawPayload.guideKind, document: rawPayload.document }),
          generationOutputHash: revisionHash(rawPayload.document)
        }
      };
    }
  }
  if (kind === "release.create") {
    const created = proposeReleaseCreate({ planningRoot, rawPayload, actor });
    return { operationId: created.operationId, releaseId: created.releaseId, displayId: created.displayId, idempotent: created.idempotent };
  }
  if (kind.startsWith("release.")) {
    const proposed = proposeReleasePlan2Mutation({ planningRoot, rawPayload, actor, kind });
    return { operationId: proposed.operationId, releaseId: proposed.releaseId, idempotent: proposed.idempotent };
  }
  if (kind === "release-item.create") {
    const releaseRef = rawPayload.releaseRef;
    if (!releaseRef) throw new UsageError("changeset propose --kind release-item.create requires releaseRef in the payload");
    const { releaseRef: _releaseRef, ...itemPayload } = rawPayload;
    const proposed = proposeReleaseItemCreate({ planningRoot, releaseRef, rawPayload: itemPayload, actor });
    return { operationId: proposed.operationId, releaseId: proposed.releaseId, itemId: proposed.itemId, displayId: proposed.displayId, idempotent: proposed.idempotent };
  }
  if (kind === "work-source.import") {
    const releaseRef = rawPayload.releaseRef;
    if (!releaseRef) throw new UsageError("changeset propose --kind work-source.import requires releaseRef in the payload");
    const { releaseRef: _releaseRef, ...importPayload } = rawPayload;
    const proposed = proposeWorkSourceImport({ planningRoot, releaseRef, rawPayload: importPayload, actor });
    return { operationId: proposed.operationId, releaseId: proposed.releaseId, itemId: proposed.itemId, displayId: proposed.displayId, idempotent: proposed.idempotent };
  }
  if (kind === "work-package.create") {
    const releaseRef = rawPayload.releaseRef;
    const itemRef = rawPayload.itemRef;
    if (!releaseRef || !itemRef) throw new UsageError("changeset propose --kind work-package.create requires releaseRef and itemRef in the payload");
    const { releaseRef: _releaseRef, itemRef: _itemRef, ...packagePayload } = rawPayload;
    const proposed = proposeWorkPackageCreate({ planningRoot, releaseRef, itemRef, rawPayload: packagePayload, actor });
    return { operationId: proposed.operationId, releaseId: proposed.releaseId, itemId: proposed.itemId, packageId: proposed.packageId, displayId: proposed.displayId, idempotent: proposed.idempotent };
  }
  const runtimeContext = {};
  if (kind === "scope.command.set" || kind === "scope.generator.set" || kind === "guide.update") {
    runtimeContext.operationId = generateUuidV7();
    runtimeContext.actor = actor;
    runtimeContext.proposedAt = new Date().toISOString();
  }
  const { payload, targetFiles } = prepareProposal(kind, rawPayload, runtimeContext);
  const operationsRoot = path.join(planningRoot, "operations");
  const candidateOperationId = runtimeContext.operationId || null;
  const operationId = propose({
    operationsRoot,
    planningRoot,
    kind,
    target: {},
    payload,
    targetFiles,
    actor,
    operationId: candidateOperationId,
    proposedAt: runtimeContext.proposedAt || null
  });
  return { operationId };
}

export function runChangesetValidate({ planningRoot, operationsRoot, operationId, runtimeContext = null }) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  const currentConfig = changeSet.kind === "workspace.init" ? null : readCurrentConfig(planningRoot);
  const render = (payload) => changeSet.kind === "work-source.refresh"
    ? renderWorkSourceRefresh(payload, { planningRoot, runtimeContext })
    : renderFor(changeSet.kind, payload, currentConfig, path.dirname(planningRoot), planningRoot, { currentSources: readConfirmedSources(planningRoot), currentScopes: readConfirmedScopes(planningRoot), proposedAt: changeSet.proposedAt });
  validateOperation({ operationsRoot, planningRoot, operationId, render });
  const operation = readOperation(operationsRoot, operationId);
  return { status: operation.status, errors: operation.validation?.errors || [] };
}

export function runChangesetApprove({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval, mode = "human", authorizationContext = null }) {
  approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval: Boolean(allowSelfApproval), mode, authorizationContext });
  return { status: readOperation(operationsRoot, operationId).status };
}

export function runChangesetApply({ planningRoot, operationsRoot, operationId, actor, runtimeContext = null }) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  const operation = readOperation(operationsRoot, operationId);
  const currentConfig = changeSet.kind === "workspace.init" ? null : readCurrentConfig(planningRoot);
  const render = (payload) => changeSet.kind === "work-source.refresh"
    ? renderWorkSourceRefresh(payload, { planningRoot, runtimeContext })
    : renderFor(changeSet.kind, payload, currentConfig, path.dirname(planningRoot), planningRoot, { currentSources: readConfirmedSources(planningRoot), currentScopes: readConfirmedScopes(planningRoot), approvalMode: operation.approval?.mode || "human", approval: operation.approval, proposedAt: changeSet.proposedAt });
  return applyOperation({ operationsRoot, planningRoot, operationId, actor, render });
}
