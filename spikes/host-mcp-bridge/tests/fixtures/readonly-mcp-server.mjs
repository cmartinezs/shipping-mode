#!/usr/bin/env node

let inputBuffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

const tools = [
  {
    name: "shipping_mode_readonly_probe",
    description: "Read-only deterministic probe for Shipping Mode host bridge smoke tests.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["requestId", "probe"],
      properties: {
        requestId: { type: "string" },
        probe: { type: "string" }
      }
    }
  }
];

function handle(request) {
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "shipping-mode-readonly", version: "1.0.0" }
      }
    });
    return;
  }
  if (request.method === "notifications/initialized") return;
  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools } });
    return;
  }
  if (request.method === "tools/call") {
    const args = request.params?.arguments || {};
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "ok",
              requestId: args.requestId,
              probe: args.probe,
              readonly: true
            })
          }
        ],
        isError: false
      }
    });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "method not found" } });
}

function pump() {
  while (true) {
    const headerEnd = inputBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = inputBuffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!lengthMatch) {
      process.exitCode = 1;
      return;
    }
    const bodyLength = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + bodyLength;
    if (inputBuffer.length < bodyEnd) return;
    const body = inputBuffer.slice(bodyStart, bodyEnd).toString("utf8");
    inputBuffer = inputBuffer.slice(bodyEnd);
    handle(JSON.parse(body));
  }
}

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  pump();
});
