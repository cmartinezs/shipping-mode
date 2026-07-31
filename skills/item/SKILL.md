---
description: Create, import, refresh and inspect Release Items and their Work Packages through the deterministic runtime.
argument-hint: "create <release-id-or-display-id> --kind <kind> --title <title> | import <release-ref> --source <source-id:item-id-or-path> | refresh <release-ref> <item-ref> | package add <release-ref> <item-ref> --scope-id <uuid> --commitment required|optional --title <title> | status <release-ref> <item-ref>"
allowed-tools: Bash(shipping-mode item:*), Bash(shipping-mode changeset validate:*), Bash(shipping-mode changeset approve:*), Bash(shipping-mode changeset apply:*), Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/work-source-host-runner.mjs:*), mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql
---

# Item

Use this skill for Release Item creation, Work Source import and refresh, Work
Package creation and status queries.

## Public Arguments

- `create <release-id-or-display-id> --kind user_story|capability|defect|enabler|spike|compliance|migration|operational --title <title> [--description <text>] [--dependency-refs <uuid,...>] [--slug <slug>] [--idempotency-key <key>] --actor <audit-actor>`
- `import <release-id-or-display-id> --source <source-id:item-id-or-path> [--idempotency-key <key>] --actor <audit-actor>`
- `refresh <release-id-or-display-id> <item-id-or-display-id> [--idempotency-key <key>] --actor <audit-actor>`
- `package add <release-id-or-display-id> <item-id-or-display-id> --scope-id <uuid> --commitment required|optional --title <title> [--description <text>] [--dependencies <uuid,...>] [--idempotency-key <key>] --actor <audit-actor>`
- `status <release-id-or-display-id> <item-id-or-display-id>`
- `package status <release-id-or-display-id> <item-id-or-display-id> <work-package-id-or-display-id>`

Kind-specific creation arguments:

- `user_story`: `--item-actor <actor> --need <text> --value <text> --acceptance-criteria <text,...>`
- `capability`: `--outcome <text> --behavior <text> --acceptance-criteria <text,...>`
- `defect`: `--observed-behavior <text> --expected-behavior <text> --reproduction <text> --severity low|medium|high|critical`
- `enabler`: `--technical-outcome <text> --unlocked-capabilities <text,...>`
- `spike`: `--question <text> --timebox <text> --expected-decision <text>`
- `compliance`: `--obligation <text> --authority <text> --deadline <text> --evidence <text,...>`
- `migration`: `--source-state <text> --target-state <text> --rollback <text>`
- `operational`: `--procedure <text> --owner <text> --evidence <text,...>`

## Runtime Invocation

```text
shipping-mode item create <release-id-or-display-id> --kind <kind> --title <title> --actor <audit-actor>
shipping-mode item import <release-id-or-display-id> --source <source-id:item-id-or-path> --actor <audit-actor>
shipping-mode item refresh <release-id-or-display-id> <item-id-or-display-id> --actor <audit-actor>
shipping-mode item package add <release-id-or-display-id> <item-id-or-display-id> --scope-id <uuid> --commitment required|optional --title <title> --actor <audit-actor>
shipping-mode item status <release-id-or-display-id> <item-id-or-display-id>
shipping-mode item package status <release-id-or-display-id> <item-id-or-display-id> <work-package-id-or-display-id>
```

For local providers, invoke the standalone runtime normally. Do not route local
imports or refreshes through the host runner.

For external Jira providers, require `SHIPPING_MODE_ATLASSIAN_CLOUD_ID` to
contain the connected Atlassian site's UUID. Site URLs are rejected. Resolve the
UUID during Atlassian connection setup before invoking this skill; Shipping Mode
does not expand its productive allowlist to perform resource discovery. Do not
call `shipping-mode item import` or `shipping-mode item refresh` directly. Use
the installed-plugin host runner:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/work-source-host-runner.mjs" prepare \
  --plugin-data-dir "${CLAUDE_PLUGIN_DATA}" \
  --cwd "${CLAUDE_PROJECT_DIR}" \
  -- item import <release-ref> --source <source-id:issue-key> --actor <audit-actor>
