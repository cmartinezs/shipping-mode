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

## Initial Plugin Load

Command attempted before adversarial review:

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

The duplicate hook registration was corrected after review by removing the
redundant explicit `hooks` field from `.claude-plugin/plugin.json`; the standard
`hooks/hooks.json` location remains. That correction still requires a new manual
plugin-load run on the final head.

## Plugin Reload And Skill Visibility

The interactive TUI opened, but slash commands did not execute reliably in the
PTY before termination. `/reload-plugins` and `/help` could not be captured as
successful evidence.

Result: not proven.

## MCP Availability

`claude mcp list` reported no Atlassian server. Configured MCP servers were not
usable:

```text
plugin:playwright:playwright -> connection timed out
pdf-to-markdown -> MCP connection closed
```

A local read-only stdio MCP fixture was attempted:

```text
server: shipping-mode-readonly
tool: mcp__shipping-mode-readonly__shipping_mode_readonly_probe
```

Claude started the connection but closed it before a tool call:

```text
MCP server "shipping-mode-readonly": Starting connection
MCP server "shipping-mode-readonly": Connection failed (-32000): MCP error -32000: Connection closed
```

Result: no real MCP tool invocation completed.

## Initial Synthetic Hook Harness

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

The state path was:

```text
/tmp/shipping-mode-plugin-data/work-source-bridge/
```

This was synthetic evidence only.

## Post-Review Corrections Requiring A New Manual Run

The final branch behavior differs materially from the initial manual attempt:

- prepare now requires and hashes `CLAUDE_CODE_SESSION_ID`;
- success and failure hooks require the event session to equal the hook process
  session;
- consume must run in the same session;
- the skill no longer pre-approves all MCP tools;
- commands resolve through `CLAUDE_PLUGIN_ROOT` and target
  `CLAUDE_PROJECT_DIR`;
- `PostToolUseFailure` records bounded failure state;
- the signed success envelope is immutable;
- request consumption is one atomic lifecycle update;
- inspect output is redacted;
- the duplicate hooks manifest declaration was removed.

None of these corrected productive-path claims has yet been demonstrated through
a real MCP tool invocation. Automated tests cover them, but manual status remains
unproven.

## Standalone Fail-Closed

Automated adversarial tests cover:

- missing challenge;
- unsigned or invalid envelope;
- replay;
- expiration;
- cross-session capture and consume;
- project/server/tool/input mismatch;
- ambiguous pending requests;
- lock-held recovery;
- oversized or malformed data;
- credential-like keys;
- failed tool normalization.

## `.planning` State

No bridge state is intentionally written under `.planning/**`. The bridge uses
`${CLAUDE_PLUGIN_DATA}/work-source-bridge/` and rejects bridge roots under a
`.planning` path.

## Classification

Result: `INCONCLUSIVE`.

Reason: the initial plugin loaded and deterministic mechanics ran, but no real MCP
tool invocation or real successful `PostToolUse` capture completed. The corrected
session-bound implementation also has not yet received a new manual smoke.
