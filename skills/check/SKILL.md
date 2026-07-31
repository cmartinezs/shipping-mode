---
description: Check Shipping Mode schema, guides, Work Sources, Release, Release Item and Work Package health query-only.
argument-hint: "schema | guides [--scope-id <uuid>] | work-sources --format json | source-drift [release-ref] --format json | release [id-or-display-id] [--format json] | item <release-ref> <item-ref> --format json | work-package <release-ref> <item-ref> <package-ref> --format json"
allowed-tools: Bash(shipping-mode check schema:*), Bash(shipping-mode check guides:*), Bash(shipping-mode check work-sources:*), Bash(shipping-mode check source-drift:*), Bash(shipping-mode check release:*), Bash(shipping-mode check item:*), Bash(shipping-mode check work-package:*), Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/work-source-host-runner.mjs:*), mcp__atlassian__jira_get_issue, mcp__atlassian__jira_search
---

Run query-only checks:

```text
shipping-mode check schema
shipping-mode check guides [--scope-id <uuid>] [--mode strict|advisory]
shipping-mode check work-sources --format json
shipping-mode check source-drift [release-id-or-display-id] --format json
shipping-mode check release [id-or-display-id] [--format json]
shipping-mode check item <release-id-or-display-id> <item-id-or-display-id> --format json
shipping-mode check work-package <release-id-or-display-id> <item-id-or-display-id> <work-package-id-or-display-id> --format json
```

For local providers, run the standalone checks above.

For `check source-drift` when Jira Work Sources are enabled, use the installed
host runner so the query can receive a bounded runtime transport:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/work-source-host-runner.mjs" prepare \
  --plugin-data-dir "${CLAUDE_PLUGIN_DATA}" \
  --cwd "${CLAUDE_PROJECT_DIR}" \
  -- check source-drift [release-id-or-display-id] --format json
```

Execute only the returned read-only Atlassian MCP actions with their exact
`toolName` and `input`. After plugin-level capture, resume:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/work-source-host-runner.mjs" resume \
  --plugin-data-dir "${CLAUDE_PLUGIN_DATA}" \
  --cwd "${CLAUDE_PROJECT_DIR}" \
  --invocation-id <invocation-id> \
  -- check source-drift [release-id-or-display-id] --format json
```

`check work-sources` validates configured Work Sources, provider resolution,
declared capabilities, local roots and contract activation status. It reports
stable findings such as `SOURCE_UNAVAILABLE`, `SOURCE_MISCONFIGURED`,
`SOURCE_CAPABILITY_MISSING` and `SOURCE_NOT_FOUND`. It does not refresh,
sync, repair, create Operations or write events.

`check release` uses the same derived health evaluator as `release status`.
With a Release reference it checks one Release; without a reference it checks
the Release catalog. It reports schema/revision/identity/projection, lane and
policy consistency, scope evidence, operational refs, deployment evidence,
Release Item and Work Package catalog health, blockers, risks, finalization
metadata and remaining unavailable Task/gate execution/Work Source capabilities.

`check item` uses the same evaluator as `item status`, but returns `PASS` or
`FAIL` for the evaluated health while `item status` continues to return `FOUND`. It checks one Release
Item only; catalog-wide Release Item discovery is part of `check release` and
`check schema`.

`check work-package` uses the same evaluator as `item package status`, but
returns `PASS` or `FAIL`. Gate requirements are declarative in Plan 2; required
gates without execution capability do not become PASS.

Checks never mutate state, never create Operations, ChangeSets or Events, never
repair README projections and never trigger recovery. Stop on
`RECOVERY_REQUIRED`, `NOT_FOUND`, `AMBIGUOUS`, `FAIL` or `NOT_INITIALIZED`.
Stop on host timeout, cancellation, mismatch, replay or malformed Atlassian
responses. Do not run capture helpers manually and do not pass raw MCP responses
through files, stdin or `.planning`.
