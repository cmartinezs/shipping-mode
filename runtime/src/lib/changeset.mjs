import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "./ids.mjs";
import { revisionHash, contentHash, ABSENT } from "./canonical.mjs";
import { confineRuntimeWritePath, ensureDirectoryTree } from "./paths.mjs";
import { assertDistinctMutationTargets, copyFileAtomic, deleteWithinRoot, removeEmptyParentDirectoryWithinRoot, renameWithinRoot, writeFileAtomic } from "./safeFs.mjs";
import { parseYaml } from "./yaml.mjs";
import { withWorkspaceMutation } from "./mutation.mjs";
import { writeOperation, readOperation, writeChangeSet, readChangeSet, writeResult } from "./operationStore.mjs";
import { validate as validateSchema } from "./schema.mjs";
import { StateError, StaleError } from "./errors.mjs";
import { buildExpectedEvent, writeEventIdempotent } from "./journal.mjs";
import { checkpoint } from "./faultInjection.mjs";
import { runDiscoverScan } from "./discoverScan.mjs";
import { bindAutonomyEvaluation, evaluateChangeSetAutonomy, currentPolicyFingerprint, hasAutonomousApprovalCapability, REASON_CODES } from "./autonomy.mjs";
import { DIRECTORY_CONTENT_HASH, isDirectoryRenderEntry } from "./bootstrapTopology.mjs";

export function readFileState(planningRoot, relativePath) {
  const absolutePath = confineRuntimeWritePath(planningRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { revisionHash: ABSENT, contentHash: ABSENT };
  }
  const stat = fs.lstatSync(absolutePath);
  if (stat.isDirectory()) {
    return { revisionHash: DIRECTORY_CONTENT_HASH, contentHash: DIRECTORY_CONTENT_HASH };
  }
  const bytes = fs.readFileSync(absolutePath);
  const isStructured = relativePath.endsWith(".yml") || relativePath.endsWith(".yaml") || relativePath.endsWith(".json");
  const structuredValue = isStructured
    ? (relativePath.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : parseYaml(bytes.toString("utf8")))
    : null;
  return {
    revisionHash: isStructured ? revisionHash(structuredValue) : contentHash(bytes),
    contentHash: contentHash(bytes)
  };
}

export function computePersistedChangeSetHash(changeSet) {
  const { hash, ...withoutHash } = changeSet;
  return revisionHash(withoutHash);
}

export function eventTypeFor(kind) {
  return {
    "workspace.init": "workspace.initialized",
    "config.update": "config.updated",
    "config.autonomy.set": "config.autonomy.set",
    "scope.add": "scope.added",
    "scope.command.set": "scope.command.set",
    "discovery.propose": "discovery.proposed",
    "guide.update": "guide.updated"
  }[kind];
}

export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor, operationId = null, proposedAt = null, preconditions = null }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId: null }, () => {
    operationId ??= generateUuidV7();
    assertDistinctMutationTargets(planningRoot, targetFiles);

    const baseRevisions = {};
    for (const relativePath of targetFiles) {
      baseRevisions[relativePath] = readFileState(planningRoot, relativePath);
    }

    const changeSetWithoutHash = { schemaVersion: 1, operationId, kind, target, baseRevisions, payload };
    if (preconditions) changeSetWithoutHash.preconditions = preconditions;
    const hash = computePersistedChangeSetHash(changeSetWithoutHash);
    writeChangeSet(operationsRoot, operationId, { ...changeSetWithoutHash, hash });

    const reservedEvents = [{ eventId: generateUuidV7(), type: eventTypeFor(kind) }];
    proposedAt ??= new Date().toISOString();
    const operation = {
      id: operationId,
      kind,
      status: "PROPOSED",
      proposedBy: actor,
      proposedAt,
      reservedEvents,
      validation: { validatedAt: null, changeSetHash: null, errors: [] },
      approval: { actor: null, approvedAt: null, changeSetHash: null, selfApproval: null, mode: null },
      history: [{ at: proposedAt, from: null, to: "PROPOSED", actor, reason: null }]
    };
    writeOperation(operationsRoot, operationId, operation);

    return operationId;
  });
}

function schemaNameForRenderedPath(relativePath) {
  if (relativePath === "config.yml") return "config";
  if (relativePath === "plugin.lock.yml") return "plugin-lock";
  if (/^sources\/[^/]+\/source\.yml$/.test(relativePath)) return "source";
  if (/^scopes\/[^/]+\/scope\.yml$/.test(relativePath)) return "scope";
  if (/^scopes\/[^/]+\/(task|test)-guide\.yml$/.test(relativePath)) return "guide";
  return null;
}

