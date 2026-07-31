# Approved Work Source Transport Bridge

Status: accepted primitive; productive Jira orchestration pending

Plan 4 reuses the P4-0 bridge result as the only approved host-owned transport
primitive for external Work Sources.

Runtime code derived from P4-0 is limited to:

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

## Review finding for Draft PR #29

P4-0 proved the generic host capture and one-time consume primitive. Draft PR
#29 correctly adds a fail-closed runtime adapter, but it does not yet provide an
installed productive skill or host runner that performs the complete Jira
sequence:

```text
build canonical WorkSourceTransportRequest
  -> choose and invoke the approved read-only Atlassian MCP tool
  -> normalize the real MCP response into the closed transport DTO
  -> capture it under the same requestId
  -> resume dispatch with HostWorkSourceTransport in runtimeContext
```

The current `skills/item/SKILL.md` invokes the standalone binary, which cannot
inject that runtime context. The host adapter tests prove fail-closed behavior,
not a successful real Jira round trip. Therefore this ADR accepts the transport
primitive and adapter shape, but does not authorize declaring Jira productive or
Corte 3 complete until the missing orchestration is implemented and demonstrated
from an installed plugin.
