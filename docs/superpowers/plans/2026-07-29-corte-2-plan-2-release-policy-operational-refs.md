# Corte 2 Plan 2 — Release Policy And Operational References

## 1. Current-State Audit

Base local: `origin/develop` after PR #21 merge (`9a860e5`). Plan 1 merged
Release core into `develop` with UUIDv7 storage, deterministic display IDs,
closed `release.yml`, deterministic `README.md`, `release.create`,
`shipping-mode release new/status`, `check schema` Release checks and immutable
`release.created` events.

Runtime primitives available now:

- schema build/validation for `config`, `scope`, `guide`, `release`,
  `operation`, `change-set`, `event` and `result`;
- Project Context persisted in `.planning/config.yml`;
- workspace mutation lock and crash recovery around every ChangeSet phase;
- idempotency binding inside `propose`;
- exact `baseRevisions` and stale detection in validate/apply;
- atomic publication of rendered file sets;
- immutable event journal under `.planning/events/YYYY/MM/<event-id>.json`;
- `evaluateGuideHealth` and `evaluateGuideReadiness` from Corte 1;
- Release resolver by UUIDv7/display ID only.

Relevant gaps and differences:

- `config.schema.json` only allows `policies.release.mode =
  strict_sequence` and has no lane catalog. Plan 2 must extend this to
  `strict_sequence | dependency_graph` plus a closed configured lane list.
- `release.schema.json` already contains `previousReleaseRefs`,
  `dependencyRefs`, `scopeRefs` and `deploymentEvents`, but Plan 1 did not
  validate their operational meaning. `scopeRefs` lacks guide-readiness
  evidence, and deployment refs are strings rather than catalog-backed refs.
- `.planning/execution-contexts/` and `.planning/environments/` exist from
  Corte 0 topology, but there is no schema or public catalog mutation for their
  entries. Plan 2 adds minimal closed catalog-entry schemas and validates refs
  when entries exist; it does not implement provisioning or execution.
- `release status` reports dependency arrays but does not evaluate policy
  consistency, scope guide evidence, operational refs or deployment summaries.
- Existing ChangeSet code can support Plan 2 by adding specific kinds and
  renderers; no generic `release.update` is needed.

Canonical contracts prevail over Plan 1 placeholders. The implementation must
close the runtime/schema differences above without advancing Release Items,
Work Packages, Tasks, final readiness, `check release` or deployment execution.

## 2. Boundary

Plan 2 owns only:

- release sequence and dependency policy references;
- lane validation against Project Context configuration;
- scope references with versioned Guide readiness evidence;
- execution-context refs;
- deployment-environment refs;
- auditable deployment event records.

Plan 2 does not implement:

- Release Items, Work Packages, Tasks or `itemRefs` mutation;
- lifecycle transitions beyond `release.create`;
- completion/readiness final truth;
- finalization mutation;
- `check release`;
- gate, Git, environment or deployment execution;
- Work Source providers, import/sync, release notes or retrospective AI.

## 3. Release Aggregate Invariants

Release remains a local aggregate with strong consistency inside `release.yml`
and recomputed consistency across related aggregates. It stores canonical IDs
and release-owned records only. It must not embed Scope, Guide, Environment,
Execution Context, Release Item, Work Package or Task payloads.

Every Plan 2 mutation targets exactly:

```text
releases/<release-uuidv7>/release.yml
releases/<release-uuidv7>/README.md
```

Both files are rendered in one ChangeSet publication unit. Manual README edits
produce drift only; README is never parsed to mutate YAML.

## 4. Exact Schema Changes

Extend `config.schema.json`:

```yaml
policies:
  release:
    mode: strict_sequence | dependency_graph
    defaultLane: <lane id>
    lanes:
      - id: <lane id>
        label: <string or null>
```

`defaultLane` must reference exactly one configured lane. Lane IDs are host
planning IDs, not Git branches.

Add minimal closed schemas:

```text
execution-context.schema.json
environment.schema.json
```

Canonical storage for entries:

```text
.planning/execution-contexts/<id>/execution-context.yml
.planning/environments/<id>/environment.yml
```

