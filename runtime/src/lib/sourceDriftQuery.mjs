import { listReleaseItemRecords } from "./releaseItemStore.mjs";
import { defaultWorkSourceRegistry, MANAGED_FIELDS_BY_KIND, managedSnapshotFromReleaseSnapshot, workSourceConfigHash } from "./workSourceImport.mjs";
import { evaluateManagedFieldDrift } from "./workSourceDrift.mjs";
import { sourceSyncAggregateRevision } from "./sourceSyncRevision.mjs";

function primaryRefs(item) {
  return (item.sourceRefs || []).filter((ref) => ref.role === "primary");
}

function itemRef(ref) {
  return ref.provider === "local_repository" ? (ref.path || ref.itemId) : (ref.externalId || ref.itemId);
}

function mappedReleaseSnapshot(normalizedItem) {
  return {
    kind: normalizedItem.type,
    title: normalizedItem.title,
    description: normalizedItem.description?.text ?? null,
    acceptanceCriteria: (normalizedItem.acceptanceCriteria || []).map((entry) => typeof entry === "string" ? entry : entry.text),
    ...normalizedItem.fields
  };
}

export function querySourceDrift({ planningRoot, releaseId = null, runtimeContext = null }) {
  const registry = defaultWorkSourceRegistry({ planningRoot, runtimeContext });
  const findings = [];
  let records;
  try {
    records = listReleaseItemRecords(planningRoot, { releaseId });
  } catch (error) {
    return { status: "FAIL", scope: releaseId ? "release" : "workspace", findings: [{ code: "SOURCE_MISCONFIGURED", severity: "error", message: error.message }], items: [] };
  }
  const items = [];
  for (const record of records.sort((left, right) => `${left.releaseId}:${left.item?.id || ""}`.localeCompare(`${right.releaseId}:${right.item?.id || ""}`))) {
    if (!record.item) continue;
    const item = record.item;
    const refs = primaryRefs(item);
    if (refs.length === 0) continue;
    if (refs.length !== 1) {
      items.push({ releaseId: item.releaseId, itemId: item.id, status: "AMBIGUOUS_SOURCE", findings: [{ code: "AMBIGUOUS_SOURCE", severity: "error", message: "primary Work Source reference is ambiguous" }] });
      continue;
    }
    const ref = refs[0];
    let result;
    try {
      const source = registry.getSource(ref.sourceId);
      const provider = registry.resolve(source.id, "get");
      const fetched = provider.get({ source, itemRef: itemRef(ref) });
      if (fetched.status !== "FOUND") {
        result = evaluateManagedFieldDrift({ sourceStatus: fetched.status === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE" });
      } else {
        const fields = MANAGED_FIELDS_BY_KIND[item.kind];
        result = evaluateManagedFieldDrift({
          baseline: item.sourceSync?.baselines?.find((entry) => entry.role === "primary") || null,
          remoteManagedSnapshot: managedSnapshotFromReleaseSnapshot(mappedReleaseSnapshot(fetched.item), fields),
          localManagedSnapshot: managedSnapshotFromReleaseSnapshot(item, fields),
          aggregateRevision: sourceSyncAggregateRevision(item),
          activeMappingProfile: source.mappingProfile || `${source.provider}-v${source.mappingVersion}`,
          activeConfigHash: `sha256:${workSourceConfigHash(source)}`
        });
      }
    } catch (error) {
      result = { status: error.code === "SOURCE_CAPABILITY_MISSING" ? "SOURCE_CAPABILITY_MISSING" : "SOURCE_MISCONFIGURED", findings: [{ code: error.code || "SOURCE_MISCONFIGURED", severity: "error", message: error.message }] };
    }
    items.push({ releaseId: item.releaseId, itemId: item.id, displayId: item.displayId, sourceId: ref.sourceId, provider: ref.provider, status: result.status, findings: result.findings || [] });
  }
  for (const item of items) findings.push(...item.findings.map((entry) => ({ ...entry, releaseId: item.releaseId, itemId: item.itemId })));
  return { status: findings.length === 0 ? "PASS" : "FAIL", scope: releaseId ? "release" : "workspace", items, findings };
}
