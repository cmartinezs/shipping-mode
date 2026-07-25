import fs from "node:fs";
import { generateUuidV7 } from "./ids.mjs";
import { canonicalize, canonicalJson, revisionHash, contentHash, ABSENT } from "./canonical.mjs";
import { confineRuntimePath } from "./paths.mjs";
import { parseYaml } from "./yaml.mjs";
import { withWorkspaceMutation } from "./mutation.mjs";
import { writeOperation, readOperation, writeChangeSet, readChangeSet } from "./operationStore.mjs";

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
