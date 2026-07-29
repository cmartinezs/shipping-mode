---
description: Create, inspect and record Release policy/reference evidence through the deterministic runtime.
argument-hint: "new --title <title> --objective <objective> | status <id-or-display-id> | policy configure <id> | refs set <id> | deployment record <id>"
disable-model-invocation: true
---

# Release

Use this skill to route Release lifecycle intent through the Shipping Mode
runtime.

## Public Arguments

- `new --title <title> --objective <objective> [--lane-id <id>] [--policy-mode strict_sequence|dependency_graph] [--slug <slug>] [--idempotency-key <key>] --actor <actor>`
- `status <id-or-display-id>`
- `policy configure <id-or-display-id> [--lane-id <id>] [--policy-mode strict_sequence|dependency_graph] [--previous-release-refs <uuid,...>] [--dependency-refs <uuid,...>] [--idempotency-key <key>] --actor <actor>`
- `scope set <id-or-display-id> --scope-ids <uuid,...> [--policy-mode strict|advisory] [--idempotency-key <key>] --actor <actor>`
- `refs set <id-or-display-id> [--execution-context-refs <uuid,...>] [--environment-refs <uuid,...>] [--idempotency-key <key>] --actor <actor>`
- `deployment record <id-or-display-id> --environment-ref <uuid> [--execution-context-ref <uuid>] --status planned|started|succeeded|failed|cancelled [--artifact-refs <ref,...>] [--evidence-refs <ref,...>] [--idempotency-key <key>] --actor <actor>`

## Preconditions

- The workspace must already be initialized with `shipping-mode init`.
- `new`, `policy configure`, `scope set`, `refs set` and `deployment record`
  create ChangeSets only. They do not approve or apply themselves.
- `status` is query-only and must not create Operations, Events or projection
  repairs.
- Related Releases, Scopes, Execution Contexts and Environments must be passed
  as UUIDv7 refs. Slugs are not resolvers.

## Runtime Invocation

```text
shipping-mode release new --title <title> --objective <objective> --actor <actor>
shipping-mode release status <id-or-display-id>
shipping-mode release policy configure <id-or-display-id> --actor <actor>
shipping-mode release scope set <id-or-display-id> --scope-ids <uuid,...> --actor <actor>
shipping-mode release refs set <id-or-display-id> --actor <actor>
shipping-mode release deployment record <id-or-display-id> --environment-ref <uuid> --status <status> --actor <actor>
```

## Approval Boundary

For mutating stages, inspect the proposed operation, then run the normal
ChangeSet stages:

```text
shipping-mode changeset validate <operation-id>
shipping-mode changeset approve <operation-id> --actor <actor>
shipping-mode changeset apply <operation-id> --actor <actor>
```

Self-approval requires the explicit runtime flag and must follow host policy.
Release identity allocation runs under the workspace mutation lock and includes
pending non-terminal `release.create` Operations as reservations. Validate and
apply also recheck persisted display-ID ownership, so concurrent proposals
cannot publish duplicate display IDs.

## Stop Conditions

- Stop if `status` reports `RECOVERY_REQUIRED`, `AMBIGUOUS` or `NOT_FOUND`.
- Stop if validation reports stale base revisions, schema findings, invalid
  lanes, invalid/corrupt catalogs, stale Guide evidence or an existing owner for
  the proposed display ID.
- Do not write `.planning` directly.
- Do not parse or edit `README.md` as source of truth.
- Do not execute deployments; `deployment record` only records evidence and
  never transitions lifecycle.
- Do not create Release Items, Work Packages or Tasks from this skill.

## Error Handling

Report the runtime error, operation ID and current operation status when they
exist. An idempotency key is permanently bound to its first normalized caller
request, including `INVALID` and `STALE` outcomes. Resolved Project Context
defaults may change later without changing that request identity. An exact
retry returns the original Operation; never create a replacement Release or
alter the request while reusing the key.
