---
description: Create and inspect Shipping Mode Releases through the deterministic runtime.
argument-hint: "new --title <title> --objective <objective> | status <id-or-display-id>"
disable-model-invocation: true
---

# Release

Use this skill to route Release lifecycle intent through the Shipping Mode
runtime.

## Public Arguments

- `new --title <title> --objective <objective> [--lane-id <id>] [--policy-mode strict_sequence|dependency_graph] [--slug <slug>] [--idempotency-key <key>] --actor <actor>`
- `status <id-or-display-id>`

## Preconditions

- The workspace must already be initialized with `shipping-mode init`.
- `new` creates a ChangeSet only. It does not approve or apply itself.
- `status` is query-only and must not create Operations, Events or projection
  repairs.

## Runtime Invocation

```text
shipping-mode release new --title <title> --objective <objective> --actor <actor>
shipping-mode release status <id-or-display-id>
```

## Approval Boundary

For `new`, inspect the proposed operation, then run the normal ChangeSet stages:

```text
shipping-mode changeset validate <operation-id>
shipping-mode changeset approve <operation-id> --actor <actor>
shipping-mode changeset apply <operation-id> --actor <actor>
```

Self-approval requires the explicit runtime flag and must follow host policy.
Display-ID ownership is rechecked during validate and apply under the workspace
mutation lock; a later concurrent proposal fails closed instead of publishing a
duplicate display ID.

## Stop Conditions

- Stop if `status` reports `RECOVERY_REQUIRED`, `AMBIGUOUS` or `NOT_FOUND`.
- Stop if validation reports stale base revisions, schema findings or an existing
  owner for the proposed display ID.
- Do not write `.planning` directly.
- Do not parse or edit `README.md` as source of truth.
- Do not create Release Items, Work Packages or Tasks from this skill.

## Error Handling

Report the runtime error, operation ID and current operation status when they
exist. An idempotency key is permanently bound to its first normalized request,
including `INVALID` and `STALE` outcomes. An exact retry returns that original
Operation; never create a replacement Release or alter the request while
reusing the key.
