from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    file = ROOT / path
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:160]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    file = ROOT / path
    text = file.read_text(encoding="utf-8")
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f"start marker not found in {path}: {start[:120]!r}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f"end marker not found in {path}: {end[:120]!r}")
    file.write_text(text[:start_index] + replacement + text[end_index:], encoding="utf-8")


write("runtime/src/lib/workSourceProvider.mjs", r'''export const WORK_SOURCE_PROVIDER_CONTRACT_VERSION = 1;
export const WORK_SOURCE_CAPABILITIES = Object.freeze(["discover", "search", "get", "create", "update", "transition", "comment"]);
const KNOWN_CAPABILITIES = new Set(WORK_SOURCE_CAPABILITIES);

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function providerFromFactory(factory) {
  const provider = typeof factory === "function" ? factory() : factory;
  if (!provider || typeof provider !== "object" || typeof provider.provider !== "string") {
    throw new Error("Work Source provider factory must return an adapter with provider id");
  }
  if (provider.contractVersion !== WORK_SOURCE_PROVIDER_CONTRACT_VERSION) {
    throw new Error(`provider ${provider.provider} must implement Work Source contract version ${WORK_SOURCE_PROVIDER_CONTRACT_VERSION}`);
  }
  return provider;
}

function validateCapabilities(owner, capabilities) {
  if (!Array.isArray(capabilities)) throw new Error(`${owner} capabilities must be an array`);
  const seen = new Set();
  for (const capability of capabilities) {
    if (!KNOWN_CAPABILITIES.has(capability)) throw new Error(`${owner} declares unknown capability ${capability}`);
    if (seen.has(capability)) throw new Error(`${owner} declares duplicate capability ${capability}`);
    seen.add(capability);
  }
  return [...seen].sort((left, right) => WORK_SOURCE_CAPABILITIES.indexOf(left) - WORK_SOURCE_CAPABILITIES.indexOf(right));
}

function cloneSource(source) {
  return {
    ...source,
    roots: (source.roots || []).map((root) => ({ ...root })),
    capabilities: [...(source.capabilities || [])],
    options: { ...(source.options || {}), ...(source.options?.file_globs ? { file_globs: [...source.options.file_globs] } : {}) }
  };
}

export function buildWorkSourceRegistry({ providerFactories, sources }) {
  const providers = new Map();
  for (const factory of providerFactories) {
    const provider = providerFromFactory(factory);
    if (providers.has(provider.provider)) throw new Error(`duplicate Work Source provider: ${provider.provider}`);
    const capabilities = validateCapabilities(`provider ${provider.provider}`, provider.capabilities || []);
    for (const capability of capabilities) {
      if (typeof provider[capability] !== "function") {
        throw new Error(`provider ${provider.provider} declares capability ${capability} without implementation`);
      }
    }
    provider.capabilities = capabilities;
    providers.set(provider.provider, provider);
  }

  const sourceIds = new Set();
  const activeSources = [];
  for (const rawSource of [...(sources || [])].sort((left, right) => compareUtf8(left.id, right.id))) {
    if (sourceIds.has(rawSource.id)) throw new Error(`duplicate Work Source id: ${rawSource.id}`);
    sourceIds.add(rawSource.id);
    const provider = providers.get(rawSource.provider);
    if (!provider) throw new Error(`unknown Work Source provider: ${rawSource.provider}`);
    const capabilities = validateCapabilities(`work source ${rawSource.id}`, rawSource.capabilities || []);
    for (const capability of capabilities) {
      if (!provider.capabilities.includes(capability)) {
        throw new Error(`work source ${rawSource.id} declares capability ${capability} unavailable from provider ${rawSource.provider}`);
      }
      if (typeof provider[capability] !== "function") {
        throw new Error(`work source ${rawSource.id} declares capability ${capability} without implementation`);
      }
    }
    activeSources.push(cloneSource({ ...rawSource, capabilities }));
  }

  function findSource(sourceId) {
    const source = activeSources.find((entry) => entry.id === sourceId);
    if (!source) {
      const error = new Error(`SOURCE_NOT_FOUND: Work Source ${sourceId} is not configured`);
      error.code = "SOURCE_NOT_FOUND";
      throw error;
    }
    return source;
  }

  return {
    listSources() {
      return activeSources.map(cloneSource);
    },
    getSource(sourceId) {
      return cloneSource(findSource(sourceId));
    },
    inspect(sourceId) {
      const source = findSource(sourceId);
      const provider = providers.get(source.provider);
      return {
        source: cloneSource(source),
        provider: provider.provider,
        contractVersion: provider.contractVersion,
        providerCapabilities: [...provider.capabilities]
      };
    },
    resolve(sourceId, capability) {
      if (!KNOWN_CAPABILITIES.has(capability)) throw new Error(`unknown Work Source capability ${capability}`);
      const source = findSource(sourceId);
      if (!source.enabled) {
        const error = new Error(`SOURCE_UNAVAILABLE: Work Source ${sourceId} is disabled`);
        error.code = "SOURCE_UNAVAILABLE";
        throw error;
      }
      if (!source.capabilities.includes(capability)) {
        const error = new Error(`SOURCE_CAPABILITY_MISSING: Work Source ${sourceId} does not declare ${capability}`);
        error.code = "SOURCE_CAPABILITY_MISSING";
        throw error;
      }
      const provider = providers.get(source.provider);
      if (!provider || typeof provider[capability] !== "function") {
        const error = new Error(`SOURCE_CAPABILITY_MISSING: Provider ${source.provider} cannot execute ${capability}`);
        error.code = "SOURCE_CAPABILITY_MISSING";
        throw error;
      }
      return provider;
    }
  };
}
''')

write("runtime/src/lib/workSourceContract.mjs", r'''import { revisionHash } from "./canonical.mjs";
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
''')

write("runtime/src/lib/localRepositoryWorkSource.mjs", r'''import fs from "node:fs";
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
''')

