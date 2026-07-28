# Corte 2 — Release Aggregate

## Boundary

Corte 2 establece `Release` como agregado canonico y unidad publica de
planificacion, seguimiento, activacion, verificacion, liberacion, cancelacion,
deployment tracking y finalizacion.

La relacion global sigue siendo:

```text
Project Context
    -> Release
    -> Release Item        (Corte 3)
    -> Work Package        (Corte 3)
    -> Task                (Corte 4)
```

Corte 2 implementa solo `Release`. No crea `release-item.yml`, Work Packages,
Tasks, Work Source productivo, ejecucion de gates, Git execution ni deployment
execution.

## Current-State Audit

| Requirement | Canonical source | Existing primitive | Current status | Implementation delta | Dependency | Proposed plan |
|---|---|---|---|---|---|---|
| Release schema | `03-plan-incremental.md` Corte 2; `01-arquitectura-objetivo.md` | Schema loader/build pipeline; no `release.schema.json` | MISSING | Add closed schema for `release.yml` with UUIDv7 identity, lifecycle, refs, blockers/risks, deployment event records and finalization metadata | Runtime schema build | Plan 1 core schema; Plan 2/3 extend only within closed fields |
| Identity/display ID | Identity contract in `01`; UUIDv7 spike | `generateUuidV7`, `isUuidV7`; no display ID | PARTIAL | Add Release display ID derivation from UUIDv7, collision extension before persist, resolver by UUID/display ID, slug decorative | Existing IDs lib | Plan 1 |
| Storage | Corte 0 topology; Corte 2 user contract | `.planning/releases/` bootstrapped by init | PARTIAL | Enforce `.planning/releases/<release-uuidv7>/release.yml` and `README.md`; reject display ID/slug paths and symlinks | Existing path/safe FS | Plan 1 |
| YAML canonical, Markdown projection | Architecture principle; Corte 1 guide projection pattern | Guide renderer/comparator and atomic ChangeSet publication | PARTIAL | Add pure `renderReleaseReadme` and projection comparator; publish YAML+README in same ChangeSet | Existing ChangeSet renderer | Plan 1 |
| Lifecycle | Corte 2 state machine | No Release lifecycle implementation | MISSING | Implement closed statuses and legal create transition; define later transition guards fail-closed until dependencies exist | Release schema | Plan 1 create; Plan 2/3 guarded transitions |
| Transition guards | Corte 2 guard tension | Guide readiness primitive exists | PARTIAL | Define matrix now; implement only guards evaluable without Release Items/Work Packages/Gates; return structured capability findings for unavailable guards | Corte 3+ for item/work gates | Plan 1 matrix; Plan 2/3 runtime primitives |
| Sequence/dependency policy | Project Context release policy; Corte 2 | `config.policies.release.mode = strict_sequence`, `defaultLane` | PARTIAL | Keep Plan 1 lane/policy refs simple; add `dependency_graph`, explicit predecessors and cycle checks later | Project Context policy expansion | Plan 2 |
| Scope guide revision index | Corte 1 Guide readiness; Corte 2 | `evaluateGuideReadiness`; scope guide metadata/revisions | PARTIAL | Release schema allows empty `scopeRefs`; strict operations using scope refs validate guides later | Corte 1 primitives | Plan 2 |
| Execution-context refs | Corte 0 topology | `.planning/execution-contexts/` directory exists | PARTIAL | Keep Release refs only; do not embed catalog entries | Catalog/schema work | Plan 2 |
| Environment refs | Corte 0 topology | `.planning/environments/` directory exists | PARTIAL | Keep Release/deployment refs only; validate existing refs when catalogs exist | Catalog/schema work | Plan 2 |
| Deployment events | Corte 2 | Event journal exists, no release-owned deployment records | MISSING | Add schema field and later mutation `release.deployment.record`; do not execute deployments or alter lifecycle automatically | Environment refs | Plan 2 |
| Finalization | Corte 2 | No finalization model | MISSING | Model as metadata, not lifecycle; mutate only when Plan 3 guards/reporting exist | Release schema | Plan 3 |
| Completion/readiness | Corte 2 | Guide readiness primitive only | PARTIAL | Add derived evaluation primitive that reports unavailable dependencies; never persist caller-controlled completion/readiness | Corte 3+ | Plan 3; Plan 1 status reports honest unavailable findings |
| Blockers/risks | Corte 2 | Documentation gaps exist; no release blockers/risks | MISSING | Minimal closed arrays on Release; no `BLOCKED` lifecycle | Release schema | Plan 1 schema; Plan 3 health impact |
| Status/check queries | Corte 2 roadmap | `check schema`, `check guides` query-only | PARTIAL | Add `release status <id-or-display-id>` query-only now; decide `check release` for Plan 3 closure | Resolver/projection comparator | Plan 1 status; Plan 3 check release |
| `check schema` integration | Corte 2 schema invariants | Existing directory/schema/operation/source/scope checks | PARTIAL | Add Release directory UUIDv7, symlink, parse/schema, id/path match, display ID uniqueness, projection drift | Release schema/projection | Plan 1 |
| Events | Runtime contract; Corte 2 | Immutable `.planning/events/YYYY/MM/<event-id>.json`; event schema | PARTIAL | Add `release.created` and aggregate ID equal to Release ID; transition/deployment/finalize events later | Existing journal | Plan 1 create event |
| Public release skill | `02-mapa-comandos-skills.md` | No `skills/release/SKILL.md` | MISSING | Add only after end-to-end release capability exists; keep thin and no direct writes | Plan 1 runtime command | Plan 1 if release new/status is complete |
| Corte 2 DoD | User request; `03-plan-incremental.md` | Verification scripts exist | PARTIAL | Run full verification after Plan 1 implementation; keep Corte 2 open until Plans 2/3 merge | All plans | Plan 3 closure |

## Plan Index

| # | Plan | Boundary | Status | Document |
|---|---|---|---|---|
| 1 | Release core | Identity, closed schema, UUIDv7 storage, lifecycle create/DRAFT, Release ChangeSet kind, YAML+README projection, release new/status, check schema integration, immutable create event | **Implementation complete; pending PR merge** | `2026-07-28-corte-2-plan-1-release-core.md` |
| 2 | Release policy and operational references | Sequence/dependency policy, lane validation, scope guide revision index, execution-context refs, environment refs and deployment-event records | **Pending Plan 1** | _TBD_ |
| 3 | Derived health and Corte 2 closure | Completion/readiness evaluation, finalization mutation, `check release`, projection/report primitives and final E2E/DoD audit | **Pending Plan 2** | _TBD_ |

## Stop Rule For Current PR

This PR executes Plan 1 only. It must not implement Release Items, Work
Packages, Tasks, deployment execution, gate execution, Work Source providers,
release notes, retrospective AI, `release_train` or parallel execution.

```text
Corte 1: COMPLETE

Corte 2:
  Plan 1 — Implementation complete; pending PR merge
  Plan 2 — Pending Plan 1
  Plan 3 — Pending Plan 2

Corte 2: OPEN
```
