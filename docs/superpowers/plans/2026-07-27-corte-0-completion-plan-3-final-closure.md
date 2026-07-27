# Corte 0 Completion — Plan 3: Remaining catalogs/references and final closure

## Objective

Close the remaining Corte 0 Project Context and Definition of Done delta. Add
only the minimum approved Documentation Source references and persisted gaps
needed to distinguish missing knowledge from decisions. Express guide absence
through the same gap primitive. Keep the Discovery catalog as the owner of
Documentation Source metadata and defer all guide, gate, concern, environment,
decision, release, Work Source, and Git execution lifecycles to their canonical
future cuts.

## Current-state audit

| Requirement | Canonical evidence | Current implementation | Actual gap | Resolution |
|---|---|---|---|---|
| Documentation Source context entry point | `04-release-init-configuracion.md` configuration model and Discovery source catalog | `.planning/sources/<uuid>/source.yml` is canonical, but `config.yml` has no selected refs | Project Context cannot state which confirmed sources are approved context | `DONE_BY_IMPLEMENTATION`: add `documentation.source_refs` with UUIDv7 refs and pre-apply existence validation |
| Missing/unknown/conflicting knowledge | `04-release-init-configuracion.md` gap/pending rules | No persisted gap primitive; diagnostics are transient findings | Absence could be mistaken for an approved decision | `DONE_BY_IMPLEMENTATION`: add closed `documentation.gaps` with contractual statuses |
| Initial guide pending state | Corte 0 requirement and Corte 1 guide boundary | Scope records commands and identity but no pending guide state | A scope cannot express that its guide is still missing | `DONE_BY_IMPLEMENTATION`: represent it as a `guides` gap scoped by `scope_ref`; no guide lifecycle |
| Concerns/gates/gate profiles | `03-plan-incremental.md` lists future catalogs; Corte 0 bootstrap topology | Directories exist from Plan 1, no lifecycle or schema is required by Corte 0 | No remaining Corte 0 behavior after topology | `DEFERRED_BY_DESIGN`: future catalog/lifecycle work stays in later cuts |
| Execution contexts | `04-release-init-configuracion.md` describes execution locations | Directory exists; no task runtime or context catalog behavior | No Corte 0 consumer exists | `DEFERRED_BY_DESIGN`: declaration/evaluation belongs to later execution cuts |
| Environments | `04-release-init-configuracion.md` separates deployable environments from execution contexts | Directory exists; no production environment behavior | No bootstrap behavior beyond reserved topology | `DEFERRED_BY_DESIGN`: deployment/provisioning belongs to later cuts |
| Decisions | Corte 0 reserves decisions and uses explicit unresolved states | Directory exists; no ADR lifecycle | No Corte 0 decision aggregate is required | `DEFERRED_BY_DESIGN`: decision lifecycle belongs to later governance work |
| Releases | `03-plan-incremental.md` defines Release in Corte 2 | Directory exists; no release aggregate | Implementing it would advance Corte 2 | `DEFERRED_BY_DESIGN`: Release starts in Corte 2 |
| Commands | Discovery scope schema and command tests | One structured scope command representation supports build/test/smoke/lint/verify/custom | No gap | `ALREADY_DONE` |
| Host Repository precedence | Host/Git/Discovery contracts | Discovery provenance and Plan 2 explicit policies exist; no second source registry | Project Context source selection/gaps need to preserve that precedence | `DONE_BY_IMPLEMENTATION`: refs only point to Discovery IDs; conflicting knowledge remains an explicit gap |

## Canonical decisions

1. `documentation.source_refs` contains only UUIDv7 IDs owned by
   `.planning/sources/<uuid>/source.yml`. It does not copy paths, fingerprints,
   authority, or role into Project Context.
2. `documentation.gaps` is the only persisted gap primitive in this plan. Its
   statuses are `known`, `missing`, `unknown`, `conflicting`, and `deferred`.
   A gap may reference a scope by UUIDv7 and may reference Documentation
   Sources by UUIDv7; those references must exist before validation succeeds.
3. `scope.add` records a `guides`/`missing` gap for the new scope using a UUID
   assigned in the proposed ChangeSet. Corte 1 may later resolve or replace
   that state through its guide lifecycle.
4. Config changes remain typed `config.update` ChangeSets. Source/gap
   relations are checked during validation and again by query-only `check
   schema`; apply cannot create a dangling Project Context.
5. Concerns, gates, gate profiles, execution contexts, environments, decisions,
   releases, and their lifecycles are not invented here. Their bootstrap
   directories are DONE; their behavior is explicitly deferred by canonical
   cut boundaries.

## Requirements resolved without code

- Commands are already DONE through the existing scope command schema and
  Discovery evidence; no registry is added.
- The topology for concerns, gates, gate profiles, execution contexts,
  environments, decisions, releases, and vendor packs is already DONE from
  Plan 1.
