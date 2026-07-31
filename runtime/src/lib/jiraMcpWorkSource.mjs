import { buildWorkSourceTransportRequest } from "./workSourceTransportPort.mjs";
import { mapJiraTransportItem } from "./workSourceMapping.mjs";
import { workSourceConfigHash } from "./workSourceImport.mjs";

function finding(code, message) {
  return { code, severity: "error", message };
}

function unavailable() {
  return { status: "FAIL", items: [], item: null, findings: [finding("SOURCE_UNAVAILABLE", "Jira MCP Work Source requires an approved host transport bridge")] };
}

function normalizeFailure(error) {
  const message = error?.message || "Jira MCP transport failed";
  const code = /not found/i.test(message) ? "SOURCE_NOT_FOUND" : /misconfigured|required mapped field/i.test(message) ? "SOURCE_MISCONFIGURED" : /malformed|fingerprint|mismatch|raw provider/i.test(message) ? "SOURCE_MALFORMED" : "SOURCE_UNAVAILABLE";
  return finding(code, message);
}

export class JiraMcpWorkSource {
  provider = "jira";
  contractVersion = 1;
  capabilities = ["discover", "search", "get"];

  constructor({ transport = null } = {}) {
    this.transport = transport;
  }

  discover({ source }) {
    const response = this.#execute({ source, operation: "discover", params: { projectKeys: source.options.project_keys, limit: source.options.query_scope.max_results } });
    if (response.status !== "OK") return { status: "FAIL", items: [], findings: response.findings };
    return { status: "PASS", items: this.#mapItems({ source, response, items: response.items }), findings: [] };
  }

  search({ source, query }) {
    const response = this.#execute({ source, operation: "search", params: { projectKeys: source.options.project_keys, queryText: String(query || ""), limit: source.options.query_scope.max_results } });
    if (response.status !== "OK") return { status: "FAIL", items: [], findings: response.findings };
    return { status: "PASS", items: this.#mapItems({ source, response, items: response.items }), findings: [] };
  }

  get({ source, itemRef }) {
    const response = this.#execute({ source, operation: "get", params: { itemRef, requestedFieldIds: requestedFieldIds(source), limit: 1 } });
    if (response.status === "NOT_FOUND") return { status: "NOT_FOUND", item: null, findings: response.findings };
    if (response.status !== "OK") return { status: "FAIL", item: null, findings: response.findings };
    try {
      return { status: "FOUND", item: mapJiraTransportItem({ source, transportItem: response.item, responseFingerprint: response.responseFingerprint, observedAt: response.observedAt }), findings: [] };
    } catch (error) {
      return { status: "FAIL", item: null, findings: [normalizeFailure(error)] };
    }
  }

  #execute({ source, operation, params }) {
    if (!this.transport || typeof this.transport.execute !== "function") return unavailable();
    const request = buildWorkSourceTransportRequest({
      ...(this.transport.requestId ? { requestId: this.transport.requestId } : {}),
      provider: "jira",
      transport: "mcp",
      connectionRef: source.connectionRef,
      sourceId: source.id,
      operation,
      capability: operation,
      mappingVersion: source.mappingVersion,
      configHash: `sha256:${workSourceConfigHash(source)}`,
      params
    });
    try {
      return this.transport.execute(request);
    } catch (error) {
      return { status: "MALFORMED", items: [], item: null, findings: [normalizeFailure(error)], responseFingerprint: null, observedAt: new Date(0).toISOString() };
    }
  }

  #mapItems({ source, response, items }) {
    return [...items].map((item) => mapJiraTransportItem({ source, transportItem: item, responseFingerprint: response.responseFingerprint, observedAt: response.observedAt }))
      .sort((left, right) => left.itemId.localeCompare(right.itemId));
  }
}

export function requestedFieldIds(source) {
  const fields = new Set(["summary", "description", "status", "priority", "labels", "parent", "epic", "links", "assignee"]);
  for (const mapping of Object.values(source.options.field_map || {})) {
    for (const [field, selector] of Object.entries(mapping)) {
      if (field !== "kind") fields.add(selector);
    }
  }
  return [...fields].sort();
}
