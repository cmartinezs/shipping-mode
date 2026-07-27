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

Corte 0 remains open after PR #7 and Discovery because the current runtime has a
strong ChangeSet/recovery foundation and a real Discovery catalog, but bootstrap
and Project Context still represent only the narrow Runtime Foundation subset.

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
| Documentation Sources map and entry point | `04-release-init-configuracion.md` Documentation Sources and host repository contract; Discovery spec | Discovery catalog can represent source docs after proposal; config has no selected source map or pending/gap refs | PARTIAL | Add config-level source selection/gap representation that reuses Discovery source ids; no parallel catalog. | Plan 3 |
| Commands build/test/smoke/lint/verify/custom structured by scope | Discovery spec C; `04-release-init-configuracion.md` commands | `scope.schema.json` and Discovery implement safe commands by scope | DONE | No second registry. Remaining work is only config/docs evidence if needed. | Plan 3 audit closure |
| Initial guides pending/missing state | `03-plan-incremental.md` Corte 0; `04-release-init-configuracion.md`; Corte 1 guide contract | Guide lifecycle and files are Corte 1; current scopes do not express missing/pending guide refs | MISSING | Add minimal scope/config refs or gaps only if needed by current schema boundary; no guide generation. | Plan 3 |
| Concerns, gates, gate profiles, execution contexts, environments, decisions, releases topology/reference shells | `03-plan-incremental.md`; `04-release-init-configuracion.md`; Corte -1.1 scopes/concerns/gates; Corte 2 future environments | Directories exist after Plan 1; schemas/lifecycle remain intentionally deferred where not needed | PARTIAL | Plan 3 adds minimal schemas/refs only where Corte 0 requires validation beyond directory presence. | Plan 3 |
| Host Repository precedence and no duplicate source of truth | `04-release-init-configuracion.md` host repository contract | Discovery favors host artifacts and records fingerprints/provenance; Plan 2 keeps Git policy explicit and Work Sources separate from Documentation Sources | PARTIAL | Plan 3 closes remaining Documentation Source/gap references without duplicate registries. | Plan 3 |

## Plan Index

| # | Plan | Boundary | Status | Doc |
|---|------|----------|--------|-----|
| 1 | Project Context and bootstrap topology | Canonical bootstrap directories, Project Context base fields, runtime/storage/path policies, structured plugin lock, `check schema` topology validation | **Merged (PR #15 to develop)** | `2026-07-27-corte-0-completion-plan-1-project-context-bootstrap.md` |
| 2 | Git/config policies and Work Source extensibility | Approved Git policy representation, lanes/branch topology/automation policy, safe Work Source config shells without providers | **Implementation complete; pending PR #16 merge** | `2026-07-27-corte-0-completion-plan-2-git-work-sources-config.md` |
| 3 | Remaining catalogs/references and Corte 0 DoD closure | Documentation Source refs/gaps, guide pending refs if still required, concern/gate/environment/decision/release reference shells, final Corte 0 audit closure | Pending Plan 2 merge | *(to be written after Plan 2 merge)* |

## Exit Rule

Corte 0 is not complete while any plan above is unmerged. After all Completion
plans merge and every remaining Corte 0 requirement is `DONE` or
`DEFERRED_BY_DESIGN`, the index may be updated to:

```text
Corte 0: COMPLETE
```

The next cut after that is:

```text
Corte 1 — scope catalog y guias aprobables
```