- Release domain/lifecycle is deferred to Corte 2; Work Source providers and
  normalized items are deferred to Corte 3; guides and guide lifecycle are
  deferred to Corte 1.

## TDD tasks

1. Add red schema fixtures for Documentation Source refs, gap statuses, scope
   refs, duplicate refs, unknown fields, and malformed IDs.
2. Extend the config and `config.update` schemas with closed documentation and
   gap definitions; regenerate validators and bundles.
3. Extend init rendering with empty documentation refs/gaps and extend
   `scope.add` payload/rendering to persist the pending guide gap atomically.
4. Extend `config.update` rendering to accept only typed documentation changes.
5. Add shared pre-apply Project Context relation checks for source IDs, scope
   IDs, gap source refs, and gap scope refs; reuse them in `check schema`.
6. Add an end-to-end bootstrap/configuration test covering operation state,
   immutable events, topology, plugin lock, Git/Work Sources, documentation
   refs/gaps, scope pending-guide state, and `check schema` PASS.
7. Add negative tests proving dangling refs become `INVALID` before approval
   and direct/unknown config fields remain rejected.
8. Run every mandatory regression gate and update the final traceability matrix.

## Adversarial review

- No second Documentation Source registry: only IDs into `sources/` are stored.
- No path-based primary identity or duplicated source metadata.
- No guide files, generation, approval, inheritance, or execution are added.
- No release, gate engine, environment provisioning, concern lifecycle, or ADR
  system is added.
- Gaps are not an issue tracker: they are closed, declarative missing-knowledge
  records with no assignment, comments, transitions, or external writes.
- Dangling refs are rejected during ChangeSet validation, not deferred to a
  post-apply schema check.
- `check schema` remains query-only and uses the same relation rules.
- `config.update` remains an allowlisted typed replacement, not an object merge.
- Existing Discovery, autonomy, ChangeSet, recovery, Git policy, and Work
  Source safety contracts are regression-only surfaces.

## Final Definition of Done traceability

| Corte 0 requirement | Canonical source | Implementation evidence | Tests | Final status |
|---|---|---|---|---|
| Bootstrap topology and runtime foundation | `03-plan-incremental.md`, Runtime Foundation | Plan 1 merged implementation | Full unit/E2E/crash/security suites | DONE |
| Project identity, runtime, paths, lock | `04-release-init-configuracion.md` | Plan 1 config/plugin lock schemas | Schema, CLI, artifact gates | DONE |
| Git policy and automation representation | Git Work Execution contract | Plan 2 `git` policy and checks | Plan 2 schema/pre-apply/E2E tests | DONE |
| Work Source configuration shell and secret safety | Work Source Provider contract | Plan 2 `work_sources` schema/checks | Security and lifecycle tests | DONE |
| Discovery Documentation Source catalog | Discovery design | `sources/<uuid>/source.yml` | Discovery scan/propose suites | DONE |
| Approved Documentation Source refs and missing knowledge | `04-release-init-configuracion.md` | Plan 3 `documentation.source_refs/gaps` | Relation and E2E tests | DONE |
| Initial guide pending state | Corte 0/Corte 1 boundary | Plan 3 scoped `guides` gap | Scope-add and E2E tests | DONE |
| Commands by scope | Discovery design | Existing scope command schema | Command/discovery tests | DONE |
| Concerns/gates/contexts/environments/decisions topology | Corte 0 bootstrap contract | Plan 1 directories | Topology/check tests | DONE |
| Their future lifecycles | `03-plan-incremental.md` Corte 1/2/3/5 boundaries | No implementation by design | Scope guard and full regression | DEFERRED_BY_DESIGN |
| Host Repository precedence | Host/Git/Discovery contracts | Provenance plus ID-only refs and gaps | Dangling/conflict relation tests | DONE |

## Regression gates

`npm ci`, `npm run build:schemas`, `npm run build:runtime`,
`npm run build:test-bundle`, `npm run test:unit`, `npm run test:cli-e2e`,
`npm run test:real-crash-e2e`, `npm run test:security-e2e`,
`npm run test:bundle`, `npm run verify:artifacts`,
`npm run verify:next-generation`, and `git diff --check`.

## Explicit deferrals

- Corte 1: guide generation, approval, inheritance, freshness, and execution.
- Corte 2: Release aggregate, release lifecycle, lanes execution, and
  deployment events.
- Corte 3: Release Items, Work Packages, provider registry, Local Repository
  and Jira/MCP adapters, normalized items, and import/sync.
- Later cuts: Git execution, gate orchestration, environment provisioning,
  task runtime, deployment, and external writes.

## Results

- [x] Implementation complete
- [x] Full regression gates green, including reproducible `npm ci`
- [x] Draft PR opened against `develop` as PR #17

`npm ci` completed successfully. npm reported one moderate audit finding; no
dependency changes were required for this plan and the mandatory build,
runtime, unit, CLI, crash, security, bundle, artifact, and next-generation
gates passed. Corte 0 remains pending Plan 3 PR merge and is not declared
complete on this branch.
