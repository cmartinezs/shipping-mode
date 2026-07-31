# Host MCP Bridge Spike

This spike is isolated from the production runtime. It proves that a Shipping
Mode plugin skill can prepare a canonical MCP request, let Claude Code execute a
real read-only MCP tool, capture host hook evidence, sign a response envelope
under `CLAUDE_PLUGIN_DATA`, consume that envelope once from Node, and reject a
second consume as replay.

Result:

```text
PASSED
```

The productive proof used an installed local plugin, the `p4fs` MCP server and
`mcp__p4fs__read_text_file` against the repository `package.json` file.

## State Location

Bridge state is stored under:

```text
${CLAUDE_PLUGIN_DATA}/work-source-bridge/
```

It must not be stored under `.planning/**`.

Production-style commands require both the explicit installed-plugin data path
and `CLAUDE_CODE_SESSION_ID`. The session ID is hashed into the pending challenge;
a hook event or consume command from another Claude Code session is rejected.

## Commands

Run these from the temporary plugin skill. Installed-plugin paths use
`${CLAUDE_PLUGIN_ROOT}` rather than assuming the target project is the plugin
source checkout. The persistent directory is passed explicitly because arbitrary
Bash calls do not reliably inherit `CLAUDE_PLUGIN_DATA` in the tested host.

Prepare a challenge:

```bash
node "${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/bridge-cli.mjs" prepare \
  --plugin-data-dir "${CLAUDE_PLUGIN_DATA}" \
  --operation get \
  --server <mcp-server> \
  --tool <mcp-tool-or-full-tool-name> \
  --project-root "${CLAUDE_PROJECT_DIR}" \
  --expected-input-file /tmp/bridge-input.json
```

Consume once, in the same Claude Code session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/bridge-cli.mjs" consume \
  --plugin-data-dir "${CLAUDE_PLUGIN_DATA}" \
  --request-id <request-id> \
  --project-root "${CLAUDE_PROJECT_DIR}"
```

Cleanup expired challenges:

```bash
node "${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/bridge-cli.mjs" cleanup-expired \
  --plugin-data-dir "${CLAUDE_PLUGIN_DATA}"
```

`--data-root` is test-only and requires `BRIDGE_SPIKE_ALLOW_DATA_ROOT=1`.
`inspect` returns redacted metadata; it never prints the nonce, response or HMAC.

## Hook Model

The capture handlers are plugin-level hooks in `hooks/hooks.json`, not hooks in
the skill frontmatter. Claude Code 2.1.220 rejected `${CLAUDE_PLUGIN_DATA}` in a
skill-scoped hook command as plugin-only, while plugin hooks support the plugin
persistent data placeholder.

The plugin hooks provide:

- `PostToolUse`: publishes one immutable signed `CAPTURED` envelope;
- `PostToolUseFailure`: records a bounded `BRIDGE_UNAVAILABLE`,
  `BRIDGE_TIMEOUT` or `BRIDGE_CANCELLED` finding without persisting the raw
  provider error.

They match MCP events while the plugin is enabled, but persistence remains scoped
by the pending challenge. Without an exact pending match on session, project,
tool and input, the handlers return unavailable and do not capture the unrelated
MCP result.

The skill does not pre-approve `mcp__*`. The chosen read-only MCP call must pass
through the normal Claude Code permission flow.

Consumption never mutates the signed envelope. It atomically changes the request
record to `CONSUMED`, stores the immutable envelope hash, and rejects replay.
If capture metadata was not published after an envelope write, consume can
reconstruct it from the valid signed envelope.

## Productive Evidence

The real installed-plugin run completed:

```text
BRIDGE_PREPARED
BRIDGE_CAPTURED
BRIDGE_CONSUMED
BRIDGE_REPLAYED
```

Request ID:

```text
019fb5a7-4768-7f9b-8b9f-7e5784c994ea
```

The MCP call read `/home/carlos/projects/shipping-mode/package.json`, returned an
1828-byte real MCP response, and was captured automatically by the plugin-level
`PostToolUse` hook. The second consume returned `BRIDGE_REPLAYED` without
returning the payload again.

Detailed evidence is recorded in:

```text
spikes/host-mcp-bridge/evidence/2026-07-30-manual-evidence.md
spikes/host-mcp-bridge/evidence/2026-07-30-automated-results.md
```

## Trust Model

This is a cooperative host guardrail. The HMAC envelope distinguishes a response
captured by the configured Claude Code hook from ordinary unsigned JSON, and
binds the request, Claude Code session, project, server, tool, input and response.

It is not a sandbox and is not a trust boundary against a malicious local process
that can read the same plugin data directory, modify the plugin, or access the
bridge key.

Key-name filtering and size/depth limits reduce accidental secret persistence,
but a generic bridge cannot prove that arbitrary string values contain no
sensitive business data. A production provider must map host responses to a
closed safe DTO before persisting domain data.

## Scope Boundary

P4-0 proves the transport primitive only. It does not implement Jira adapters,
field mappings, refresh, drift or productive Plan 4 domain behavior.

## Key Rotation

Delete `${CLAUDE_PLUGIN_DATA}/work-source-bridge/bridge.key` only when no pending
requests exist. The next prepare/capture/consume command regenerates a local key
with restrictive permissions where the platform supports POSIX modes. Old
pending envelopes become invalid after rotation.
