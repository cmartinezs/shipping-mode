import assert from "node:assert/strict";
import { evaluateManagedFieldDrift } from "../workSourceDrift.mjs";

const baseline = {
  sourceId: "jira-gradeops",
  provider: "jira",
  mappingVersion: 1,
  mappingProfile: "jira-gradeops-v1",
  configHash: `sha256:${"a".repeat(64)}`,
  managedFields: ["/title", "/description"],
  managedSnapshot: { title: "A", description: "B" },
  managedSnapshotHash: `sha256:${"b".repeat(64)}`,
  aggregateRevisionAtSync: `sha256:${"c".repeat(64)}`
};
const same = { title: "A", description: "B" };
const changed = { title: "A changed", description: "B" };
const localChanged = { title: "Local", description: "B" };

assert.equal(evaluateManagedFieldDrift({ sourceStatus: "UNAVAILABLE" }).status, "SOURCE_UNAVAILABLE");
assert.equal(evaluateManagedFieldDrift({ sourceStatus: "MISCONFIGURED" }).status, "SOURCE_MISCONFIGURED");
assert.equal(evaluateManagedFieldDrift({ capabilityMissing: true }).status, "SOURCE_CAPABILITY_MISSING");
assert.equal(evaluateManagedFieldDrift({ sourceStatus: "NOT_FOUND" }).status, "SOURCE_NOT_FOUND");
assert.equal(evaluateManagedFieldDrift({ baseline: null, remoteManagedSnapshot: same, localManagedSnapshot: same }).status, "BASELINE_MISSING_SAFE");
assert.equal(evaluateManagedFieldDrift({ baseline: null, remoteManagedSnapshot: changed, localManagedSnapshot: same }).status, "BASELINE_MISSING_CONFLICT");
assert.equal(evaluateManagedFieldDrift({ baseline, remoteManagedSnapshot: same, localManagedSnapshot: same, aggregateRevision: baseline.aggregateRevisionAtSync }).status, "UNCHANGED");
assert.equal(evaluateManagedFieldDrift({ baseline, remoteManagedSnapshot: same, localManagedSnapshot: same, aggregateRevision: `sha256:${"d".repeat(64)}` }).status, "LOCAL_UNMANAGED_CHANGED");
assert.equal(evaluateManagedFieldDrift({ baseline, remoteManagedSnapshot: changed, localManagedSnapshot: same, aggregateRevision: baseline.aggregateRevisionAtSync }).status, "REMOTE_CHANGED");
assert.equal(evaluateManagedFieldDrift({ baseline, remoteManagedSnapshot: same, localManagedSnapshot: localChanged, aggregateRevision: baseline.aggregateRevisionAtSync }).status, "LOCAL_MANAGED_CHANGED");
assert.equal(evaluateManagedFieldDrift({ baseline, remoteManagedSnapshot: changed, localManagedSnapshot: same, aggregateRevision: `sha256:${"d".repeat(64)}` }).status, "BOTH_CHANGED_COMPATIBLE");
assert.equal(evaluateManagedFieldDrift({ baseline, remoteManagedSnapshot: changed, localManagedSnapshot: localChanged, aggregateRevision: `sha256:${"d".repeat(64)}` }).status, "SOURCE_CONFLICT");
assert.equal(evaluateManagedFieldDrift({ baseline, activeMappingProfile: "jira-gradeops-v2", remoteManagedSnapshot: same, localManagedSnapshot: same }).status, "MAPPING_OBSOLETE");
assert.equal(evaluateManagedFieldDrift({ baseline, activeConfigHash: `sha256:${"e".repeat(64)}`, remoteManagedSnapshot: same, localManagedSnapshot: same }).status, "CONFIG_CHANGED");
assert.equal(evaluateManagedFieldDrift({ ambiguousSource: true }).status, "AMBIGUOUS_SOURCE");

console.log("work-source-drift: managed-field matrix pass");
