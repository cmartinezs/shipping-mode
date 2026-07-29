# Corte 2 Plan 1 — Release Core

## 1. Current-State Audit

The repo is on `develop` after PR #20 merge. Corte 1 provides Scope and Guide
primitives, especially `evaluateGuideReadiness`, deterministic Guide
projections and query-only `check guides`.

Runtime primitives already available:

- UUIDv7 generation/validation in `runtime/src/lib/ids.mjs`;
- canonical hashing in `runtime/src/lib/canonical.mjs`;
- `propose -> validate -> approve -> apply` ChangeSets in
  `runtime/src/lib/changeset.mjs`;
- crash-safe publication, staging, recovery and immutable events;
- schema build/validation pipeline under `runtime/src/schemas/`;
- `check schema` query-only validation for initialized workspaces;
- `.planning/releases/` bootstrapped by Corte 0.

Missing for Release:

- `release.schema.json`;
- display ID derivation/resolution;
- `release.create` ChangeSet kind;
- Release renderer/comparator;
- `shipping-mode release new/status`;
- Release checks inside `check schema`;
- public `skills/release/SKILL.md`.

## 2. Release Aggregate Boundary

Release owns:

- identity and immutable display ID;
- title, objective, decorative slug;
- lifecycle status;
- configured lane and release policy reference;
- empty/future `scopeRefs` and `itemRefs` contracts;
- release-level blockers, risks and deployment event records;
- finalization metadata;
- creation/update audit metadata.

Release does not own or embed:

- Release Item payloads;
- Work Package payloads;
- Task payloads;
- Scope or Guide documents;
- Environment or Execution Context catalogs;
- Work Source provenance as canonical state.

Consistency rule:

```text
strong consistency inside Release
recomputed consistency across related aggregates
```

## 3. Exact Schema

Add `runtime/src/schemas/release.schema.json` as a closed schema.

Top-level fields:

```yaml
schemaVersion: 1
id: <uuidv7>
displayId: REL-<derived>
displayIdStatus: ACTIVE
slug: <decorative string or null>
title: <string>
objective: <string>
status: DRAFT | PLANNED | ACTIVE | VERIFYING | RELEASED | CANCELLED
lane:
  id: <host configured string>
policy:
  mode: strict_sequence | dependency_graph
  previousReleaseRefs: []
  dependencyRefs: []
scopeRefs: []
itemRefs: []
blockers: []
risks: []
deploymentEvents: []
finalization:
  completed: false
  completedAt: null
  completedBy: null
  retrospectiveStatus: not_started
audit:
  createdAt: <server timestamp>
  createdBy: <actor>
  updatedAt: <server timestamp>
  updatedBy: <actor>
  revision: sha256:<hash>
  operationId: <uuidv7>
```

Plan 1 validation rules:

- `additionalProperties: false` everywhere;
- `id`, `displayId`, lifecycle timestamps, status, audit and revision are
  server-owned;
- no `completion` or `readiness` fields;
- no embedded `items`, `workPackages`, `tasks`, `scopes`, `guides` or provider
  payloads;
- `itemRefs` starts empty and no mutation attaches children in Plan 1;
- relation arrays are UUIDv7 only;
- directory UUID and `release.id` must match;
- validate/apply must rebind `payload.operationId`, `target.releaseId`, actor and timestamps to the persisted Operation, and verify that `displayId` is derived from `release.id`;
- the normalized idempotency request hash is recomputed during validation rather than trusted from editable ChangeSet content.

## 4. Identity And Display-ID Algorithm

Primary identity:

```text
id = server-owned UUIDv7
```

Display ID:

```text
displayId = REL-<first 8 Crockford Base32 chars of SHA-256(UUID bytes)>
```

Collision handling before persist:

```text
REL-<8>
REL-<12>
REL-<16>
REL-<26>
REL-<52>
```

If the full UUID-derived token collides with a different Release, fail closed.

Rules:

- display ID is immutable;
- slug never participates in identity or resolution;
- cancellation does not free display ID;
- no global sequence such as `REL-001`;
- no identity from title, lane, scope or create order;
- raw UUIDv7 timestamp prefixes are not used because releases created in the same time window would collide systematically.

## 5. Storage Contract

Canonical storage:

```text
.planning/releases/<release-uuidv7>/
  release.yml
  README.md
```

Plan 1 must reject:

```text
.planning/releases/<display-id>/
.planning/releases/<slug>/
.planning/active/
.planning/finished/
.releases/
```

`release.yml` is canonical runtime state. `README.md` is a deterministic
projection and can be deleted/rebuilt from YAML.

## 6. Lifecycle State Machine

Plan 1 implements create only:

```text
create_release: initial -> DRAFT
```

The closed lifecycle contract is fixed now:

```text
DRAFT -> PLANNED
PLANNED -> ACTIVE
ACTIVE -> VERIFYING
VERIFYING -> RELEASED
VERIFYING -> ACTIVE
DRAFT|PLANNED|ACTIVE|VERIFYING -> CANCELLED
```

Terminal states:

```text
RELEASED
CANCELLED
```

No `BLOCKED`, `FINALIZED`, `ARCHIVED` or arbitrary transition status exists.

## 7. Transition Guard Matrix

| Transition | Guard implementable now | Guard dependent on Corte 3+ | Plan 1 behavior |
|---|---|---|---|
| create_release | Caller payload closed; title/objective; lane/policy reference shape; UUID/display ID uniqueness; target path absent | None | Fully functional |
| plan_release | Existing Release in DRAFT can be read | Scope readiness, item refs, dependency policy | Structurally defined only; not public mutation |
| activate_release | Existing lifecycle can be read | planned items/work packages/gates | Not public mutation |
| start_release_verification | Existing lifecycle can be read | required work complete | Not public mutation |
| release_release | Existing lifecycle can be read | readiness/gates/deployment evidence | Not public mutation |
| reopen_release | Existing lifecycle can be read | verification findings | Not public mutation |
| cancel_release | Reason/actor/timestamp evidence can be modeled | none for DRAFT/PLANNED; future downstream side effects | Deferred mutation; schema supports cancellation metadata later |

Any future public transition whose guard depends on missing aggregates returns a
structured capability finding and must not succeed by vacuous truth.

## 8. Derived-State Deferrals

Plan 1 status reports derived health available now:

- schema validity;
- projection match/drift;
- whether unsupported readiness dimensions are unavailable.

It must not compute false readiness from empty `itemRefs`, nor persist caller
controlled `completion` or `readiness`.

## 9. ChangeSet Kinds

Add only:

```text
release.create
```

Do not add `release.update`.

Project Context defaults are resolved once during `propose` and persisted in the server-owned ChangeSet payload. Validation and apply never re-read mutable defaults to decide the Release content.

Payload accepted from caller:

```yaml
title: string
objective: string
laneId: string?       # defaults from Project Context
policyMode: string?   # defaults from Project Context
slug: string?
idempotencyKey: string?
```

Server-owned payload fields:

```yaml
operationId
id
displayId
displayIdStatus
status
createdAt
createdBy
updatedAt
updatedBy
```

Target files:

```text
releases/<release-id>/release.yml
releases/<release-id>/README.md
```

Base revisions for both files must be `ABSENT`. Idempotency keys remain permanently bound to their first normalized request and Operation, including terminal `INVALID` or `STALE` outcomes; unreadable or multiply-bound records fail closed.

## 10. Projection Contract

Add:

```text
renderReleaseReadme(release)
compareReleaseReadme(release, currentReadme)
```

The README shows only values derivable from YAML:

- identity;
- title/objective;
- lifecycle;
- lane/policy;
- scope ref summary;
- item ref summary;
- blockers/risks summary;
- deployment summary;
- finalization summary.

Manual README edits produce drift findings but never change `release.yml`.

## 11. Query Contract

Implement:

```text
shipping-mode release status <id-or-display-id> --format json
```