function checkKindInvariants(changeSet) {
  const errors = [];
  if (changeSet.kind === "workspace.init") {
    for (const relativePath of Object.keys(changeSet.baseRevisions)) {
      const entry = changeSet.baseRevisions[relativePath];
      if (!entry || entry.revisionHash !== ABSENT || entry.contentHash !== ABSENT) {
        errors.push(`${relativePath} must be ABSENT for workspace.init; the workspace already appears initialized -- use config set to update it instead`);
      }
    }
  }
  if (changeSet.kind === "scope.add") {
    const scopePath = `scopes/${changeSet.payload.id}/scope.yml`;
    const entry = changeSet.baseRevisions[scopePath];
    if (!entry || entry.revisionHash !== ABSENT || entry.contentHash !== ABSENT) {
      errors.push(`${scopePath} must be ABSENT for a new scope.add, but baseRevisions recorded something else`);
    }
  }
  if (changeSet.kind === "guide.update") {
    const guidePath = `scopes/${changeSet.payload.scopeId}/${changeSet.payload.guideKind}-guide.yml`;
    const requiresGuideFile = ["generate", "regenerate"].includes(changeSet.payload.action);
    const expectedPaths = new Set(["config.yml", `scopes/${changeSet.payload.scopeId}/scope.yml`, ...(requiresGuideFile ? [guidePath] : [])]);
    const actualPaths = new Set(Object.keys(changeSet.baseRevisions));
    if (expectedPaths.size !== actualPaths.size || [...expectedPaths].some((target) => !actualPaths.has(target))) {
      errors.push("guide.update baseRevisions must contain exactly the scope metadata and, for generation, the canonical guide file");
    }
    if (changeSet.payload.action === "generate" && [...actualPaths].some((target) => target === guidePath && changeSet.baseRevisions[target].contentHash !== ABSENT)) {
      errors.push(`${guidePath} must be ABSENT for initial guide.generate`);
    }
  }
  return errors;
}

function revalidateChangeSet({ operationsRoot, planningRoot, operationId, render }) {
  const changeSet = readChangeSet(operationsRoot, operationId);

  if (changeSet.operationId !== operationId) {
    return { ok: false, status: "INVALID", errors: [`change-set.json operationId ${changeSet.operationId} does not match operation ${operationId}`], recomputedHash: null };
  }

  const recomputedHash = computePersistedChangeSetHash(changeSet);
  if (recomputedHash !== changeSet.hash) {
    return { ok: false, status: "INVALID", errors: ["change-set.json hash does not match its own recomputed content; the file has been tampered with or corrupted"], recomputedHash };
  }

  const changeSetResult = validateSchema("change-set", changeSet);
  if (!changeSetResult.valid) {
    return { ok: false, status: "INVALID", errors: changeSetResult.errors.map((e) => `change-set${e.path}: ${e.message}`), recomputedHash };
  }

  const invariantErrors = checkKindInvariants(changeSet);
  if (invariantErrors.length > 0) {
    return { ok: false, status: "INVALID", errors: invariantErrors, recomputedHash };
  }

  let rendered;
  try {
    rendered = render(changeSet.payload);
    assertDistinctMutationTargets(planningRoot, [...rendered.keys()]);
  } catch (error) {
    return { ok: false, status: "INVALID", errors: [error.message], recomputedHash };
  }

  const renderedPaths = new Set(rendered.keys());
  const baseRevisionPaths = new Set(Object.keys(changeSet.baseRevisions));
  const missingFromBaseRevisions = [...renderedPaths].filter((p) => !baseRevisionPaths.has(p));
  const extraInBaseRevisions = [...baseRevisionPaths].filter((p) => !renderedPaths.has(p));
  if (missingFromBaseRevisions.length > 0 || extraInBaseRevisions.length > 0) {
    return {
      ok: false,
      status: "INVALID",
      errors: [`baseRevisions must exactly match the rendered file set; missing=${JSON.stringify(missingFromBaseRevisions)} extra=${JSON.stringify(extraInBaseRevisions)}`],
      recomputedHash
    };
  }

  for (const [relativePath, expected] of Object.entries(changeSet.baseRevisions)) {
    const actual = readFileState(planningRoot, relativePath);
    if (actual.revisionHash !== expected.revisionHash || actual.contentHash !== expected.contentHash) {
      return { ok: false, status: "STALE", errors: [`${relativePath} changed since propose`], recomputedHash };
    }
  }

  const renderErrors = [];
  for (const [relativePath, content] of rendered) {
    if (content === null || isDirectoryRenderEntry(content)) continue;
    const schemaName = schemaNameForRenderedPath(relativePath);
    if (!schemaName) continue;
    const value = parseYaml(content);
    const result = validateSchema(schemaName, value);
    if (!result.valid) {
      for (const error of result.errors) renderErrors.push(`${relativePath}${error.path}: ${error.message}`);
    }
  }
  if (renderErrors.length > 0) {
    return { ok: false, status: "INVALID", errors: renderErrors, recomputedHash };
  }

  return { ok: true, recomputedHash, changeSet, rendered };
}

