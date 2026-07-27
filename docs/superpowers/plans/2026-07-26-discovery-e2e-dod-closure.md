# Discovery E2E, Real Crash Recovery, and DoD Closure Plan

> **For agentic workers:** REQUIRED PROCESS: close the Discovery Iteration only. Do not reopen brainstorming, do not implement Work Sources/Jira/guides/releases/items/work packages/tasks, and do not start Corte 1.

**Goal:** prove the complete Discovery pipeline end to end under normal, adversarial, stale, autonomous, human, and real process-kill recovery conditions.

**Normative source:** `docs/superpowers/specs/2026-07-25-discovery-iteration-design.md`, especially H.1-H.6 and the Definition of Done.

**Local execution status:** Implemented on branch `agent/discovery-plan-5-dod-closure`; full required regression passed; pending Draft PR review/merge.

## Scope

Plan 5 is a closure and evidence plan, not a feature plan. It may add or extend tests, small test helpers, and documentation. Production code changes are allowed only when a new closure test reveals a real contract bug.

The target pipeline is:

```text
discover scan
  -> DiscoveryProposal
  -> validation
  -> autonomyEvaluation
  -> ChangeSet
  -> human/autonomous approval
  -> apply preconditions
  -> atomic mutation
  -> crash/recovery
  -> consistent catalog
```

## Spec-To-Test Traceability Matrix