Extend `release.schema.json`:

- `scopeRefs[]` includes `scopeId`, `evaluatedAt`, `readiness`,
  exact task/test Guide evidence and structured findings.
- `executionContextRefs[]` and `environmentRefs[]` are arrays of canonical IDs.
- `deploymentEvents[]` uses UUIDv7 `environmentRef`, optional UUIDv7
  `executionContextRef`, server-owned `id`, `releaseId`, timestamps, actor and
  `operationId`.

No `completion` or `readiness` top-level fields are introduced.

## 5. Reference Contracts

All Release relationships in Plan 2 use UUIDv7 IDs. Public commands may accept
Release UUIDv7 or display ID for the target Release only. Related Releases,
Scopes, Execution Contexts and Environments are canonical UUIDv7 refs.

Reference findings use structured codes:

- `INVALID_REFERENCE`;
- `CAPABILITY_UNAVAILABLE`;
- `CATALOG_CORRUPT`;
- `REFERENCE_STALE`;
- `AMBIGUOUS_REFERENCE`;
- `DUPLICATE_REFERENCE`;
- `SELF_REFERENCE`;
- `POLICY_VIOLATION`;
- `CYCLE_DETECTED`;
- `LANE_INVALID`;
- `GUIDE_EVIDENCE_STALE`.

Existing Guide finding codes from Corte 1 are reused inside scope evidence
instead of duplicating guide-health semantics.

## 6. `strict_sequence`

`strict_sequence` is an explicit singly linked sequence per lane.

Rules:

- `previousReleaseRefs` has length 0 or 1.
- `dependencyRefs` must be empty.
- zero predecessors is valid only when there is no other structurally valid,
  non-`CANCELLED` Release in the same lane.
- one predecessor is required when another non-`CANCELLED` Release already
  exists in the same lane.
- the predecessor must exist, be structurally valid, use `strict_sequence`, be
  in the same lane and not be `CANCELLED`.
- a predecessor cannot already have another non-`CANCELLED` successor in the
  same lane.
- self references and duplicates fail closed.

Cancelled Releases keep identity/history/display ID, but they do not satisfy
or occupy active sequence links. Re-releasing a cancelled Release is still
impossible because lifecycle terminality belongs to the state machine.

## 7. `dependency_graph`

`dependency_graph` uses `dependencyRefs` only.

Rules:

- `previousReleaseRefs` must be empty.
- every dependency ref is a UUIDv7 Release ID;
- no self-dependency;
- no duplicates;
- every referenced Release must exist and be structurally valid;
- `CANCELLED` dependencies are invalid;
- direct and indirect cycles are rejected deterministically;
- graph traversal sorts IDs before visiting, so filesystem order cannot affect
  findings.

Plan 2 validates graph structure. It does not declare dependencies satisfied or
derive releasability; Plan 3 owns readiness semantics.

## 8. Lane Validation

Lanes are configured in Project Context:

```yaml
policies.release.lanes[].id
```

Validation fails closed when:

- the config is missing, unparsable or schema-invalid;
- the lane list is missing, empty, duplicate or ambiguous;
- `defaultLane` is not one configured lane;
- the requested lane does not exist;
- `config.yml` is a symlink or changes between propose, validate and apply;
- the caller tries to set server-owned Release fields.

Defaults are resolved during propose and frozen into the ChangeSet payload and
idempotency hash. A retry with the same idempotency key returns the original
operation and never reinterprets defaults from a changed config.

## 9. Scope And Guide Revisions

`release.scopeRefs.set` accepts a target Release and a closed list of Scope
UUIDv7 IDs. The renderer recomputes evidence from canonical Scope and Guide
files during propose, validate and apply.

Each persisted scope ref records:

- `scopeId`;
- `evaluatedAt` server timestamp;
- `readiness.policyMode`;
- `readiness.ready`;
- task/test Guide IDs, revisions, content hashes, states and usability;
- structured findings from `evaluateGuideReadiness`.

If Scope, Guide YAML, Guide metadata or Guide projection changes after propose,
the operation becomes `STALE` through base revision mismatch or explicit
evidence mismatch. Empty scope lists are allowed only as "no scope selected";
they are never evidence of readiness.