function transitionToStale(operationsRoot, operationId, operation, reason) {
  const staleAt = new Date().toISOString();
  writeOperation(operationsRoot, operationId, {
    ...operation,
    status: "STALE",
    history: [...operation.history, { at: staleAt, from: operation.status, to: "STALE", actor: "system:validator", reason }]
  });
  throw new StaleError(reason);
}

export function validateOperation({ operationsRoot, planningRoot, operationId, render }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId }, () => {
    const operation = readOperation(operationsRoot, operationId);
    if (operation.status !== "PROPOSED") {
      throw new StateError(`cannot validate operation in status ${operation.status}`);
    }

    const result = revalidateChangeSet({ operationsRoot, planningRoot, operationId, render });
    const validatedAt = new Date().toISOString();

    if (!result.ok) {
      writeOperation(operationsRoot, operationId, {
        ...operation,
        status: result.status,
        validation: { validatedAt, changeSetHash: result.recomputedHash, errors: result.errors },
        history: [...operation.history, { at: validatedAt, from: operation.status, to: result.status, actor: "system:validator", reason: result.errors[0] }]
      });
      return;
    }

    const nextOperation = {
      ...operation,
      status: "VALIDATED",
      validation: { validatedAt, changeSetHash: result.recomputedHash, errors: [] },
      history: [...operation.history, { at: validatedAt, from: operation.status, to: "VALIDATED", actor: "system:validator", reason: null }]
    };
    const evaluation = evaluateChangeSetAutonomy({ changeSet: result.changeSet, planningRoot });
    if (evaluation) {
      nextOperation.autonomyEvaluation = bindAutonomyEvaluation({
        evaluation,
        operationId,
        changeSetHash: result.recomputedHash
      });
    } else {
      delete nextOperation.autonomyEvaluation;
    }
    writeOperation(operationsRoot, operationId, nextOperation);
  });
}

export function approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval = false, mode = "human", authorizationContext = null }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId }, () => {
    const operation = readOperation(operationsRoot, operationId);
    if (operation.status !== "VALIDATED") {
      throw new StateError(`cannot approve operation in status ${operation.status}`);
    }
    if (!["human", "autonomous"].includes(mode)) {
      throw new StateError(`unsupported approval mode: ${mode}`);
    }
    const changeSet = readChangeSet(operationsRoot, operationId);
    if (changeSet.kind === "guide.update" && changeSet.payload.action === "approve" && mode !== "human") {
      throw new StateError("Guide approval must use the human approval mode");
    }
    const recomputedHash = computePersistedChangeSetHash(changeSet);
    if (recomputedHash !== changeSet.hash || recomputedHash !== operation.validation.changeSetHash) {
      transitionToStale(operationsRoot, operationId, operation, "change-set.json changed since validate; propose and validate again before approving");
    }

    if (mode === "autonomous") {
      if (!hasAutonomousApprovalCapability(authorizationContext)) {
        throw new StateError("autonomous approval requires a server-owned authorization capability");
      }
      if (!operation.autonomyEvaluation) {
        throw new StateError("autonomous approval requires this operation's autonomyEvaluation");
      }
      if (operation.autonomyEvaluation.operationId !== operationId
          || operation.autonomyEvaluation.changeSetHash !== recomputedHash) {
        throw new StateError("autonomyEvaluation is not bound to this operation and validated ChangeSet");
      }
      if (currentPolicyFingerprint(planningRoot) !== operation.autonomyEvaluation.policyFingerprint) {
        transitionToStale(operationsRoot, operationId, operation, REASON_CODES.POLICY_CHANGED_SINCE_VALIDATION);
      }
      const evaluation = evaluateChangeSetAutonomy({ changeSet, planningRoot });
      const freshEvaluation = bindAutonomyEvaluation({ evaluation, operationId, changeSetHash: recomputedHash });
      if (!freshEvaluation || revisionHash(freshEvaluation) !== revisionHash(operation.autonomyEvaluation)) {
        throw new StateError("autonomyEvaluation does not match this operation");
      }
      if (!operation.autonomyEvaluation.autoApprovable) {
        throw new StateError("autonomous approval requires autoApprovable true");
      }
    }

    const selfApproval = actor === operation.proposedBy;
    if (selfApproval && !allowSelfApproval) {
      throw new StateError("self-approval requires allowSelfApproval to be explicitly set");
    }

    const approvedAt = new Date().toISOString();
    writeOperation(operationsRoot, operationId, {
      ...operation,
      status: "APPROVED",
      approval: { actor, approvedAt, changeSetHash: recomputedHash, selfApproval, mode },
      history: [...operation.history, { at: approvedAt, from: "VALIDATED", to: "APPROVED", actor, reason: selfApproval ? "self-approved" : null }]
    });
  });
}