normalized_schema = {
  "$id": "https://shipping-mode.dev/schemas/normalized-work-source-item.schema.json",
  "type": "object",
  "additionalProperties": False,
  "required": ["schemaVersion", "sourceId", "provider", "itemId", "type", "title", "description", "acceptanceCriteria", "status", "priority", "labels", "relationships", "dependencies", "assignee", "owner", "fields", "revision", "mappingVersion", "metadata", "trace"],
  "properties": {
    "schemaVersion": {"const": 1},
    "sourceId": {"type": "string", "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"},
    "provider": {"type": "string", "pattern": "^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$"},
    "itemId": {"type": "string", "minLength": 1, "maxLength": 256},
    "path": {"type": "string", "minLength": 1, "maxLength": 1024},
    "url": {"type": "string", "minLength": 1, "maxLength": 2048},
    "type": {"enum": ["user_story", "capability", "defect", "enabler", "spike", "compliance", "migration", "operational"]},
    "title": {"type": "string", "minLength": 1, "maxLength": 512},
    "description": {"type": "object", "additionalProperties": False, "required": ["format", "text"], "properties": {"format": {"enum": ["plain", "markdown"]}, "text": {"type": "string", "minLength": 1, "maxLength": 32768}}},
    "acceptanceCriteria": {"type": "array", "minItems": 1, "maxItems": 128, "items": {"type": "object", "additionalProperties": False, "required": ["id", "text"], "properties": {"id": {"type": "string", "minLength": 1, "maxLength": 128}, "text": {"type": "string", "minLength": 1, "maxLength": 4096}}}},
    "status": {"type": "object", "additionalProperties": False, "required": ["normalized", "providerStatus"], "properties": {"normalized": {"enum": ["todo", "in_progress", "done", "cancelled", "unknown"]}, "providerStatus": {"type": ["string", "null"], "minLength": 1, "maxLength": 256}}},
    "priority": {"type": "object", "additionalProperties": False, "required": ["normalized", "providerPriority"], "properties": {"normalized": {"enum": ["critical", "high", "medium", "low", "none"]}, "providerPriority": {"type": ["string", "null"], "minLength": 1, "maxLength": 256}}},
    "labels": {"type": "array", "maxItems": 128, "items": {"type": "string", "minLength": 1, "maxLength": 128}, "uniqueItems": True},
    "relationships": {"type": "array", "maxItems": 128, "items": {"$ref": "#/$defs/typedRef"}},
    "dependencies": {"type": "array", "maxItems": 128, "items": {"$ref": "#/$defs/typedRef"}},
    "assignee": {"type": ["string", "null"], "minLength": 1, "maxLength": 256},
    "owner": {"type": ["string", "null"], "minLength": 1, "maxLength": 256},
    "fields": {"$ref": "#/$defs/canonicalFields"},
    "revision": {"type": "object", "additionalProperties": False, "required": ["updatedAt"], "properties": {"externalRevision": {"type": "string", "minLength": 1, "maxLength": 512}, "contentRevision": {"$ref": "#/$defs/hash"}, "fingerprint": {"$ref": "#/$defs/hash"}, "updatedAt": {"type": ["string", "null"], "minLength": 1}}, "anyOf": [{"required": ["externalRevision"]}, {"required": ["contentRevision"]}, {"required": ["fingerprint"]}]},
    "mappingVersion": {"type": "integer", "minimum": 1},
    "metadata": {"type": "object", "maxProperties": 32},
    "trace": {"type": "object", "additionalProperties": False, "required": ["observedPath", "observedBytes", "observedContentHash"], "properties": {"observedPath": {"type": ["string", "null"], "minLength": 1}, "observedBytes": {"type": "integer", "minimum": 0}, "observedContentHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"}}}
  },
  "allOf": [],
  "$defs": {
    "hash": {"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"},
    "stringList": {"type": "array", "minItems": 1, "maxItems": 128, "items": {"type": "string", "minLength": 1, "maxLength": 4096}, "uniqueItems": True},
    "typedRef": {"type": "object", "additionalProperties": False, "required": ["type", "target"], "properties": {"type": {"type": "string", "minLength": 1, "maxLength": 128}, "target": {"type": "string", "minLength": 1, "maxLength": 512}}},
    "canonicalFields": {"type": "object", "additionalProperties": False, "properties": {
      "actor": {"type": "string", "minLength": 1}, "need": {"type": "string", "minLength": 1}, "value": {"type": "string", "minLength": 1},
      "outcome": {"type": "string", "minLength": 1}, "behavior": {"type": "string", "minLength": 1},
      "observedBehavior": {"type": "string", "minLength": 1}, "expectedBehavior": {"type": "string", "minLength": 1}, "reproduction": {"type": "string", "minLength": 1}, "severity": {"enum": ["low", "medium", "high", "critical"]},
      "technicalOutcome": {"type": "string", "minLength": 1}, "unlockedCapabilities": {"$ref": "#/$defs/stringList"},
      "question": {"type": "string", "minLength": 1}, "timebox": {"type": "string", "minLength": 1}, "expectedDecision": {"type": "string", "minLength": 1},
      "obligation": {"type": "string", "minLength": 1}, "authority": {"type": "string", "minLength": 1}, "deadline": {"type": "string", "minLength": 1}, "evidence": {"$ref": "#/$defs/stringList"},
      "sourceState": {"type": "string", "minLength": 1}, "targetState": {"type": "string", "minLength": 1}, "rollback": {"type": "string", "minLength": 1},
      "procedure": {"type": "string", "minLength": 1}, "owner": {"type": "string", "minLength": 1}
    }}
  }
}
normalized_schema["allOf"].append({"if": {"type": "object", "required": ["provider"], "properties": {"provider": {"const": "local_repository"}}}, "then": {"type": "object", "required": ["path"], "not": {"required": ["url"]}}, "else": {"type": "object", "not": {"required": ["path"]}}})
requirements = {
  "user_story": ["actor", "need", "value"], "capability": ["outcome", "behavior"], "defect": ["observedBehavior", "expectedBehavior", "reproduction", "severity"],
  "enabler": ["technicalOutcome", "unlockedCapabilities"], "spike": ["question", "timebox", "expectedDecision"], "compliance": ["obligation", "authority", "deadline", "evidence"],
  "migration": ["sourceState", "targetState", "rollback"], "operational": ["procedure", "owner", "evidence"]
}
for kind, fields in requirements.items():
    normalized_schema["allOf"].append({"if": {"type": "object", "required": ["type"], "properties": {"type": {"const": kind}}}, "then": {"type": "object", "properties": {"fields": {"type": "object", "required": fields}}}})
