import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";
import { computeFileFingerprint, FingerprintError } from "./fingerprint.mjs";
import { contentHash } from "./canonical.mjs";
import { validateNormalizedWorkSourceItem, assertSafeMetadata } from "./workSourceImport.mjs";

const LOCAL_FILE_EXTENSIONS = new Set([".yml", ".yaml", ".json"]);
const DEFAULT_MAX_ITEM_BYTES = 1024 * 1024;

function normalizeError(error, code = null) {
  return {
    code: code || error.code || "SOURCE_UNAVAILABLE",
    severity: "error",
    message: error.message
  };
}

function compareUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function readStructuredFile(absolutePath, maxBytes) {
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    const error = new Error(`SOURCE_MISCONFIGURED: symlink entries are not permitted: ${absolutePath}`);
    error.code = "SOURCE_MISCONFIGURED";
    throw error;
  }
  if (!stat.isFile()) {
    const error = new Error(`SOURCE_MISCONFIGURED: Work Source item must be a regular file: ${absolutePath}`);
    error.code = "SOURCE_MISCONFIGURED";
    throw error;
  }
  if (stat.size > maxBytes) {
    const error = new Error(`SOURCE_MISCONFIGURED: Work Source item exceeds size limit: ${absolutePath}`);
    error.code = "SOURCE_MISCONFIGURED";
    throw error;
  }
  const bytes = fs.readFileSync(absolutePath);
  const text = bytes.toString("utf8");
  const extension = path.extname(absolutePath);
  const document = extension === ".json" ? JSON.parse(text) : parseYaml(text);
  return { document, bytes };
}

function sourceRootEntries(source) {
  return source.roots.map((root) => ({ root, absoluteRoot: root.absolutePath }));
}

function globMatches(relativePath, globs) {
  const basename = path.basename(relativePath);
  const patterns = globs && globs.length > 0 ? globs : ["*.work-source.yml", "*.work-source.yaml", "*.work-source.json"];
  return patterns.some((pattern) => {
    if (pattern.startsWith("*")) return basename.endsWith(pattern.slice(1));
    return basename === pattern || relativePath === pattern;
  });
}

export class LocalRepositoryWorkSource {
  provider = "local_repository";
  capabilities = ["discover", "search", "get"];

  constructor({ workspaceRoot }) {
    this.workspaceRoot = workspaceRoot;
  }