function prepareApply({ operationsRoot, planningRoot, operationId, render, actor }) {
  let operation = readOperation(operationsRoot, operationId);
  if (operation.status !== "APPROVED") {
    throw new StateError(`cannot apply operation in status ${operation.status}`);
  }
  const changeSet = readChangeSet(operationsRoot, operationId);

  const revalidation = revalidateChangeSet({ operationsRoot, planningRoot, operationId, render });
  if (!revalidation.ok) {
    transitionToStale(operationsRoot, operationId, operation, revalidation.errors[0]);
  }
  const recomputedHash = revalidation.recomputedHash;
  if (recomputedHash !== changeSet.hash || recomputedHash !== operation.validation.changeSetHash || recomputedHash !== operation.approval.changeSetHash) {
    transitionToStale(operationsRoot, operationId, operation, "changeSetHash no longer matches validate/approve; the change-set has drifted since approval");
  }

  const discoveryWorkspace = changeSet.preconditions?.discoveryWorkspace;
  if (discoveryWorkspace) {
    const freshScan = runDiscoverScan({
      planningRoot,
      workspaceRoot: path.dirname(planningRoot),
      maxSourceBytes: discoveryWorkspace.scanParameters.maxSourceBytes
    });
    if (freshScan.baseRevision.workspaceHash !== discoveryWorkspace.workspaceHash) {
      transitionToStale(operationsRoot, operationId, operation, "discovery workspace changed since validation; rescan and create a new operation");
    }
  }

  const rendered = revalidation.rendered;
  const runtimeOperationRelative = path.join(".runtime", "operations", operationId);
  const stagingRelative = path.join(runtimeOperationRelative, "staged");
  const beforeRelative = path.join(runtimeOperationRelative, "before");
  ensureDirectoryTree(planningRoot, stagingRelative);
  ensureDirectoryTree(planningRoot, beforeRelative);
  assertDistinctMutationTargets(planningRoot, [...rendered.keys()]);

  const filePlan = [];
  for (const [relativePath, newContent] of rendered) {
    const before = changeSet.baseRevisions[relativePath];
    confineRuntimeWritePath(planningRoot, relativePath);
    if (before.contentHash !== ABSENT && !isDirectoryRenderEntry(newContent)) {
      copyFileAtomic(planningRoot, relativePath, path.join(beforeRelative, relativePath));
    }
    if (isDirectoryRenderEntry(newContent)) {
      filePlan.push({
        target: relativePath,
        action: "mkdir",
        expectedBefore: before.contentHash === ABSENT ? "ABSENT" : "PRESENT",
        beforeContentHash: before.contentHash,
        beforeRevisionHash: before.revisionHash,
        stagedContentHash: DIRECTORY_CONTENT_HASH,
        stagedRevisionHash: DIRECTORY_CONTENT_HASH
      });
    } else if (newContent === null) {
      filePlan.push({
        target: relativePath,
        action: "delete",
        expectedBefore: before.contentHash === ABSENT ? "ABSENT" : "PRESENT",
        beforeContentHash: before.contentHash,
        beforeRevisionHash: before.revisionHash,
        stagedContentHash: ABSENT,
        stagedRevisionHash: ABSENT
      });
    } else {
      filePlan.push({
        target: relativePath,
        action: "write",
        stagedRelativePath: relativePath,
        expectedBefore: before.contentHash === ABSENT ? "ABSENT" : "PRESENT",
        beforeContentHash: before.contentHash,
        beforeRevisionHash: before.revisionHash,
        stagedContentHash: contentHash(newContent),
        stagedRevisionHash: relativePath.endsWith(".gitignore") ? contentHash(newContent) : revisionHash(parseYaml(newContent))
      });
    }
  }
  checkpoint("AFTER_BEFORE");

  for (const [relativePath, newContent] of rendered) {
    if (newContent === null || isDirectoryRenderEntry(newContent)) continue;
    writeFileAtomic(planningRoot, path.join(stagingRelative, relativePath), newContent);
  }
  checkpoint("AFTER_STAGED");

  const expectedEvents = operation.expectedEvents?.length
    ? operation.expectedEvents.map((expectedEvent) => {
        const relationallyConsistent = expectedEvent.eventId === expectedEvent.document?.eventId
          && expectedEvent.document?.operationId === operation.id
          && expectedEvent.relativePath.endsWith(`/${expectedEvent.eventId}.json`);
        const eventSchemaCheck = validateSchema("event", expectedEvent.document);
        if (!relationallyConsistent || !eventSchemaCheck.valid) {
          throw new StateError("persisted expectedEvents manifest is invalid or internally inconsistent");
        }
        return expectedEvent;
      })
    : operation.reservedEvents.map((reserved) => buildExpectedEvent({
        eventId: reserved.eventId,
        type: reserved.type,
        aggregate: { type: operation.kind.split(".")[0], id: operationId },
        actor,
        operationId,
        idempotencyKey: operationId,
        payload: changeSet.payload
      }));

  operation = readOperation(operationsRoot, operationId);
  writeOperation(operationsRoot, operationId, { ...operation, filePlan, expectedEvents });
  checkpoint("AFTER_MANIFEST");

  operation = readOperation(operationsRoot, operationId);
  const applyingAt = new Date().toISOString();
  writeOperation(operationsRoot, operationId, {
    ...operation,
    status: "APPLYING",
    history: [...operation.history, { at: applyingAt, from: "APPROVED", to: "APPLYING", actor, reason: null }]
  });
  checkpoint("AFTER_APPLYING");

  return { filePlan, expectedEvents, stagingRelative, runtimeOperationRelative };
}

