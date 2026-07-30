# Corte 2 Plan 3 — Derived Health And Corte 2 Closure

## 1. Current-State Audit

Base verified for this plan: `origin/develop` at PR #22 merge
`3f90c9c8ca3a8d9e8209b5a871bc125fc080cba4`. PR #21 and PR #22 are merged
into `develop`.

Implemented before Plan 3:

- Plan 1: closed `release.yml`, UUIDv7 storage, deterministic display ID,
  `release.create`, deterministic README projection, `release status`,
  Release checks in `check schema`, immutable `release.created` event.
- Plan 2: configured lanes, `strict_sequence` and `dependency_graph` policy,
  scope guide evidence snapshots, execution-context refs, environment refs,
  deployment event records and Plan 2 trust-boundary checks.

Remaining Corte 2 gap:

- `release status` still reports placeholder readiness.
- There is no shared derived health evaluator.
- There is no public `shipping-mode check release`.
- Finalization exists in schema as metadata but has no audited mutation.
- Corte 2 index still marks Plan 2 pending merge and Plan 3 pending.

## 2. Boundary

Plan 3 owns:

- pure derived Release health;
- completion/readiness reporting with explicit unavailable capabilities;
- `release status` using the shared health evaluator;
- query-only `check release`;
- narrow finalization mutation;
- immutable finalization event;
- documentation and public skill updates;
- final Corte 2 DoD audit.

Plan 3 does not implement Release Items, `release-item.yml`, Work Packages,
Tasks, Work Sources, gates, Git execution, deployment execution, lifecycle
transition engine, release notes, retrospective AI, release trains,
`release.update`, or persisted completion/readiness.

## 3. Derived Health Model

`runtime/src/lib/releaseHealth.mjs` evaluates health from current canonical
sources only. It is side-effect free, deterministic, ordered and query-only.

Each dimension returns:

```yaml
id: <stable dimension id>
status: valid | failed | unavailable | invalid
summary: <human summary>
evidence: {}
findings: []
```

Meaning:

- `valid`: the capability exists and the condition is satisfied.
- `failed`: the capability exists and the condition is not satisfied.
- `unavailable`: the capability is not implemented or no current evidence is
  selected; it is not approval by vacuous truth.
- `invalid`: canonical state is corrupt, unsafe or schema-invalid.

The aggregate status is:

```text
invalid > failed > partial > valid
```

`partial` means no current failure was found, but at least one dimension is
unavailable.

## 4. Evaluated Dimensions

Plan 3 evaluates:

- `structure`: release schema validity.
- `identity`: directory UUID and `release.id`.
- `displayId`: display ID derived from UUIDv7.
- `revision`: canonical `audit.revision`.
- `projection`: README drift against deterministic render from `release.yml`.
- `lane`: lane exists in Project Context config.
- `policy`: global sequence/dependency catalog consistency.
- `scope`: scope refs exist and persisted guide-readiness evidence is ready.
- `refs`: execution-context and environment refs resolve and lane-compatible.
- `deployment`: deployment event evidence exists, resolves and includes a
  succeeded event with artifact or evidence refs.
- `blockers`: open blockers prevent readiness; risks are visible warnings.
- `finalization`: finalization metadata consistency.
- `futureCapabilities`: Corte 3+ Release Item, Work Package, Task and gate
  capability status.

## 5. States And Finding Codes

Primary Plan 3 finding codes:

```text
RELEASE_SCHEMA_INVALID
RELEASE_REVISION_INVALID
RELEASE_ID_DIRECTORY_MISMATCH
RELEASE_DISPLAY_ID_INVALID
RELEASE_PROJECTION_DRIFT
LANE_INVALID
POLICY_VIOLATION
CAPABILITY_UNAVAILABLE
INVALID_REFERENCE
CATALOG_CORRUPT
GUIDE_EVIDENCE_STALE
SCOPE_NOT_READY
DEPLOYMENT_EVIDENCE_MISSING
DEPLOYMENT_EVIDENCE_INVALID
BLOCKER_OPEN
RISK_OPEN
FINALIZATION_INVALID
```

Plan 2 policy and catalog codes are preserved where they are the canonical
source (`CYCLE_DETECTED`, `DUPLICATE_REFERENCE`, `SELF_REFERENCE`,
`REFERENCE_STALE`, `AMBIGUOUS_REFERENCE`).

## 6. `release status` Contract

`shipping-mode release status <id-or-display-id>` remains query-only.

Response includes:

