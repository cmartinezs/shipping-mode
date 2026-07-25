import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "./ids.mjs";
import { canonicalize, canonicalJson, revisionHash, contentHash, ABSENT } from "./canonical.mjs";
import { confineRuntimePath } from "./paths.mjs";
import { parseYaml } from "./yaml.mjs";
import { withWorkspaceMutation } from "./mutation.mjs";
import { writeOperation, readOperation, writeChangeSet, readChangeSet } from "./operationStore.mjs";
import { validate as validateSchema } from "./schema.mjs";
import { StateError, StaleError } from "./errors.mjs";
import { buildExpectedEvent } from "./journal.mjs";
import { checkpoint } from "./faultInjection.mjs";

export function readFileState(planningRoot, relativePath) {
  const absolutePath = confineRuntimePath(planningRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { revisionHash: ABSENT, contentHash: ABSENT };
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
  return { "workspace.init": "workspace.initialized", "config.update": "config.updated", "scope.add": "scope.added" }[kind];
}

export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId: null }, () => {
    const operationId = generateUuidV7();

    const baseRevisions = {};
    for (const relativePath of targetFiles) {
      baseRevisions[relativePath] = readFileState(planningRoot, relativePath);
    }

    const changeSetWithoutHash = { schemaVersion: 1, operationId, kind, target, baseRevisions, payload };
    const hash = computePersistedChangeSetHash(changeSetWithoutHash);
    writeChangeSet(operationsRoot, operationId, { ...changeSetWithoutHash, hash });

    // Corte 0 operations always emit exactly one event; its id is reserved
    // now and never regenerated (Revision 4 note 2)
    const reservedEvents = [{ eventId: generateUuidV7(), type: eventTypeFor(kind) }];

    const proposedAt = new Date().toISOString();
    writeOperation(operationsRoot, operationId, {
      id: operationId,
      kind,
      status: "PROPOSED",
      proposedBy: actor,
      proposedAt,
      reservedEvents,
      validation: { validatedAt: null, changeSetHash: null, errors: [] },
      approval: { actor: null, approvedAt: null, changeSetHash: null, selfApproval: null },
      history: [{ at: proposedAt, from: null, to: "PROPOSED", actor, reason: null }]
    });

    return operationId;
  });
}

function schemaNameForRenderedPath(relativePath) {
  if (relativePath === "config.yml") return "config";
  if (relativePath === "plugin.lock.yml") return "plugin-lock";
  if (/^scopes\/[^/]+\/scope\.yml$/.test(relativePath)) return "scope";
  return null; // e.g. .gitignore -- no schema, nothing to validate
}

function checkKindInvariants(changeSet) {
  const errors = [];
  if (changeSet.kind === "workspace.init") {
    for (const relativePath of ["config.yml", "plugin.lock.yml", ".gitignore"]) {
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
  return errors;
}

function revalidateChangeSet({ operationsRoot, planningRoot, operationId, render }) {
  const changeSet = readChangeSet(operationsRoot, operationId);

  // relational invariant JSON Schema can't express: the change-set must
  // agree with the operation directory it's persisted under
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

  // render in-memory first -- both the exact-match check below and the
  // per-document schema validation need it
  let rendered;
  try {
    rendered = render(changeSet.payload);
  } catch (error) {
    return { ok: false, status: "INVALID", errors: [error.message], recomputedHash };
  }

  // baseRevisions must be exactly the set of files this render touches --
  // no more, no less. There is no safe fallback for a path that's missing
  // from baseRevisions; "assume ABSENT" would let a renamed/added target
  // slip past staleness checking entirely (Revision 4 note 3).
  const renderedPaths = new Set(rendered.keys());
  const baseRevisionPaths = new Set(Object.keys(changeSet.baseRevisions));
  const missingFromBaseRevisions = [...renderedPaths].filter((p) => !baseRevisionPaths.has(p));
  const extraInBaseRevisions = [...baseRevisionPaths].filter((p) => !renderedPaths.has(p));
  if (missingFromBaseRevisions.length > 0 || extraInBaseRevisions.length > 0) {
    return {
      ok: false, status: "INVALID",
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
    ...operation, status: "STALE",
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
        ...operation, status: result.status,
        validation: { validatedAt, changeSetHash: result.recomputedHash, errors: result.errors },
        history: [...operation.history, { at: validatedAt, from: operation.status, to: result.status, actor: "system:validator", reason: result.errors[0] }]
      });
      return;
    }

    writeOperation(operationsRoot, operationId, {
      ...operation, status: "VALIDATED",
      validation: { validatedAt, changeSetHash: result.recomputedHash, errors: [] },
      history: [...operation.history, { at: validatedAt, from: operation.status, to: "VALIDATED", actor: "system:validator", reason: null }]
    });
  });
}

