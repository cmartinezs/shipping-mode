import { revisionHash } from "./canonical.mjs";

function finding(code, message) {
  return { code, severity: "error", message };
}

function equal(left, right) {
  return revisionHash(left ?? null) === revisionHash(right ?? null);
}

function result(status, findings = []) {
  return { status, findings };
}

export function evaluateManagedFieldDrift({
  sourceStatus = "OK",
  capabilityMissing = false,
  ambiguousSource = false,
  baseline = null,
  remoteManagedSnapshot = null,
  localManagedSnapshot = null,
  aggregateRevision = null,
  activeMappingProfile = null,
  activeConfigHash = null
} = {}) {
  if (ambiguousSource) return result("AMBIGUOUS_SOURCE", [finding("AMBIGUOUS_SOURCE", "primary Work Source reference is ambiguous")]);
  if (capabilityMissing) return result("SOURCE_CAPABILITY_MISSING", [finding("SOURCE_CAPABILITY_MISSING", "provider does not declare required capability")]);
  if (sourceStatus === "UNAVAILABLE") return result("SOURCE_UNAVAILABLE", [finding("SOURCE_UNAVAILABLE", "source is unavailable")]);
  if (sourceStatus === "MISCONFIGURED") return result("SOURCE_MISCONFIGURED", [finding("SOURCE_MISCONFIGURED", "source is misconfigured")]);
  if (sourceStatus === "NOT_FOUND") return result("SOURCE_NOT_FOUND", [finding("SOURCE_NOT_FOUND", "source item was not found")]);
  if (!baseline) {
    if (equal(remoteManagedSnapshot, localManagedSnapshot)) return result("BASELINE_MISSING_SAFE", [finding("SYNC_REQUIRED", "baseline can be captured safely")]);
    return result("BASELINE_MISSING_CONFLICT", [finding("SOURCE_CONFLICT", "baseline is missing and local managed fields differ from remote")]);
  }
  if (activeMappingProfile && activeMappingProfile !== baseline.mappingProfile) return result("MAPPING_OBSOLETE", [finding("MAPPING_OBSOLETE", "mapping profile changed")]);
  if (activeConfigHash && activeConfigHash !== baseline.configHash) return result("CONFIG_CHANGED", [finding("SOURCE_STALE", "Work Source config hash changed")]);

  const remoteEqualsBaseline = equal(remoteManagedSnapshot, baseline.managedSnapshot);
  const localEqualsBaseline = equal(localManagedSnapshot, baseline.managedSnapshot);
  const aggregateEqualsBaseline = !aggregateRevision || aggregateRevision === baseline.aggregateRevisionAtSync;

  if (remoteEqualsBaseline && localEqualsBaseline && aggregateEqualsBaseline) return result("UNCHANGED");
  if (remoteEqualsBaseline && localEqualsBaseline && !aggregateEqualsBaseline) return result("LOCAL_UNMANAGED_CHANGED");
  if (!remoteEqualsBaseline && localEqualsBaseline && aggregateEqualsBaseline) return result("REMOTE_CHANGED", [finding("SYNC_REQUIRED", "remote managed fields changed")]);
  if (!remoteEqualsBaseline && localEqualsBaseline && !aggregateEqualsBaseline) return result("BOTH_CHANGED_COMPATIBLE", [finding("SYNC_REQUIRED", "remote managed fields changed while local-owned fields changed")]);
  if (!localEqualsBaseline && remoteEqualsBaseline) return result("LOCAL_MANAGED_CHANGED", [finding("SOURCE_CONFLICT", "local managed fields changed")]);
  return result("SOURCE_CONFLICT", [finding("SOURCE_CONFLICT", "local and remote managed fields changed")]);
}
