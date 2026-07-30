# Corte 3 Plan 2 — Work Package Core

## 1. Audit del runtime actual

`develop` includes PR #24 (`012b47f990507bf7452ce302545e8b53c79da336`) with
Release Item as the current child aggregate. Release Items are UUIDv7
directories under `.planning/releases/<release-id>/items/<item-id>/`, use
deterministic `RI-*` display IDs, are created only through `release-item.create`,
publish YAML plus README atomically and are checked by query-only status/check
commands. Before this plan, Release Item completion was unavailable because
Work Packages did not exist.

## 2. Boundary exacto del Plan 2

This plan implements only the canonical `WorkPackage` aggregate, creation by
`work-package.create`, package status/check queries, derived Release Item
completion and Release health discovery. It does not implement Tasks, task
storage, gate execution, Work Sources, import/sync, generic update, item
resolve, traceability, release notes or automatic repair.

## 3. Decisiones de identidad

Primary identity is UUIDv7. Human identity is immutable deterministic
`WP-<Base32 Crockford short hash>`, derived from the UUIDv7 with deterministic
collision extension at 8, 12, 16, 26 and 52 characters. Resolution accepts only
UUIDv7 or `WP-*` display IDs and returns `FOUND`, `NOT_FOUND`, `AMBIGUOUS` or
`INVALID`; slugs, paths and scope names do not resolve.

## 4. Modelo del agregado `WorkPackage`

`work-package.yml` is schema version 1 and closed. It stores `id`, `displayId`,
`displayIdStatus`, immutable `releaseId`, immutable `releaseItemId`, one
`scopeId`, title/description, `status`, `commitment`, design notes, interfaces,
contracts, UUIDv7 dependencies, captured `guideRefs`, declarative
`gateRequirements`, risks, blockers, optional terminal `resolution` and audit
metadata with canonical `sha256:` revision.

## 5. Storage canónico

Canonical storage is:

```text
.planning/releases/<release-uuidv7>/items/<release-item-uuidv7>/work-packages/<work-package-uuidv7>/work-package.yml
.planning/releases/<release-uuidv7>/items/<release-item-uuidv7>/work-packages/<work-package-uuidv7>/README.md
```

No `workPackageRefs` list is written to `release-item.yml`.

## 6. Relación padre-hijo

Membership is determined by physical location plus `releaseId`,
`releaseItemId`, parent Release integrity, parent Release Item integrity and
Scope integrity. `work-package.create` resolves Release and Release Item before
idempotency lookup, records parent revisions and revalidates them at validate
and apply.

## 7. Ownership por Scope

Each Work Package has exactly one owner `scopeId`. The caller supplies only an
explicit UUIDv7 Scope reference. The runtime evaluates the confirmed Scope and
its task/test guides; labels, paths and hardcoded names are not accepted.

## 8. Captura de Guide Revisions

Work Package creation captures the existing guide evidence shape:
`scopeId`, guide `kind`, guide `id`, `revision`, `contentHash`, `state`,
`usable` and `capturedAt`. It also stores the propose-time `guideEvidence` and
`observedRevisions` in the ChangeSet so guide drift becomes `STALE`.

## 9. Commitment requerido u opcional

`commitment` is `required` or `optional`. Required packages participate in
Release Item completion. Optional packages are visible in counts/findings but
do not block completion. Optional-only catalogs and empty catalogs are
incomplete, not successful by vacuous truth.

## 10. Dependencias

Dependencies persist UUIDv7 Work Package IDs only. The evaluator scans the
whole Release package catalog and rejects missing targets, cross-Release
targets, self-dependency, duplicate/unsorted dependency lists, direct cycles
and indirect cycles with deterministic findings.

## 11. Gates declarativos

Gate requirements are derived from approved task guide `requiredGateRefs`.
They are closed objects with gate id, required flag, applicability and guide
provenance. No gate result is accepted from callers, no shell/build/test/smoke
command is executed, and required gates with no execution capability make
package health unavailable rather than PASS.

## 12. Lifecycle disponible y lifecycle diferido

Creation stores `DRAFT`. The schema reserves `DONE`, `CANCELLED` and
`SUPERSEDED` with matching structured `resolution`, but this plan adds no
transition engine, no generic update and no `item resolve`. Completion tests
use controlled canonical fixtures.

## 13. Completion derivada de Release Item

Release Item completion now scans `items/<item-id>/work-packages/`. The result
contains `status`, `complete`, `evaluable`, package counts, required/optional
completed counts, blocking package IDs, invalid package IDs and unavailable
capabilities. Empty package catalogs and required-empty catalogs are
incomplete. Required invalid packages make completion invalid. Required gates
without execution capability make completion unavailable.