export function __prepareApplyForTests(args) {
  return prepareApply(args);
}

export function applyOperation({ operationsRoot, planningRoot, operationId, render, actor }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId }, () => {
    const operation = readOperation(operationsRoot, operationId);
    if (operation.status !== "APPROVED") {
      throw new StateError(`cannot apply operation in status ${operation.status}`);
    }

    const { filePlan, expectedEvents, stagingRelative, runtimeOperationRelative } = prepareApply({ operationsRoot, planningRoot, operationId, render, actor });

    const files = [];
    for (const [index, entry] of filePlan.entries()) {
      if (entry.action === "delete") {
        deleteWithinRoot(planningRoot, entry.target);
        if (operation.kind === "discovery.propose") {
          removeEmptyParentDirectoryWithinRoot(planningRoot, entry.target);
        }
      } else if (entry.action === "mkdir") {
        ensureDirectoryTree(planningRoot, entry.target);
      } else {
        renameWithinRoot(planningRoot, path.join(stagingRelative, entry.stagedRelativePath), entry.target);
      }
      files.push({ target: entry.target, action: entry.action, contentHash: entry.stagedContentHash });
      if (index === 0) checkpoint("AFTER_FIRST_RENAME");
    }
    checkpoint("AFTER_ALL_RENAMES");

    const result = { operationId, files };
    const resultSchemaCheck = validateSchema("result", result);
    if (!resultSchemaCheck.valid) {
      throw new Error(`constructed result is schema-invalid: ${resultSchemaCheck.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
    }
    writeResult(operationsRoot, operationId, result);
    checkpoint("AFTER_RESULT");

    const eventsRoot = path.join(planningRoot, "events");
    for (const [index, expectedEvent] of expectedEvents.entries()) {
      writeEventIdempotent(eventsRoot, expectedEvent);
      if (index === 0) checkpoint("AFTER_FIRST_EVENT");
    }
    checkpoint("AFTER_ALL_EVENTS");
    checkpoint("BEFORE_APPLIED");

    const appliedAt = new Date().toISOString();
    const current = readOperation(operationsRoot, operationId);
    writeOperation(operationsRoot, operationId, {
      ...current,
      status: "APPLIED",
      appliedAt,
      history: [...current.history, { at: appliedAt, from: "APPLYING", to: "APPLIED", actor, reason: null }]
    });
    const residuePath = confineRuntimeWritePath(planningRoot, runtimeOperationRelative);
    fs.rmSync(residuePath, { recursive: true, force: true });

    return { status: "APPLIED", files };
  });
}
