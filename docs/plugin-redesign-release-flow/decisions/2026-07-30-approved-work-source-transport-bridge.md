# Approved Work Source Transport Bridge

Status: accepted

Plan 4 reuses the P4-0 bridge result as the only approved host-owned transport
primitive for external Work Sources.

Productive runtime code derived from P4-0 is limited to:

- `runtime/src/lib/hostWorkSourceTransport.mjs`
- `runtime/src/lib/workSourceTransportPort.mjs`

The spike implementation under `spikes/host-mcp-bridge/**` remains the host
capture and consume primitive. Plan 4 does not copy the whole spike into the
domain layer.

The capture hooks remain plugin-level hooks in `hooks/hooks.json`. Claude Code
2.1.220 rejected `CLAUDE_PLUGIN_DATA` in skill-scoped hooks, while plugin-level
`PostToolUse` and `PostToolUseFailure` received the installed plugin data
directory. Moving capture hooks to skill frontmatter would break the approved
host path and would make Jira transport unavailable.

`HostWorkSourceTransport` consumes one bridge envelope and immediately validates
the response as a closed `WorkSourceTransportPort` DTO. It does not trust
caller-supplied MCP payloads, does not persist bridge state in `.planning/**`,
and fails closed without the installed plugin data directory and session-bound
bridge state.
