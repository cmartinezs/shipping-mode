# Corte 0 Completion Plan 1 — Project Context and Bootstrap Topology

> **For agentic workers:** implement only Plan 1. Do not implement Git execution,
> Work Source providers, guides, releases, release items, work packages, tasks,
> or Corte 1.

**Goal:** close the Corte 0 bootstrap topology and Project Context base delta
against the current canonical contracts, without weakening Runtime Foundation or
Discovery.

**Local execution status:** Implemented on branch
`agent/corte-0-plan-1-project-context-bootstrap`; full required regression
passed; pending Draft PR review/merge.

**`writing-plans` pass:** this file follows the repo-native `writing-plans`
convention used in prior Discovery plans: concrete tasks, adversarial review,
TDD steps, gates, and explicit out-of-scope guardrails. No separate executable
`writing-plans` tool is exposed in this checkout.

## Source Findings

- `03-plan-incremental.md` and `04-release-init-configuracion.md` require the
  canonical `.planning/` base topology, including directories that current
  `renderWorkspaceInit()` does not materialize.
- `docs/specs/corte-0-runtime-foundation.md` is lower authority for this delta:
  it intentionally implemented only the Runtime Foundation subset and explicitly
  left discovery/git/scopes/guides/configuration work pending.
- `04-release-init-configuracion.md` requires Project Context to represent
  project identity, runtime paths/storage, scope catalog refs, work-source
  policy defaults/extensibility, autonomy, and workspace boundary. Plan 1 closes
  only the base/project/runtime/path/plugin-lock subset; Git and Work Source
  config are Plan 2.
- `08-corte-1-1-contratos-runtime.md` requires historical template pack
  reproducibility through `vendor/template-packs/<fingerprint>/`.

## Scope

Plan 1 implements:

- Bootstrap topology created by `workspace.init` through the existing ChangeSet
  apply path.
- `check schema` query-only validation that required topology exists and unsafe
  entries are reported.
- Project Context base fields in `config.yml`:
  - `project.name`;
  - `project.type`;
  - `plugin.schemaVersion`;
  - `plugin.launcher`;
  - `scopeCatalog.directory`;
  - `scopeCatalog.enabled`;
  - `policies.release`;
  - `policies.workSources` defaults only;
  - `policies.paths.workspaceBoundary`;
  - `runtime.eventStore`;
  - `runtime.operationStore`;
  - `runtime.runtimeStore`;
  - `runtime.templateVendor`;
  - retention policy fields.
- Structured `plugin.lock.yml`:
  - `plugin.version`;
  - `plugin.schemaVersion`;
  - `plugin.templatePack.id`;
  - `plugin.templatePack.version`;
  - `plugin.templatePack.fingerprint`;
  - `plugin.templatePack.vendorSnapshot`.

Plan 1 does not remove the existing top-level `name`, `vcs`, `baseBranch`, or
`scopeRefs` fields yet. Existing code and Discovery tests read those fields. The
new Project Context fields become canonical; later plans can migrate remaining
legacy-shaped command payloads only when their replacement is implemented.

## TDD Tasks

### Task 1: Red tests for bootstrap topology

- [x] Add unit tests proving `renderWorkspaceInit()` returns directory targets
  for every required directory.
- [x] Add CLI E2E assertions that `init -> validate -> approve -> apply`
  materializes the topology under `.planning/`.
- [x] Assert the created topology includes `sources/` because Discovery has made
  source catalog a real Corte 0/Discovery artifact.

### Task 2: Red tests for Project Context base config

- [x] Add schema fixture tests for the expanded `config.yml`.
- [x] Assert init-rendered config includes `project`, `plugin`,
  `scopeCatalog`, `policies.release`, `policies.workSources`,
  `policies.paths`, and `runtime`.
- [x] Assert existing fields needed by current commands remain present.

### Task 3: Red tests for plugin lock structure

- [x] Add schema fixture tests for structured `plugin.lock.yml`.
- [x] Assert `workspace.init` renders a deterministic vendor snapshot path
  derived from the template pack fingerprint.

### Task 4: Red tests for `check schema` topology validation

- [x] Add `check schema` tests for missing required topology directories.
- [x] Add tests that a required topology entry that is a file or symlink is a
  finding, not silently accepted.