write("runtime/src/schemas/normalized-work-source-item.schema.json", json.dumps(normalized_schema, indent=2) + "\n")

# Work Source import internals: validated config, strict roots, full config binding,
# exact canonical mapping and closed invariant checks.
replace_once("runtime/src/lib/workSourceImport.mjs", 'import { confineScopePath } from "./paths.mjs";\n', 'import { confineRuntimeWritePath, confineScopePath, confineWritePath } from "./paths.mjs";\n')
replace_once("runtime/src/lib/workSourceImport.mjs", 'import { parseYaml } from "./yaml.mjs";\n', 'import { parseYaml } from "./yaml.mjs";\nimport { assertProjectContextConsistency } from "./projectContextValidation.mjs";\n')
replace_once("runtime/src/lib/workSourceImport.mjs", '''function readConfig(planningRoot) {
  const configPath = path.join(planningRoot, "config.yml");
  if (!fs.existsSync(configPath)) throw new Error("workspace config.yml not found");
  return parseYaml(fs.readFileSync(configPath, "utf8"));
}
''', '''export function readValidatedWorkSourceConfig(planningRoot) {
  const configPath = confineRuntimeWritePath(planningRoot, "config.yml");
  if (!fs.existsSync(configPath)) throw new Error("workspace config.yml not found");
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("config.yml must be a real file");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  const schema = validate("config", config);
  if (!schema.valid) throw new Error(`config.yml is schema-invalid: ${schema.errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`);
  assertProjectContextConsistency(config);
  return config;
}
''')
replace_once("runtime/src/lib/workSourceImport.mjs", '''  const absolutePath = confineScopePath(workspaceRoot, normalized);
''', '''  confineWritePath(workspaceRoot, normalized);
  const absolutePath = confineScopePath(workspaceRoot, normalized);
''')
replace_once("runtime/src/lib/workSourceImport.mjs", '''function normalizePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}
''', '''function normalizePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}

export function workSourceConfigSnapshot(source) {
  return {
    id: source.id,
    provider: source.provider,
    enabled: source.enabled,
    roots: source.roots.map((root) => root.relativePath),
    mappingVersion: source.mappingVersion,
    importPolicy: source.importPolicy,
    syncMode: source.syncMode,
    capabilities: [...source.capabilities],
    options: { ...source.options, ...(source.options.file_globs ? { file_globs: [...source.options.file_globs] } : {}) }
  };
}

export function workSourceConfigHash(source) {
  return revisionHash(workSourceConfigSnapshot(source));
}
''')
replace_once("runtime/src/lib/workSourceImport.mjs", '  const config = readConfig(planningRoot);\n', '  const config = readValidatedWorkSourceConfig(planningRoot);\n')
replace_once("runtime/src/lib/workSourceImport.mjs", '''export function assertSafeMetadata(value, { depth = 0, bytes = { value: 0 } } = {}) {
  bytes.value += Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  if (bytes.value > 8192) throw new Error("metadata exceeds safe size limit");
  if (depth > 4) throw new Error("metadata exceeds safe depth limit");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > 32) throw new Error("metadata array exceeds safe length limit");
    for (const entry of value) assertSafeMetadata(entry, { depth: depth + 1, bytes });
    return;
  }
  if (typeof value !== "object") throw new Error("metadata must be JSON-safe");
  const keys = Object.keys(value);
  if (keys.length > 32) throw new Error("metadata object exceeds safe key limit");
  for (const key of keys) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`metadata key is not allowed: ${key}`);
    assertSafeMetadata(value[key], { depth: depth + 1, bytes });
  }
}
''', '''export function assertSafeMetadata(value, { depth = 0, measuredBytes = null } = {}) {
  if (measuredBytes === null) {
    let serialized;
    try {
      serialized = JSON.stringify(value ?? null);
    } catch {
      throw new Error("metadata must be JSON-safe");
    }
    if (Buffer.byteLength(serialized, "utf8") > 8192) throw new Error("metadata exceeds safe size limit");
    measuredBytes = Buffer.byteLength(serialized, "utf8");
  }
  if (depth > 4) throw new Error("metadata exceeds safe depth limit");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > 32) throw new Error("metadata array exceeds safe length limit");
    for (const entry of value) assertSafeMetadata(entry, { depth: depth + 1, measuredBytes });
    return;
  }
  if (typeof value !== "object") throw new Error("metadata must be JSON-safe");
  const keys = Object.keys(value);
  if (keys.length > 32) throw new Error("metadata object exceeds safe key limit");
  for (const key of keys) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`metadata key is not allowed: ${key}`);
    assertSafeMetadata(value[key], { depth: depth + 1, measuredBytes });
  }
}
''')
replace_between("runtime/src/lib/workSourceImport.mjs", 'function normalizeImportIntent(', 'function mappedReleaseItemSnapshot', r'''function normalizeImportIntent(rawPayload, { actor, defaultIdempotencyKey, releaseId, source, normalizedItem, role = "primary" }) {
  const configHash = workSourceConfigHash(source);
  const callerIntent = { sourceRef: `${source.id}:${normalizedItem.itemId}`, role };
  const requestSnapshot = {
    actor,
    releaseId,
    sourceId: source.id,
    provider: source.provider,
    itemId: normalizedItem.itemId,
    mappingVersion: source.mappingVersion,
    sourceConfigHash: configHash,
    sourceRevision: normalizedItem.revision.contentRevision || normalizedItem.revision.externalRevision || normalizedItem.revision.fingerprint,
    role,
    callerIntent
  };
  const idempotencyKey = rawPayload.idempotencyKey === undefined ? requireString(defaultIdempotencyKey, "idempotencyKey") : requireString(rawPayload.idempotencyKey, "idempotencyKey");
  return {
    requestSnapshot,
    idempotencyKey,
    idempotencyRequestHash: workSourceImportRequestHash({
      actor,
      releaseId,
      sourceId: source.id,
      provider: source.provider,
      itemId: normalizedItem.itemId,
      mappingVersion: source.mappingVersion,
      sourceConfigHash: configHash,
      observedRevision: requestSnapshot.sourceRevision,
      role
    })
  };
}

''')
replace_between("runtime/src/lib/workSourceImport.mjs", 'function mappedReleaseItemSnapshot', 'function deriveSourceRef', r'''function mappedReleaseItemSnapshot(normalizedItem, sourceRef) {
  if (!SUPPORTED_KINDS.has(normalizedItem.type)) throw new Error(`unsupported Work Source item type: ${normalizedItem.type}`);
  const base = {
    kind: normalizedItem.type,
    title: normalizedItem.title,
    description: normalizedItem.description.text,
    slug: null,
    dependencies: [],
    sourceRefs: [sourceRef]
  };
  const criteria = normalizedItem.acceptanceCriteria.map((entry) => entry.text);
  const fields = normalizedItem.fields;
  if (normalizedItem.type === "user_story") return { ...base, actor: fields.actor, need: fields.need, value: fields.value, acceptanceCriteria: criteria };
  if (normalizedItem.type === "capability") return { ...base, outcome: fields.outcome, behavior: fields.behavior, acceptanceCriteria: criteria };
  if (normalizedItem.type === "defect") return { ...base, observedBehavior: fields.observedBehavior, expectedBehavior: fields.expectedBehavior, reproduction: fields.reproduction, severity: fields.severity };
  if (normalizedItem.type === "enabler") return { ...base, technicalOutcome: fields.technicalOutcome, unlockedCapabilities: fields.unlockedCapabilities };
  if (normalizedItem.type === "spike") return { ...base, question: fields.question, timebox: fields.timebox, expectedDecision: fields.expectedDecision };
  if (normalizedItem.type === "compliance") return { ...base, obligation: fields.obligation, authority: fields.authority, deadline: fields.deadline, evidence: fields.evidence };
  if (normalizedItem.type === "migration") return { ...base, sourceState: fields.sourceState, targetState: fields.targetState, rollback: fields.rollback };
  if (normalizedItem.type === "operational") return { ...base, procedure: fields.procedure, owner: fields.owner, evidence: fields.evidence };
  throw new Error(`unsupported Work Source item type: ${normalizedItem.type}`);
}

''')
replace_once("runtime/src/lib/workSourceImport.mjs", '''      role,
      path: normalizedItem.path,
''', '''      role,
      itemId: normalizedItem.itemId,
      path: normalizedItem.path,
''')
replace_between("runtime/src/lib/workSourceImport.mjs", 'function existingPrimarySourceItem', 'export function prepareWorkSourceImport', r'''function existingPrimarySourceItem(planningRoot, operationsRoot, { releaseId, sourceId, provider, normalizedItem, excludeItemId = null }) {
  const current = listReleaseItemDocuments(planningRoot, { releaseId });
  const reserved = listReservedReleaseItemDocuments(operationsRoot).filter((item) => item.releaseId === releaseId);
  for (const item of [...current, ...reserved]) {
    if (excludeItemId && item.id === excludeItemId) continue;
    for (const ref of item.sourceRefs || []) {
      if (ref.role !== "primary" || ref.provider !== provider || ref.sourceId !== sourceId) continue;
      if ((ref.itemId && ref.itemId === normalizedItem.itemId) || (ref.externalId && ref.externalId === normalizedItem.itemId) || (ref.path && ref.path === normalizedItem.path)) return item;
    }
  }
  return null;
}

''')
replace_once("runtime/src/lib/workSourceImport.mjs", '''        mappingVersion: source.mappingVersion,
        role: "primary"
''', '''        mappingVersion: source.mappingVersion,
        configHash: workSourceConfigHash(source),
        role: "primary"
''')
replace_once("runtime/src/lib/workSourceImport.mjs", '''  if (source.provider !== payload.source.provider || source.mappingVersion !== payload.source.mappingVersion) {
    const error = new Error("SOURCE_STALE: Work Source configuration changed since propose");
''', '''  if (source.provider !== payload.source.provider || source.mappingVersion !== payload.source.mappingVersion || workSourceConfigHash(source) !== payload.source.configHash) {
    const error = new Error("SOURCE_STALE: Work Source configuration changed since propose");
''')
replace_once("runtime/src/lib/workSourceImport.mjs", '''export function workSourceImportRequestHash({ actor, releaseId, sourceId, provider, itemId, mappingVersion, observedRevision, role }) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid Work Source import parent release id: ${releaseId}`);
  return revisionHash({ actor, releaseId, sourceId, provider, itemId, mappingVersion, observedRevision, role });
}
''', '''export function workSourceImportRequestHash({ actor, releaseId, sourceId, provider, itemId, mappingVersion, sourceConfigHash, observedRevision, role }) {
  if (!isUuidV7(releaseId)) throw new Error(`invalid Work Source import parent release id: ${releaseId}`);
  return revisionHash({ actor, releaseId, sourceId, provider, itemId, mappingVersion, sourceConfigHash, observedRevision, role });
}
''')
replace_once("runtime/src/lib/workSourceImport.mjs", '''  if (payload.requestSnapshot?.sourceRefs?.[0]?.sourceId !== payload.source?.sourceId) findings.push("work-source.import sourceRef sourceId must match resolved source");
  if (payload.requestSnapshot?.sourceRefs?.[0]?.provider !== payload.source?.provider) findings.push("work-source.import sourceRef provider must match resolved provider");
  if (payload.requestSnapshot?.sourceRefs?.[0]?.mappingVersion !== payload.source?.mappingVersion) findings.push("work-source.import sourceRef mappingVersion must match resolved mapping");
  if (payload.requestSnapshot?.sourceRefs?.[0]?.contentRevision && payload.requestSnapshot.sourceRefs[0].contentRevision !== payload.source?.observedRevision) findings.push("work-source.import sourceRef revision must match observed revision");
  if (revisionHash(payload.normalizedItem || {}) !== revisionHash(payload.normalizedItem || {})) findings.push("work-source.import normalizedItem is not canonical");
''', '''  const normalizedValidation = validateNormalizedWorkSourceItem(payload.normalizedItem || {});
  if (!normalizedValidation.valid) findings.push(`work-source.import normalizedItem is invalid: ${normalizedValidation.errors.join("; ")}`);
  const observedRevision = payload.normalizedItem?.revision?.contentRevision || payload.normalizedItem?.revision?.externalRevision || payload.normalizedItem?.revision?.fingerprint;
  if (payload.normalizedItem?.sourceId !== payload.source?.sourceId) findings.push("work-source.import normalizedItem sourceId must match resolved source");
  if (payload.normalizedItem?.provider !== payload.source?.provider) findings.push("work-source.import normalizedItem provider must match resolved provider");
  if (payload.normalizedItem?.itemId !== payload.source?.itemId) findings.push("work-source.import normalizedItem itemId must match resolved item");
  if ((payload.normalizedItem?.path || null) !== (payload.source?.path || null)) findings.push("work-source.import normalizedItem path must match resolved locator");
  if (payload.normalizedItem?.mappingVersion !== payload.source?.mappingVersion) findings.push("work-source.import normalizedItem mappingVersion must match resolved mapping");
  if (observedRevision !== payload.source?.observedRevision) findings.push("work-source.import normalizedItem revision must match observed revision");
  try {
    const expectedSourceRef = deriveSourceRef({ source: { id: payload.source.sourceId, provider: payload.source.provider, mappingVersion: payload.source.mappingVersion }, normalizedItem: payload.normalizedItem, importedAt: payload.proposedAt, role: payload.source.role });
    if (revisionHash(expectedSourceRef) !== revisionHash(payload.requestSnapshot?.sourceRefs?.[0] || null)) findings.push("work-source.import sourceRef must be derived from the normalized source item");
    const expectedSnapshot = mappedReleaseItemSnapshot(payload.normalizedItem, expectedSourceRef);
    if (revisionHash(expectedSnapshot) !== revisionHash(payload.requestSnapshot || null)) findings.push("work-source.import requestSnapshot must be derived from the normalized source item");
  } catch (error) {
    findings.push(`work-source.import cannot derive canonical snapshot: ${error.message}`);
  }
''')
replace_once("runtime/src/lib/workSourceImport.mjs", '''    mappingVersion: payload.source?.mappingVersion,
    observedRevision: payload.source?.observedRevision,
''', '''    mappingVersion: payload.source?.mappingVersion,
    sourceConfigHash: payload.source?.configHash,
    observedRevision: payload.source?.observedRevision,
''')

