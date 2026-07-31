---
description: Create, import and inspect Release Items and their Work Packages through the deterministic runtime.
argument-hint: "create <release-id-or-display-id> --kind <kind> --title <title> | import <release-ref> --source <source-id:item-id-or-path> | package add <release-ref> <item-ref> --scope-id <uuid> --commitment required|optional --title <title> | status <release-ref> <item-ref>"
disable-model-invocation: true
---

# Item

Use this skill for Release Item creation, Work Source import, Work Package
creation and status queries.

## Public Arguments

- `create <release-id-or-display-id> --kind user_story|capability|defect|enabler|spike|compliance|migration|operational --title <title> [--description <text>] [--dependency-refs <uuid,...>] [--slug <slug>] [--idempotency-key <key>] --actor <audit-actor>`
- `import <release-id-or-display-id> --source <source-id:item-id-or-path> [--idempotency-key <key>] --actor <audit-actor>`
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

`item create` creates only a `release-item.create` ChangeSet. `item import`
creates only a `work-source.import` ChangeSet from a configured Work Source and
derives source refs server-side. `item refresh` creates only a
`work-source.refresh` ChangeSet after a read-only fetch and managed-field drift
evaluation. `item package add` creates only a
`work-package.create` ChangeSet. No stage approves or applies itself. Use the
normal ChangeSet lifecycle after inspecting the operation:

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
- For `package add`, the parent Release and Release Item resolve by UUIDv7 or display ID, the Scope is an explicit UUIDv7, both task and test guides must be approved/current, and Work Package dependencies are UUIDv7 Work Package IDs in the same Release.
- Work Package creation stores guide revisions and declarative gate requirements only; it does not execute gates and does not mutate the parent Release Item.
- Internal Work Package payloads must use unique IDs for interfaces, contracts, risks and blockers; invalid nested identities fail before an Operation is reserved.
- Source refs for imports are server-owned. Do not pass normalized provider
  payloads, revisions, imported timestamps or source refs as trusted caller data.
- Slugs are decorative and never resolve.

## Stop Conditions

- Stop on `RECOVERY_REQUIRED`, `NOT_FOUND`, `AMBIGUOUS`, `INVALID` or `STALE`.
- Do not write `.planning` directly.
- Do not parse Markdown as source.
- Do not create Tasks, external providers, refresh/sync/write-back operations or
  `item resolve` from this skill.
