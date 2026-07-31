import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";
import { confineWritePath } from "./paths.mjs";
import { listReleaseItemRecords } from "./releaseItemStore.mjs";
import { listWorkPackageRecords } from "./workPackageStore.mjs";

export function queryWorkSourceTraceability({ planningRoot, releaseId = null }) {
  const items = [];
  const records = listReleaseItemRecords(planningRoot, { releaseId });
  for (const record of records.sort((left, right) => `${left.releaseId}:${left.item?.id || ""}`.localeCompare(`${right.releaseId}:${right.item?.id || ""}`))) {
    if (!record.item) continue;
    const item = record.item;
    const sourceRefs = (item.sourceRefs || []).filter((ref) => ref.role === "primary").sort((a, b) => `${a.provider}:${a.sourceId}`.localeCompare(`${b.provider}:${b.sourceId}`));
    const packages = listWorkPackageRecords(planningRoot, { releaseId: item.releaseId, itemId: item.id }).filter((entry) => entry.workPackage).map((entry) => entry.workPackage).sort((a, b) => a.id.localeCompare(b.id));
    for (const sourceRef of sourceRefs.length > 0 ? sourceRefs : [null]) {
      const packageEntries = packages.length > 0 ? packages : [null];
      for (const workPackage of packageEntries) {
        let scope = null;
        const scopeId = workPackage?.scopeId || null;
        if (scopeId) {
          const scopePath = confineWritePath(planningRoot, path.join("scopes", scopeId, "scope.yml"));
          if (fs.existsSync(scopePath) && fs.lstatSync(scopePath).isFile()) scope = parseYaml(fs.readFileSync(scopePath, "utf8"));
        }
        items.push({
          source: sourceRef ? { sourceId: sourceRef.sourceId, provider: sourceRef.provider, role: sourceRef.role, externalId: sourceRef.externalId || null, itemId: sourceRef.itemId || null, path: sourceRef.path || null } : null,
          sourceSync: item.sourceSync?.baselines?.find((entry) => entry.role === "primary") || null,
          releaseItem: { releaseId: item.releaseId, itemId: item.id, displayId: item.displayId },
          workPackage: workPackage ? { id: workPackage.id, displayId: workPackage.displayId, scopeId: workPackage.scopeId } : null,
          scope: scope ? { id: scope.id, key: scope.key, label: scope.label } : null,
          findings: [
            ...(sourceRef ? [] : ["SOURCE_REF_MISSING"]),
            ...(workPackage ? [] : ["WORK_PACKAGE_MISSING"]),
            ...(workPackage && scope ? [] : workPackage ? ["SCOPE_MISSING"] : [])
          ]
        });
      }
    }
  }
  const findings = items.flatMap((entry) => entry.findings.map((code) => ({ code, severity: "error", source: entry.source, releaseItem: entry.releaseItem, workPackage: entry.workPackage })));
  return { status: findings.length === 0 ? "PASS" : "FAIL", items, findings };
}