```yaml
status:
release:
derivedHealth:
completion:
readiness:
policy:
refs:
deployment:
finalization:
findings:
```

It resolves UUIDv7 and display ID only. Slug is not a resolver. It does not
create Operations, ChangeSets or Events, does not repair README, does not
rewrite YAML, does not update revisions and does not finalize.

## 7. `check release` Contract

Syntax:

```text
shipping-mode check release [id-or-display-id] --format json
```

The reference is optional. With a reference, it evaluates one Release. Without a
reference, it evaluates the Release catalog, matching `check guides` behavior
for whole-catalog checks.

Exit status:

- `0`: `PASS`.
- `1`: `FAIL`, `NOT_INITIALIZED`, `NOT_FOUND`, `AMBIGUOUS` or
  `RECOVERY_REQUIRED`.
- `3`: unsupported command.

`check release` uses the same evaluator as `release status`, reports structured
findings, fails controlled for missing/ambiguous/corrupt/recovery-required
state, detects global policy/catalog inconsistencies and projection drift, and
never repairs anything.

## 8. Finalization Contract

ChangeSet kind:

```text
release.finalization.complete
```

Allowed caller fields:

```yaml
releaseRef: <uuidv7 or display ID>
retrospectiveStatus: not_started | draft | approved | not_required
idempotencyKey: <string>
```

Mutated canonical fields only:

```yaml
finalization:
  completed: true
  completedAt: <server Operation proposedAt>
  completedBy: <server Operation proposedBy>
  retrospectiveStatus: <caller value or not_required>
```

Finalization is metadata, not lifecycle. It never creates `FINALIZED` or
`ARCHIVED`, never changes lifecycle and never executes retrospective AI.

Lifecycle guard matrix:

| Lifecycle | May finalize | Reason |
|---|---:|---|
| `DRAFT` | No | Scope, readiness and release evidence are not complete. |
| `PLANNED` | No | Execution has not started or completed. |
| `ACTIVE` | No | Work may still be in progress. |
| `VERIFYING` | No | Verification has not produced `RELEASED`. |
| `RELEASED` | Yes, if current evaluable guards pass | Release has passed release lifecycle; finalization may close metadata. |
| `CANCELLED` | No | Cancellation is terminal but not release completion. |

Unavailable Corte 3+ capabilities are reported in health but are not treated as
approval. Current evaluable failures still block finalization.

## 9. ChangeSet Kinds

Plan 3 adds:

```text
release.finalization.complete
```

Existing kinds retained:

```text
release.create
release.policy.configure
release.scopeRefs.set
release.operationalRefs.set
release.deployment.record
```

No `release.update` is introduced.

## 10. Immutable Events

Applied finalization publishes:

```text
release.finalization.completed
```

Event payload includes Release ID, display ID, operation ID, idempotency key,
ChangeSet hash, revision before/after, lifecycle status, previous and next
finalization metadata, derived guard summary and server-owned timestamp through
the existing immutable event document.

Events remain audit records, not event sourcing. `release.yml` is canonical.
Crash recovery and idempotent publication use the existing manifest and
`writeEventIdempotent` path.

## 11. Idempotency Rules

- Exact retry returns the original Operation.
- Same key with different normalized intent fails.
- Keys bound to `INVALID` or `STALE` Operations remain reserved.
- Corrupt, unreadable or multiply-bound ChangeSets fail closed.
- Request hash includes actor, kind and normalized caller snapshot.
- Operation request binding and proposal hash are server-owned.

## 12. Trust Boundaries

The caller cannot provide:

```text
actor
timestamp
audit
revision
operationId
eventId
ChangeSet hash
release target after resolution
finalization.completedAt
finalization.completedBy
derived health
findings
completion
readiness
guard evidence
```

Editing `change-set.json` and recomputing its public hash cannot falsify these
values because validate/apply compare against the Operation proposal hash,
request binding, server actor/timestamp, current release revision and
recomputed guard summary.

## 13. Concurrency Rules

- Proposal, validation and apply run under the workspace mutation lock.
- `baseRevisions` include exactly target `release.yml` and `README.md`.
- `config.yml` and release revision observed at propose are rechecked.
- Validate and apply recompute guards.
- Release revision drift between propose/validate/apply produces `STALE`.
- Config/reference drift affecting guard summary produces `STALE`.

## 14. Projection Versus Live Report

Responsibilities remain separated:

```text
release.yml  = canonical persisted Release state
README.md    = deterministic projection from release.yml only
status/check = live report derived from Release plus external refs
```

Derived health from Scope, Guide, Environment, Execution Context or deployment
catalog files is never written into README.