- [x] Confirm `check schema` remains query-only.

### Task 5: Implementation

- [x] Add a small topology helper with the authoritative required directory
  list.
- [x] Update `prepareProposal("workspace.init")` target files to include
  directory targets.
- [x] Update renderer output so directories are created through ChangeSet/apply
  without introducing non-canonical temp files.
- [x] Expand config and plugin-lock schemas.
- [x] Update check schema.
- [x] Regenerate schemas/runtime/test bundle.

### Task 6: Regression

- [x] `npm ci`
- [x] `npm run build:schemas`
- [x] `npm run build:runtime`
- [x] `npm run build:test-bundle`
- [x] `npm run test:unit`
- [x] `npm run test:cli-e2e`
- [x] `npm run test:real-crash-e2e`
- [x] `npm run test:security-e2e`
- [x] `npm run test:bundle`
- [x] `npm run verify:artifacts`
- [x] `npm run verify:next-generation`
- [x] `git diff --check`

## Adversarial Review

- [x] Directory creation must happen only through ChangeSet/apply, not direct
  init writes.
- [x] Required directories must not be treated as optional just because older
  Runtime Foundation text scoped them out.
- [x] `check schema` must report missing/unsafe topology and never create it.
- [x] Placeholder files must not be introduced where directories are the
  canonical state.
- [x] Plugin lock expansion must preserve deterministic generated artifacts.
- [x] Config expansion must not break existing Discovery/autonomy config or
  scopeRefs semantics.
- [x] Plan 1 must not implement Plan 2 Git policy fields beyond existing
  `vcs`/`baseBranch` compatibility.
- [x] Plan 1 must not implement Work Source providers, import/sync, guide
  lifecycle, release entities, or task execution.

## Completion Criteria

Plan 1 is complete only when:

- bootstrap materializes the canonical Corte 0 base topology;
- `check schema` fails closed on missing/unsafe topology;
- init-rendered config represents Project Context base/runtime/path policies;
- plugin lock represents historical template pack reproducibility metadata;
- all mandatory gates pass;
- this plan is updated with actual results;
- the Completion Index marks Plan 1 implementation complete / pending PR merge.

## Actual Results

- Added `runtime/src/lib/bootstrapTopology.mjs` with the authoritative bootstrap
  directory lists and a server-owned directory render marker.
- Extended the ChangeSet apply/recovery path with `mkdir` filePlan entries so
  directory creation remains part of `validate -> approve -> apply -> recover`,
  not direct `init` writes.
- `workspace.init` now creates the canonical base topology required by Corte 0:
  `events/`, `operations/`, `.runtime/`, `scopes/`, `sources/`, `concerns/`,
  `gates/`, `gate-profiles/`, `execution-contexts/`, `environments/`,
  `decisions/`, `releases/`, and `vendor/template-packs/`.
- `config.yml` now persists Project Context base/runtime/path policy fields while
  preserving current `name`, `vcs`, `baseBranch`, and `scopeRefs` compatibility
  for existing commands and Discovery.
- `plugin.lock.yml` now includes structured plugin/template pack metadata and a
  deterministic vendor snapshot path.
- `check schema` now fails closed for missing, file-backed, or symlinked required
  topology entries and remains query-only.
- No Work Source providers, Git execution, guide lifecycle, releases, release
  items, work packages, tasks, or Corte 1 behavior were introduced.
- No new production provider dependency was added.
- `npm ci` completed with the existing npm audit notice: 1 moderate vulnerability.

## Post-review corrections

The PR review found and closed four Plan 1 integrity gaps before merge:

- `project.type` is no longer guessed as `software`; `init` accepts an explicit
  `--project-type` and otherwise persists `unknown`.
- `scopeCatalog.enabled` now uses UUIDv7 primary references and is updated by both
  explicit `scope.add` and Discovery scope creation, instead of silently drifting
  from the canonical scope catalog.
- `check schema` now rejects divergence between canonical Project Context/plugin-lock
  fields and the temporary compatibility fields retained during Corte 0 Completion.
- `mkdir` filePlan/result entries now require the deterministic server-owned directory
  marker hash, so corrupted operation metadata cannot be accepted as a valid recovered
  directory mutation.

