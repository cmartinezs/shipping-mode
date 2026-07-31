import { validateNormalizedWorkSourceItem } from "./workSourceImport.mjs";

const SECRET_KEY_PATTERN = /(token|secret|password|cookie|credential|authorization|auth|api[-_]?key|refresh)/i;
const REQUIRED_FIELDS_BY_KIND = {
  user_story: ["actor", "need", "value"],
  capability: ["outcome", "behavior"],
  defect: ["observedBehavior", "expectedBehavior", "reproduction", "severity"],
  enabler: ["technicalOutcome", "unlockedCapabilities"],
  spike: ["question", "timebox", "expectedDecision"],
  compliance: ["obligation", "authority", "deadline", "evidence"],
  migration: ["sourceState", "targetState", "rollback"],
  operational: ["procedure", "owner", "evidence"]
};

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-blank string`);
  return value.trim();
}

function assertNoRawOrSecretKeys(value, path = "transportItem", depth = 0) {
  if (depth > 6) throw new Error(`${path} exceeds safe depth`);
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoRawOrSecretKeys(entry, path, depth + 1);
    return;
  }
  for (const key of Object.keys(value)) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`${path} contains secret-like key ${key}`);
    if (/raw.*payload|payload.*raw|rawJiraPayload/i.test(key)) throw new Error(`${path} contains raw provider payload key ${key}`);
    assertNoRawOrSecretKeys(value[key], `${path}.${key}`, depth + 1);
  }
}

function valueForSelector(issue, selector) {
  if (selector === "summary") return issue.summary;
  if (selector === "description") return issue.description;
  if (selector === "status") return issue.status;
  if (selector === "priority") return issue.priority;
  if (selector === "labels") return issue.labels;
  if (selector === "parent") return issue.parent;
  if (selector === "epic") return issue.epic;
  if (selector === "links") return issue.links;
  if (selector === "assignee") return issue.assignee;
  return issue.fields?.[selector];
}

function normalizeDescription(value) {
  if (value === null || value === undefined || value === "") return null;
  return { format: "plain", text: requireString(value, "description") };
}

function normalizeStatus(value) {
  const raw = value === undefined || value === null ? null : requireString(value, "status");
  if (!raw) return { normalized: "unknown", providerStatus: null };
  const normalized = raw.toLowerCase().replaceAll(" ", "_");
  if (["to_do", "todo", "open", "backlog"].includes(normalized)) return { normalized: "todo", providerStatus: raw };
  if (["in_progress", "doing"].includes(normalized)) return { normalized: "in_progress", providerStatus: raw };
  if (["done", "closed", "resolved"].includes(normalized)) return { normalized: "done", providerStatus: raw };
  if (["cancelled", "canceled"].includes(normalized)) return { normalized: "cancelled", providerStatus: raw };
  return { normalized: "unknown", providerStatus: raw };
}

function normalizePriority(value) {
  const raw = value === undefined || value === null ? null : requireString(value, "priority");
  if (!raw) return { normalized: "none", providerPriority: null };
  const normalized = raw.toLowerCase();
  if (["critical", "high", "medium", "low"].includes(normalized)) return { normalized, providerPriority: raw };
  return { normalized: "none", providerPriority: raw };
}

function sanitizeUrl(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const url = new URL(requireString(value, "url"));
  if (url.username || url.password) throw new Error("Jira URL must not contain credentials");
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Jira URL must be http or https");
  return url.toString();
}

function normalizeAcceptanceCriteria(value) {
  const entries = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  return entries.map((entry, index) => ({ id: `ac-${index + 1}`, text: requireString(entry, `acceptanceCriteria[${index}]`) }));
}

function normalizeStringArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const normalized = value.map((entry) => requireString(entry, field));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} cannot contain duplicates`);
  return normalized.sort();
}

function normalizeExternalRefs(value, type) {
  const entries = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  return entries.map((entry) => ({
    type,
    target: typeof entry === "string" ? entry : requireString(entry?.externalId || entry?.key || entry?.target, `${type}.target`)
  })).sort((left, right) => `${left.type}:${left.target}`.localeCompare(`${right.type}:${right.target}`));
}

function normalizeKindFields({ issue, mapping, issueType }) {
  const kind = mapping.kind;
  const fields = {};
  for (const name of REQUIRED_FIELDS_BY_KIND[kind] || []) {
    const selector = mapping[name];
    const value = valueForSelector(issue, selector);
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      throw new Error(`SOURCE_MISCONFIGURED: ${issueType} missing required mapped field ${name}`);
    }
    fields[name] = Array.isArray(value) ? normalizeStringArray(value, name) : requireString(String(value), name);
  }
  if (kind === "defect") fields.severity = normalizePriority(fields.severity).normalized === "none" ? String(fields.severity).toLowerCase() : normalizePriority(fields.severity).normalized;
  return fields;
}

export function mapJiraTransportItem({ source, transportItem, responseFingerprint, observedAt }) {
  if (!source || source.provider !== "jira") throw new Error("Jira mapping requires a jira Work Source");
  if (!transportItem || typeof transportItem !== "object" || Array.isArray(transportItem)) throw new Error("Jira transport item must be an object");
  assertNoRawOrSecretKeys(transportItem);
  const issueType = requireString(transportItem.issueType, "issueType");
  const mapping = source.options.field_map[issueType];
  if (!mapping) throw new Error(`SOURCE_MISCONFIGURED: Jira issue type ${issueType} is not mapped`);
  const kind = mapping.kind;
  const fields = normalizeKindFields({ issue: transportItem, mapping, issueType });
  const acceptanceCriteria = mapping.acceptanceCriteria ? normalizeAcceptanceCriteria(valueForSelector(transportItem, mapping.acceptanceCriteria)) : [];
  const normalized = {
    schemaVersion: 1,
    sourceId: source.id,
    provider: "jira",
    itemId: requireString(transportItem.externalId, "externalId"),
    ...(transportItem.url ? { url: sanitizeUrl(transportItem.url) } : {}),
    type: kind,
    title: requireString(transportItem.summary, "summary"),
    description: normalizeDescription(transportItem.description),
    acceptanceCriteria,
    status: normalizeStatus(transportItem.status),
    priority: normalizePriority(transportItem.priority),
    labels: normalizeStringArray(transportItem.labels, "labels"),
    relationships: [
      ...normalizeExternalRefs(transportItem.parent, "jira.parent"),
      ...normalizeExternalRefs(transportItem.epic, "jira.epic"),
      ...normalizeExternalRefs(transportItem.links, "jira.link")
    ],
    dependencies: [],
    assignee: transportItem.assignee ? requireString(typeof transportItem.assignee === "string" ? transportItem.assignee : transportItem.assignee.displayName, "assignee") : null,
    owner: null,
    fields,
    revision: { externalRevision: requireString(transportItem.revision || responseFingerprint, "revision"), fingerprint: responseFingerprint, updatedAt: transportItem.updatedAt || null },
    mappingVersion: source.mappingVersion,
    metadata: { issueType, mappingProfile: source.mappingProfile },
    trace: {
      kind: "external",
      externalId: requireString(transportItem.externalId, "externalId"),
      observedAt: requireString(observedAt, "observedAt"),
      responseFingerprint,
      evidence: { issueType, responseBytes: Buffer.byteLength(JSON.stringify(transportItem), "utf8") }
    }
  };
  const validation = validateNormalizedWorkSourceItem(normalized);
  if (!validation.valid) throw new Error(`Jira mapping produced invalid NormalizedWorkSourceItem: ${validation.errors.join("; ")}`);
  return normalized;
}