| Spec requirement | Existing test(s) | Coverage status | Missing coverage | Action |
|---|---|---|---|---|
| H.1 single file fingerprint equals content hash | `runtime/src/lib/tests/fingerprint-file.test.mjs` | COVERED | None | Reuse. |
| H.1 directory multiplicity affects content hash | `runtime/src/lib/tests/fingerprint-directory.test.mjs` | COVERED | None | Reuse. |
| H.1 symlink target text affects fingerprint, target content is not followed | `runtime/src/lib/tests/fingerprint-directory.test.mjs` | COVERED | None | Reuse. |
| H.1 normalized path collision hard diagnostic | `runtime/src/lib/tests/fingerprint-directory.test.mjs` | COVERED | None | Reuse. |
| H.1 invalid UTF-8 path or target hard diagnostic | `runtime/src/lib/tests/fingerprint-directory.test.mjs` | COVERED | None | Reuse. |
| H.1 unreadable source hard diagnostic | `runtime/src/lib/tests/fingerprint-file.test.mjs`, `runtime/src/lib/tests/fingerprint-directory.test.mjs` | COVERED | Real user-switch CLI remains environment-dependent per spec wording. | Reuse injected EACCES coverage; document no new privileged user-switch test. |
| H.1 size preflight before content reads and exact `observedBytes` | `runtime/src/lib/tests/fingerprint-file.test.mjs`, `runtime/src/lib/tests/fingerprint-directory.test.mjs` | COVERED | None | Reuse. |
| H.1 moved unique vs ambiguous | `runtime/src/lib/tests/fingerprint-dispatch.test.mjs`, `runtime/src/lib/tests/discover-drift.test.mjs` | COVERED | None | Reuse. |
| H.2 structural invariants from B/C | `runtime/src/lib/tests/discovery-proposal-schema.test.mjs`, `runtime/src/lib/tests/discovery-proposal-structure.test.mjs`, `runtime/src/lib/tests/scope-commands-schema.test.mjs` | COVERED | None | Reuse. |
| H.2 maxSourceBytes outside range rejected | `runtime/src/lib/tests/discovery-proposal-structure.test.mjs`, `runtime/src/commands/tests/discover.test.mjs` | COVERED | None | Reuse. |
| H.2 workspaceHash mismatch and deterministic same-content ordering | `runtime/src/lib/tests/discovery-proposal-consistency.test.mjs`, `runtime/src/lib/tests/discover-workspace-hash.test.mjs` | COVERED | None | Reuse. |
| H.2 skill-claimed fingerprint mismatch rejected | `runtime/src/lib/tests/discovery-proposal-fingerprints.test.mjs` | COVERED | None | Reuse. |
| H.2 dangling sourceRef rejected | `runtime/src/lib/tests/discovery-proposal-references.test.mjs` | COVERED | None | Reuse. |
| H.2 source remove referential integrity and reconciled update accepted | `runtime/src/lib/tests/discovery-proposal-removal-integrity.test.mjs` | COVERED | None | Reuse. |
| H.2 unaddressed drift rejected | `runtime/src/lib/tests/discovery-proposal-drift-reconciliation.test.mjs` | COVERED | None | Reuse. |
| H.3 family override present vs absent | `runtime/src/lib/tests/autonomy.test.mjs` | COVERED | None | Reuse. |
| H.3 authority ceiling boundary and above-ceiling | `runtime/src/lib/tests/autonomy.test.mjs` | COVERED | None | Reuse. |
| H.3 authority escalation | `runtime/src/lib/tests/autonomy.test.mjs` | COVERED | None | Reuse. |
| H.3 move/remove hard pause | `runtime/src/lib/tests/autonomy.test.mjs` | COVERED | None | Reuse. |
| H.3 scope add hard pause | `runtime/src/lib/tests/autonomy.test.mjs` | COVERED | None | Reuse. |
| H.3 scopeCommandConfidenceFloor | `runtime/src/lib/tests/autonomy.test.mjs` | COVERED | None | Reuse. |
| H.3 alternatives pause | `runtime/src/lib/tests/autonomy.test.mjs`, `runtime/src/commands/tests/autonomy-approve.test.mjs` | COVERED | None | Reuse. |
| H.3 whole ChangeSet atomicity | `runtime/src/lib/tests/autonomy.test.mjs` | COVERED | None | Reuse. |
| H.3 config autonomy set never autoapprovable | `runtime/src/commands/tests/autonomy-approve.test.mjs`, `runtime/tests/cli-e2e.test.mjs` | COVERED | None | Reuse. |
| H.3 family update uses new family | `runtime/src/lib/tests/autonomy.test.mjs` | COVERED | None | Reuse. |
| H.4 autonomous rejected with `autoApprovable:false` | `runtime/src/commands/tests/autonomy-approve.test.mjs`, `runtime/tests/discovery-e2e.test.mjs` | COVERED | None | Plan 5 added blocked human-path E2E. |
| H.4 stale policy fingerprint -> `StaleError` | `runtime/src/commands/tests/autonomy-approve.test.mjs`, `runtime/tests/discovery-e2e.test.mjs` | COVERED | None | Plan 5 added stale-policy E2E with no catalog mutation. |
| H.4 operation-bound `autonomyEvaluation` | `runtime/src/commands/tests/autonomy-approve.test.mjs`, `runtime/src/lib/tests/schema-fixtures.test.mjs` | COVERED | None | Reuse. |
| H.4 actor without server-owned capability rejected | `runtime/src/commands/tests/autonomy-approve.test.mjs`, `runtime/tests/discovery-e2e.test.mjs` | COVERED | None | Plan 5 added public CLI spoof rejection. |
| H.4 autonomous happy path with capability | `runtime/src/commands/tests/autonomy-approve.test.mjs`, `runtime/tests/discovery-e2e.test.mjs` | COVERED | None | Plan 5 added trusted command-layer E2E and `method: inferred`. |
| H.4 human approval bypasses autonomy and fingerprint | `runtime/src/commands/tests/autonomy-approve.test.mjs`, `runtime/tests/discovery-e2e.test.mjs` | COVERED | None | Plan 5 added blocked proposal plus policy change before human approval. |
| H.4 omitted mode defaults human | `runtime/src/commands/tests/autonomy-approve.test.mjs` | COVERED | None | Reuse and assert in Plan 5 human path if natural. |
| H.5 unchanged workspace apply succeeds and persists fingerprints/hashes | `runtime/src/commands/tests/discoveryChangeSet.test.mjs`, `runtime/tests/cli-e2e.test.mjs`, `runtime/tests/discovery-e2e.test.mjs` | COVERED | None | Plan 5 added semantic public Discovery E2E. |
| H.5 workspace changed after approve -> stale, no writes, new operation required | `runtime/src/commands/tests/discoveryChangeSet.test.mjs`, `runtime/tests/discovery-e2e.test.mjs` | COVERED | None | Plan 5 added public workspace-stale E2E. |
| H.5 real process-kill during Discovery apply | `runtime/tests/real-crash-e2e.test.mjs`, `runtime/tests/discovery-real-crash-e2e.test.mjs` | COVERED | None | Plan 5 added real `SIGKILL` during multi-mutation Discovery apply. |
| H.5 no mixed catalog exposed as valid after crash | `runtime/tests/discovery-real-crash-e2e.test.mjs` | COVERED | None | Plan 5 inspects pending operation, filePlan, canonical files, runtime residue, events/result, and `check schema`. |
| H.5 full recovery cycle reusing Corte 0 recovery | `runtime/src/lib/tests/recovery.test.mjs`, `runtime/tests/discovery-real-crash-e2e.test.mjs` | COVERED | None | Plan 5 triggers existing recovery through the production binary after manual dead-lock removal. |
| H.5 recovery idempotency after Discovery crash | `runtime/src/lib/tests/crash-matrix.test.mjs`, `runtime/tests/discovery-real-crash-e2e.test.mjs` | COVERED | None | Plan 5 compares structured snapshots across a second recovery pass. |
| H.6 schemas compiled via Ajv standalone and registry current | `runtime/src/generated/tests/build-determinism.test.mjs`, `runtime/src/schemas/tests/schemas-are-valid-json.test.mjs` | COVERED | None | Reuse. |
| H.6 runtime bundle self-contained and no accidental Ajv runtime dependency | `runtime/tests/bundle-self-contained.test.mjs`, `npm run verify:artifacts` | COVERED | None | Reuse. |
| H.6 verify-next-generation covers all above | `scripts/verify-next-generation.sh`, `package.json` scripts | COVERED | None | Plan 5 wires new E2E tests into existing `test:cli-e2e` and `test:real-crash-e2e` scripts, which `verify:next-generation` already runs. |