# Manual Release Item creation cannot forge source provenance.
replace_once("runtime/src/lib/releaseItemCreate.mjs", 'const SERVER_OWNED = new Set(["id", "displayId", "displayIdStatus", "releaseId", "releaseRefResolved", "operationId", "createdAt", "updatedAt", "createdBy", "updatedBy", "audit", "status", "revision", "findings", "readiness", "completion", "resolution", "approval", "childIndexes", "workPackageRefs", "eventId", "targetPaths", "parentRevision"]);\n', 'const SERVER_OWNED = new Set(["id", "displayId", "displayIdStatus", "releaseId", "releaseRefResolved", "operationId", "createdAt", "updatedAt", "createdBy", "updatedBy", "audit", "status", "revision", "findings", "readiness", "completion", "resolution", "approval", "childIndexes", "workPackageRefs", "sourceRefs", "eventId", "targetPaths", "parentRevision"]);\n')
replace_once("runtime/src/lib/releaseItemCreate.mjs", 'const COMMON_ALLOWED = new Set(["kind", "title", "description", "dependencies", "dependencyRefs", "sourceRefs", "slug", "idempotencyKey"]);\n', 'const COMMON_ALLOWED = new Set(["kind", "title", "description", "dependencies", "dependencyRefs", "slug", "idempotencyKey"]);\n')
replace_once("runtime/src/lib/releaseItemCreate.mjs", '    sourceRefs: normalizeSourceRefs(rawPayload.sourceRefs),\n', '    sourceRefs: [],\n')

