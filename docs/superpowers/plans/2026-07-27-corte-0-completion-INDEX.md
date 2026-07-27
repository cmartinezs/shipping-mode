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
| Discovery Iteration administrative closure | Discovery Plan Index | Plan 5 merged by PR #14; index updated in this plan | DONE | None. | This index update |
| Bootstrap creates canonical base topology | `03-plan-incremental.md` Corte 0; `04-release-init-configuracion.md` expected result; Corte -1.2 storage separation | `renderWorkspaceInit()` currently writes only `config.yml`, `plugin.lock.yml`, `.gitignore`; tests assert only those files | PARTIAL | Add required directory placeholders through ChangeSet/apply: `events/`, `operations/`, `.runtime/`, `scopes/`, `sources/`, `concerns/`, `gates/`, `gate-profiles/`, `execution-contexts/`, `environments/`, `decisions/`, `releases/`, `vendor/template-packs/`. | Plan 1 |
| `check schema` verifies required base topology without mutating | `04-release-init-configuracion.md` result; Runtime Foundation query-only check | `checkSchema()` verifies required files and validates existing scopes/sources/operations, but does not require topology directories | PARTIAL | Add query-only topology findings and tests. | Plan 1 |
| Project identity and project type | `04-release-init-configuracion.md` minimum config; Host repository contract | Current `config.yml` has top-level `name`, `vcs`, `baseBranch`; no `project` object or `type` | PARTIAL | Add backward-free Corte 0 Project Context structure while preserving existing runtime fields only where needed for compatibility during this completion sequence. | Plan 1 |
| Runtime/storage policies and workspace boundary | `04-release-init-configuracion.md` minimum config and rules | Current config lacks `runtime` and `paths`; code hardcodes `.planning/events`, `.planning/operations`, `.planning/.runtime` | PARTIAL | Persist runtime store paths/retention and `paths.workspaceBoundary`. | Plan 1 |
| Plugin lock version/schema/template pack reproducibility | `04-release-init-configuracion.md`; Corte -1.1 template pack historical contract | Current `plugin.lock.yml` stores `schemaVersion`, `pluginVersion`, `templatePackFingerprint` only | PARTIAL | Persist structured plugin lock fields: plugin version/schema, template pack id/version/fingerprint/vendor snapshot. | Plan 1 |
| Git enabled/disabled, provider, branch topology, lanes, automation policy | `11-git-work-execution-contract.md`; `04-release-init-configuracion.md` Git questions | Current config has `vcs` and `baseBranch` only; Discovery detects git but approved policy cannot express `feature/fix -> develop`, `develop -> master` | MISSING | Add schema/config representation only. No Git execution. | Plan 2 |
| Work Sources extensibility without providers | `12-work-source-provider-contract.md`; `03-plan-incremental.md` Corte 0 note | Current config has no `work_sources` policies/provider refs; Discovery source catalog is documentation/source evidence, not Work Source config | MISSING | Add safe config shape for disabled/provider refs, sync mode, source policy, roots/queries/connection refs, no secrets. No adapters/import/sync. | Plan 2 |
| Documentation Sources map and entry point | `04-release-init-configuracion.md` Documentation Sources and host repository contract; Discovery spec | Discovery catalog can represent source docs after proposal; config has no selected source map or pending/gap refs | PARTIAL | Add config-level source selection/gap representation that reuses Discovery source ids; no parallel catalog. | Plan 3 |
| Commands build/test/smoke/lint/verify/custom structured by scope | Discovery spec C; `04-release-init-configuracion.md` commands | `scope.schema.json` and Discovery implement safe commands by scope | DONE | No second registry. Remaining work is only config/docs evidence if needed. | Plan 3 audit closure |
| Initial guides pending/missing state | `03-plan-incremental.md` Corte 0; `04-release-init-configuracion.md`; Corte 1 guide contract | Guide lifecycle and files are Corte 1; current scopes do not express missing/pending guide refs | MISSING | Add minimal scope/config refs or gaps only if needed by current schema boundary; no guide generation. | Plan 3 |
| Concerns, gates, gate profiles, execution contexts, environments, decisions, releases topology/reference shells | `03-plan-incremental.md`; `04-release-init-configuracion.md`; Corte -1.1 scopes/concerns/gates; Corte 2 future environments | Directories absent from bootstrap; schemas/lifecycle absent | PARTIAL | Plan 1 creates topology; Plan 3 adds minimal schemas/refs only where Corte 0 requires validation beyond directory presence. | Plans 1 and 3 |
| Host Repository precedence and no duplicate source of truth | `04-release-init-configuracion.md` host repository contract | Discovery favors host artifacts and records fingerprints/provenance | PARTIAL | Completion docs/config must reuse Discovery catalog and not introduce duplicate registries. | Plans 2 and 3 |

## Plan Index

| # | Plan | Boundary | Status | Doc |
|---|------|----------|--------|-----|
| 1 | Project Context and bootstrap topology | Canonical bootstrap directories, Project Context base fields, runtime/storage/path policies, structured plugin lock, `check schema` topology validation | Implementation complete locally; pending PR review/merge | `2026-07-27-corte-0-completion-plan-1-project-context-bootstrap.md` |
| 2 | Git/config policies and Work Source extensibility | Approved Git policy representation, lanes/branch topology/automation policy, safe Work Source config shells without providers | Pending Plan 1 merge | *(to be written after Plan 1 merge)* |
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
