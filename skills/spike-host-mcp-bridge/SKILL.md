---
name: spike-host-mcp-bridge
description: Temporarily prove the Corte 3 P4-0 host-to-MCP transport bridge with one explicitly approved read-only MCP call.
argument-hint: "--server <mcp-server> --tool <mcp-tool-or-full-tool-name> --input-file <json>"
disable-model-invocation: true
hooks:
  PostToolUse:
    - matcher: "mcp__.*"
      hooks:
        - type: command
          command: "node \"${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/capture-post-tool-use.mjs\""
          timeout: 10
  PostToolUseFailure:
    - matcher: "mcp__.*"
      hooks:
        - type: command
          command: "node \"${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/capture-post-tool-failure.mjs\""
          timeout: 10
---

# Spike Host MCP Bridge

Use this temporary skill only for Corte 3 Plan 4 P4-0.

The skill deliberately does not pre-approve `mcp__*`. The user must inspect and
approve the selected read-only MCP tool through the normal Claude Code permission
flow. Never select a create, update, delete, transition, comment or other mutating
tool.

Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and
`${CLAUDE_PROJECT_DIR}` directly into installed plugin skill content. It exports
plugin path variables automatically to hook processes, but it does not guarantee
that arbitrary Bash tool calls inherit `CLAUDE_PLUGIN_DATA`. Therefore, do not
check `CLAUDE_PLUGIN_DATA` through `env`; pass the substituted directory explicitly
to the bridge CLI as shown below.

## Required Flow

1. Confirm `CLAUDE_CODE_SESSION_ID` is present in the Bash environment. Treat the
   already-substituted `${CLAUDE_PLUGIN_DATA}` path in these instructions as the
   authoritative persistent data directory. Create it if needed, but do not print
   its full contents or expose `bridge.key`.
2. Run:

   ```text
   node "${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/bridge-cli.mjs" cleanup-expired \
     --plugin-data-dir "${CLAUDE_PLUGIN_DATA}"
   ```

3. Prepare exactly one challenge:

   ```text
   node "${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/bridge-cli.mjs" prepare \
     --plugin-data-dir "${CLAUDE_PLUGIN_DATA}" \
     --operation get \
     --server <mcp-server> \
     --tool <mcp-tool-or-full-tool-name> \
     --project-root "${CLAUDE_PROJECT_DIR}" \
     --expected-input-file <json>
   ```

4. Read the prepared output and invoke exactly one read-only MCP tool with the
   returned `toolInput`. The full tool name must belong to the declared server.
5. Allow the scoped `PostToolUse` or `PostToolUseFailure` hook to record the
   result. Hook processes receive their real plugin-specific `CLAUDE_PLUGIN_DATA`;
   do not manually execute either capture script.
6. Do not write to Jira or any external system.
7. Consume the envelope in the same Claude Code session:

   ```text
   node "${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/bridge-cli.mjs" consume \
     --plugin-data-dir "${CLAUDE_PLUGIN_DATA}" \
     --request-id <request-id> \
     --project-root "${CLAUDE_PROJECT_DIR}"
   ```

8. Report the bounded consumed DTO or normalized bridge finding.
9. Run cleanup again with the same explicit `--plugin-data-dir` argument.

## Stop Conditions

- Stop if `CLAUDE_CODE_SESSION_ID` is unavailable.
- Stop if `${CLAUDE_PLUGIN_DATA}` remains literally unresolved or resolves to a
  blank path instead of an installed-plugin data directory.
- Stop if no read-only MCP tool is available.
- Stop if the normal permission UI identifies the selected MCP tool as mutating
  or broader than the requested read operation.
- Stop if the hook does not create an envelope or normalized failure state.
- Stop on `BRIDGE_AMBIGUOUS`, `BRIDGE_INVALID`, `BRIDGE_EXPIRED`,
  `BRIDGE_REPLAYED` or `BRIDGE_RECOVERY_REQUIRED`.
- Do not use `--data-root`; that override is restricted to deterministic tests.
- Do not store bridge state or secrets under `.planning/**`.