# Persist stable local item identity and validate source-ref semantics.
release_schema_path = ROOT / "runtime/src/schemas/release-item.schema.json"
release_schema = json.loads(release_schema_path.read_text(encoding="utf-8"))
source_ref = release_schema["$defs"]["sourceRef"]
source_ref["properties"]["itemId"] = {"type": "string", "minLength": 1, "maxLength": 256}
local_variant = source_ref["oneOf"][0]
if "itemId" not in local_variant["required"]:
    local_variant["required"].append("itemId")
release_schema_path.write_text(json.dumps(release_schema, indent=2) + "\n", encoding="utf-8")
replace_once("runtime/src/lib/releaseItemStore.mjs", '''  if (!isReleaseItemDisplayIdForUuid(item.id, item.displayId)) findings.push(`displayId ${item.displayId} is not derived from Release Item UUIDv7 ${item.id}`);
  const revisionless = { ...item, audit: { ...item.audit } };
''', '''  if (!isReleaseItemDisplayIdForUuid(item.id, item.displayId)) findings.push(`displayId ${item.displayId} is not derived from Release Item UUIDv7 ${item.id}`);
  const sourceIdentities = new Set();
  let primaryCount = 0;
  for (const ref of item.sourceRefs || []) {
    if (ref.role === "primary") primaryCount += 1;
    const locator = ref.itemId || ref.externalId || ref.path;
    const identity = `${ref.role}:${ref.provider}:${ref.sourceId}:${locator}`;
    if (sourceIdentities.has(identity)) findings.push(`sourceRefs contains duplicate semantic identity ${identity}`);
    sourceIdentities.add(identity);
  }
  if (primaryCount > 1) findings.push("sourceRefs cannot contain more than one primary reference without an explicit policy");
  const revisionless = { ...item, audit: { ...item.audit } };
''')

