# Corte 3 Plan 1 — Release Item Core

## 1. Audit

`origin/develop` contains Corte 2 PR #21, #22 and #23. `Release` already has
closed schemas, `REL-*` deterministic display IDs, UUIDv7 directories,
ChangeSets, immutable events, recovery and derived health. The current
`release.schema.json` still contains `itemRefs`, while the architecture says
children reference parents and parent indexes are projections.

## 2. Boundary

Plan 1 implements only the `ReleaseItem` aggregate core: identity, schema,
storage, creation as `release-item.create`, query-only status/checks, dependency
graph validation, projection and Release health integration. Work Packages,
Tasks, gates, Work Source providers, import/sync and `item resolve` are excluded.

## 3. Identity

Canonical identity is UUIDv7 primary plus deterministic immutable `RI-*`
display ID. Historical `ITEM-*` counter examples are rejected because the later
identity contract requires aggregate prefix plus Base32 Crockford short hash
with deterministic collision extension, matching `REL-*`. Slug is decorative
and not resolvable.

## 4. Aggregate Model

`ReleaseItem` is independent state, not an embedded editable object in
`release.yml`. It stores `releaseId`, kind-specific fields, dependencies,
`sourceRefs`, optional future `resolution`, and audit metadata. `releaseId` is
server-owned and immutable.

## 5. Schema

`release-item.yml` uses camelCase to match runtime schemas. The schema is closed
and versioned with eight discriminated kinds:
`user_story`, `capability`, `defect`, `enabler`, `spike`, `compliance`,
`migration`, `operational`. Each kind requires its own fields and rejects fields
from other kinds.

## 6. Lifecycle

Plan 1 creates only `DRAFT`. The schema reserves `DONE`, `CANCELLED` and
`SUPERSEDED` because resolution is a documented target model, but this PR does
not implement transitions or `item resolve`. `SKIPPED` is not a status.

## 7. Guards

Creation requires an existing, schema-valid, integrity-valid parent Release in
`DRAFT` with `finalization.completed=false`. `PLANNED`, `ACTIVE`, `VERIFYING`,
`RELEASED`, `CANCELLED` or finalized Releases reject creation. The ChangeSet
records the observed parent revision; drift before validate/apply becomes
`STALE`.

## 8. Storage

Canonical storage:

```text
.planning/releases/<release-uuidv7>/items/<release-item-uuidv7>/release-item.yml
.planning/releases/<release-uuidv7>/items/<release-item-uuidv7>/README.md
```

Directories use UUIDv7 only. Markdown is deterministic projection from YAML and
is never parsed as source.

## 9. Parent-Child Resolution

Canonical membership is `release-item.yml.releaseId` plus physical location
under the matching Release directory. Items are discovered by scanning
`releases/<release-id>/items/<item-id>/release-item.yml`.

## 10. `release.itemRefs`

`release.itemRefs` remains a compatibility/projection index from Corte 2, not a
second source of truth. Plan 1 does not mutate `release.yml` during item create.
If `itemRefs` contains an ID that has no canonical item under `items/`, checks
fail closed. Missing backfill from items to `itemRefs` is allowed in Plan 1 to
avoid multi-aggregate writes.

## 11. Dependencies

Dependencies persist UUIDv7 only. Display IDs, slugs and paths are rejected.
Plan 1 allows same-Release dependencies only, rejects self-dependency,
duplicates, missing targets and direct/indirect cycles, and validates the whole
catalog deterministically.

## 12. ChangeSet Kind

Only `release-item.create` is added. It fixes operation ID, item ID, display ID,
parent Release, actor, proposedAt, request binding, proposal hash, parent
revision, target paths, base revisions and reserved event identity.

## 13. Events

Successful apply publishes immutable `release-item.created` with aggregate
`{type: "release-item", id: <item-id>}`. Payload includes item ID, display ID,
release ID, operation ID, actor, idempotency key, ChangeSet hash, created
revision, kind, initial status, dependency refs and source ref summary.

## 14. Idempotency

The same idempotency key plus exact normalized intent returns the original
Operation. Reusing the key with different intent fails. Bindings survive
`INVALID` and `STALE` operations through the existing operation store contract.

## 15. Trust Boundaries

Caller intent excludes ID, display ID, resolved releaseId, audit fields,
timestamps, status, resolution, findings, readiness, completion, child indexes,
operation ID and target paths. Recalculating `change-set.json.hash` after
tampering does not rebind those server-owned fields.

## 16. Query Contracts

`item status <release-ref> <item-ref>` resolves Release and Item by UUIDv7 or
display ID only. `check item <release-ref> <item-ref> --format json` reuses the
same evaluator and is query-only. Absence of an item is a single-item
`NOT_FOUND`; catalog-wide checks remain under `check release` and `check schema`.

## 17. Health and Completion

Release Item health covers schema, directory/ID match, parent match, display ID,
revision, projection drift, dependencies, source refs and resolution metadata.
Completion is unavailable until Work Packages exist. Release health now treats
Release Item capability as implemented and still reports Work Packages, Tasks
and gates as `CAPABILITY_UNAVAILABLE`.

## 18. Projection

`renderReleaseItemReadme()` and `compareReleaseItemProjection()` are pure,
deterministic and byte-stable. They embed no live health, Work Source state or
external data.

## 19. Crash Recovery

Creation uses the existing atomic ChangeSet machinery: YAML, README, event,
operation state, result and manifest are one logical publication. Existing crash
boundaries cover before first canonical write, after YAML/README renames, after
manifest, before/after event and recovery retries.

## 20. TDD Tasks

Tests cover conditional schema, `RI-*` identity, slug non-resolution, ambiguity,
ChangeSet creation/apply, tamper rejection, idempotency, parent guards,
dependency missing/cycle, query-only status/checks and Release health discovery.

## 21. Regression Matrix

Regression keeps Corte 0 init/config, Corte 1 guides, Corte 2 release
create/status/policy/refs/deployment/finalization, crash recovery, security,
bundle and generated artifacts green.

## 22. Exclusions

No `work-package.yml`, WorkPackage aggregate, Task, gate execution, Work Source
provider registry, Jira MCP, import, refresh, sync, external writes,
traceability projection, release notes, generic update or auto-repair is
implemented.

## 23. Definition of Done

Plan 1 is complete when Release Item is a separate aggregate, parent is
immutable, schema is closed and conditional, creation is ChangeSet-only, IDs are
server-owned, YAML/README publish atomically, `release-item.created` exists,
queries are read-only, dependencies fail closed, Release health discovers items
canonically, deferred capabilities are honest, docs/skill are updated and the
full verification suite is green.


## 24. Post-review Corrections

Adversarial review closed four trust and contract gaps:

- `release-item.create` idempotency is bound to the canonical parent Release ID as well as normalized item intent, so the same key cannot silently reuse an Operation under another Release.
- `check item` now exposes check semantics (`PASS`/`FAIL`) and a failing process exit code without changing query-only `item status` resolution semantics (`FOUND`).
- `sourceRefs` use closed provider-specific locator/revision unions; unknown nested fields and caller-owned import timestamps are rejected.
- terminal resolution metadata is status-consistent, and `SUPERSEDED` replacement references are validated against the same-Release catalog.
