# Corte 1 Plan 1 — Guide Domain, Schemas, Storage and Lifecycle

## Objective

Implement the minimum server-owned Guide aggregate needed to persist and
approve `task-guide.yml` and `test-guide.yml` per existing Scope, without
implementing source-driven generation, Markdown projections, staleness
detection, strict atomization, custom generators, Release, Work Package, or
Task behavior.

## Current-state findings

- `.planning/scopes/<scope-id>/scope.yml` is canonical and already uses
  server-created UUIDv7 Scope IDs.
- Discovery owns `.planning/sources/<source-id>/source.yml`; Project Context
  already stores only ID references and gaps.
- `documentation.gaps` records `concern: guides`, `status: missing`, and
  `scope_ref` when a Scope is created. No second pending-guide registry exists.
- ChangeSet validation, approval, apply, locks, recovery, immutable events,
  and approval hash binding already exist and must be reused.
- There are no Guide schemas, Guide files, Guide metadata, lifecycle commands,
  or Guide-specific checks in the current runtime.
- Existing Scope command and source models are not to be copied into Guide
  documents.

## Canonical decisions

### Guide identity and storage

- Each task/test Guide has a server-owned UUIDv7 `id`, independent of its path,
  Scope key, or timestamp.
- `scopeId` is the only relationship to Scope. `sourceRefs` contains only
  existing Documentation Source UUIDv7 IDs; source metadata remains in the
  Discovery catalog.
- The canonical files are exactly:
  `.planning/scopes/<scope-id>/task-guide.yml` and `test-guide.yml`.
- `scope.yml` stores typed Guide metadata and references the canonical files.
  It does not duplicate the guide body.
- Markdown projection paths may be recorded in metadata, but Plan 1 neither
  generates nor trusts them. Plan 2 owns projection generation.

### Content and revision

- A Guide revision is the SHA-256 of canonical serialized Guide YAML content,
  computed by the server. Callers cannot assert the revision.
- The Guide document has a closed structural envelope in Plan 1: schema/dsl
  version, Scope ID, source refs, provenance, typed sections, and open gaps.
  Plan 2 may extend the content schema with the executable task/test DSL, but
  cannot make it an arbitrary object or accept inline scripts.
- `status` is persisted in Scope metadata and must agree with the Guide file
  and its revision.

### Lifecycle and mutation protocol

Use one closed `guide.update` ChangeSet kind with an action enum, rather than
an open object merge or a parallel configuration service:

```text
generate | submit_review | approve | reject | mark_stale | regenerate
```

The server derives the resulting state and target files. Legal transitions:

```text
generate:       absent -> generated
submit_review:  generated -> reviewed
approve:        reviewed -> approved
reject:         generated|reviewed -> rejected
mark_stale:     approved -> stale
regenerate:     stale|rejected -> generated
```

No caller-supplied status, approval metadata, revision, or target path is
trusted. `approve` requires the existing human approval path; autonomous guide
approval is rejected in Plan 1 because generation and approval must remain
separate trust boundaries.

Approval records actor, timestamp, ChangeSet hash, Guide revision, and content
hash. A later content change invalidates the old approval instead of mutating
the approved revision in place.

### Corte 0 gap resolution

The existing `guides/missing` gap is retained through generation, review, and
rejection. Only the server-owned `approve` transition may contribute to
resolving the Scope Guide gap; the gap is removed only when both the task and
test Guides are approved, in the same approved mutation that completes the
second Guide. A guide file appearing without those approved transitions cannot
clear the gap.

## Scope

### Included

- `guide.schema.json` and the Guide metadata definitions used by `scope.schema`.
- `guide.update` ChangeSet and operation-kind registration.
- Typed task/test Guide metadata in `scope.yml`.
- Canonical Guide YAML storage and file-plan/recovery integration.
- Server-owned lifecycle transitions and approval/revision binding.
- Validation of Scope, Guide, and Documentation Source references before apply.
- Query-only `check schema` validation for Guide files and metadata.
- Unit, adversarial, lifecycle, and CLI/E2E coverage for Plan 1.

### Explicitly excluded

- Source-driven generation and source selection heuristics.
- The complete executable task/test DSL and evaluator.
- Markdown rendering or projection drift detection.
- Custom generator execution, scripts, subprocesses, or provider adapters.
- Source fingerprint drift/staleness evaluation beyond accepting persisted
  provenance fields.
- Strict atomization enforcement and `check guides` diagnostics.
- Gate orchestration, environments, Release, Release Items, Work Packages,
  Tasks, Jira/MCP, Work Sources, Git execution, deployment, and task runtime.

## TDD implementation tasks

1. Add failing schema fixtures for Guide envelope, metadata, valid statuses,
   UUIDv7 identity, source refs, closed properties, and forbidden path/status
   claims.
