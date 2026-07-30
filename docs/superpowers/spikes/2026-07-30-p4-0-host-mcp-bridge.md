# Corte 3 P4-0 Host MCP Bridge Spike

## Hypothesis

A manual Shipping Mode plugin skill can prepare a canonical request, trigger one
real read-only MCP tool invocation in Claude Code, capture the host
`PostToolUse` event, sign the response envelope under `CLAUDE_PLUGIN_DATA`, and
let a later Node process consume that envelope once.

## Version And Environment

- Date: 2026-07-30
- Claude Code: `2.1.220`, commit `4073f59596e2`, `linux-x64`
- Branch: `spike/corte-3-p4-0-host-mcp-bridge`
- Base: `4b73fa17397ec9370b83c8355cbdcb849b6c88a1`

## Architecture Tested

```text
manual plugin skill
  -> bridge prepare
      -> pending challenge in CLAUDE_PLUGIN_DATA
  -> real MCP tool invocation
      -> skill-scoped PostToolUse command hook
          -> receives tool_name/tool_input/tool_response
          -> matches pending challenge
          -> writes authenticated response envelope
  -> bridge consume
      -> verifies envelope
      -> marks challenge consumed
      -> returns bounded safe DTO
```

## Sequence

Implemented and tested deterministic sequence:

```text
bridge prepare
  -> pending challenge in ${CLAUDE_PLUGIN_DATA}/work-source-bridge/requests
synthetic PostToolUse harness
  -> capture-post-tool-use.mjs
  -> signed envelope in ${CLAUDE_PLUGIN_DATA}/work-source-bridge/envelopes
bridge consume
  -> HMAC, TTL, request/project/tool/input/session/response binding
  -> request and envelope marked consumed
replay
  -> BRIDGE_REPLAYED
```

Attempted real sequence:

```text
claude --plugin-dir . --mcp-config /tmp/shipping-mode-mcp-config.json --strict-mcp-config
```

The plugin loaded, but the real MCP/tool step did not complete in this run.

## Threat Model

Shipping Mode provides cooperative guardrails and traceability. This bridge does
not claim to sandbox a malicious local user or process with access to the same
filesystem. A process that can read or modify `${CLAUDE_PLUGIN_DATA}` can read
the bridge key or alter bridge state.

## Guarantees Achieved

- Canonical request hash is deterministic.
- Pending challenges are stored under `${CLAUDE_PLUGIN_DATA}/work-source-bridge`,
  not under `.planning/**`.
- Local bridge key is generated outside `.planning/**` and used for HMAC.
- Envelope verification binds request ID, nonce hash, project root hash, server,
  tool, normalized tool input hash, session ID, tool use ID and response hash.
- HMAC tampering, unsigned manual payloads, replay, expired challenges,
  different project, different tool, different input, different session,
  oversized responses and secret-like keys are rejected in deterministic tests.
- Consumption is one-time and lock-protected.

## Guarantees Not Achieved

- A real Claude Code MCP tool invocation was not completed.
- A real `PostToolUse` event containing actual MCP `tool_input` and
  `tool_response` was not captured.
- `/reload-plugins` success could not be captured from the TUI in this run.
- Atlassian MCP was not available.
- The local read-only MCP fixture did not complete Claude Code connection; the
  debug log reported `MCP error -32000: Connection closed`.

## Automatic Results

```text
node --test spikes/host-mcp-bridge/tests/*.test.mjs
PASS

claude plugin validate .
PASS
```

## Manual Results

Sanitized evidence is recorded under:

```text
spikes/host-mcp-bridge/evidence/2026-07-30-manual-evidence.md
spikes/host-mcp-bridge/evidence/2026-07-30-automated-results.md
```

Observed:

- `claude --plugin-dir .` loaded the inline `shipping-mode` plugin.
- The plugin loaded 7 skills, including the temporary spike skill in the
  working tree.
- Existing configured MCP servers did not provide an Atlassian smoke path.
- Network calls to `api.anthropic.com` failed with `ECONNREFUSED`.
- Claude attempted writes under `/home/carlos/.claude/**` and hit `EROFS` in
  this sandboxed execution environment.
- No real MCP tool invocation completed.

## Cross-Platform Limits

The bridge attempts POSIX `0600` permissions for the local HMAC key. Platforms
without POSIX mode support rely on host filesystem controls and the cooperative
trust model.

## Risks

- Skill-scoped hook frontmatter must be verified in the installed Claude Code
  version.
- MCP tool names are host-defined and must remain configurable.
- Hook event shape can drift across Claude Code versions.
- The existing manifest points at `hooks/hooks.json`, while Claude also
  auto-discovers that file. The debug log reports this as a duplicate hook file
  load error. This spike did not change the existing manifest behavior.
- A local stdio MCP fixture without the official SDK may not satisfy every
  Claude Code MCP client expectation.

## Decision

`INCONCLUSIVE`.

The deterministic authenticated envelope design is viable as a cooperative
guardrail, but P4-0 cannot be marked `PASSED` because the required real MCP
tool invocation and real host `PostToolUse` capture did not complete.

## Condition To Continue Plan 4

Plan 4 can continue only if the final result is `PASSED`: a real loaded plugin
skill triggers one real read-only MCP call, `PostToolUse` captures the actual
response, the signed envelope is consumed once, manual payloads and replay are
rejected, and no bridge secrets or state are stored under `.planning/**`.

Current condition: not met. Do not implement Jira productive provider,
`work-source.refresh`, drift, mappings or production transport files from this
branch.
