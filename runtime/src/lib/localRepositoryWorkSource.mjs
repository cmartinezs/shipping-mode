import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./yaml.mjs";
import { computeFileFingerprint } from "./fingerprint.mjs";
import { contentHash } from "./canonical.mjs";
import { validateNormalizedWorkSourceItem, assertSafeMetadata } from "./workSourceImport.mjs";

const LOCAL_FILE_EXTENSIONS = new Set([".yml", ".yaml", ".json"]);
const DEFAULT_MAX_ITEM_BYTES = 1024 * 1024;
const COMMON_DOCUMENT_FIELDS = new Set(["schemaVersion", "id", "type", "title", "description", "acceptanceCriteria", "status", "priority", "labels", "relationships", "dependencies", "assignee", "owner", "metadata"]);
const KIND_FIELDS = {
  user_story: ["actor", "need", "value"],
  capability: ["outcome", "behavior"],
  defect: ["observedBehavior", "expectedBehavior", "reproduction", "severity"],
  enabler: ["technicalOutcome", "unlockedCapabilities"],
  spike: ["question", "timebox", "expectedDecision"],
  compliance: ["obligation", "authority", "deadline", "evidence"],
  migration: ["sourceState", "targetState", "rollback"],
  operational: ["procedure", "owner", "evidence"]
};

function normalizeError(error, code = null) {
  return { code: code || error.code || "SOURCE_UNAVAILABLE", severity: "error", message: error.message };
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isWithin(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function excludedDirectory(workspaceRoot, absolutePath) {
  return [".planning", ".git"].some((name) => isWithin(absolutePath, path.join(workspaceRoot, name)));
}

function readStructuredFile(absolutePath, relativePath, maxBytes) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`Work Source item must be a regular file: ${relativePath}`);
    if (stat.size > maxBytes) throw new Error(`Work Source item exceeds size limit: ${relativePath}`);
    const bytes = fs.readFileSync(descriptor);
    const text = bytes.toString("utf8");
    const extension = path.extname(absolutePath);
    const document = extension === ".json" ? JSON.parse(text) : parseYaml(text);
    const fingerprint = computeFileFingerprint(absolutePath, { maxBytes, statFn: () => stat, readFn: () => bytes });
    return { document, bytes, fingerprint };
  } catch (error) {
    const wrapped = new Error(`SOURCE_MISCONFIGURED: cannot read ${relativePath}: ${error.message}`);
    wrapped.code = "SOURCE_MISCONFIGURED";
    throw wrapped;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
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
  contractVersion = 1;
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
        if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`root must be a real directory: ${root.root.relativePath}`);
        if (excludedDirectory(this.workspaceRoot, root.absoluteRoot)) throw new Error(`root is reserved and cannot be used as a Work Source: ${root.root.relativePath}`);
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
              if (excludedDirectory(this.workspaceRoot, absolute)) continue;
              stack.push(absolute);
              stack.sort(compareUtf8).reverse();
              continue;
            }
            if (!stat.isFile() || !LOCAL_FILE_EXTENSIONS.has(path.extname(name))) continue;
            const relativePath = path.relative(this.workspaceRoot, absolute).split(path.sep).join("/");
            if (!globMatches(path.relative(root.absoluteRoot, absolute).split(path.sep).join("/"), source.options.file_globs)) continue;
            items.push(this.#readItem({ source, absolutePath: absolute, relativePath }));
          }
        }
      } catch (error) {
        findings.push(normalizeError(error, error.code || "SOURCE_UNAVAILABLE"));
      }
    }
    items.sort((left, right) => compareUtf8(`${left.itemId}:${left.path}`, `${right.itemId}:${right.path}`));
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
    return { ...discovered, items: discovered.items.filter((item) => normalizedQuery.length === 0 || `${item.itemId} ${item.title} ${item.description.text}`.toLowerCase().includes(normalizedQuery)) };
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
    const { document, bytes, fingerprint } = readStructuredFile(absolutePath, relativePath, maxBytes);
    return normalizeLocalDocument({ source, document, relativePath, bytes, fingerprint });
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function normalizeDescription(value) {
  if (typeof value === "string") return { format: "plain", text: requireString(value, "description") };
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

function normalizeStringList(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array`);
  const normalized = value.map((entry) => requireString(entry, field));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} cannot contain duplicates`);
  return normalized;
}

function normalizeLabels(value) {
  const labels = value === undefined ? [] : value;
  if (!Array.isArray(labels)) throw new Error("labels must be an array");
  const normalized = labels.map((entry) => requireString(entry, "labels"));
  if (new Set(normalized).size !== normalized.length) throw new Error("labels cannot contain duplicates");
  return normalized.sort(compareUtf8);
}

