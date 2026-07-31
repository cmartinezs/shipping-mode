# P4-0 Manual Evidence

Date: 2026-07-30 (America/Santiago)

## Classification

```text
PASSED
```

A real installed Claude Code plugin prepared a session-bound challenge, executed
one explicitly approved read-only MCP tool, captured the real host `PostToolUse`
event through a plugin-level hook, consumed the signed envelope once, and rejected
a second consume as replay.

## Environment

```text
Claude Code: 2.1.220
Doctor commit: 4073f59596e2
Platform: linux-x64
Branch: spike/corte-3-p4-0-host-mcp-bridge
Plugin under test: shipping-mode-p4-test@shipping-mode-p4-clean
MCP server: p4fs
Tool: mcp__p4fs__read_text_file
Target: /home/carlos/projects/shipping-mode/package.json
```

The target was a non-sensitive, in-project file allowed by the read-only
filesystem MCP server.

## Installed Plugin And Hook Model

The plugin was installed through a local marketplace rather than loaded only with
`--plugin-dir`. The capture handlers were registered as plugin-level hooks in
`hooks/hooks.json`:

```text
PostToolUse        matcher: mcp__.*
PostToolUseFailure matcher: mcp__.*
```

This placement was required by the tested host. Claude Code 2.1.220 rejected
`${CLAUDE_PLUGIN_DATA}` in skill-scoped hooks as plugin-only, but accepted it in
plugin-level hooks. The skill frontmatter therefore contains no capture hooks.

## Real Productive Sequence

The installed skill was invoked as:

```text
/shipping-mode-p4-test:spike-host-mcp-bridge \
  --server p4fs \
  --tool mcp__p4fs__read_text_file \
  --input-file /tmp/p4-input.json
```

Observed sequence:

1. `CLAUDE_CODE_SESSION_ID` was available.
2. The installed plugin data directory resolved successfully.
3. `cleanup-expired` completed.
4. `prepare` returned `BRIDGE_PREPARED`.
5. Claude Code presented the normal MCP permission flow.
6. The user approved the read-only `mcp__p4fs__read_text_file` call.
7. The MCP server returned the real contents of `package.json`.
8. The plugin-level `PostToolUse` hook captured the real input and response.
9. `consume` returned `BRIDGE_CONSUMED` with result `BRIDGE_CAPTURED`.
10. Final cleanup completed.

Canonical request:

```text
019fb5a7-4768-7f9b-8b9f-7e5784c994ea
```

Sanitized consumed result:

```text
status: BRIDGE_CONSUMED
result: BRIDGE_CAPTURED
tool: mcp__p4fs__read_text_file
responseBytes: 1828
response: equal to the real MCP response
```

No capture script was invoked manually and no envelope was fabricated.

## Replay Evidence

A second `consume` was executed in the same Claude Code session for the exact
request ID, plugin data directory and project root, without preparing another
challenge.

Observed result:

```text
BRIDGE_REPLAYED
```

The bridge did not return the payload again and did not modify the immutable
signed envelope. This proves one-time consumption on the real captured request.

## Earlier Failed Attempts And Findings

The manual investigation also identified and corrected host-integration defects:

1. `--plugin-dir` did not provide the installed-plugin data semantics required by
   the spike.
2. Arbitrary Bash commands did not reliably inherit `CLAUDE_PLUGIN_DATA`; the
   skill now passes the substituted installed-plugin path explicitly.
3. Skill-scoped hooks could use `${CLAUDE_PLUGIN_ROOT}` but the host rejected
   `${CLAUDE_PLUGIN_DATA}` as plugin-only.
4. Moving capture handlers to plugin-level `hooks/hooks.json` enabled the real
   `PostToolUse` capture.
5. A first p4fs call correctly failed because `/tmp/p4-mcp-readonly/probe.txt`
   was outside the server allowlist. The successful proof used the in-project
   `package.json` path.

These failed attempts did not count as productive evidence; they were used only
to correct the final architecture.

## Security And Persistence

- The selected MCP action was read-only.
- The tool passed through the normal permission UI.
- The request was bound to the preparing Claude Code session.
- Project, server, exact tool and normalized input were bound.
- The captured response was bounded and signed with the local HMAC key.
- The signed envelope remained immutable after consume.
- Bridge state was stored under the installed plugin data directory in
  `work-source-bridge/`, not under `.planning/**`.
- The bridge rejects data roots inside `.planning`.
- No Jira, external mutation or credential-bearing response was involved.

## Boundary Of The Result

P4-0 proves the productive host-to-MCP transport mechanism for an explicitly
approved read-only MCP operation. It does not by itself implement or validate:

- `JiraMcpWorkSource`;
- Jira field mappings;
- refresh or drift behavior;
- productive Plan 4 domain integration;
- a sandbox against a malicious local process with access to plugin data.

Those remain later Plan 4 work built on the now-proven transport primitive.
