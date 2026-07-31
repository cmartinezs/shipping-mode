# Corte 3 P4-0 Host MCP Bridge Spike

## Decision

```text
PASSED
```

A real installed Shipping Mode plugin prepared a session-bound challenge,
executed one explicitly approved read-only MCP tool through Claude Code, captured
the real host result with a plugin-level `PostToolUse` hook, signed and consumed
the envelope once, and rejected a second consume as `BRIDGE_REPLAYED`.

The Plan 4 transport blocker established by P4-0 is removed. Productive Jira,
refresh, drift and mapping work remain separate later tasks and are not part of
this spike.

## Hypothesis

A manual Shipping Mode plugin skill can prepare a canonical request, trigger one
real read-only MCP tool invocation in Claude Code, capture the host hook event,
sign the response envelope under `CLAUDE_PLUGIN_DATA`, and let a later Node
process consume that envelope once.

Result: proven for the tested installed-plugin host path.

## Version And Environment

- Date: 2026-07-30, America/Santiago
- Claude Code observed: `2.1.220`, commit `4073f59596e2`, `linux-x64`
- Branch: `spike/corte-3-p4-0-host-mcp-bridge`
- Base: `4b73fa17397ec9370b83c8355cbdcb849b6c88a1`
- Installed test plugin: `shipping-mode-p4-test@shipping-mode-p4-clean`
- MCP server: `p4fs`
- Tool: `mcp__p4fs__read_text_file`
- Read target: `/home/carlos/projects/shipping-mode/package.json`

## Proven Architecture

```text
installed plugin skill
  -> bridge prepare
      -> session-bound pending challenge in CLAUDE_PLUGIN_DATA
  -> explicitly approved read-only MCP invocation
      -> plugin-level PostToolUse or PostToolUseFailure hook
          -> binds session/tool/input/result to pending challenge
          -> writes immutable signed success envelope or bounded failure state
  -> bridge consume in the same Claude Code session
      -> verifies envelope
      -> atomically marks request consumed
      -> returns bounded DTO
  -> second consume
      -> BRIDGE_REPLAYED
```

## Real Productive Sequence

The final manual run completed:

```text
BRIDGE_PREPARED
BRIDGE_CAPTURED
BRIDGE_CONSUMED
BRIDGE_REPLAYED
```

Canonical request ID:

```text
019fb5a7-4768-7f9b-8b9f-7e5784c994ea
```

Observed behavior:

1. The plugin and temporary skill loaded from an installed local marketplace.
2. `cleanup-expired` completed against the installed-plugin data directory.
3. `prepare` created one session-bound challenge.
4. Claude Code displayed the normal MCP permission flow.
5. The user approved only the read-only `mcp__p4fs__read_text_file` tool.
6. p4fs returned the real `package.json` content.
7. The plugin-level `PostToolUse` hook captured the actual tool input and
   response without manual capture execution.
8. `consume` verified the signed envelope and returned `BRIDGE_CONSUMED` with
   result `BRIDGE_CAPTURED` and an 1828-byte response.
9. A second consume for the same request, data directory and project root
   returned `BRIDGE_REPLAYED` and did not return the payload again.
10. Cleanup completed before and after the productive sequence.

## Host Integration Finding

Claude Code 2.1.220 treats skill-scoped hooks and plugin-level hooks differently:

```text
skill-scoped hook:
  CLAUDE_PLUGIN_ROOT available
  CLAUDE_PLUGIN_DATA rejected as plugin-only

plugin-level hook in hooks/hooks.json:
  CLAUDE_PLUGIN_ROOT available
  CLAUDE_PLUGIN_DATA available
```

The initial attempt to place capture handlers in the skill frontmatter therefore
failed before hook execution. The final implementation moves `PostToolUse` and
`PostToolUseFailure` to `hooks/hooks.json`. The skill contains no capture hooks.

The plugin-level handlers match MCP events while the plugin is enabled, but they
persist evidence only when session, project, exact tool and normalized input
match one pending challenge. Unrelated MCP calls are not captured.

