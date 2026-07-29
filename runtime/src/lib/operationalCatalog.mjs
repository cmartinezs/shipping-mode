import fs from "node:fs";
import path from "node:path";
import { isUuidV7 } from "./ids.mjs";
import { parseYaml } from "./yaml.mjs";
import { validate } from "./schema.mjs";
import { confineWritePath } from "./paths.mjs";
import { revisionHash } from "./canonical.mjs";

export const CATALOG_FINDING_CODES = Object.freeze({
  INVALID_REFERENCE: "INVALID_REFERENCE",
  CAPABILITY_UNAVAILABLE: "CAPABILITY_UNAVAILABLE",
  CATALOG_CORRUPT: "CATALOG_CORRUPT",
  REFERENCE_STALE: "REFERENCE_STALE"
});

const CATALOGS = Object.freeze({
  executionContext: {
    root: "execution-contexts",
    file: "execution-context.yml",
    schema: "execution-context"
  },
  environment: {
    root: "environments",
    file: "environment.yml",
    schema: "environment"
  }
});

export function catalogRelativePath(kind, id) {
  const catalog = CATALOGS[kind];
  if (!catalog) throw new Error(`unknown operational catalog kind: ${kind}`);
  if (!isUuidV7(id)) throw new Error(`${kind} reference must be UUIDv7: ${id}`);
  return path.join(catalog.root, id, catalog.file);
}

export function readCatalogEntry(planningRoot, kind, id) {
  const catalog = CATALOGS[kind];
  if (!catalog) throw new Error(`unknown operational catalog kind: ${kind}`);
  if (!isUuidV7(id)) {
    return { status: "INVALID_REFERENCE", entry: null, revision: null, findings: [{ code: CATALOG_FINDING_CODES.INVALID_REFERENCE, message: `${kind} reference must be UUIDv7: ${id}` }] };
  }
  const root = confineWritePath(planningRoot, catalog.root);
  if (!fs.existsSync(root)) {
    return { status: "CAPABILITY_UNAVAILABLE", entry: null, revision: null, findings: [{ code: CATALOG_FINDING_CODES.CAPABILITY_UNAVAILABLE, message: `${catalog.root} catalog is not available` }] };
  }
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { status: "CATALOG_CORRUPT", entry: null, revision: null, findings: [{ code: CATALOG_FINDING_CODES.CATALOG_CORRUPT, message: `${catalog.root} catalog must be a real directory` }] };
  }
  const entryDir = path.join(root, id);
  if (!fs.existsSync(entryDir)) {
    return { status: "INVALID_REFERENCE", entry: null, revision: null, findings: [{ code: CATALOG_FINDING_CODES.INVALID_REFERENCE, message: `${kind} reference does not resolve: ${id}` }] };
  }
  const entryStat = fs.lstatSync(entryDir);
  if (!entryStat.isDirectory() || entryStat.isSymbolicLink()) {
    return { status: "CATALOG_CORRUPT", entry: null, revision: null, findings: [{ code: CATALOG_FINDING_CODES.CATALOG_CORRUPT, message: `${catalog.root}/${id} must be a real directory` }] };
  }
  const relativePath = catalogRelativePath(kind, id);
  const filePath = confineWritePath(planningRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    return { status: "INVALID_REFERENCE", entry: null, revision: null, findings: [{ code: CATALOG_FINDING_CODES.INVALID_REFERENCE, message: `${relativePath} is missing` }] };
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { status: "CATALOG_CORRUPT", entry: null, revision: null, findings: [{ code: CATALOG_FINDING_CODES.CATALOG_CORRUPT, message: `${relativePath} must be a real file` }] };
  }
  let entry;
  try {
    entry = parseYaml(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { status: "CATALOG_CORRUPT", entry: null, revision: null, findings: [{ code: CATALOG_FINDING_CODES.CATALOG_CORRUPT, message: `${relativePath} failed to parse: ${error.message}` }] };
  }
  const schemaResult = validate(catalog.schema, entry);
  if (!schemaResult.valid) {
    return {
      status: "CATALOG_CORRUPT",
      entry,
      revision: null,
      findings: schemaResult.errors.map((error) => ({ code: CATALOG_FINDING_CODES.CATALOG_CORRUPT, message: `${relativePath}${error.path}: ${error.message}` }))
    };
  }
  if (entry.id !== id) {
    return { status: "CATALOG_CORRUPT", entry, revision: null, findings: [{ code: CATALOG_FINDING_CODES.CATALOG_CORRUPT, message: `${relativePath}: id must match directory ${id}` }] };
  }
  return { status: "FOUND", entry, revision: revisionHash(entry), findings: [] };
}

export function assertCatalogRefsValid({ planningRoot, kind, ids, laneId = null, expectedRevisions = null }) {
  const seen = new Set();
  const revisions = {};
  for (const id of ids) {
    if (seen.has(id)) {
      const error = new Error(`DUPLICATE_REFERENCE: duplicate ${kind} reference: ${id}`);
      error.code = "INVALID";
      throw error;
    }
    seen.add(id);
    const result = readCatalogEntry(planningRoot, kind, id);
    if (result.status !== "FOUND") {
      const error = new Error(result.findings.map((finding) => `${finding.code}: ${finding.message}`).join("; "));
      error.code = result.status === "CAPABILITY_UNAVAILABLE" ? "CAPABILITY_UNAVAILABLE" : "INVALID";
      throw error;
    }
    if (kind === "environment" && Array.isArray(result.entry.laneRefs) && result.entry.laneRefs.length > 0 && laneId && !result.entry.laneRefs.includes(laneId)) {
      const error = new Error(`POLICY_VIOLATION: environment ${id} is not compatible with lane ${laneId}`);
      error.code = "INVALID";
      throw error;
    }
    if (expectedRevisions && expectedRevisions[id] !== result.revision) {
      const error = new Error(`REFERENCE_STALE: ${kind} reference changed since propose: ${id}`);
      error.code = "STALE";
      throw error;
    }
    revisions[id] = result.revision;
  }
  return revisions;
}
