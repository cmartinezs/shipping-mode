import fs from "node:fs";
import { transportResponseFingerprint, validateWorkSourceTransportResponse } from "../../workSourceTransportPort.mjs";

export class FakeWorkSourceTransport {
  constructor({ fixturePath, scenario = null } = {}) {
    if (!fixturePath) throw new Error("FakeWorkSourceTransport requires a fixturePath");
    this.fixturePath = fixturePath;
    this.scenarios = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    this.scenario = scenario;
    this.requests = [];
  }

  execute(request, { scenario = this.scenario } = {}) {
    this.requests.push(structuredClone(request));
    const selected = scenario || request.operation;
    const fixture = this.#fixture(selected, request);
    const response = {
      schemaVersion: 1,
      requestId: request.requestId,
      requestHash: request.requestHash,
      provider: request.provider,
      transport: request.transport,
      connectionRef: request.connectionRef,
      sourceId: request.sourceId,
      status: fixture.status,
      items: fixture.items || [],
      item: fixture.item ?? null,
      findings: fixture.findings || [],
      observedAt: "2026-07-30T00:00:00.000Z"
    };
    if (selected === "request-mismatch") response.requestId = "018f0000-0000-7000-8000-000000000000";
    if (selected === "response-oversized") response.items = [{ externalId: "GRADE-BIG", text: "x".repeat(300 * 1024) }];
    response.responseFingerprint = transportResponseFingerprint(response);
    if (selected === "fingerprint-mismatch") response.responseFingerprint = `sha256:${"b".repeat(64)}`;
    return validateWorkSourceTransportResponse(request, response);
  }

  #fixture(name, request) {
    if (name === "request-mismatch" || name === "fingerprint-mismatch" || name === "response-oversized") return this.#fixture(request.operation, request);
    const fixture = this.scenarios[name];
    if (!fixture) throw new Error(`unknown fake Work Source transport scenario: ${name}`);
    return structuredClone(fixture);
  }
}