```

or:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/work-source-host-runner.mjs" prepare \
  --plugin-data-dir "${CLAUDE_PLUGIN_DATA}" \
  --cwd "${CLAUDE_PROJECT_DIR}" \
  -- item refresh <release-ref> <item-ref> --actor <audit-actor>
```

Then execute exactly each returned read-only Atlassian MCP action using the
returned `toolName` and `input`, allowing the normal Claude Code authorization
prompt. The only supported Jira host tools are
`mcp__atlassian__getJiraIssue` and
`mcp__atlassian__searchJiraIssuesUsingJql`. Do not substitute similarly named
legacy or mutating tools, and do not run capture helpers manually. After the
plugin-level hook captures each action, resume with the same Shipping Mode
command:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/work-source-host-runner.mjs" resume \
  --plugin-data-dir "${CLAUDE_PLUGIN_DATA}" \
  --cwd "${CLAUDE_PROJECT_DIR}" \
  --invocation-id <invocation-id> \
  -- item refresh <release-ref> <item-ref> --actor <audit-actor>
```

`item create` creates only a `release-item.create` ChangeSet. `item import`
creates only a `work-source.import` ChangeSet from a configured Work Source and
derives source refs server-side. `item refresh` creates only a
`work-source.refresh` ChangeSet after a read-only fetch and managed-field drift
evaluation. `item package add` creates only a `work-package.create` ChangeSet. No
stage approves or applies itself. Use the normal ChangeSet lifecycle after
inspecting the operation:

```text
shipping-mode changeset validate <operation-id>
shipping-mode changeset approve <operation-id> --actor <actor>
shipping-mode changeset apply <operation-id> --actor <actor>
```

## Preconditions

- The workspace is initialized.
- The parent Release resolves by UUIDv7 or `REL-*` display ID.
- The parent Release is `DRAFT` and not finalized.
- Dependencies are UUIDv7 Release Item IDs in the same Release.
- Idempotency is bound to both normalized item intent and the canonical parent Release ID.
- For `item import`, the Work Source must be configured and enabled, the
  provider must declare and implement `get`, mapping version must be supported,
  and the observed source revision must remain unchanged through validate/apply.
- For `item refresh`, the Release Item must have exactly one primary source ref.
  Local providers can execute in the standalone runtime. External Jira refresh
  requires an approved host runtime context; without it the command fails closed.
- For `package add`, the parent Release and Release Item resolve by UUIDv7 or display ID, the Scope is an explicit UUIDv7, both task and test guides must be approved/current, and Work Package dependencies are UUIDv7 Work Package IDs in the same Release.
- Work Package creation stores guide revisions and declarative gate requirements only; it does not execute gates and does not mutate the parent Release Item.
- Internal Work Package payloads must use unique IDs for interfaces, contracts, risks and blockers; invalid nested identities fail before an Operation is reserved.
- Source refs for imports are server-owned. Do not pass normalized provider
  payloads, revisions, imported timestamps or source refs as trusted caller data.
- Slugs are decorative and never resolve.

## Stop Conditions

- Stop on `RECOVERY_REQUIRED`, `NOT_FOUND`, `AMBIGUOUS`, `INVALID` or `STALE`.
- Stop when an external Work Source reports `SOURCE_UNAVAILABLE`; do not inject a
  caller-supplied transport response or bridge envelope as a workaround.
- Stop when host PREPARE, MCP execution, hook capture or RESUME reports mismatch,
  timeout, cancellation, replay or malformed response.
- Do not write `.planning` directly.
- Do not parse Markdown as source.
- Do not create Tasks, external mutations, write-back operations or `item resolve`
  from this skill.