# P4-0 Manual Evidence

Date: 2026-07-30

## Claude Code Version

```text
2.1.220 (Claude Code)
doctor commit: 4073f59596e2
platform: linux-x64
```

## Develop Base

```text
HEAD: 4b73fa17397ec9370b83c8355cbdcb849b6c88a1
branch: spike/corte-3-p4-0-host-mcp-bridge
```

## Plugin Load

Command attempted:

```text
claude --plugin-dir . --mcp-config /tmp/shipping-mode-mcp-config.json --strict-mcp-config --debug hooks,mcp --debug-file /tmp/shipping-mode-bridge-claude-debug-2.log
```

Sanitized debug evidence:

```text
Loaded inline plugin from path: shipping-mode
Loaded 7 skills from plugin shipping-mode default directory
Registered 3 hooks from 4 plugins
```

Observed setup issues:

```text
Hook load failed: Duplicate hooks file detected for ./hooks/hooks.json
SessionStart hook error: EROFS creating /home/carlos/.claude/session-env/<session>
Remote Control session creation failed: ECONNREFUSED api.anthropic.com
```

## Plugin Reload And Skill Visibility

The interactive TUI opened, but slash commands did not execute reliably in the
PTY before the session had to be terminated. `/reload-plugins` and `/help` could
not be captured as successful manual evidence in this run.

Result: not proven.

## MCP Availability

`claude mcp list` reported no Atlassian server. Configured MCP servers were not
usable:

```text
plugin:playwright:playwright -> connection timed out
pdf-to-markdown -> MCP connection closed
```

A local read-only stdio MCP fixture was attempted for the spike:

```text
server: shipping-mode-readonly
tool: mcp__shipping-mode-readonly__shipping_mode_readonly_probe
```

Claude started the connection but closed it before a tool call:

```text
MCP server "shipping-mode-readonly": Starting connection
MCP server "shipping-mode-readonly": Connection failed (-32000): MCP error -32000: Connection closed
```

Result: no real MCP tool invocation was completed.

## Bridge CLI And Synthetic Hook Harness

The deterministic local harness executed:

```text
prepare -> synthetic PostToolUse stdin -> signed envelope -> consume -> replay rejection
```

Sanitized outcomes:

```text
BRIDGE_PREPARED
BRIDGE_CAPTURED
BRIDGE_CONSUMED
BRIDGE_REPLAYED
```

The bridge state path used for the local harness was:

```text
/tmp/shipping-mode-plugin-data/work-source-bridge/
```

## Standalone Fail-Closed

The second consume of the same request returned:

```text
BRIDGE_REPLAYED
```

Automated adversarial tests additionally covered unsigned envelopes, incorrect
signatures, missing challenges, expired envelopes, session/project/tool/input
mismatches, ambiguous pending requests and lock-held recovery.

## `.planning` State

No bridge state was intentionally written under `.planning/**`. The bridge core
rejects bridge roots whose resolved path contains `.planning`.

## Classification

Result: `INCONCLUSIVE`.

Reason: the plugin loaded, the deterministic bridge contract passed, and the CLI
remained fail-closed, but this run did not complete a real Claude Code MCP tool
invocation nor a real `PostToolUse` capture from that invocation.
