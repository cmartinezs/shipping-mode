# Corte 3 — Release Items, Work Packages and Work Sources

## Audit

Corte 2 is complete on `develop`: PR #21, PR #22 and PR #23 are merged. The
runtime has a closed `Release` aggregate, UUIDv7 storage under
`.planning/releases/<release-id>/`, deterministic `REL-*` display IDs,
ChangeSets, idempotency binding, atomic YAML/README publication, events,
query-only `release status`, `check release` and derived health.

Corte 3 must not turn `Release` into a monolithic tree. The parent-child
contract from the architecture still applies: children reference parents,
parents do not own canonical child lists, and indexes are projections.

## Plan Index

| # | Plan | Boundary | Status | Document |
|---|---|---|---|---|
| 1 | Release Item Core | Identity, closed conditional schema, storage, immutable parent, creation, status, dependencies, projection, checks and health | **Implemented / pending PR merge** | `2026-07-29-corte-3-plan-1-release-item-core.md` |
| 2 | Work Package Core | Aggregate WorkPackage, owner scope, guide refs, commitment required/optional, dependencies, declarative gates and Item completion | **Pending** | _To be created_ |
| 3 | Work Source Foundation | Provider registry, capabilities, `NormalizedWorkSourceItem`, contract tests, LocalRepositoryWorkSource, import and source refs | **Pending** | _To be created_ |
| 4 | External Provider and Corte 3 Closure | Jira MCP, refresh/sync, drift/conflict, Work Source checks, traceability and final DoD audit | **Pending** | _To be created_ |

## State

```text
Corte 2 — COMPLETE

Corte 3:
  Plan 1 — IMPLEMENTED / PENDING PR MERGE
  Plan 2 — PENDING
  Plan 3 — PENDING
  Plan 4 — PENDING

Corte 3 — IN PROGRESS
```

No plan after Plan 1 is approved by this index. Capabilities that depend on
Work Packages, Tasks, gate execution, Work Source providers, import, sync or
external writes must report `CAPABILITY_UNAVAILABLE` until their plan lands.