2. Add the Guide schema and extend Scope/operation/ChangeSet schemas with the
   closed `guide.update` action contract and conditional payload fields.
3. Add failing lifecycle tests for every legal transition and every illegal
   transition, including direct generated->approved and approved->approved.
4. Add server render/validation logic that derives Guide IDs, revisions,
   content hashes, status, approval metadata, and target paths. Reject caller
   tampering and path escapes before apply.
5. Add a human-only approval guard and bind approval to the exact ChangeSet and
   Guide content revision. Prove autonomous approval cannot approve a Guide.
6. Add atomic rendering of the Guide YAML and Scope metadata, using existing
   file plans, locks, journal, stale detection, recovery, and events.
7. Add pre-apply relation checks for Scope identity, source IDs, duplicate
   Guide metadata, matching file/revision hashes, and the existing
   `guides/missing` gap. Reuse those checks in `check schema`.
8. Add lifecycle E2E coverage: generate -> validate -> human approve path
   through review -> approve -> apply; reject and regenerate; stale marker;
   gap remains until approval and resolves only after approval.
9. Regenerate schemas/runtime/test bundles and run the complete regression
   gates before updating this plan and the Corte 1 index.

## Adversarial review before implementation

- **Markdown source of truth:** Plan 1 never reads or writes Markdown as
  canonical state; projection is deferred to Plan 2.
- **Self-approval:** `approve` is a human-only Guide action; autonomous mode
  is rejected even when a caller supplies a trusted-looking actor string.
- **Approval binding:** server computes content/revision hashes and stores the
  approved revision; a different payload or content cannot reuse approval.
- **Second source registry/fingerprint engine:** Guide stores only source IDs
  and supplied provenance/fingerprint evidence; Discovery remains authoritative.
- **Scope duplication:** Guide stores `scopeId`, not a copied Scope document.
- **Open DSL/arbitrary merge:** payload action and document envelope are closed;
  no scripts, shell, or unbounded merge is accepted.
- **Gap handling:** generating, reviewing, rejecting, or marking stale does not
  remove the Corte 0 gap; only an approved server transition can resolve it.
- **Lifecycle holes:** transitions are an explicit finite state machine; no
  arbitrary status assignment is accepted.
- **Premature domains:** no Work Package, Task, Release, gate engine, strict
  executor, generator subprocess, or staleness evaluator is added.

## Traceability and completion criteria

| Criterion | Evidence required |
|---|---|
| Guide identity/storage | UUIDv7 Guide metadata and canonical YAML under the owning Scope |
| Closed schema | Generated validators reject extra fields, bad refs, paths, and statuses |
| Lifecycle | Legal transition matrix green; illegal transitions fail before apply |
| Human approval | Approval contains actor/time/ChangeSet hash/revision and is server-owned |
| Autonomous boundary | Autonomous Guide approval rejected; no actor string bypass |
| Gap semantics | `guides/missing` persists until approved transition and then resolves atomically |
| Runtime safety | ChangeSet, stale, lock, recovery, journal, event, and path tests remain green |
| Boundary | No generation, projections, generators, strict policy, Release, Work Package, or Task behavior |

## Regression gates

```text
npm ci
npm run build:schemas
npm run build:runtime
npm run build:test-bundle
npm run test:unit
npm run test:cli-e2e
npm run test:real-crash-e2e
npm run test:security-e2e
npm run test:bundle
npm run verify:artifacts
npm run verify:next-generation
git diff --check
```

## Definition of Done

- Guide domain and schemas are persisted through ChangeSets only.
- Every lifecycle transition is server-owned and tested.
- Approval is human-only, revision-bound, and cannot be spoofed.
- Documentation Source refs remain ID-only and resolve against Discovery.
- The Corte 0 guide gap is resolved only by approved Guide state.
- Existing Runtime Foundation, Discovery, autonomy, recovery, and security
  contracts pass all regression gates.
- The Completion Index marks Plan 1 implementation complete pending PR merge.
- A Draft PR targets `develop`; work stops before Plan 2.

## Implementation result

- [x] Guide schemas, metadata, canonical storage, and `guide.update` ChangeSet
  are implemented.
- [x] Server-owned UUIDv7 identity, revision/content hashes, provenance, and
  finite lifecycle transitions are implemented and tested.
- [x] Human-only approval binding and Corte 0 gap retention/resolution are
  implemented and tested.
- [x] Full unit suite and focused Guide lifecycle/schema tests are green.
- [x] Mandatory regression gates completed: `npm ci`, schema/runtime/test
  bundle builds, unit, CLI E2E, real crash E2E, security E2E, bundle,
  artifact, next-generation, and `git diff --check`.
- [x] Draft PR opened against `develop` as PR #18.