## 14. Readiness y capability availability

Work Package health reports dimensions for structure, parent, projection,
scope/guide refs, dependencies, gates, blockers and future Tasks. Tasks remain
future `CAPABILITY_UNAVAILABLE`. Gate execution remains unavailable when a
required gate exists.

## 15. ChangeSet kinds

Only `work-package.create` is added. The generic route supports
`shipping-mode changeset propose --kind work-package.create --payload-file ...`
with `releaseRef` and `itemRef` in payload. The public route is
`shipping-mode item package add <release-ref> <item-ref> --scope-id <uuid>
--commitment required|optional --title <title> ...`.

## 16. Eventos

Apply publishes immutable `work-package.created` with aggregate
`{type: "work-package", id: <work-package-id>}`. Payload includes package ID,
display ID, release ID, item ID, scope ID, commitment, initial status,
dependency refs, guide revision summary, gate requirement summary, actor,
operation ID, idempotency key, ChangeSet hash and created revision.

## 17. Idempotencia

Request identity includes actor, canonical Release ID, canonical Release Item
ID, canonical Scope ID and normalized caller intent. Same key with same parent,
scope and intent returns the original Operation. Reuse with different parent,
scope, commitment or payload fails.

## 18. Trust boundaries

The caller cannot control package ID, display ID, parent IDs, resolved scope,
guide refs, guide revisions, gate requirements, status, resolution, audit,
operation ID, event ID, target paths, base revisions, proposal hash or binding
hashes. `checkKindInvariants` rejects tampering even when
`change-set.json.hash` is recomputed.

## 19. Optimistic locking y staleness

The ChangeSet records target file base revisions and server-owned Release,
Release Item, Scope and guide revisions. Validation/apply re-render the package
and re-evaluate guide evidence. Drift becomes `STALE`; the runtime does not
silently produce a new proposal.

## 20. Query contracts

`item package status <release-ref> <item-ref> <work-package-ref>` returns
resolution plus live health and can return `FOUND` while health fails.
`check work-package <release-ref> <item-ref> <work-package-ref> --format json`
returns `PASS` or `FAIL`. `item status`, `check item`, `release status`,
`check release` and `check schema` incorporate Work Packages without mutating
`.planning`.

## 21. Proyecciones

`renderWorkPackageReadme()` and `compareWorkPackageProjection()` are pure and
byte-stable. README is derived only from `work-package.yml` and contains no
live health, Work Source data or gate execution output.

## 22. Crash recovery

`work-package.create` uses the existing ChangeSet staging/recovery flow. Tests
cover retry after manifest, recovery after YAML/README renames, after result,
after event, no duplicate package, no duplicate event and no parent item
mutation.

## 23. Plan TDD

Tests were added for schema closure, identity/resolution, create/apply,
status/check query-only behavior, idempotency, trust-boundary tampering,
dependency validation, non-vacuous completion, declarative gate unavailability
and crash recovery.

## 24. Matriz adversarial

Implemented tamper coverage rejects server-owned display ID, Scope ID, target
paths, request binding and proposal hash through kind invariants and existing
operation binding checks. Schema tests reject unknown top-level and nested
properties, fake gate PASS fields, invalid UUIDs, invalid guide refs and
invalid blocker/risk shapes.

## 25. Matriz de regresión

The full unit suite covers Corte 0 init/config, discovery, autonomy, Scope,
guides, Release, Release policy, Release Item, ChangeSets, recovery, locks,
security primitives, host integration fixtures, bundle determinism and
generated schemas.

## 26. Definition of Done

Plan 2 is done when `WorkPackage` is a separate closed aggregate with UUIDv7
and `WP-*`, immutable parent IDs, one Scope owner, captured guide revisions,
required/optional commitment, fail-closed dependencies, declarative gates,
ChangeSet-only creation, atomic YAML/README/event publication, query-only
status/checks, derived Item completion, Release health discovery, recovery and
trust-boundary tests, updated skills/CLI and deterministic generated artifacts.

## 27. Exclusiones explícitas

No Task aggregate, `task.yml`, task lifecycle, AI atomization, gate execution,
shell execution, Work Source provider registry, normalized work source item,
LocalRepositoryWorkSource, Jira MCP, import, refresh, sync, external writes,
`item resolve`, generic update, global traceability, release notes,
auto-repair or parent-owned canonical child list is implemented.

## 28. Riesgos residuales

Terminal Work Package states are schema-valid but still require a future
intent-specific lifecycle operation. Gate requirements are captured from
currently available guide evidence only; richer gate catalogs remain deferred.
Release completion remains honest but not fully complete while Tasks, gate
execution and Work Sources are unavailable.