## Implementation Tasks

### Task 1: Plan and traceability

- [x] Update Discovery Plan Index to mark Plan 4 merged by PR #13.
- [x] Add this Plan 5 implementation plan with the traceability matrix.
- [x] Keep Plan 5 pending until implementation and gates pass.

### Task 2: Shared E2E helpers

Add a focused E2E helper module or local helpers in the new test file to:

- [x] run the real public binary and parse JSON responses;
- [x] initialize a workspace;
- [x] configure autonomy through `config autonomy set`;
- [x] build valid DiscoveryProposals from real `discover scan` output;
- [x] inspect operation, ChangeSet, result, event files, source docs, scope docs, config docs, and structural hashes;
- [x] snapshot semantic catalog state for recovery idempotency comparisons.

### Task 3: Real Discovery E2E

- [x] Use real workspace files and real `bin/shipping-mode.mjs`.
- [x] Execute `init -> config autonomy set -> discover scan -> discover propose -> validate -> human approve -> apply -> check schema`.
- [x] Inspect IDs, source catalog, scopeRefs, scope commands, provenance, fingerprints, content hashes, approval metadata, events, result, operation state, and `check schema == PASS`.

### Task 4: Human approval E2E

- [x] Create a proposal blocked by autonomy (`autoApprovable:false`) through a real Discovery ChangeSet.
- [x] Confirm autonomous approval is rejected.
- [x] Change confirmed autonomy policy before human approval.
- [x] Confirm human approval still succeeds and apply persists `method: reviewed`.

### Task 5: Autonomous approval E2E

- [x] Create an eligible proposal with `autoApprovable:true`.
- [x] Confirm CLI `changeset approve --mode autonomous --actor discovery-skill` fails because the CLI cannot provide server-owned capability.
- [x] Use command-layer trusted authorization context with `AUTONOMOUS_APPROVAL_CAPABILITY`.
- [x] Apply and assert persisted `method: inferred`.

### Task 6: Policy stale E2E

