# Corte 1 — Scope Catalog y Guías Aprobables

## Boundary

Corte 1 convierte Documentation Sources ya descubiertas y referenciadas por
Project Context en guías operativas versionadas por Scope. `scope.yml` sigue
siendo el único catálogo de scopes. Los YAML de guía son estado canónico; los
Markdown son proyecciones regenerables y no participan en reglas runtime.

No se implementan Release, Release Items, Work Packages, Tasks, Work Sources
providers, Git execution, deployment ni lifecycle de environments.

## Requirement Audit

| Requirement | Canonical source | Implementation evidence | Final status | Boundary / deferral |
|---|---|---|---|---|
| Scope catalog with UUIDv7 identity and per-scope storage | `01-arquitectura-objetivo.md`; Corte 0/Discovery | `scope.schema.json`, `.planning/scopes/<uuid>/scope.yml`, ChangeSet `scope.add` | **DONE** | Reused without a second Scope catalog |
| Canonical `task-guide.yml` and `test-guide.yml` paths | `03-plan-incremental.md`; `04-release-init-configuracion.md`; `05-scope-task-guides.md` | Guide schema, metadata and ChangeSet file plans | **DONE** | Canonical paths are server-owned per Scope |
| YAML is canonical and Markdown is projection only | `01-arquitectura-objetivo.md`; `05-scope-task-guides.md` | `guideProjection.mjs`, YAML+Markdown atomic publication and projection drift checks | **DONE** | Markdown never participates in runtime evaluation |
| Stable Guide identity and Scope/Source references | Identity contract; `05-scope-task-guides.md` | Server-owned Guide UUIDv7, Scope UUIDv7 and Documentation Source ID refs | **DONE** | Paths and slugs are not primary identity |
| Guide lifecycle `generated/reviewed/approved/stale/rejected` | `05-scope-task-guides.md` | Closed `guide.update` transitions and approval binding | **DONE** | Mutations use the existing ChangeSet lifecycle |
| Guide provenance and approved revision binding | `03-plan-incremental.md`; `05-scope-task-guides.md` | Source/generator/input/output evidence, revision/content hash and approval metadata | **DONE** | Health revalidates the binding independently of persisted status |
| Consume and resolve Corte 0 `guides/missing` gap | `04-release-init-configuracion.md`; Corte 0 Plan 3 | Guide approval transition removes only the exact missing-guide gap; stale/unapproved restores it | **DONE** | Generation alone never resolves the gap |
| Closed task-guide DSL and test-guide DSL | `05-scope-task-guides.md` | Discriminated Guide schema, typed AST and deterministic evaluator | **DONE** | No scripts, natural-language executable conditions or arbitrary shell |
| Generation from approved Project Context and sources | `03-plan-incremental.md`; `05-scope-task-guides.md` | `guideGeneration.mjs`, approved source refs only, generic/custom/manual evidence | **DONE** | Generation produces a proposal, never approval |
| Deterministic Markdown projections and drift detection | `01-arquitectura-objetivo.md`; `05-scope-task-guides.md` | Pure renderer/comparator and `check guides` findings | **DONE** | Repair remains an explicit mutation, not a query side effect |
| Custom generators with confinement, timeout and structured I/O | `05-scope-task-guides.md` | `scope.generator.set`, constrained runner, hashes and adversarial tests | **DONE** | Approved host executable contract; no false OS-sandbox claim |
| Scope kind to gate/profile references | `01-arquitectura-objetivo.md`; Corte 0 topology | Per-Scope task/test Guides carry closed ID-only gate/profile references | **DONE** | Gate definitions and execution remain outside Corte 1 |
| Strict blocking for non-approved/current Guides | `03-plan-incremental.md`; `05-scope-task-guides.md` | `evaluateGuideReadiness` strict/advisory primitive | **DEFERRED_BY_DESIGN** | Enforcement is consumed by the first dependent atomization/execution cut; Corte 1 provides the fail-closed primitive only |
| Deterministic source-driven staleness | `05-scope-task-guides.md` | `evaluateGuideHealth`, live Discovery fingerprint observations and stable findings | **DONE** | No second fingerprint engine or timestamp freshness rule |
| Public `check guides`, query-only | `03-plan-incremental.md`; `05-scope-task-guides.md` | Public command, recovery precedence and no-mutation tests | **DONE** | Reports recommended explicit operations only |
| Release/Work Package/Task integration | `03-plan-incremental.md` Corte 2/3; architecture contract | Deliberately absent | **DEFERRED_BY_DESIGN** | Target: Corte 2/3; no future aggregate or execution behavior is introduced here |

## Plan Index

| # | Plan | Boundary | Status | Document |
|---|---|---|---|---|
| 1 | Guide domain, schemas, storage and lifecycle | Guide metadata/content envelopes, scope references, ChangeSet mutations, legal transitions, approval binding, gap resolution | **Merged (PR #18 to develop)** | `2026-07-27-corte-1-plan-1-guide-domain-lifecycle.md` |
| 2 | Generation, DSL, projections and custom generators | Source-driven generation, closed executable DSL, deterministic Markdown projections, generator safety, gate/profile references | **Merged (PR #19 to develop)** | `2026-07-28-corte-1-plan-2-generation-projections-generators.md` |
| 3 | Staleness, strict policy, `check guides` and DoD closure | Source drift, strict-mode primitive, query-only diagnostics, final traceability and regression closure | **Merged (PR #20 to develop)** | `2026-07-27-corte-1-plan-3-staleness-strict-check-guides.md` |

## Completion Rule

Every Corte 1 requirement is now `DONE` or `DEFERRED_BY_DESIGN` with an
explicit future boundary.

```text
Plan 1 — Merged (PR #18 to develop)
Plan 2 — Merged (PR #19 to develop)
Plan 3 — Merged (PR #20 to develop)

Corte 1: COMPLETE
```