  discover({ source }) {
    const findings = [];
    const items = [];
    for (const root of sourceRootEntries(source)) {
      try {
        const rootStat = fs.lstatSync(root.absoluteRoot);
        if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`root must be a real directory: ${root.relativePath}`);
        const stack = [root.absoluteRoot];
        while (stack.length > 0) {
          const current = stack.pop();
          for (const name of fs.readdirSync(current).sort(compareUtf8)) {
            const absolute = path.join(current, name);
            const stat = fs.lstatSync(absolute);
            if (stat.isSymbolicLink()) {
              findings.push({ code: "SOURCE_MISCONFIGURED", severity: "error", message: `symlink entries are not permitted: ${path.relative(this.workspaceRoot, absolute)}` });
              continue;
            }
            if (stat.isDirectory()) {
              stack.push(absolute);
              stack.sort(compareUtf8).reverse();
              continue;
            }
            if (!stat.isFile() || !LOCAL_FILE_EXTENSIONS.has(path.extname(name))) continue;
            const relativePath = path.relative(this.workspaceRoot, absolute).split(path.sep).join("/");
            if (!globMatches(path.relative(root.absoluteRoot, absolute).split(path.sep).join("/"), source.options.file_globs)) continue;
            const item = this.#readItem({ source, absolutePath: absolute, relativePath });
            items.push(item);
          }
        }
      } catch (error) {
        findings.push(normalizeError(error, error.code || "SOURCE_UNAVAILABLE"));
      }
    }
    items.sort((left, right) => `${left.itemId}:${left.path}`.localeCompare(`${right.itemId}:${right.path}`));
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item.itemId)) findings.push({ code: "SOURCE_MISCONFIGURED", severity: "error", message: `duplicate local Work Source item id ${item.itemId}` });
      seen.add(item.itemId);
    }
    return { status: findings.some((finding) => finding.severity === "error") ? "FAIL" : "PASS", items, findings };
  }

  search({ source, query }) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const discovered = this.discover({ source });
    return {
      ...discovered,
      items: discovered.items.filter((item) => normalizedQuery.length === 0 || `${item.itemId} ${item.title} ${item.description.text}`.toLowerCase().includes(normalizedQuery))
    };
  }

  get({ source, itemRef }) {
    const discovered = this.discover({ source });
    if (discovered.findings.some((finding) => finding.severity === "error")) return { status: "FAIL", item: null, findings: discovered.findings };
    const matches = discovered.items.filter((item) => item.itemId === itemRef || item.path === itemRef);
    if (matches.length === 0) return { status: "NOT_FOUND", item: null, findings: [{ code: "SOURCE_NOT_FOUND", severity: "error", message: `Work Source item not found: ${itemRef}` }] };
    if (matches.length > 1) return { status: "AMBIGUOUS", item: null, findings: [{ code: "SOURCE_MISCONFIGURED", severity: "error", message: `Work Source item reference is ambiguous: ${itemRef}` }] };
    return { status: "FOUND", item: matches[0], findings: [] };
  }

  #readItem({ source, absolutePath, relativePath }) {
    const maxBytes = source.options.max_item_bytes || DEFAULT_MAX_ITEM_BYTES;
    const { document, bytes } = readStructuredFile(absolutePath, maxBytes);
    const fingerprint = computeFileFingerprint(absolutePath, { maxBytes });
    return normalizeLocalDocument({ source, document, relativePath, bytes, fingerprint });
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function normalizeDescription(value) {
  if (typeof value === "string") return { format: "plain", text: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("description must be a string or object");
  const format = value.format === undefined ? "plain" : requireString(value.format, "description.format");
  if (!["plain", "markdown"].includes(format)) throw new Error("description.format must be plain or markdown");
  return { format, text: requireString(value.text, "description.text") };
}

function normalizeAcceptanceCriteria(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("acceptanceCriteria must be a non-empty array");
  const seen = new Set();
  return value.map((entry, index) => {
    const normalized = typeof entry === "string"
      ? { id: `ac-${index + 1}`, text: requireString(entry, `acceptanceCriteria[${index}]`) }
      : { id: requireString(entry?.id, `acceptanceCriteria[${index}].id`), text: requireString(entry?.text, `acceptanceCriteria[${index}].text`) };
    if (seen.has(normalized.id)) throw new Error(`duplicate acceptanceCriteria id ${normalized.id}`);
    seen.add(normalized.id);
    return normalized;
  });
}

function normalizeLabels(value) {
  const labels = value === undefined ? [] : value;
  if (!Array.isArray(labels)) throw new Error("labels must be an array");
  const normalized = labels.map((entry) => requireString(entry, "labels"));
  if (new Set(normalized).size !== normalized.length) throw new Error("labels cannot contain duplicates");
  return normalized.sort();
}

function normalizeTypedRefs(value, field) {
  const refs = value === undefined ? [] : value;
  if (!Array.isArray(refs)) throw new Error(`${field} must be an array`);
  const identities = new Set();
  return refs.map((entry, index) => {
    const normalized = {
      type: requireString(entry?.type, `${field}[${index}].type`),
      target: requireString(entry?.target, `${field}[${index}].target`)
    };
    const key = `${normalized.type}:${normalized.target}`;
    if (identities.has(key)) throw new Error(`${field} cannot contain duplicate ${key}`);
    identities.add(key);
    return normalized;
  }).sort((left, right) => `${left.type}:${left.target}`.localeCompare(`${right.type}:${right.target}`));
}

function normalizeLocalDocument({ source, document, relativePath, bytes, fingerprint }) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("local Work Source item must be an object");
  if (document.rawPayload !== undefined || document.providerMetadata !== undefined) throw new Error("raw provider payload fields are not accepted");
  const metadata = document.metadata === undefined ? {} : document.metadata;
  assertSafeMetadata(metadata);
  const item = {
    schemaVersion: 1,
    sourceId: source.id,
    provider: "local_repository",
    itemId: requireString(document.id, "id"),
    path: relativePath,
    type: requireString(document.type, "type"),
    title: requireString(document.title, "title"),
    description: normalizeDescription(document.description),
    acceptanceCriteria: normalizeAcceptanceCriteria(document.acceptanceCriteria),
    status: {
      normalized: normalizeStatus(document.status),
      providerStatus: document.status === undefined ? null : requireString(document.status, "status")
    },
    priority: {
      normalized: normalizePriority(document.priority),
      providerPriority: document.priority === undefined ? null : requireString(document.priority, "priority")
    },
    labels: normalizeLabels(document.labels),
    relationships: normalizeTypedRefs(document.relationships, "relationships"),
    dependencies: normalizeTypedRefs(document.dependencies, "dependencies"),
    assignee: document.assignee === undefined ? null : requireString(document.assignee, "assignee"),
    owner: document.owner === undefined ? null : requireString(document.owner, "owner"),
    revision: {
      contentRevision: `sha256:${fingerprint.contentHash}`,
      fingerprint: `sha256:${fingerprint.fingerprint}`,
      updatedAt: null
    },
    mappingVersion: source.mappingVersion,
    metadata,
    trace: {
      observedPath: relativePath,
      observedBytes: bytes.length,
      observedContentHash: contentHash(bytes)
    }
  };
  const result = validateNormalizedWorkSourceItem(item);
  if (!result.valid) throw new Error(`invalid normalized Work Source item: ${result.errors.join("; ")}`);
  return item;
}

function normalizeStatus(value) {
  if (value === undefined || value === null || value === "") return "unknown";
  const normalized = String(value).trim().toLowerCase().replaceAll(" ", "_");
  if (["todo", "open", "new", "draft", "backlog"].includes(normalized)) return "todo";
  if (["in_progress", "doing", "active"].includes(normalized)) return "in_progress";
  if (["done", "closed", "resolved"].includes(normalized)) return "done";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  return "unknown";
}

function normalizePriority(value) {
  if (value === undefined || value === null || value === "") return "none";
  const normalized = String(value).trim().toLowerCase();
  if (["low", "medium", "high", "critical"].includes(normalized)) return normalized;
  return "none";
}