function normalizeTypedRefs(value, field) {
  const refs = value === undefined ? [] : value;
  if (!Array.isArray(refs)) throw new Error(`${field} must be an array`);
  const identities = new Set();
  return refs.map((entry, index) => {
    const normalized = { type: requireString(entry?.type, `${field}[${index}].type`), target: requireString(entry?.target, `${field}[${index}].target`) };
    const key = `${normalized.type}:${normalized.target}`;
    if (identities.has(key)) throw new Error(`${field} cannot contain duplicate ${key}`);
    identities.add(key);
    return normalized;
  }).sort((left, right) => compareUtf8(`${left.type}:${left.target}`, `${right.type}:${right.target}`));
}

function normalizeKindFields(document, type) {
  const names = KIND_FIELDS[type];
  if (!names) throw new Error(`unsupported Work Source item type: ${type}`);
  const allowed = new Set([...COMMON_DOCUMENT_FIELDS, ...names]);
  for (const key of Object.keys(document)) {
    if (!allowed.has(key)) throw new Error(`local Work Source item contains unsupported field: ${key}`);
  }
  if (type === "user_story") return { actor: requireString(document.actor, "actor"), need: requireString(document.need, "need"), value: requireString(document.value, "value") };
  if (type === "capability") return { outcome: requireString(document.outcome, "outcome"), behavior: requireString(document.behavior, "behavior") };
  if (type === "defect") {
    const severity = requireString(document.severity, "severity");
    if (!["low", "medium", "high", "critical"].includes(severity)) throw new Error("severity is invalid");
    return { observedBehavior: requireString(document.observedBehavior, "observedBehavior"), expectedBehavior: requireString(document.expectedBehavior, "expectedBehavior"), reproduction: requireString(document.reproduction, "reproduction"), severity };
  }
  if (type === "enabler") return { technicalOutcome: requireString(document.technicalOutcome, "technicalOutcome"), unlockedCapabilities: normalizeStringList(document.unlockedCapabilities, "unlockedCapabilities") };
  if (type === "spike") return { question: requireString(document.question, "question"), timebox: requireString(document.timebox, "timebox"), expectedDecision: requireString(document.expectedDecision, "expectedDecision") };
  if (type === "compliance") return { obligation: requireString(document.obligation, "obligation"), authority: requireString(document.authority, "authority"), deadline: requireString(document.deadline, "deadline"), evidence: normalizeStringList(document.evidence, "evidence") };
  if (type === "migration") return { sourceState: requireString(document.sourceState, "sourceState"), targetState: requireString(document.targetState, "targetState"), rollback: requireString(document.rollback, "rollback") };
  if (type === "operational") return { procedure: requireString(document.procedure, "procedure"), owner: requireString(document.owner, "owner"), evidence: normalizeStringList(document.evidence, "evidence") };
  throw new Error(`unsupported Work Source item type: ${type}`);
}

function normalizeLocalDocument({ source, document, relativePath, bytes, fingerprint }) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("local Work Source item must be an object");
  if (document.schemaVersion !== 1) throw new Error("local Work Source item schemaVersion must be 1");
  const type = requireString(document.type, "type");
  const metadata = document.metadata === undefined ? {} : document.metadata;
  assertSafeMetadata(metadata);
  const item = {
    schemaVersion: 1,
    sourceId: source.id,
    provider: "local_repository",
    itemId: requireString(document.id, "id"),
    path: relativePath,
    type,
    title: requireString(document.title, "title"),
    description: normalizeDescription(document.description),
    acceptanceCriteria: normalizeAcceptanceCriteria(document.acceptanceCriteria),
    status: { normalized: normalizeStatus(document.status), providerStatus: document.status === undefined ? null : requireString(document.status, "status") },
    priority: { normalized: normalizePriority(document.priority), providerPriority: document.priority === undefined ? null : requireString(document.priority, "priority") },
    labels: normalizeLabels(document.labels),
    relationships: normalizeTypedRefs(document.relationships, "relationships"),
    dependencies: normalizeTypedRefs(document.dependencies, "dependencies"),
    assignee: document.assignee === undefined ? null : requireString(document.assignee, "assignee"),
    owner: document.owner === undefined ? null : requireString(document.owner, "owner"),
    fields: normalizeKindFields(document, type),
    revision: { contentRevision: `sha256:${fingerprint.contentHash}`, fingerprint: `sha256:${fingerprint.fingerprint}`, updatedAt: null },
    mappingVersion: source.mappingVersion,
    metadata,
    trace: { observedPath: relativePath, observedBytes: bytes.length, observedContentHash: contentHash(bytes) }
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
