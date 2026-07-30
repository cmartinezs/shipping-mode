import { revisionHash } from "./canonical.mjs";
import { validateNormalizedWorkSourceItem } from "./workSourceImport.mjs";
import { WORK_SOURCE_PROVIDER_CONTRACT_VERSION } from "./workSourceProvider.mjs";

function finding(code, message) {
  return { code, severity: "error", message };
}

function stableItems(items) {
  return (items || []).map((item) => ({ itemId: item.itemId, revision: revisionHash(item) }));
}

export function evaluateWorkSourceProviderContract({ registry, source }) {
  if (!source.enabled) {
    return { status: "SKIPPED", active: false, contractVersion: WORK_SOURCE_PROVIDER_CONTRACT_VERSION, checks: [], itemCount: 0, findings: [] };
  }
  const findings = [];
  const checks = [];
  let discovered = { status: "PASS", items: [], findings: [] };
  try {
    if (source.capabilities.includes("discover")) {
      const provider = registry.resolve(source.id, "discover");
      const first = provider.discover({ source });
      const second = provider.discover({ source });
      checks.push("discover", "discover_determinism");
      if (first.status !== "PASS") findings.push(...(first.findings || []));
      if (revisionHash(stableItems(first.items)) !== revisionHash(stableItems(second.items)) || revisionHash(first.findings || []) !== revisionHash(second.findings || [])) {
        findings.push(finding("SOURCE_MISCONFIGURED", `provider ${source.provider} discover output is not deterministic for ${source.id}`));
      }
      for (const item of first.items || []) {
        const validation = validateNormalizedWorkSourceItem(item);
        if (!validation.valid) findings.push(finding("SOURCE_MISCONFIGURED", `provider ${source.provider} returned invalid item ${item.itemId}: ${validation.errors.join("; ")}`));
      }
      discovered = first;
    }
    if (source.capabilities.includes("search")) {
      const provider = registry.resolve(source.id, "search");
      const searched = provider.search({ source, query: "" });
      checks.push("search");
      if (searched.status !== "PASS") findings.push(...(searched.findings || []));
      if (revisionHash(stableItems(searched.items)) !== revisionHash(stableItems(discovered.items))) {
        findings.push(finding("SOURCE_MISCONFIGURED", `provider ${source.provider} empty search does not match discover for ${source.id}`));
      }
    }
    if (source.capabilities.includes("get") && (discovered.items || []).length > 0) {
      const provider = registry.resolve(source.id, "get");
      const samples = [discovered.items[0], discovered.items.at(-1)].filter((entry, index, values) => entry && values.findIndex((candidate) => candidate.itemId === entry.itemId) === index);
      checks.push("get");
      for (const expected of samples) {
        const fetched = provider.get({ source, itemRef: expected.itemId });
        if (fetched.status !== "FOUND" || !fetched.item) {
          findings.push(finding("SOURCE_NOT_FOUND", `provider ${source.provider} cannot get discovered item ${expected.itemId}`));
        } else if (revisionHash(fetched.item) !== revisionHash(expected)) {
          findings.push(finding("SOURCE_MISCONFIGURED", `provider ${source.provider} get output differs from discover for ${expected.itemId}`));
        }
      }
    }
  } catch (error) {
    findings.push(finding(error.code || "SOURCE_UNAVAILABLE", error.message));
  }
  const ordered = findings.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`));
  return {
    status: ordered.length > 0 ? "FAIL" : "PASS",
    active: ordered.length === 0,
    contractVersion: WORK_SOURCE_PROVIDER_CONTRACT_VERSION,
    checks,
    itemCount: (discovered.items || []).length,
    findings: ordered
  };
}
