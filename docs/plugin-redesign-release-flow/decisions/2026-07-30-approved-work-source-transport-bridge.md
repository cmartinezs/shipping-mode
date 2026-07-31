# Approved Work Source Transport Bridge

Status: accepted primitive; productive Jira host path automated; manual Jira evidence pending

Plan 4 reuses the P4-0 bridge result as the only approved host-owned transport
primitive for external Work Sources.

Runtime code derived from P4-0 is limited to:

- `runtime/src/lib/hostWorkSourceTransport.mjs`
- `runtime/src/lib/workSourceTransportPort.mjs`

Plan 4 host orchestration code that is allowed to know about installed-plugin
host details is limited to:

- `runtime/src/lib/atlassianMcpHostAdapter.mjs`
- `runtime/src/lib/hostWorkSourceInvocation.mjs`
- `scripts/work-source-host-runner.mjs`

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
#29 added a fail-closed runtime adapter, but did not provide an installed
productive skill or host runner that performed the complete Jira sequence:

```text
build canonical WorkSourceTransportRequest
  -> choose and invoke the approved read-only Atlassian MCP tool
  -> normalize the real MCP response into the closed transport DTO
  -> capture it under the same requestId
  -> resume dispatch with HostWorkSourceTransport in runtimeContext
```

PR #29 was merged with this limitation still documented. PR #30 is the
continuation that implements the missing orchestration. Corte 3 remains open
until PR #30 has real installed-plugin evidence and is merged.

## Productive host path update

Automated implementation adds the PREPARE/MCP/RESUME host layer:

```text
Shipping Mode command
  -> collecting runtimeContext records canonical WorkSourceTransportRequest
  -> AtlassianMcpHostAdapter maps to allowlisted read-only MCP action
  -> bridge challenge uses the same requestId
  -> plugin-level hook captures signed envelope
  -> HostWorkSourceInvocation validates and normalizes all responses
  -> invocation enters a durable READY state
  -> bridge envelopes are consumed once
  -> dispatch resumes with an in-memory WorkSourceTransport
```

The runtime core still only sees `WorkSourceTransportRequest`,
`WorkSourceTransportResponse` and `WorkSourceTransportPort`. Atlassian tool
names, Claude Code session binding, plugin data paths, hook placement and bridge
keys remain host-side.

The current Atlassian Rovo MCP read allowlist is:

```text
mcp__atlassian__getJiraIssue
mcp__atlassian__searchJiraIssuesUsingJql
```

Every action includes a host-owned `cloudId`, supplied as the connected
Atlassian site's UUID through `SHIPPING_MODE_ATLASSIAN_CLOUD_ID`. Site URLs are
rejected rather than forwarded as `cloudId`. The adapter applies the same
UUID-only validation to an environment value and to any source-level `cloudId`,
so configuration precedence cannot bypass the contract. The UUID must be
resolved during connection setup, outside the productive Shipping Mode
allowlist. The value is bound into the exact MCP input hash and bridge challenge;
it is not persisted in `.planning/**` and cannot be provided as arbitrary Jira
query syntax.

The host invocation lifecycle is crash-recoverable across bridge consumption:
all envelopes are verified and normalized before the invocation is persisted as
`READY`. A retry can resume from `READY` even when an envelope was already
marked consumed, provided its signed evidence hash is unchanged. Host item
mutations receive an invocation-derived idempotency key so retry after dispatch
cannot create a second Operation.

PREPARE classifies local Work Sources before dispatch. Local imports and
refreshes return `HOST_INVOCATION_NOT_REQUIRED` without creating Operations or
changing `.planning/**`.

Current status:

```text
PRODUCTIVE JIRA HOST PATH: PENDING REAL MANUAL EVIDENCE
CORTE 3: IN PROGRESS
```

The remaining gate is a real installed-plugin Atlassian MCP smoke. Fake
transport, unit tests, manually invoked capture helpers and fabricated envelopes
are not sufficient to mark the Jira path passed.