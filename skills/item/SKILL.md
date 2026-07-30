---
description: Create and inspect Release Items through the deterministic runtime.
argument-hint: "create <release-id-or-display-id> --kind <kind> --title <title> | status <release-id-or-display-id> <item-id-or-display-id>"
disable-model-invocation: true
---

# Item

Use this skill for Release Item creation and status queries.

## Public Arguments

- `create <release-id-or-display-id> --kind user_story|capability|defect|enabler|spike|compliance|migration|operational --title <title> [--description <text>] [--dependency-refs <uuid,...>] [--slug <slug>] [--idempotency-key <key>] --actor <audit-actor>`
- `status <release-id-or-display-id> <item-id-or-display-id>`

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
shipping-mode item status <release-id-or-display-id> <item-id-or-display-id>
```

`item create` creates only a `release-item.create` ChangeSet. It never approves
or applies itself. Use the normal ChangeSet lifecycle after inspecting the
operation:

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
- Slugs are decorative and never resolve.

## Stop Conditions

- Stop on `RECOVERY_REQUIRED`, `NOT_FOUND`, `AMBIGUOUS`, `INVALID` or `STALE`.
- Do not write `.planning` directly.
- Do not parse Markdown as source.
- Do not create Work Packages, Tasks, providers, imports, sync operations or
  `item resolve` from this skill.
