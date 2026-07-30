# Host MCP Bridge Spike

This spike is isolated from the production runtime. It tests whether a Shipping
Mode plugin skill can prepare a canonical MCP request, let Claude Code execute a
real read-only MCP tool, capture `PostToolUse` host evidence, sign a response
envelope under `CLAUDE_PLUGIN_DATA`, and consume that envelope once from Node.

The bridge state is stored under:

```text
${CLAUDE_PLUGIN_DATA}/work-source-bridge/
```

It must not be stored under `.planning/**`.

## Commands

Prepare a challenge:

```bash
node spikes/host-mcp-bridge/bridge-cli.mjs prepare \
  --operation get \
  --server <mcp-server> \
  --tool <mcp-tool-or-full-tool-name> \
  --project-root "$PWD" \
  --expected-input-file /tmp/bridge-input.json
```

Consume once:

```bash
node spikes/host-mcp-bridge/bridge-cli.mjs consume \
  --request-id <request-id> \
  --project-root "$PWD"
```

Cleanup expired challenges:

```bash
node spikes/host-mcp-bridge/bridge-cli.mjs cleanup-expired
```

## Trust Model

This is a cooperative host guardrail. The HMAC envelope distinguishes a response
captured by the configured Claude Code hook from ordinary JSON passed to the CLI,
binds request, project, tool, input and response, and rejects accidental
tampering or replay.

It is not a sandbox and is not a trust boundary against a malicious local process
that can read the same plugin data directory, modify the plugin, or access the
bridge key.

## Key Rotation

Delete `${CLAUDE_PLUGIN_DATA}/work-source-bridge/bridge.key` only when no pending
requests exist. The next prepare/capture/consume command regenerates a new local
key with restrictive permissions when the platform supports POSIX modes. Old
pending envelopes become invalid after rotation.
