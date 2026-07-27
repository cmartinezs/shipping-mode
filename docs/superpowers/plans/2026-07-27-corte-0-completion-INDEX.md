# Corte 0 Completion — Audit and Plan Index

> **For agentic workers:** close only the remaining Corte 0 bootstrap/configuration
> delta. Do not reopen Discovery, Runtime Foundation, Work Sources providers, Git
> execution, guides, releases, release items, work packages, tasks, or Corte 1.

**Canonical source order used:**

1. `docs/plugin-redesign-release-flow/03-plan-incremental.md`
2. `docs/plugin-redesign-release-flow/04-release-init-configuracion.md`
3. Current contracts for target architecture, runtime, Project Context, Host Repository, Git Work Execution, and Work Sources
4. `docs/specs/corte-0-runtime-foundation.md`
5. Merged Discovery Iteration
6. Current `develop` implementation and tests

## Completion Boundary

Corte 0 was completed by merging PR #17 to `develop`. The runtime now has the
ChangeSet/recovery foundation, Discovery catalog, bootstrap topology, and the
approved Project Context configuration required by the canonical Corte 0
contract.

Corte 0 Completion closes only the minimum configuration/state required by the
canonical Corte 0 contract:

- base `.planning/` topology required for future cuts;
- Project Context fields for identity, runtime/storage, paths, lanes, Git policy,
  automation policy, scope catalog references, Documentation Sources, Work Source
  extensibility, and autonomy;
- minimal catalog/reference shells for concerns, gates, gate profiles, execution
  contexts, environments, decisions, releases, and vendor template packs;
- no productive providers, no Git execution engine, no guide lifecycle, no release
  or task domain.

## Requirement Audit