export function approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval = false }) {
  return withWorkspaceMutation({ planningRoot, operationsRoot, operationId }, () => {
    const operation = readOperation(operationsRoot, operationId);
    if (operation.status !== "VALIDATED") {
      throw new StateError(`cannot approve operation in status ${operation.status}`);
    }

    const changeSet = readChangeSet(operationsRoot, operationId);
    const recomputedHash = computePersistedChangeSetHash(changeSet);
    if (recomputedHash !== changeSet.hash || recomputedHash !== operation.validation.changeSetHash) {
      transitionToStale(operationsRoot, operationId, operation, "change-set.json changed since validate; propose and validate again before approving");
    }

    const selfApproval = actor === operation.proposedBy;
    if (selfApproval && !allowSelfApproval) {
      throw new StateError("self-approval requires allowSelfApproval to be explicitly set");
    }

    const approvedAt = new Date().toISOString();
    writeOperation(operationsRoot, operationId, {
      ...operation, status: "APPROVED",
      approval: { actor, approvedAt, changeSetHash: recomputedHash, selfApproval },
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

  // step 1 (revalidation under the lock, authoritative -- the earlier
  // validate/approve checks were only ever a fail-fast optimistic pass).
  // Reuses the exact same rule set validateOperation uses, then additionally
  // requires the hash to still match what validate AND approve each recorded.
  const revalidation = revalidateChangeSet({ operationsRoot, planningRoot, operationId, render });
  if (!revalidation.ok) {
    transitionToStale(operationsRoot, operationId, operation, revalidation.errors[0]);
  }
  const recomputedHash = revalidation.recomputedHash;
  if (recomputedHash !== changeSet.hash || recomputedHash !== operation.validation.changeSetHash || recomputedHash !== operation.approval.changeSetHash) {
    transitionToStale(operationsRoot, operationId, operation, "changeSetHash no longer matches validate/approve; the change-set has drifted since approval");
  }

  const rendered = revalidation.rendered;
  const stagingDir = path.join(planningRoot, ".runtime", "operations", operationId, "staged");
  const beforeDir = path.join(planningRoot, ".runtime", "operations", operationId, "before");
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(beforeDir, { recursive: true });

  // step 2 (part 1): snapshot before/ for files that currently exist, and
  // build the filePlan entries (both content+revision hashes, before and
  // staged). revalidateChangeSet already guaranteed baseRevisions contains
  // exactly the rendered file set, so there is no fallback here -- a missing
  // entry would be a bug in that guarantee, not something to paper over.
  const filePlan = [];
  for (const [relativePath, newContent] of rendered) {
    const before = changeSet.baseRevisions[relativePath];
    if (before.contentHash !== ABSENT) {
      const currentAbsolute = confineRuntimePath(planningRoot, relativePath);
      const beforePath = confineRuntimePath(beforeDir, relativePath);
      fs.mkdirSync(path.dirname(beforePath), { recursive: true });
      fs.copyFileSync(currentAbsolute, beforePath);
    }
    filePlan.push({
      target: relativePath,
      stagedRelativePath: relativePath,
      expectedBefore: before.contentHash === ABSENT ? "ABSENT" : "PRESENT",
      beforeContentHash: before.contentHash,
      beforeRevisionHash: before.revisionHash,
      stagedContentHash: contentHash(newContent),
      stagedRevisionHash: relativePath.endsWith(".gitignore") ? contentHash(newContent) : revisionHash(parseYaml(newContent))
    });
  }
  checkpoint("AFTER_BEFORE");

  // step 2 (part 2): write staged/ content
  for (const [relativePath, newContent] of rendered) {
    const stagedPath = confineRuntimePath(stagingDir, relativePath);
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
    fs.writeFileSync(stagedPath, newContent);
  }
  checkpoint("AFTER_STAGED");

  // step 3: persist the filePlan + full, immutable expectedEvents documents,
  // fixed before anything canonical is touched. The event id is the one
  // reserved at propose time (operation.reservedEvents), never a fresh one.
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
        actor, operationId, idempotencyKey: operationId, payload: changeSet.payload
      }));

  operation = readOperation(operationsRoot, operationId);
  writeOperation(operationsRoot, operationId, { ...operation, filePlan, expectedEvents });
  checkpoint("AFTER_MANIFEST");

  // step 4: durable transition to APPLYING, still holding the lock
  operation = readOperation(operationsRoot, operationId);
  const applyingAt = new Date().toISOString();
  writeOperation(operationsRoot, operationId, {
    ...operation, status: "APPLYING",
    history: [...operation.history, { at: applyingAt, from: "APPROVED", to: "APPLYING", actor, reason: null }]
  });
  checkpoint("AFTER_APPLYING");

  return { filePlan, expectedEvents };
}

export function __prepareApplyForTests(args) {
  return prepareApply(args);
}
