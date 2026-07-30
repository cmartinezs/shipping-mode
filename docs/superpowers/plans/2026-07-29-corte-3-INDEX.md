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
| 1 | Release Item Core | Identity, closed conditional schema, storage, immutable parent, creation, status, dependencies, projection, checks and health | **Complete — PR #24 merged** | `2026-07-29-corte-3-plan-1-release-item-core.md` |
| 2 | Work Package Core | Aggregate WorkPackage, owner scope, guide refs, commitment required/optional, dependencies, declarative gates and Item completion | **Complete — PR #25 merged** | `2026-07-29-corte-3-plan-2-work-package-core.md` |
| 3 | Work Source Foundation | Provider registry, capabilities, `NormalizedWorkSourceItem`, contract tests, LocalRepositoryWorkSource, import and source refs | **Complete — PR #26 merged** | `2026-07-30-corte-3-plan-3-work-source-foundation.md` |
| 4 | External Provider and Corte 3 Closure | Jira MCP, refresh/sync, drift/conflict, Work Source checks, traceability and final DoD audit | **Planned** | `2026-07-30-corte-3-plan-4-external-provider-closure.md` |

## State

```text
Corte 2 — COMPLETE

Corte 3:
  Plan 1 — COMPLETE — PR #24 merged
  Plan 2 — COMPLETE — PR #25 merged
  Plan 3 — COMPLETE — PR #26 merged
  Plan 4 — PLANNED

Corte 3 — IN PROGRESS
```

Plan 3 is merged. Capabilities that depend on Tasks, gate execution, external
writes, write-back or Corte 5 reports must report `CAPABILITY_UNAVAILABLE`
until their plan lands. Corte 3 remains in progress until Plan 4 is
implemented, reviewed and merged.