| Requirement | Canonical source | Current implementation evidence | Status | Remaining delta | Target plan |
|---|---|---|---|---|---|
| ChangeSet lifecycle, durable operations, locks, stale semantics, recovery, immutable events, deterministic schemas/build | `docs/specs/corte-0-runtime-foundation.md`; Corte -1.1/-1.2 runtime contracts | `runtime/src/lib/changeset.mjs`, `mutation.mjs`, `journal.mjs`, `lock.mjs`, `operationStore.mjs`; unit/e2e/crash/security/bundle suites | DONE | None. Must not weaken. | Regression in every plan |
| Runtime bundle self-contained with generated Ajv validators | Corte -1.1 sections 13/15; Runtime Foundation | `runtime/dist/shipping-mode.mjs`, `scripts/build-runtime.mjs`, `runtime/tests/bundle-self-contained.test.mjs`, `verify:artifacts` | DONE | None. Must not weaken. | Regression in every plan |
| Discovery source catalog and command discovery | Discovery spec A-H; `04-release-init-configuracion.md` Documentation Sources model | `runtime/src/lib/discoverScan.mjs`, `source.schema.json`, `discovery-proposal.schema.json`, `scope.schema.json` commands, Discovery e2e suites | DONE | Do not create a second source or command registry. | Regression in every plan |
| Discovery Iteration administrative closure | Discovery Plan Index | Plan 5 merged by PR #14 | DONE | None. | Complete |
| Bootstrap creates canonical base topology | `03-plan-incremental.md` Corte 0; `04-release-init-configuracion.md` expected result; Corte -1.2 storage separation | Plan 1 materializes canonical directories through ChangeSet/apply | DONE | None. | Plan 1 |
| `check schema` verifies required base topology without mutating | `04-release-init-configuracion.md` result; Runtime Foundation query-only check | Plan 1 validates required topology and unsafe entries query-only | DONE | None. | Plan 1 |
| Project identity and project type | `04-release-init-configuracion.md` minimum config; Host repository contract | Plan 1 persists canonical `project` fields with explicit/unknown project type | DONE | None. | Plan 1 |
| Runtime/storage policies and workspace boundary | `04-release-init-configuracion.md` minimum config and rules | Plan 1 persists runtime stores, retention, and workspace boundary | DONE | None. | Plan 1 |
| Plugin lock version/schema/template pack reproducibility | `04-release-init-configuracion.md`; Corte -1.1 template pack historical contract | Plan 1 persists structured lock and deterministic vendor snapshot metadata | DONE | None. | Plan 1 |
| Git enabled/disabled, provider, branch topology, lanes, automation policy | `11-git-work-execution-contract.md`; `04-release-init-configuracion.md` Git questions | Plan 2 adds required canonical `git` policy, compatibility synchronization, branch/promotion relations, trunk-based support, and automation policy | DONE | None. Git execution remains deferred. | Plan 2 |
| Work Sources extensibility without providers | `12-work-source-provider-contract.md`; `03-plan-incremental.md` Corte 0 note | Plan 2 adds required canonical `work_sources` config with closed safe provider refs/policies, pre-apply relational validation, and no secrets | DONE | None. Providers/import/sync remain deferred. | Plan 2 |
| Documentation Sources map and entry point | `04-release-init-configuracion.md` Documentation Sources and host repository contract; Discovery spec | Discovery owns `.planning/sources/<uuid>/source.yml`; Project Context now stores ID-only `documentation.source_refs` and declarative `documentation.gaps` | DONE | None. Source metadata remains owned by Discovery. | Plan 3 |
| Commands build/test/smoke/lint/verify/custom structured by scope | Discovery spec C; `04-release-init-configuracion.md` commands | `scope.schema.json` and Discovery implement safe commands by scope | DONE | No second registry. Remaining work is only config/docs evidence if needed. | Plan 3 audit closure |
| Initial guides pending/missing state | `03-plan-incremental.md` Corte 0; `04-release-init-configuracion.md`; Corte 1 guide contract | Scope creation records a typed `guides`/`missing` gap in Project Context; no guide files or lifecycle are introduced | DONE | None. Guide generation and approval remain Corte 1. | Plan 3 |
| Concerns, gates, gate profiles, execution contexts, environments, decisions, releases bootstrap topology | `03-plan-incremental.md`; `04-release-init-configuracion.md`; Corte -1.1 scopes/concerns/gates; Corte 2 future environments | Plan 1 materializes the canonical directories and `check schema` verifies the topology | DONE | None. Future behavior is tracked separately as an explicit deferral. | Plan 1 |
| Concern, gate, environment, decision, release, and execution lifecycles | `03-plan-incremental.md` Corte 1/2/3/5 boundaries; Runtime Foundation | No lifecycle engine is present or required for Corte 0 | DEFERRED_BY_DESIGN | Deferred to the canonical cuts; bootstrap remains available. | Later cuts |
| Host Repository precedence and no duplicate source of truth | `04-release-init-configuracion.md` host repository contract | Discovery owns evidence/catalog metadata; Project Context stores only approved ID refs and declarative gaps; Git and Work Sources remain separate | DONE | None. Contradictions remain explicit gaps/decisions rather than silent overwrites. | Plan 3 |

## Plan Index

| # | Plan | Boundary | Status | Doc |
|---|------|----------|--------|-----|
| 1 | Project Context and bootstrap topology | Canonical bootstrap directories, Project Context base fields, runtime/storage/path policies, structured plugin lock, `check schema` topology validation | **Merged (PR #15 to develop)** | `2026-07-27-corte-0-completion-plan-1-project-context-bootstrap.md` |
| 2 | Git/config policies and Work Source extensibility | Approved Git policy representation, lanes/branch topology/automation policy, safe Work Source config shells without providers | **Merged (PR #16 to develop)** | `2026-07-27-corte-0-completion-plan-2-git-work-sources-config.md` |
| 3 | Remaining catalogs/references and Corte 0 DoD closure | Documentation Source refs/gaps, guide pending refs, and final Corte 0 audit closure | **Merged (PR #17 to develop)** | `2026-07-27-corte-0-completion-plan-3-final-closure.md` |

## Exit Rule

Corte 0: COMPLETE

All Completion plans are merged and every remaining Corte 0 requirement is
`DONE` or `DEFERRED_BY_DESIGN`. The next cut is:

The next cut after that is:

```text
Corte 1 — scope catalog y guias aprobables
```
