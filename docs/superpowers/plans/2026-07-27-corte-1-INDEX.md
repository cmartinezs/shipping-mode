# Corte 1 — Scope Catalog y Guías Aprobables

## Boundary

Corte 1 convierte Documentation Sources ya descubiertas y referenciadas por
Project Context en guías operativas versionadas por Scope. `scope.yml` sigue
siendo el único catálogo de scopes. Los YAML de guía son estado canónico; los
Markdown son proyecciones regenerables y no participan en reglas runtime.

No se implementan Release, Release Items, Work Packages, Tasks, Work Sources
providers, Git execution, deployment ni lifecycle de environments.

## Requirement Audit

| Requirement | Canonical source | Existing primitive | Status | Implementation delta | Plan |
|---|---|---|---|---|---|
| Scope catalog with UUIDv7 identity and per-scope storage | `01-arquitectura-objetivo.md`; Corte 0/Discovery | `scope.schema.json`, `.planning/scopes/<uuid>/scope.yml`, ChangeSet `scope.add` | DONE | Reuse without redesigning Scope | Regression |
| Canonical `task-guide.yml` and `test-guide.yml` paths | `03-plan-incremental.md`; `04-release-init-configuracion.md`; `05-scope-task-guides.md` | Scope directories exist, but no guide files or metadata schema | MISSING | Add Guide aggregate metadata, typed storage, and file-plan integration | Plan 1 |
| YAML is canonical and Markdown is projection only | `01-arquitectura-objetivo.md`; `05-scope-task-guides.md` | YAML canonical rule exists for existing domains; no Guide enforcement | PARTIAL | Bind guide state to canonical YAML and reserve projection metadata; rendering belongs Plan 2 | Plans 1-2 |
| Stable Guide identity and Scope/Source references | `03-plan-incremental.md`; identity contract | UUIDv7 exists for scopes/sources; no Guide identity | MISSING | Server-owned Guide UUIDv7, Scope UUIDv7 relation, ID-only source refs | Plan 1 |
| Guide lifecycle `generated/reviewed/approved/stale/rejected` | `05-scope-task-guides.md` state diagram/table | ChangeSet lifecycle and approval machinery exist; no Guide state machine | MISSING | Closed transitions and server-owned state changes | Plan 1 |
| Guide provenance and approved revision binding | `03-plan-incremental.md`; `04-release-init-configuracion.md`; `05-scope-task-guides.md` | Source fingerprints/provenance exist for Discovery; no Guide provenance | MISSING | Typed provenance, content/revision hash, approval actor/time/hash | Plan 1 |
| Consume and resolve Corte 0 `guides/missing` gap | `04-release-init-configuracion.md`; Corte 0 Plan 3 | `documentation.gaps` with `scope_ref` and `guides/missing` exists | PARTIAL | Resolve only after server-side approval through the same mutation | Plan 1 |
| Closed task-guide DSL and test-guide DSL | `05-scope-task-guides.md` operators/content examples | Scope command schema is closed; no guide DSL schema | MISSING | Define operator/content schemas and references without scripts | Plan 2 |
| Generation from approved Project Context and sources | `03-plan-incremental.md`; `05-scope-task-guides.md` | Discovery scan/propose and source catalog exist; no generator | MISSING | Generate structured proposal via ChangeSet; no auto-approval | Plan 2 |
| Deterministic Markdown projections and drift detection | `01-arquitectura-objetivo.md`; `05-scope-task-guides.md` | No guide renderer/projection check | MISSING | Render YAML to Markdown and detect projection drift | Plan 2 / Plan 3 |
| Custom generators with confinement, timeout, and structured I/O | `05-scope-task-guides.md` | Safe command/path primitives exist; no generator runner | MISSING | Contracted runner only; no arbitrary canonical writes | Plan 2 |
| Scope kind to gate/profile references | `01-arquitectura-objetivo.md`; Corte 0 topology | Scope `kind` and gate-profile topology exist; no relation | PARTIAL | Add ID-only references; no gate engine | Plan 2 |
| Strict blocking for non-approved guides | `03-plan-incremental.md`; `05-scope-task-guides.md` | No atomization/task runtime exists and no strict guide policy | DEFERRED_BY_DESIGN | Primitive/check policy only; enforcement belongs the first dependent cut | Plan 3 |
| Deterministic source-driven staleness | `05-scope-task-guides.md` | Discovery fingerprints exist; no Guide freshness evaluator | MISSING | Recompute and explain drift without a second fingerprint engine | Plan 3 |
| Public `check guides`, query-only | `03-plan-incremental.md`; `05-scope-task-guides.md` | `check schema` exists; no guide check | MISSING | Add non-mutating Guide diagnostics and recommendations | Plan 3 |
| Release/Work Package/Task integration | `03-plan-incremental.md` Corte 2/3; architecture contract | Deliberately absent | DEFERRED_BY_DESIGN | No aggregate or execution behavior in Corte 1 | Later cuts |

## Plan Index

| # | Plan | Boundary | Status | Document |
|---|---|---|---|---|
| 1 | Guide domain, schemas, storage and lifecycle | Guide metadata/content envelopes, scope references, ChangeSet mutations, legal transitions, approval binding, gap resolution | **Merged (PR #18 to develop)** | `2026-07-27-corte-1-plan-1-guide-domain-lifecycle.md` |
| 2 | Generation, DSL, projections and custom generators | Source-driven generation, closed executable DSL, deterministic Markdown projections, generator safety, gate/profile references | **Merged (PR #19 to develop)** | `2026-07-28-corte-1-plan-2-generation-projections-generators.md` |
| 3 | Staleness, strict policy, `check guides` and DoD closure | Source drift, strict-mode primitive, query-only diagnostics, final traceability and regression closure | **Implementation complete; pending PR merge** | `2026-07-27-corte-1-plan-3-staleness-strict-check-guides.md` |

## Completion Rule

Corte 1 remains open until all plans are merged and each requirement is
`DONE` or explicitly `DEFERRED_BY_DESIGN` with a canonical target cut. This
execution implements only Plan 3. Corte 1 remains open.