## 10. Execution Context References

`release.operationalRefs.set` may set `executionContextRefs`.

Execution Context refs resolve against:

```text
execution-contexts/<uuidv7>/execution-context.yml
```

The entry must be a real non-symlink directory/file, schema-valid and
`entry.id` must match the directory. Missing catalog directory produces
`CAPABILITY_UNAVAILABLE`; corrupt catalog produces `CATALOG_CORRUPT`; missing
ID produces `INVALID_REFERENCE`; change between validate/apply produces
`REFERENCE_STALE`.

## 11. Environment References

`release.operationalRefs.set` may set `environmentRefs`. Deployment records
also require a valid `environmentRef`.

Environment refs resolve against:

```text
environments/<uuidv7>/environment.yml
```

They follow the same path, schema, identity, ambiguity and stale guarantees as
Execution Context refs. Plan 2 records optional `laneRefs` compatibility on
environment entries; if present, the Release lane must be included.

## 12. Deployment Event Records

`release.deployment.record` records release-owned deployment evidence. It does
not execute deployments and never changes lifecycle.

Caller payload:

```yaml
releaseRef: <uuidv7 or display ID>
environmentRef: <environment uuidv7>
executionContextRef: <execution-context uuidv7 or null>
status: planned | started | succeeded | failed | cancelled
artifactRefs: []
evidenceRefs: []
completedAt: <optional observed timestamp for completed statuses>
idempotencyKey: <optional>
```

Server-owned fields:

```yaml
id
releaseId
startedAt
actor
operationId
eventId
changeSetHash
release revision
operation status
```

Duplicate deployment records with the same server-owned ID are impossible; an
idempotency retry returns the original operation. A successful deployment event
does not imply `VERIFYING` or `RELEASED`.

## 13. ChangeSet Kinds And Commands

Plan 2 adds specific kinds:

```text
release.policy.configure
release.scopeRefs.set
release.operationalRefs.set
release.deployment.record
```

Public commands:

```text
shipping-mode release policy configure <id-or-display-id> ...
shipping-mode release scope set <id-or-display-id> ...
shipping-mode release refs set <id-or-display-id> ...
shipping-mode release deployment record <id-or-display-id> ...
```

Generic `changeset propose --kind ...` supports the same closed payloads for
tests and host integrations. No `release.update` is introduced.

## 14. Immutable Events

Events:

```text
release.policy.configured
release.scopeRefs.set
release.operationalRefs.set
release.deployment.recorded
```

Each event uses aggregate `{ type: "release", id: <release-id> }` and includes
operation ID, actor, ChangeSet hash, previous/next release revision, previous
and next policy/ref/deployment summaries as applicable. Events are audit
records only; YAML remains canonical state.

## 15. Idempotency

Each Plan 2 ChangeSet payload includes `idempotencyKey` and
`idempotencyRequestHash`. The hash is computed from normalized caller intent
and actor, with resolved defaults frozen at propose time where defaults exist.
The same key plus same hash returns the first operation. Same key plus different
hash fails closed. Unreadable or multiply-bound operations fail closed.

## 16. Concurrency And Locking

All Plan 2 propose/validate/apply phases run under the existing workspace
mutation lock. Validation and apply re-render from current canonical refs. Base
revision mismatch produces `STALE`; corrupt catalogs produce `INVALID`.
Concurrent legitimate creates still use UUIDv7 and do not require a global
sequence lock.

## 17. Validation, Approval And Apply

Validate:

- recomputes ChangeSet hash;
- validates ChangeSet schema;
- checks target identity and exact base revision set;
- resolves Release, Project Context, Scope/Guide/catalog refs;
- renders YAML+README in memory;
- validates rendered Release schema.

Approve remains bound to the exact validated hash. Apply repeats the same
checks under lock, stages both files, publishes atomically, writes immutable
events and marks the Operation `APPLIED`.

## 18. README Projection

`renderReleaseReadme` is extended to include:

- policy mode, previous refs and dependency refs;
- configured lane;
- scope-guide evidence summary;
- execution-context refs;
- environment refs;
- deployment event summary.

