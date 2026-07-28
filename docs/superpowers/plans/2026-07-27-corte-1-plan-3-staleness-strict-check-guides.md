# Corte 1 Plan 3 — Guide Staleness, Strict Readiness and `check guides`

## Objective

Close the operational trust boundary for Guides without implementing Corte 2.
The runtime will derive effective Guide health from canonical YAML, source
catalog state, provenance, approval binding and the deterministic Markdown
projection. It will expose a pure strict/advisory readiness decision and the
query-only command `check guides`.

## Current-state audit

Post-PR19 (`develop` at `98e82de`) already provides:

- finite Guide lifecycle and server-owned identity in `guide.update`;
- source fingerprints, generation input/output hashes and generator evidence;
- schema and metadata checks in `check schema`;
- deterministic projection renderer and pure projection comparison;
- ChangeSet-controlled `mark_stale`;
- generic/custom generation with no direct canonical writes.

The remaining gap is that no shared runtime primitive currently evaluates
effective freshness/readiness, compares current source/config/generator state
with Guide provenance, or exposes `check guides`.

## Scope

### In scope

1. `evaluateGuideHealth`, including deterministic finding codes and stable order.
2. Current source, Project Context source refs, Guide content, approval,
   generator and projection comparisons.
3. `evaluateGuideReadiness` with caller-declared required Guide kinds and
   `strict`/`advisory` modes.
4. Public `check guides`, with optional scope selection if consistent with the
   existing CLI, and `PASS`/`WARN`/`FAIL`/`RECOVERY_REQUIRED` semantics.
5. Tests for query-only behavior, drift, approval integrity and readiness.
6. Final Corte 1 traceability/DoD documentation.

### Explicitly out of scope

- automatic `mark_stale`, regeneration, review or approval;
- generator execution from health checks;
- timestamp-based freshness;
- a second fingerprint/hash algorithm;
- generic waivers or `--force` bypasses;
- Release, Release Item, Work Package, Task, atomization or execution;
- Gate execution, environment execution, Work Sources, Jira/MCP and Git execution.

## Decisions

- `check guides` is query-only and creates no files, Operations or Events.
- Persisted `status` and effective health remain separate. An approved Guide
  with current drift is reported as `approved_stale` and is unusable in strict
  mode even before `mark_stale` is persisted.
- Existing Discovery `confirmedFingerprint` and Guide provenance hashes are the
  only freshness evidence. A source missing, unconfirmed, unavailable or no
  longer approved is a structured blocking finding.
- Current generator comparisons apply only to custom/generic provenance. Manual
  Guides do not become stale merely because a generator is configured.
- The current generation input is reconstructed from the same approved source
  refs, scope data and DSL/schema versions used by Plan 2. Unreconstructable
  required evidence fails closed.
- Open gaps are warnings unless a future canonical policy makes a category
  blocking. Their text is never parsed to infer severity.
- Recovery-required workspace state takes precedence over Guide findings.

## Adversarial review

The design was reviewed against the following blockers before implementation:

- trusting only `status: approved`;
- accepting source drift before a persisted stale transition;
- mutating from `check guides`;
- running custom generators during checking;
- using timestamps as freshness;
- duplicating Discovery fingerprints or approval binding;
- treating Markdown as canonical;
- marking every config change stale;
- globally blocking unrelated operations;
- using free-form gap text as policy;
- adding generic waivers or future aggregates.

The implementation must fail closed on schema, approval, source-reference,
projection and recovery integrity errors, while advisory mode reports findings
without blocking.

## TDD tasks

1. Add pure health tests for missing/invalid/generated/reviewed/rejected,
   approved-current, source drift, missing/unconfirmed source, source removal
   from Project Context, content/revision mismatch, approval mismatch,
   generator drift, and projection drift.
2. Add readiness tests proving only caller-required kinds block strict mode,
   advisory mode never blocks, open gaps warn, and recovery state wins.
3. Add `check guides` tests proving stable machine-readable output, deterministic
   finding order, scope filtering, and no filesystem/operation/event mutation.
4. Add CLI coverage and expose the pure primitives from the runtime entrypoint.
5. Regenerate schemas/runtime/test bundles and add final traceability evidence.

## Definition of Done

- effective health is deterministic and explainable;
- strict readiness blocks every invalid or stale required Guide;
- advisory readiness reports without blocking;
- `check guides` is query-only and does not execute generators;
- source, approval, generator and projection drift are covered;
- recovery-required is fail-closed;
- no Plan 3 implementation leaves `PARTIAL` or `MISSING` without an explicit
  canonical deferral;
- all required regression gates pass;
- the Index says Plan 3 implementation complete pending PR merge and Corte 1
  remains open.

## Completion Matrix

| Requirement | Evidence | Status |
|---|---|---|
| Effective health is deterministic and explainable | `runtime/src/lib/guideHealth.mjs`; `guide-health.test.mjs` | DONE |
| Source fingerprint, source approval and source availability drift | `GUIDE_SOURCE_*` findings and health tests | DONE |
| Approval revision/content binding | `guideHealth.mjs`; existing lifecycle tests plus health tests | DONE |
| Generator/configuration drift without generator execution | `guideHealth.mjs`; Plan 2 generator tests and health tests | DONE |
| Projection missing/drift detection | `compareGuideProjection`; health tests | DONE |
| Strict/advisory readiness with caller-declared kinds | `evaluateGuideReadiness`; health tests | DONE |
| Query-only public `check guides` | `checkGuides.mjs`; CLI and command tests | DONE |
| Recovery-required fail-closed precedence | `checkGuides.mjs`; existing recovery/crash suites | DONE |
| No automatic stale marking/regeneration/approval | command implementation has no mutation path; query-only tests | DONE |
| Release/Work Package/Task and execution behavior | Corte 2/3 canonical boundary | DEFERRED_BY_DESIGN |

## Regression Results

The required gates passed after `npm ci`:

```text
npm ci                         PASS
npm run build:schemas          PASS
npm run build:runtime          PASS
npm run build:test-bundle      PASS
npm run test:unit              PASS (63 files)
npm run test:cli-e2e           PASS
npm run test:real-crash-e2e    PASS
npm run test:security-e2e      PASS
npm run test:bundle             PASS
npm run verify:artifacts        PASS
npm run verify:next-generation  PASS
git diff --check               PASS
```

`npm ci` reports one moderate dependency advisory from the existing lockfile;
it does not affect the Plan 3 runtime gates and no dependency upgrade is part
of this plan.