## 15. Guard Matrix

| Guard | Status/check | Finalization |
|---|---|---|
| Schema valid | Report `invalid` | Block |
| Directory/id match | Report `invalid` | Block |
| Display ID derived | Report `invalid` | Block |
| Revision valid | Report `invalid` | Block |
| README projection drift | Report `failed` | Block |
| Lane configured | Report `failed` | Block |
| Policy catalog valid | Report `failed` | Block |
| Scope refs ready | Report `failed` | Block |
| Operational refs valid | Report `failed`/`invalid` | Block |
| Deployment evidence valid | Report `failed` | Block |
| Open blockers | Report `failed` | Block |
| Risks | Report warning | Do not block by themselves |
| Future Corte 3+ capabilities | Report `unavailable` | Do not approve by vacuous truth |
| Already finalized | Report finalization metadata | Block duplicate finalization |

## 16. TDD Tasks

- Unit: deterministic derived health, empty `itemRefs`, projection drift.
- Command integration: status uses shared health, `check release` single/catalog
  paths, slug rejection, finalization lifecycle guard, finalization event.
- CLI E2E: public `check release`, finalization guard failure, query-only
  behavior.
- Security: Plan 2 tamper coverage retained; Plan 3 uses proposal hash,
  request binding and finalization-specific invariants.
- Bundle: regenerated runtime and validators.

## 17. Adversarial Cases

Plan 3 must fail closed for:

- invalid schema;
- invalid revision;
- directory/id mismatch;
- display ID ambiguity;
- projection drift;
- stale config/reference/release revisions;
- missing/corrupt Scope, Execution Context or Environment refs;
- deployment event release mismatch;
- deployment evidence without succeeded evidence/artifact refs;
- open blockers;
- caller-provided completion/readiness/health/findings;
- caller-provided completedAt/completedBy;
- tampered request snapshot;
- tampered finalization state;
- tampered guard summary/hash;
- recomputed public ChangeSet hash;
- exact retry and conflicting idempotency key reuse.

## 18. Regression Matrix

Required regression suites:

```text
npm run test:unit
npm run test:cli-e2e
npm run test:real-crash-e2e
npm run test:security-e2e
npm run test:bundle
npm run verify:artifacts
npm run verify:next-generation
git diff --check
```

Plan 1 and Plan 2 public commands remain compatible. Corte 0/Corte 1 checks,
schema build, crash recovery, security and bundle tests remain in scope.

## 19. Corte 2 Definition Of Done

Corte 2 is implementation-complete when:

- Release is a closed canonical aggregate.
- Identity, storage and projection are deterministic.
- Policy and operational references are valid.
- Derived health is honest and does not use vacuous truth.
- Completion/readiness report missing Corte 3+ capabilities explicitly.
- Finalization is audited, narrow and idempotent.
- `release status` and `check release` are query-only.
- `check schema` and `check release` detect relevant corruption.
- Events are immutable and idempotently published.
- Crash recovery covers finalization through the existing ChangeSet pipeline.
- No Corte 3/Corte 4 entities are introduced.
- Generated artifacts match source.
- Documentation and public skills are updated.

## 20. Explicit Corte 3+ Exclusions

Deferred as structured `CAPABILITY_UNAVAILABLE`, not approved:

- Release Items and `release-item.yml`;
- Work Packages;
- Tasks;
- Work Sources;
- gate execution;
- Git branch/worktree execution;
- deployment execution;
- environment provisioning;
- lifecycle transition engine;
- release notes;
- retrospective AI;
- release trains;
- parallel release execution;
- generic `release.update`.

## 21. Post-review Corrections

Adversarial review of PR #23 closed four material gaps:

- Scope/Guide health now rebuilds current canonical evidence instead of trusting the persisted readiness snapshot; stale guide content, metadata or source evidence is reported as `GUIDE_EVIDENCE_STALE` and blocks finalization.
- Finalization guard summaries include a deterministic health/evidence revision. Changes to Scope/Guide, Environment or Execution Context documents stale the operation even when their boolean health result remains unchanged.
- Whole-catalog `check release` retains parse/schema-invalid Release records and reports them structurally instead of silently omitting them or dereferencing missing fields.
- `check release --format json` is parsed as an option for both single and catalog checks; unsupported formats and extra positional arguments fail with a controlled usage error.

Required Project Context state and selected operational references are not treated as vacuously satisfied capabilities. Only explicitly deferred Corte 3+ completion capabilities remain non-blocking for current Release health.