The comparator stays pure.

## 19. Queries And JSON

`shipping-mode release status <id-or-display-id>` remains query-only and
returns Plan 2 refs/findings:

```yaml
release:
  policyMode
  laneId
refs:
  previousReleaseRefs
  dependencyRefs
  scopeRefs
  executionContextRefs
  environmentRefs
deployment:
  count
  events
findings: []
```

It does not create Operations, ChangeSets, events or repairs.

## 20. Findings And Errors

Commands return structured `UsageError`/`StateError` messages and query
findings with stable codes. `release status` can report unavailable catalog
capabilities without mutating state. Mutating operations fail closed instead of
recording unverifiable refs.

## 21. Adversarial Matrix

| Risk | Correction |
|---|---|
| Release becomes global tree aggregate | Store only IDs and release-owned deployment records |
| `strict_sequence` inferred from filesystem order | Use explicit predecessor refs and sorted deterministic validation |
| Empty refs imply readiness | Plan 2 validates structure only; readiness stays unavailable |
| Lane treated as Git branch | Lane catalog is Project Context planning config |
| Env equals execution context | Separate schemas, dirs and refs |
| Deployment record auto-transitions lifecycle | Renderer preserves `release.status` |
| Slug/display ID used for relations | Related refs are UUIDv7 only |
| Generic update bypasses guards | Four specific ChangeSet kinds only |
| Catalog or Guide changes after validation | Exact base revisions and evidence revalidation mark stale |
| Provider payloads leak into Release | Deployment refs/evidence are closed strings and UUIDs only |

## 22. Ordered TDD Tasks

1. Add schema tests for release Plan 2 shape, config lanes, execution contexts
   and environments.
2. Add unit tests for lane validation, release policy validation and cycle
   detection.
3. Add renderer/projection tests for Plan 2 summaries.
4. Add ChangeSet tests for policy configure, scope refs, operational refs and
   deployment record.
5. Add CLI E2E tests for happy paths and structured failures.
6. Add crash/security regression coverage for release Plan 2 operations.
7. Run full regression and artifact verification.

## 23. Regression Matrix

Plan 2 must keep green:

- `release new/status`;
- `check schema`;
- `check guides`;
- `scope.generator.set`;
- Discovery ChangeSets;
- crash recovery;
- security/path confinement;
- bundle self-contained verification.

It must not create:

- `release-item.yml`;
- Work Packages;
- Tasks;
- deployment execution;
- gate execution;
- Git execution;
- finalization/report artifacts.

## 24. Definition Of Done

Done when:

- this plan exists and the Corte 2 Index marks Plan 1 complete and Plan 2 in
  progress/pending PR merge;
- schemas and runtime implement Plan 2 only;
- new ChangeSet kinds are closed and idempotent;
- `release status` and README projection expose Plan 2 refs deterministically;
- all mandatory verification commands pass;
- branch is pushed and a Draft PR targets `develop`.

## 25. Deferrals

Plan 3 owns derived completion/readiness, finalization mutation,
`shipping-mode check release`, projection/report closure and Corte 2 DoD.

Corte 3+ owns Release Items, Work Packages, Tasks, Work Sources, provider
imports/sync, gates over work packages, release notes from items and
traceability from item provenance.

Corte 4+ owns task execution, Git branch/worktree execution, deployment
execution and environment provisioning.

## 26. Post-review Corrections

Adversarial review of PR #22 found and closed two trust-boundary gaps:

- Release Plan 2 Operations now retain a server-owned request binding and proposal hash. Editing a persisted ChangeSet and recomputing its public hash cannot change caller intent, actor, timestamps, generated deployment identity or resolved Release targets before validation.
- Release policy validation now evaluates the complete Release catalog. Reconfiguring a sequence root or predecessor cannot orphan existing successors, create multiple roots, introduce branching or hide a cycle. `check schema` reports these global policy inconsistencies.

The corrections preserve the Plan 2 boundary and do not add lifecycle transitions, deployment execution, Release Items, Work Packages, Tasks, final readiness or finalization.