# Close the Work Source ChangeSet payload and bind full source configuration.
change_set_path = ROOT / "runtime/src/schemas/change-set.schema.json"
change_set_text = change_set_path.read_text(encoding="utf-8")
start = '''    {
      "if": {
        "properties": {
          "kind": {
            "const": "work-source.import"
'''
end = '''    {
      "if": {
        "properties": {
          "kind": {
            "const": "config.autonomy.set"
'''
new_block = r'''    {
      "if": {
        "properties": {
          "kind": {
            "const": "work-source.import"
          }
        }
      },
      "then": {
        "properties": {
          "payload": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "operationId",
              "id",
              "displayId",
              "displayIdStatus",
              "releaseId",
              "parentRevision",
              "proposedAt",
              "actor",
              "source",
              "normalizedItem",
              "requestSnapshot",
              "idempotencyKey",
              "idempotencyRequestHash",
              "targetPaths"
            ],
            "properties": {
              "operationId": { "$ref": "#/properties/operationId" },
              "id": { "$ref": "#/properties/operationId" },
              "displayId": { "type": "string", "pattern": "^RI-([0-9A-HJKMNP-TV-Z]{8}|[0-9A-HJKMNP-TV-Z]{12}|[0-9A-HJKMNP-TV-Z]{16}|[0-9A-HJKMNP-TV-Z]{26}|[0-9A-HJKMNP-TV-Z]{52})$" },
              "displayIdStatus": { "const": "ACTIVE" },
              "releaseId": { "$ref": "#/properties/operationId" },
              "parentRevision": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" },
              "proposedAt": { "type": "string", "minLength": 1 },
              "actor": { "type": "string", "minLength": 1 },
              "source": {
                "type": "object",
                "additionalProperties": false,
                "required": ["sourceId", "provider", "itemRef", "itemId", "path", "observedRevision", "mappingVersion", "configHash", "role"],
                "properties": {
                  "sourceId": { "type": "string", "minLength": 1 },
                  "provider": { "type": "string", "pattern": "^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$" },
                  "itemRef": { "type": "string", "minLength": 1 },
                  "itemId": { "type": "string", "minLength": 1 },
                  "path": { "type": ["string", "null"], "minLength": 1 },
                  "observedRevision": { "type": "string", "minLength": 1 },
                  "mappingVersion": { "type": "integer", "minimum": 1 },
                  "configHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
                  "role": { "const": "primary" }
                }
              },
              "normalizedItem": { "$ref": "https://shipping-mode.dev/schemas/normalized-work-source-item.schema.json" },
              "requestSnapshot": {
                "type": "object",
                "additionalProperties": false,
                "required": ["kind", "title", "description", "slug", "dependencies", "sourceRefs"],
                "properties": {
                  "kind": { "enum": ["user_story", "capability", "defect", "enabler", "spike", "compliance", "migration", "operational"] },
                  "title": { "type": "string", "minLength": 1 },
                  "description": { "type": ["string", "null"], "minLength": 1 },
                  "slug": { "type": ["string", "null"], "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
                  "dependencies": { "type": "array", "items": { "$ref": "#/properties/operationId" }, "uniqueItems": true },
                  "sourceRefs": { "type": "array", "minItems": 1, "maxItems": 1, "items": { "$ref": "https://shipping-mode.dev/schemas/release-item.schema.json#/$defs/sourceRef" } },
                  "actor": { "type": "string", "minLength": 1 },
                  "need": { "type": "string", "minLength": 1 },
                  "value": { "type": "string", "minLength": 1 },
                  "acceptanceCriteria": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 }, "uniqueItems": true },
                  "outcome": { "type": "string", "minLength": 1 },
                  "behavior": { "type": "string", "minLength": 1 },
                  "observedBehavior": { "type": "string", "minLength": 1 },
                  "expectedBehavior": { "type": "string", "minLength": 1 },
                  "reproduction": { "type": "string", "minLength": 1 },
                  "severity": { "enum": ["low", "medium", "high", "critical"] },
                  "technicalOutcome": { "type": "string", "minLength": 1 },
                  "unlockedCapabilities": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 }, "uniqueItems": true },
                  "question": { "type": "string", "minLength": 1 },
                  "timebox": { "type": "string", "minLength": 1 },
                  "expectedDecision": { "type": "string", "minLength": 1 },
                  "obligation": { "type": "string", "minLength": 1 },
                  "authority": { "type": "string", "minLength": 1 },
                  "deadline": { "type": "string", "minLength": 1 },
                  "evidence": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 }, "uniqueItems": true },
                  "sourceState": { "type": "string", "minLength": 1 },
                  "targetState": { "type": "string", "minLength": 1 },
                  "rollback": { "type": "string", "minLength": 1 },
                  "procedure": { "type": "string", "minLength": 1 },
                  "owner": { "type": "string", "minLength": 1 }
                }
              },
              "idempotencyKey": { "type": "string", "minLength": 1, "maxLength": 256 },
              "idempotencyRequestHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
              "targetPaths": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "string", "minLength": 1 }, "uniqueItems": true }
            }
          }
        }
      }
    },
'''
start_index = change_set_text.find(start)
end_index = change_set_text.find(end, start_index)
if start_index < 0 or end_index < 0:
    raise SystemExit("work-source.import schema block markers not found")
change_set_path.write_text(change_set_text[:start_index] + new_block + change_set_text[end_index:], encoding="utf-8")

# Config roots cannot be Git internals either.
replace_once("runtime/src/schemas/config.schema.json", '"pattern": "^(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!\\.planning(?:/|$)).+"', '"pattern": "^(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!\\.planning(?:/|$))(?!\\.git(?:/|$)).+"')
replace_once("runtime/src/lib/projectContextValidation.mjs", '''      if (path.posix.isAbsolute(root) || path.win32.isAbsolute(root) || segments.includes("..")) {
        findings.push(`config.yml: work source ${source.id} root must remain inside the workspace`);
      }
''', '''      if (path.posix.isAbsolute(root) || path.win32.isAbsolute(root) || segments.includes("..")) {
        findings.push(`config.yml: work source ${source.id} root must remain inside the workspace`);
      }
      if (segments[0] === ".planning" || segments[0] === ".git") findings.push(`config.yml: work source ${source.id} root cannot use reserved runtime or VCS directories`);
''')

