# Host MCP Bridge Spike

This spike is isolated from the production runtime. It tests whether a Shipping
Mode plugin skill can prepare a canonical MCP request, let Claude Code execute a
real read-only MCP tool, capture host hook evidence, sign a response envelope
under `CLAUDE_PLUGIN_DATA`, and consume that envelope once from Node.

The result remains `INCONCLUSIVE`: deterministic mechanics are tested, but a real
MCP success followed by a real `PostToolUse` capture has not yet completed.

## State Location

Bridge state is stored under:

```text
${CLAUDE_PLUGIN_DATA}/work-source-bridge/
```

It must not be stored under `.planning/**`.

Production-style commands require both `CLAUDE_PLUGIN_DATA` and
`CLAUDE_CODE_SESSION_ID`. The session ID is hashed into the pending challenge;
a hook event or consume command from another Claude Code session is rejected.

## Commands

Run these from the temporary plugin skill. Installed-plugin paths use
`${CLAUDE_PLUGIN_ROOT}` rather than assuming the target project is the plugin
source checkout.

Prepare a challenge:

```bash
node "${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/bridge-cli.mjs" prepare \
  --operation get \
  --server <mcp-server> \
  --tool <mcp-tool-or-full-tool-name> \
  --project-root "${CLAUDE_PROJECT_DIR}" \
  --expected-input-file /tmp/bridge-input.json
```

Consume once, in the same Claude Code session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/bridge-cli.mjs" consume \
  --request-id <request-id> \
  --project-root "${CLAUDE_PROJECT_DIR}"
```

Cleanup expired challenges:

```bash
node "${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/bridge-cli.mjs" cleanup-expired
```

`--data-root` is test-only and requires `BRIDGE_SPIKE_ALLOW_DATA_ROOT=1`.
`inspect` returns redacted metadata; it never prints the nonce, response or HMAC.

## Hook Model

The skill defines scoped hooks for:

- `PostToolUse`: publishes one immutable signed `CAPTURED` envelope;
- `PostToolUseFailure`: records a bounded `BRIDGE_UNAVAILABLE`,
  `BRIDGE_TIMEOUT` or `BRIDGE_CANCELLED` finding without persisting the raw
  provider error.

The skill does not pre-approve `mcp__*`. The chosen read-only MCP call must pass
through the normal Claude Code permission flow.

Consumption never mutates the signed envelope. It atomically changes the request
record to `CONSUMED`, stores the immutable envelope hash, and rejects replay.
If capture metadata was not published after an envelope write, consume can
reconstruct it from the valid signed envelope.

## Trust Model

This is a cooperative host guardrail. The HMAC envelope distinguishes a response
captured by the configured Claude Code hook from ordinary unsigned JSON, and
binds the request, Claude Code session, project, server, tool, input and response.

It is not a sandbox and is not a trust boundary against a malicious local process
that can read the same plugin data directory, modify the plugin, or access the
bridge key.

Key-name filtering and size/depth limits reduce accidental secret persistence,
but a generic bridge cannot prove that arbitrary string values contain no
sensitive business data. P4-0 must use an intentionally non-sensitive read-only
tool; a production provider must map host responses to a closed safe DTO before
persisting domain data.

## Key Rotation

Delete `${CLAUDE_PLUGIN_DATA}/work-source-bridge/bridge.key` only when no pending
requests exist. The next prepare/capture/consume command regenerates a local key
with restrictive permissions where the platform supports POSIX modes. Old
pending envelopes become invalid after rotation.
