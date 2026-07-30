---
description: Temporarily prove the Corte 3 P4-0 host-to-MCP transport bridge with one read-only MCP call.
argument-hint: "--server <mcp-server> --tool <mcp-tool-or-full-tool-name> --input-file <json>"
disable-model-invocation: true
allowed-tools:
  - Bash(node spikes/host-mcp-bridge/bridge-cli.mjs prepare:*)
  - Bash(node spikes/host-mcp-bridge/bridge-cli.mjs consume:*)
  - Bash(node spikes/host-mcp-bridge/bridge-cli.mjs cleanup-expired:*)
  - Bash(claude mcp list:*)
  - mcp__*
hooks:
  PostToolUse:
    - matcher: "mcp__.*"
      hooks:
        - type: command
          command: "node \"${CLAUDE_PLUGIN_ROOT}/spikes/host-mcp-bridge/capture-post-tool-use.mjs\""
          timeout: 10
---

# Spike Host MCP Bridge

Use this temporary skill only for Corte 3 Plan 4 P4-0.

## Required Flow

1. Run `node spikes/host-mcp-bridge/bridge-cli.mjs cleanup-expired`.
2. Prepare exactly one challenge:

   ```text
   node spikes/host-mcp-bridge/bridge-cli.mjs prepare --operation get --server <mcp-server> --tool <mcp-tool-or-full-tool-name> --project-root <project-root> --expected-input-file <json>
   ```

3. Read the prepared output and invoke exactly one read-only MCP tool with the
   returned `toolInput`.
4. Do not write to Jira or any external system.
5. Consume the envelope:

   ```text
   node spikes/host-mcp-bridge/bridge-cli.mjs consume --request-id <request-id> --project-root <project-root>
   ```

6. Report the bounded consumed DTO or the normalized finding.
7. Run `cleanup-expired` again.

## Stop Conditions

- Stop if `${CLAUDE_PLUGIN_DATA}` is unavailable.
- Stop if no read-only MCP tool is available.
- Stop if the hook does not create an envelope.
- Stop on `BRIDGE_AMBIGUOUS`, `BRIDGE_INVALID`, `BRIDGE_EXPIRED`,
  `BRIDGE_REPLAYED` or `BRIDGE_RECOVERY_REQUIRED`.
- Do not store bridge state or secrets under `.planning/**`.
