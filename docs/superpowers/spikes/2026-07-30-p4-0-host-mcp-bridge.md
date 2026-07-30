# Corte 3 P4-0 Host MCP Bridge Spike

## Hypothesis

A manual Shipping Mode plugin skill can prepare a canonical request, trigger one
real read-only MCP tool invocation in Claude Code, capture the host hook event,
sign the response envelope under `CLAUDE_PLUGIN_DATA`, and let a later Node
process consume that envelope once.

## Version And Environment

- Date: 2026-07-30
- Claude Code observed: `2.1.220`, commit `4073f59596e2`, `linux-x64`
- Branch: `spike/corte-3-p4-0-host-mcp-bridge`
- Base: `4b73fa17397ec9370b83c8355cbdcb849b6c88a1`

## Architecture Tested

```text
manual plugin skill
  -> bridge prepare
      -> session-bound pending challenge in CLAUDE_PLUGIN_DATA
  -> explicitly approved read-only MCP invocation
      -> scoped PostToolUse or PostToolUseFailure hook
          -> binds session/tool/input/result to pending challenge
          -> writes immutable signed success envelope or bounded failure state
  -> bridge consume in the same Claude Code session
      -> verifies envelope
      -> atomically marks request consumed
      -> returns bounded DTO
```

## Sequence

Deterministic sequence implemented and tested:

```text
bridge prepare
  -> request bound to CLAUDE_CODE_SESSION_ID
synthetic PostToolUse harness
  -> immutable signed CAPTURED envelope
bridge consume
  -> HMAC, TTL, session, project, server, tool, input and response binding
  -> request atomically marked CONSUMED
  -> signed envelope not modified
replay
  -> BRIDGE_REPLAYED
```

Failure sequence implemented and tested:

```text
synthetic PostToolUseFailure
  -> BRIDGE_UNAVAILABLE | BRIDGE_TIMEOUT | BRIDGE_CANCELLED
  -> only bounded hashes and identifiers persisted
  -> raw provider error not persisted
```

Attempted real sequence:

```text
claude --plugin-dir . --mcp-config /tmp/shipping-mode-mcp-config.json --strict-mcp-config
```

The plugin loaded, but a real MCP tool invocation and real success hook capture
did not complete in this run.

## Threat Model

Shipping Mode provides cooperative guardrails and traceability. This bridge does
not sandbox a malicious local user or process with access to the same filesystem.
A process that can read or modify `${CLAUDE_PLUGIN_DATA}`, the plugin files or the
bridge key can alter the cooperative mechanism.

The bridge is intended to distinguish normal host-captured evidence from ordinary
unsigned CLI input, prevent accidental cross-session matching and replay, and
make incomplete state fail closed.

## Adversarial Review Corrections

The initial spike implementation contained material defects that were corrected
on the same branch:

1. **The pending challenge was not bound to its preparing Claude Code session.**
   It now stores `expectedSessionIdHash` derived from
   `CLAUDE_CODE_SESSION_ID`. Capture and consume must occur in that same session.

2. **Consumption modified the signed envelope without recomputing its HMAC.**
   The envelope is now immutable with permanent status `CAPTURED`. Consumption
   changes only the canonical request record and stores `consumedEnvelopeHash`.

3. **Consumption previously updated request and envelope as two canonical state
   files.** The request is now the only mutable lifecycle record, so one atomic
   write transitions it to `CONSUMED`. A valid envelope can reconstruct missing
   capture metadata after a crash between envelope publication and request update.

4. **The skill pre-approved every `mcp__*` tool.** This could remove the normal
   permission prompt from mutating MCP tools. The wildcard pre-approval was
   removed; the selected read-only call must be explicitly approved.

5. **Skill commands assumed the target project was the plugin source checkout.**
   Commands now resolve executable files through `CLAUDE_PLUGIN_ROOT` and bind
   the target through `CLAUDE_PROJECT_DIR`.

6. **A full MCP tool name could disagree with its declared server.** Full names
   must now have the exact `mcp__<server>__` prefix.

7. **The secret-key matcher rejected legitimate fields such as `author`.** It was
   replaced with exact credential-oriented names plus size, depth, node-count and
   finite-number limits. This remains a heuristic, not proof that arbitrary text
   is non-sensitive.