# Query-only checks now run a reusable provider contract probe.
replace_once("runtime/src/commands/check.mjs", 'import { defaultWorkSourceRegistry, normalizeWorkSourceConfig } from "../lib/workSourceImport.mjs";\n', 'import { defaultWorkSourceRegistry, normalizeWorkSourceConfig, readValidatedWorkSourceConfig } from "../lib/workSourceImport.mjs";\nimport { evaluateWorkSourceProviderContract } from "../lib/workSourceContract.mjs";\n')
replace_between("runtime/src/commands/check.mjs", 'export function checkWorkSources', 'function checkReleaseDocument', r'''export function checkWorkSources({ planningRoot, workspaceRoot = path.dirname(planningRoot) }) {
  if (!fs.existsSync(planningRoot)) return { status: "NOT_INITIALIZED", sources: [], findings: ["workspace is not initialized: .planning/ does not exist"], pendingOperations: [] };
  const pending = pendingRecovery(planningRoot);
  if (pending.length > 0) return { status: "RECOVERY_REQUIRED", sources: [], findings: ["workspace has pending or recovery-required operations"], pendingOperations: pending };
  let config;
  let sources;
  try {
    config = readValidatedWorkSourceConfig(planningRoot);
    sources = normalizeWorkSourceConfig({ config, workspaceRoot });
  } catch (error) {
    return { status: "FAIL", sources: [], findings: [`SOURCE_MISCONFIGURED: ${error.message}`], pendingOperations: [] };
  }
  let registry;
  try {
    registry = defaultWorkSourceRegistry({ planningRoot });
  } catch (error) {
    return { status: "FAIL", sources: [], findings: [`SOURCE_MISCONFIGURED: ${error.message}`], pendingOperations: [] };
  }
  const entries = [];
  const findings = [];
  for (const source of sources) {
    const entryFindings = [];
    const descriptor = registry.inspect(source.id);
    const capabilities = source.capabilities.map((capability) => ({ name: capability, declared: true, implemented: descriptor.providerCapabilities.includes(capability) }));
    for (const capability of capabilities) {
      if (!capability.implemented) entryFindings.push({ code: "SOURCE_CAPABILITY_MISSING", severity: "error", message: `capability ${capability.name} is not implemented by ${source.provider}` });
    }
    const roots = source.roots.map((root) => {
      let available = false;
      try {
        const stat = fs.lstatSync(root.absolutePath);
        available = stat.isDirectory() && !stat.isSymbolicLink();
      } catch {
        available = false;
      }
      if (source.enabled && !available) entryFindings.push({ code: "SOURCE_UNAVAILABLE", severity: "error", message: `root unavailable: ${root.relativePath}` });
      return { path: root.relativePath, available };
    });
    const contract = evaluateWorkSourceProviderContract({ registry, source });
    entryFindings.push(...contract.findings);
    const orderedFindings = entryFindings.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`));
    entries.push({
      sourceId: source.id,
      provider: source.provider,
      enabled: source.enabled,
      capabilities,
      configuration: { valid: orderedFindings.length === 0, mappingVersion: source.mappingVersion, importPolicy: source.importPolicy, syncMode: source.syncMode },
      roots,
      contractTests: { active: contract.active, status: contract.status, contractVersion: contract.contractVersion, checks: contract.checks, itemCount: contract.itemCount },
      findings: orderedFindings
    });
  }
  for (const entry of entries) findings.push(...entry.findings.map((finding) => `${finding.code}: ${finding.message}`));
  return { status: findings.length > 0 ? "FAIL" : "PASS", sources: entries.sort((left, right) => left.sourceId.localeCompare(right.sourceId)), findings, pendingOperations: [] };
}

''')