- [x] Validate a Discovery operation under policy A.
- [x] Confirm policy B via a separate human-approved `config autonomy set`.
- [x] Attempt autonomous approval with trusted context.
- [x] Assert `StaleError`, `policy_changed_since_validation`, terminal `STALE`, and no catalog mutation from the stale operation.

### Task 7: Workspace stale E2E

- [x] Validate and approve a Discovery operation.
- [x] Mutate host workspace before apply.
- [x] Assert `StaleError`, terminal `STALE`, no canonical file partial writes, and no runtime staging/before residue started before the stale check.
- [x] Demonstrate recovery requires rescan + new operation, not retry of the stale operation.

### Task 8: Real process-kill Discovery apply

- [x] Prepare a multi-mutation Discovery ChangeSet with multiple sources, a scope, a command, and config change.
- [x] Apply in a separate OS process using the test bundle only to arm existing checkpoint behavior.
- [x] Kill via actual parent-side `SIGKILL` after `AFTER_FIRST_RENAME` so one canonical mutation has occurred.
- [x] Assert a dead lock remains and ordinary production binary refuses to auto-reclaim it.
- [x] Inspect immediately after crash: operation state, filePlan, source/scope/config files, event/result state, runtime residue, and `check schema`.
- [x] Remove the dead lock manually, then trigger existing recovery through the production binary.
- [x] Assert final semantic catalog consistency, result, events, operation `APPLIED`, and `check schema == PASS`.
- [x] Run recovery again and assert semantic snapshot equality, no duplicate sources/scopeRefs/commands/provenance/events/filePlan effects.

### Task 9: Build and regression closure

- [x] Ensure the new E2E is included in required gates.
- [x] Run all mandatory gates.
- [x] Update this plan with actual results and any real bug fixed.
- [x] Update the index to Plan 5 implementation complete / pending PR merge.
- [x] Do not mark Discovery Iteration complete before PR merge.

## Adversarial Review Checklist

- [x] Tests use real binary where public CLI behavior matters.
- [x] Trusted autonomous capability is not exposed via CLI or env.
- [x] Autonomous stale policy cannot mutate catalog.
- [x] Human approval remains independent from autonomy/fingerprint drift.
- [x] Workspace stale apply stops before staging/before/canonical writes.
- [x] Process-kill test uses real process exit, not thrown exception.
- [x] Recovery path reuses existing locks/filePlan/staged/before/journal machinery.
- [x] A partially applied Discovery catalog is never reported as valid.
- [x] Idempotent recovery is proven by structured snapshots, not only exit codes.
- [x] No Plan 5 test weakens Plan 1-4 contracts.

## Required Regression Before PR

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

## Definition of Done Closure

- [x] `npm ci` reproducible
- [x] deterministic isolated build
- [x] every H.1-H.5 adversarial requirement covered
- [x] real process-kill discovery apply test
- [x] full recovery cycle
- [x] recovery idempotency
- [x] full Corte 0 regression
- [x] all Discovery tests green
- [x] self-contained bundle
- [x] generated artifacts deterministic
- [x] no temp/scratch files
- [x] spec-to-test traceability complete

## Actual Results

- Added `runtime/tests/discovery-e2e.test.mjs` for public-bin Discovery semantics, blocked human approval, trusted autonomous approval, policy stale, and workspace stale paths.
- Added `runtime/tests/discovery-real-crash-e2e.test.mjs` for real parent-side `SIGKILL` during multi-mutation Discovery apply, immediate crash consistency checks, full recovery, and recovery idempotency.
- Wired the new tests into `npm run test:cli-e2e` and `npm run test:real-crash-e2e`, so `npm run verify:next-generation` covers them through existing gates.
- Fixed one real bug found during closure: `setFaultCheckpoint()` still referenced the removed `hardExitOnCheckpoint` variable after adding the wait-for-kill test hook. The fix restores Corte 0 simulated-crash tests and keeps the new SIGKILL path test-only.
- `npm ci` completed with the existing npm audit notice: 1 moderate vulnerability.