## Adversarial Review Corrections

The spike implementation was corrected during review:

1. **Preparing-session binding.** The request stores
   `expectedSessionIdHash`; capture and consume must use the same Claude Code
   session.
2. **Immutable signed evidence.** Consumption does not mutate the signed
   `CAPTURED` envelope.
3. **Single mutable lifecycle record.** The request is the only canonical mutable
   state during consume.
4. **Explicit permission.** The skill does not pre-approve `mcp__*`; the user
   must approve the selected read-only call.
5. **Installed-plugin path resolution.** Executables use
   `CLAUDE_PLUGIN_ROOT`, the target uses `CLAUDE_PROJECT_DIR`, and Bash
   entrypoints receive the substituted plugin data directory explicitly.
6. **Server/tool binding.** Full tool names must belong to the declared MCP
   server.
7. **Bounded persistence.** Response size, depth, node count, finite numbers and
   credential-like keys are checked before publication.
8. **Redacted inspection.** Nonce, response and HMAC are not exposed by inspect.
9. **Normalized failures.** `PostToolUseFailure` records only bounded failure
   identifiers and an error hash.
10. **Single plugin hook discovery path.** The manifest does not redundantly
    declare the default hooks file.
11. **Plugin-level capture placement.** Capture handlers reside in
    `hooks/hooks.json`; structural tests prohibit skill-scoped capture hooks.
12. **Official verification.** The spike suite is part of
    `verify:next-generation`.

## Guarantees Achieved

Manual productive evidence plus deterministic tests establish:

- a real approved MCP read can be captured through the Claude Code host;
- the request is bound to session, project, server, exact tool and normalized
  input;
- the response envelope is schema-closed, bounded and HMAC-signed;
- the envelope is immutable after capture;
- consume is lock-protected and changes one canonical lifecycle record;
- the envelope can be consumed exactly once;
- a real second consume returns `BRIDGE_REPLAYED`;
- cross-session capture and consume fail closed in deterministic tests;
- HMAC tampering, expiry, mismatch, ambiguity and malformed data fail closed;
- failed tools normalize to unavailable, timeout or cancellation without storing
  raw provider errors;
- bridge state and the local HMAC key live under the installed plugin data
  directory, not `.planning/**`;
- the standalone CLI cannot select an arbitrary data root without the explicit
  test-only gate.

## Remaining Limits

- Atlassian MCP was not required for P4-0 and was not tested.
- The generic bridge cannot prove arbitrary string values are free of sensitive
  business data; productive adapters must map to closed safe DTOs.
- This cooperative mechanism is not a sandbox against a local process with access
  to plugin files, plugin data or the HMAC key.
- POSIX key modes, rename/link and lock behavior must be rechecked on any future
  native Windows host path.
- P4-0 does not implement Jira providers, mappings, refresh, drift or domain
  integration.

## Automatic Results

The official workflow runs:

```text
npm run test:host-mcp-bridge
npm run verify:next-generation
```

The suite covers lifecycle, session binding, hook processes, plugin hook
placement, failure normalization, immutable envelopes, recovery, replay,
redaction, security limits and host integration. The verification after the
final plugin-level hook architecture completed successfully.

## Evidence

Detailed evidence is stored under:

```text
spikes/host-mcp-bridge/evidence/2026-07-30-manual-evidence.md
spikes/host-mcp-bridge/evidence/2026-07-30-automated-results.md
```

## Condition To Continue Plan 4

The P4-0 condition is met:

1. plugin and skill loaded successfully;
2. one explicitly approved read-only MCP tool completed;
3. plugin-level `PostToolUse` received the real session, input and response;
4. the request was prepared in the same session;
5. the immutable envelope verified and was consumed once;
6. real replay was rejected and automated cross-session tests pass;
7. bridge state uses the installed plugin data directory rather than
   `.planning/**`;
8. absence and failure paths normalize fail-closed.

Plan 4 may proceed from this transport result, while preserving the scope and
security constraints documented above.