The query is read-only. It does not create operations, events, fixes or
transitions.

JSON result includes:

```yaml
status: FOUND | NOT_FOUND | AMBIGUOUS | RECOVERY_REQUIRED
release:
  id
  displayId
  lifecycle
derivedHealth:
  schemaValid
  projection
  readiness:
    available: false
    unavailableDependencies: [...]
refs:
  scopeRefs
  itemRefs
findings: []
```

Resolution accepts UUIDv7 or display ID. Slug is not accepted as a resolver.

## 12. Events

Use existing immutable journal. `release.create` records `release.created`.

The event aggregate must be:

```yaml
aggregate:
  type: release
  id: <release-id>
```

The event payload includes previous/next status evidence:

```yaml
previousStatus: null
nextStatus: DRAFT
changeSetHash: <hash>
revisionBefore: ABSENT
revisionAfter: sha256:<release revision>
```

This is audit evidence, not event sourcing.

## 13. TDD Tasks

- Add unit tests for display ID derivation, collision extension, UUID/display
  resolution, ambiguous display ID fail-closed and slug non-resolution.
- Add schema tests for valid Release, arbitrary field rejection, caller-owned
  field rejection, embedded child payload rejection, invalid lifecycle rejection
  and directory/id mismatch through `check schema`.
- Add ChangeSet tests for propose/validate no-write, approval hash binding,
  stale base revisions, idempotency, create/create concurrency, crash after first
  canonical write, recovery, YAML+README publication and immutable event.
- Add projection tests for deterministic README, rebuild equality and manual
  drift.
- Add CLI E2E tests for `release new`, ChangeSet apply, `release status` by UUID
  and display ID, unknown ID and query-only behavior.
- Add regression assertions that no Release Items, Work Packages or Tasks are
  created.

## 14. Adversarial Findings And Corrections

| Finding | Correction |
|---|---|
| Release could become a monolithic root for future tree state | Schema stores refs and summaries only; no child payload fields |
| Display ID could become `REL-001`, path identity, or a truncated UUIDv7 timestamp | Derive a Crockford Base32 short-hash from UUID bytes and store under UUID directory only |
| Slug could become a resolver | Resolver accepts UUIDv7/display ID only |
| Empty Release could be declared releasable | Readiness reports unavailable dependencies and `available: false` |
| A generic `release.update` could bypass guards | Plan 1 adds only `release.create` |
| README could drift from YAML or become source of truth | Renderer/comparator are pure; query reports drift only |
| Deployment tracking could imply lifecycle released | Deployment records are deferred and never auto-transition lifecycle |
| Plan 1 could leak Corte 3 | No `items/`, `release-item.yml`, Work Packages or Tasks |
| Idempotency key could alias different requests or differ by entrypoint | Bind the key to a server-owned request hash inside the workspace mutation lock for both `release new` and generic `changeset propose` |
| `release status` could crash or trust a valid-looking corrupted aggregate | Safe resolver and shared schema/identity/revision integrity checks fail closed |
| Project Context defaults could change between validate and apply | Resolve lane/policy at propose time and bind them into the ChangeSet/idempotency request hash |

No production blocker remains after these corrections.

## 15. Plan 2/3 Deferrals

Plan 2 owns:

- release sequence/dependency policy;
- lane validation against host config;
- `scopeRefs` guide revision index using `evaluateGuideReadiness`;
- execution context and deployment environment refs;
- deployment event records.

Plan 3 owns:

- completion/readiness derived evaluation;
- finalization mutation;
- `check release`;
- projection/report closure;
- Corte 2 DoD and full E2E audit.

## 16. Regression And DoD Matrix

Plan 1 is complete when:

- `release.create` creates exactly `release.yml` and `README.md` under UUIDv7
  storage plus one immutable event;
- `release status` is query-only and resolves UUID/display ID equivalently;
- `check schema` validates releases and projection drift without readiness
  execution;
- no Release Item, Work Package or Task storage exists;
- Corte 0 and Corte 1 public flows remain green.

Required verification:

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