# Tests and fixtures.
replace_once("runtime/src/lib/tests/work-source-foundation.test.mjs", 'import { runItemImport } from "../../commands/item.mjs";\n', 'import { proposeReleaseItemCreate, runItemImport } from "../../commands/item.mjs";\n')
replace_once("runtime/src/lib/tests/work-source-foundation.test.mjs", 'import { normalizeWorkSourceConfig, validateNormalizedWorkSourceItem } from "../workSourceImport.mjs";\n', 'import { normalizeWorkSourceConfig, validateNormalizedWorkSourceItem } from "../workSourceImport.mjs";\nimport { validate } from "../schema.mjs";\n')
replace_once("runtime/src/lib/tests/work-source-foundation.test.mjs", '''    title: "Import assessment brief",
    description: { format: "markdown", text: "As a teacher I need an assessment brief." },
''', '''    title: "Import assessment brief",
    description: { format: "markdown", text: "As a teacher I need an assessment brief." },
    actor: "teacher",
    need: "an assessment brief",
    value: "consistent evaluation instructions",
''')
replace_once("runtime/src/lib/tests/work-source-foundation.test.mjs", '() => buildWorkSourceRegistry({ providerFactories: [() => ({ provider: "local_repository", capabilities: ["discover"], discover() {} }), () => ({ provider: "local_repository", capabilities: ["discover"], discover() {} })], sources: [] })', '() => buildWorkSourceRegistry({ providerFactories: [() => ({ provider: "local_repository", contractVersion: 1, capabilities: ["discover"], discover() {} }), () => ({ provider: "local_repository", contractVersion: 1, capabilities: ["discover"], discover() {} })], sources: [] })')
replace_once("runtime/src/lib/tests/work-source-foundation.test.mjs", '() => buildWorkSourceRegistry({ providerFactories: [() => ({ provider: "broken", capabilities: ["discover", "create"], discover() {} })], sources:', '() => buildWorkSourceRegistry({ providerFactories: [() => ({ provider: "broken", contractVersion: 1, capabilities: ["discover", "create"], discover() {} })], sources:')
extra_tests = r'''

{
  const { workspaceRoot, planningRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  assert.throws(() => proposeReleaseItemCreate({
    planningRoot,
    releaseRef: release.releaseId,
    actor: "carlos",
    rawPayload: {
      kind: "user_story",
      title: "Forged provenance",
      actor: "teacher",
      need: "traceability",
      value: "trust",
      acceptanceCriteria: ["provenance is genuine"],
      sourceRefs: [{ sourceId: "forged", provider: "local_repository", role: "primary", itemId: "forged-1", path: "forged.yml", contentRevision: `sha256:${"a".repeat(64)}`, mappingVersion: 1 }]
    }
  }), /sourceRefs.*server-owned/);
}

{
  const { workspaceRoot, planningRoot, operationsRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const proposed = runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "closed-schema", commandActor: "carlos" } });
  const changeSet = readChangeSet(operationsRoot, proposed.operationId);
  changeSet.payload.untrusted = true;
  assert.equal(validate("change-set", changeSet).valid, false, "work-source.import payload must remain closed");
}

{
  const { workspaceRoot, planningRoot, operationsRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const proposed = runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "config-stale", commandActor: "carlos" } });
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.work_sources[0].options.max_item_bytes = 65535;
  fs.writeFileSync(configPath, stringifyYaml(config));
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: proposed.operationId }).status, "STALE", "any Work Source configuration drift must stale the proposal");
}

{
  const { workspaceRoot, planningRoot } = initializedWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "real-backlog"), { recursive: true });
  fs.symlinkSync(path.join(workspaceRoot, "real-backlog"), path.join(workspaceRoot, "linked-backlog"), "dir");
  configureLocalSource(planningRoot, { roots: ["linked-backlog"] });
  assert.throws(() => normalizeWorkSourceConfig({ config: parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")), workspaceRoot }), /symlink component rejected/);
}

{
  const { workspaceRoot, planningRoot } = initializedWorkspace();
  configureLocalSource(planningRoot, { roots: ["."], options: { file_globs: ["*"], max_item_bytes: 65536 } });
  writeLocalItem(workspaceRoot);
  fs.writeFileSync(path.join(planningRoot, "internal.work-source.yml"), stringifyYaml({
    schemaVersion: 1, id: "internal", type: "user_story", title: "Internal", description: "must be ignored", actor: "runtime", need: "privacy", value: "isolation", acceptanceCriteria: ["ignored"], status: "todo", priority: "low"
  }));
  const result = checkWorkSources({ planningRoot, workspaceRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.sources[0].contractTests.itemCount, 1, ".planning must never be traversed by a broad local root");
}

{
  const { workspaceRoot, planningRoot } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot, "invalid.work-source.yml", { actor: undefined });
  const result = checkWorkSources({ planningRoot, workspaceRoot });
  assert.equal(result.status, "FAIL", "check work-sources must execute provider discovery and expose invalid source items");
  assert.match(result.findings.join("\n"), /actor must be a non-blank string/);
}

{
  const { workspaceRoot, planningRoot, operationsRoot, release } = initializedWorkspace();
  configureLocalSource(planningRoot);
  writeLocalItem(workspaceRoot);
  const imported = runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "move-1", commandActor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: imported.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: imported.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: imported.operationId, actor: "carlos" });
  fs.renameSync(path.join(workspaceRoot, "backlog", "story.work-source.yml"), path.join(workspaceRoot, "backlog", "moved.work-source.yml"));
  assert.throws(() => runItemImport({ planningRoot, releaseRef: release.releaseId, args: { sourceRef: "local-backlog:story-1", idempotencyKey: "move-2", commandActor: "carlos" } }), /already imported as primary/, "stable local item id must survive path moves");
}

{
  const external = {
    schemaVersion: 1,
    sourceId: "jira-gradeops",
    provider: "jira",
    itemId: "GRADE-142",
    url: "https://example.invalid/browse/GRADE-142",
    type: "capability",
    title: "External capability",
    description: { format: "plain", text: "External normalized item" },
    acceptanceCriteria: [{ id: "ac-1", text: "It imports" }],
    status: { normalized: "todo", providerStatus: "To Do" },
    priority: { normalized: "high", providerPriority: "High" },
    labels: [], relationships: [], dependencies: [], assignee: null, owner: null,
    fields: { outcome: "Imported capability", behavior: "Preserve provider-neutral semantics" },
    revision: { externalRevision: "10042", updatedAt: "2026-07-30T00:00:00Z" },
    mappingVersion: 1, metadata: {},
    trace: { observedPath: null, observedBytes: 0, observedContentHash: "a".repeat(64) }
  };
  assert.equal(validateNormalizedWorkSourceItem(external).valid, true, "normalized schema must remain usable by the future Jira adapter without local revision fields");
}
'''
replace_once("runtime/src/lib/tests/work-source-foundation.test.mjs", '\nconsole.log("work-source-foundation: registry, local provider, import, stale detection and checks pass");\n', extra_tests + '\nconsole.log("work-source-foundation: registry, local provider, import, stale detection and checks pass");\n')
replace_once("runtime/src/lib/tests/work-source-import-crash-recovery.test.mjs", '''    title: "Crash import",
    description: { format: "plain", text: "Import must recover." },
''', '''    title: "Crash import",
    description: { format: "plain", text: "Import must recover." },
    actor: "operator",
    need: "recoverable imports",
    value: "durable provenance",
''')

# Record the review corrections in the canonical plan.
plan_path = ROOT / "docs/superpowers/plans/2026-07-30-corte-3-plan-3-work-source-foundation.md"
plan = plan_path.read_text(encoding="utf-8")
plan += r'''

## Auditoría post-review de PR #26

La revisión adversarial cerró gaps que no estaban cubiertos por la implementación inicial:

- `release-item.create` ya no acepta `sourceRefs` proporcionadas por caller; la provenance de import es exclusivamente server-owned.
- El payload de `work-source.import`, `source` y `requestSnapshot` son schemas cerrados.
- `normalizedItem`, source resolution, source ref y Release Item mapping quedan ligados semánticamente, no solo por el hash público del ChangeSet.
- La configuración completa de la Work Source queda fijada mediante hash; cambios de roots, options, capabilities, policy o sync mode producen `STALE`.
- `config.yml` se lee como archivo real, schema-valid e íntegro antes de activar el registry.
- Roots con componentes symlink son rechazados y discovery excluye siempre `.planning` y `.git`, incluso desde roots amplios.
- El provider contract tiene versión explícita y `check work-sources` ejecuta probes deterministas de discover/search/get.
- La normalización exige campos canónicos específicos por kind; no se fabrican valores `unspecified` ni se infieren campos obligatorios ambiguos.
- Source refs locales conservan `itemId` estable además de path, por lo que un movimiento de archivo no permite duplicar el mismo primary item.
- El schema normalizado admite providers externos sin exigir fingerprints locales, preservando la compatibilidad prevista para Plan 4.
'''
plan_path.write_text(plan, encoding="utf-8")

print("PR 26 corrective source patch applied")
