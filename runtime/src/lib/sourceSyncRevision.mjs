import { revisionHash } from "./canonical.mjs";

const KIND_FIELDS = Object.freeze({
  user_story: ["actor", "need", "value", "acceptanceCriteria"],
  capability: ["outcome", "behavior", "acceptanceCriteria"],
  defect: ["observedBehavior", "expectedBehavior", "reproduction", "severity"],
  enabler: ["technicalOutcome", "unlockedCapabilities"],
  spike: ["question", "timebox", "expectedDecision"],
  compliance: ["obligation", "authority", "deadline", "evidence"],
  migration: ["sourceState", "targetState", "rollback"],
  operational: ["procedure", "owner", "evidence"]
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * Reproduces the aggregate snapshot that Plan 4 import baselines bind.
 *
 * The original import contract computes aggregateRevisionAtSync before the
 * canonical identity/audit wrapper is added. Drift evaluation must compare the
 * same projection instead of audit.revision; comparing those two unrelated
 * hashes makes a newly imported item appear locally modified immediately.
 */
export function sourceSyncAggregateRevision(item) {
  const fields = KIND_FIELDS[item?.kind];
  if (!fields) throw new Error(`unsupported Release Item kind for source sync revision: ${item?.kind}`);
  const snapshot = {
    kind: item.kind,
    title: item.title,
    description: item.description ?? null,
    slug: item.slug ?? null,
    dependencies: clone(item.dependencies || []),
    sourceRefs: clone(item.sourceRefs || []),
    ...Object.fromEntries(fields.map((field) => [field, clone(item[field])])),
    sourceSync: null
  };
  return `sha256:${revisionHash(snapshot)}`;
}