8. **`inspect` exposed nonce and response material.** It now returns redacted
   metadata. `--data-root` is restricted to deterministic tests.

9. **Failed MCP calls had no durable normalized path.** A scoped
   `PostToolUseFailure` hook now records unavailable, timeout or cancellation
   without retaining the raw error.

10. **The plugin manifest explicitly registered the default hooks file while the
    tested Claude Code version also auto-discovered it.** The redundant manifest
    entry was removed and host integration now asserts one default discovery path.

11. **The official verification did not run the spike suite.**
    `test:host-mcp-bridge` is now part of `verify:next-generation`.

## Guarantees Achieved By Deterministic Tests

- Canonical request hashing is deterministic.
- Pending challenges live under `${CLAUDE_PLUGIN_DATA}/work-source-bridge`, not
  under `.planning/**`.
- The HMAC key lives outside `.planning/**` with restrictive permissions where
  supported.
- The request is bound to the preparing Claude Code session before capture.
- Server, exact MCP tool, normalized input and project are bound.
- The envelope is schema-closed, size-bounded, depth-bounded and signed.
- The signed envelope remains immutable during one-time consumption.
- Request consumption is lock-protected and one atomic canonical state update.
- Missing capture metadata can be recovered from a valid signed envelope.
- Cross-session capture/consume, HMAC tampering, replay, expiry, project/tool/input
  mismatch, oversized structures, credential-like keys and malformed data fail
  closed.
- Successful and failed tool hooks use separate bounded paths.
- The standalone CLI cannot inject an arbitrary data root without the explicit
  test-only environment guard.

## Guarantees Not Achieved

- No real Claude Code MCP tool invocation completed.
- No real `PostToolUse` event with actual MCP `tool_input` and `tool_response` was
  captured.
- The corrected session-bound hook path has not yet been demonstrated manually
  inside an installed/plugin-loaded Claude Code session.
- `/reload-plugins` success was not captured from the TUI.
- Atlassian MCP was not available.
- A generic bridge cannot prove arbitrary text values contain no sensitive
  business data; production must map to a provider-specific closed safe DTO.
- This mechanism is not a sandbox against a process with local access to plugin
  data and the HMAC key.

## Automatic Results

The official workflow now runs:

```text
npm run test:host-mcp-bridge
npm run verify:next-generation
```

The suite covers original mechanics plus the post-review session, permission,
failure, immutable-envelope, recovery and redaction cases.

## Manual Results

Sanitized evidence remains under:

```text
spikes/host-mcp-bridge/evidence/2026-07-30-manual-evidence.md
spikes/host-mcp-bridge/evidence/2026-07-30-automated-results.md
```

Observed before the adversarial correction:

- `claude --plugin-dir .` loaded the inline Shipping Mode plugin.
- The temporary spike skill was discovered.
- No Atlassian MCP server was available.
- Existing MCP servers were unavailable.
- The local read-only stdio fixture failed its connection before a tool call.
- Network and filesystem restrictions prevented the real smoke.

Those observations do not demonstrate the corrected productive bridge.

## Cross-Platform Limits

The bridge attempts POSIX `0600` permissions for the local HMAC key. Platforms
without POSIX modes rely on host filesystem controls and the cooperative trust
model. Atomic rename/link and lock-file behavior must be rechecked on the Windows
host path used by a future manual smoke.

## Decision

`INCONCLUSIVE`.

The authenticated envelope mechanics are stronger after adversarial review, but
P4-0 cannot be marked `PASSED` without a real loaded-plugin MCP call and real host
hook capture on the corrected implementation.

## Condition To Continue Plan 4

Plan 4 can continue only after a new manual run demonstrates all of the following
on the final corrected head:

1. plugin and temporary skill load successfully;
2. one explicitly approved read-only MCP tool completes;
3. `PostToolUse` receives the real session, input and response;
4. the request was prepared in the same session;
5. the immutable envelope verifies and is consumed once;
6. replay and cross-session attempts fail;
7. no bridge secret or state is written under `.planning/**`;
8. absence/failure paths normalize correctly.

Current condition: not met. Do not implement productive Jira, refresh, drift,
mapping or production transport files from this result.
