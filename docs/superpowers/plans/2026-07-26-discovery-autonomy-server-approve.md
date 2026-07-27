# Discovery Autonomy and Server-Side Approve Implementation Plan

> **For agentic workers:** REQUIRED PROCESS: implement Section E only. Do not reopen Discovery brainstorming, do not implement Plan 5, and do not expand into Work Sources, Jira, git execution, guides, releases, release items, or tasks.

**Goal:** Implement Discovery Iteration Plan 4: autonomy configuration, server-owned autonomy evaluation, policy fingerprint enforcement, and explicit `changeset approve --mode human|autonomous` for the Discovery ChangeSet path.

**Normative source:**

- `docs/superpowers/specs/2026-07-25-discovery-iteration-design.md`, Section E and H.3-H.4.

**Local execution status:** Implemented on branch `agent/discovery-plan-4-autonomy`; full required regression passed; pending Draft PR review/merge.

## Architecture

Plan 4 adds a confirmed autonomy policy under `config.yml`, changed only via ChangeSet:

```yaml
autonomy:
  discovery:
    default: pause
    scopeCommandConfidenceFloor: high
    sourceOverrides:
      - family: project-module-manifests
        mode: auto-approve
        authorityCeiling:
          standing: supporting
          force: advisory
    scopeCommand:
      mode: auto-approve
```

`discover propose` remains the only caller-supplied route for `discovery.propose`. After validation steps 1-4 pass, the runtime reads the confirmed policy, computes a deterministic `policyFingerprint`, evaluates every source/scope/command item server-side, and persists:

```json
{
  "policyFingerprint": "...",
  "autoApprovable": false,
  "blockedBy": []
}
```

Autonomous approval is a server-side check at `changeset approve --mode autonomous`, never a trust in caller payload. Human approval remains the default and remains independent of autonomy.

## Task 1: Autonomy config schema and ChangeSet kind

**Files:**

- Modify: `runtime/src/schemas/config.schema.json`
- Modify: `runtime/src/schemas/change-set.schema.json`
- Modify: `runtime/src/schemas/operation.schema.json`
- Modify: `runtime/src/lib/tests/schema-fixtures.test.mjs`
- Modify: `runtime/src/schemas/tests/schemas-are-valid-json.test.mjs`
- Build: `runtime/src/generated/validators.mjs`

**Steps:**

- [x] Add optional `config.yml.autonomy.discovery`.
- [x] Enforce `default: pause|auto-approve`.
- [x] Enforce `scopeCommandConfidenceFloor: low|medium|high`.
- [x] Enforce `sourceOverrides[]` entries with `family`, `mode`, and optional/required `authorityCeiling` according to implementation needs. For `mode:auto-approve`, require `authorityCeiling`.
- [x] Enforce `scopeCommand.mode: pause|auto-approve`.
- [x] Add ChangeSet kind `config.autonomy.set` to change-set and operation schemas.
- [x] Add `autonomyEvaluation` to operation schema, associated with `VALIDATED` and later states when present.
- [x] Add valid/invalid fixtures for policy, `config.autonomy.set`, and `autonomyEvaluation`.
- [x] Rebuild schemas.

## Task 2: Config autonomy set command path

**Files:**

- Modify: `runtime/src/commands/proposalPreparation.mjs`
- Modify: `runtime/src/commands/renderers.mjs`
- Modify: `runtime/src/commands/changesetCommand.mjs`
- Modify: `runtime/src/index.mjs`
- Modify: `runtime/src/commands/tests/proposalPreparation.test.mjs`
- Modify: `runtime/src/commands/tests/renderers.test.mjs`
- Modify: `runtime/src/commands/tests/commands.test.mjs`
- Modify: `runtime/tests/cli-e2e.test.mjs`

**Steps:**

- [x] Add `config autonomy set --file <file|-> --actor <actor>`.
- [x] Parse JSON/YAML payload consistently with existing ChangeSet payload parsing.
- [x] Normalize by replacing only `config.yml.autonomy`, preserving unrelated config fields.
- [x] Persist via ChangeSet apply only; no direct writes.
- [x] Add `renderConfigAutonomySet(payload, currentConfig)`.
- [x] Add `config.autonomy.set` to `renderFor()` and `eventTypeFor()`.
- [x] Ensure the operation's `autonomyEvaluation.autoApprovable` is always false with reason `autonomy_config_change`.

## Task 3: Policy fingerprint and effective mode engine

**Files:**

- Add: `runtime/src/lib/autonomy.mjs`
- Add: `runtime/src/lib/tests/autonomy.test.mjs`
- Modify as needed: `runtime/src/lib/discoverScan.mjs`

**Steps:**

- [x] Add deterministic default autonomy policy for workspaces with no configured policy.
- [x] Compute `policyFingerprint` using `revisionHash` over the confirmed effective policy.
- [x] Implement formal orders for standing, force, and confidence.
- [x] Implement reason codes exactly from the spec:
  - `family_not_allowlisted`
  - `authority_above_ceiling`
  - `authority_escalation`
  - `low_confidence`
  - `alternatives_present`
  - `destructive_action`
  - `new_scope_always_pauses`
  - `default_pause`
  - `autonomy_config_change`
  - `policy_changed_since_validation`
- [x] Evaluate source add/update using new family and authority.
- [x] Evaluate source update authority escalation against the confirmed prior source.
- [x] Force source move/remove to pause.
- [x] Force scope add to pause.
- [x] Evaluate scope commands with `scopeCommandConfidenceFloor` and alternatives.
- [x] Treat any blocked item as making the whole ChangeSet `autoApprovable:false`.
- [x] Unit-test every H.3 case.

## Task 4: Server-owned autonomyEvaluation on validation

**Files:**

- Modify: `runtime/src/commands/discoveryChangeSet.mjs`
- Modify: `runtime/src/lib/changeset.mjs`
- Modify: `runtime/src/commands/tests/discoveryChangeSet.test.mjs`
- Modify: `runtime/src/lib/tests/changeset-validate-approve.test.mjs`

**Steps:**

- [x] Compute autonomy evaluation only after `validateDiscoveryProposal()` succeeds.
- [x] Persist evaluation in operation state at validation/propose handoff in a way that is tied to the same `operationId`.
- [x] Do not accept or persist caller-supplied autonomy fields in `DiscoveryProposal`.
- [x] For `config.autonomy.set`, persist server-owned `autoApprovable:false` and `autonomy_config_change`.
- [x] Ensure tampering with `autonomyEvaluation` after validation is detected before autonomous approval.
- [x] Bind persisted evaluation to `operationId` + validated `changeSetHash` and ensure even an otherwise identical evaluation from another operation cannot be reused.

## Task 5: Approve mode and automation-capable actors

**Files:**

- Modify: `runtime/src/lib/changeset.mjs`
- Modify: `runtime/src/commands/changesetCommand.mjs`
- Modify: `runtime/src/index.mjs`
- Add/modify tests: `runtime/src/lib/tests/autonomous-approve.test.mjs`, `runtime/src/commands/tests/commands.test.mjs`, `runtime/src/tests/dispatcher.test.mjs`, `runtime/tests/cli-e2e.test.mjs`

**Steps:**

- [x] Add `changeset approve <operation-id> --mode human|autonomous`; omitted mode defaults to `human`.
- [x] Preserve existing human approval and self-approval behavior.
- [x] Add a minimal server-owned authorization context with capability `discovery.autonomous-approve`; `--actor` remains audit metadata and cannot grant privilege.
- [x] Reject autonomous approval when the trusted runtime invocation lacks that capability, including spoofed `--actor discovery-skill`.
- [x] Reject autonomous approval when this operation has no associated evaluation.
- [x] Reject autonomous approval when `autoApprovable:false`.
- [x] Recompute the currently confirmed policy fingerprint and throw `StaleError` with `policy_changed_since_validation` when it differs.
- [x] Human approval must ignore `autoApprovable` and policy fingerprint.
- [x] Record approval mode in operation approval metadata.

## Task 6: Server-owned command method at apply

**Files:**

- Modify: `runtime/src/commands/renderers.mjs`
- Modify: `runtime/src/commands/changesetCommand.mjs`
- Modify: `runtime/src/commands/tests/renderers.test.mjs`
- Modify: `runtime/src/commands/tests/discoveryChangeSet.test.mjs`

**Steps:**

- [x] Stop trusting `proposal.scopeCommands[].method` for persisted state.
- [x] During render/apply, set selected discovery commands to `method: inferred` when approval mode is `autonomous`.
- [x] Set selected discovery commands to `method: reviewed` when approval mode is `human`.
- [x] Keep alternatives without `method`.
- [x] Preserve the Proposal schema contract so the incoming proposal can still contain its Plan 2/3 method shape until the spec/docs are minimally adjusted.
- [x] Add a small spec note if needed: persisted method is server-owned and derived from actual approval mode.

## Task 7: Documentation and plan closure

**Files:**

- Modify: `docs/superpowers/specs/2026-07-25-discovery-iteration-design.md` only if needed for the method contradiction.
- Modify: `docs/superpowers/plans/2026-07-25-discovery-iteration-INDEX.md`
- Modify: this plan.

**Steps:**

- [x] Keep Plan 3 marked merged via PR #12.
- [x] Mark Plan 4 implementation complete locally only after all gates pass.
- [x] Keep Plan 5 pending.
- [x] Do not mark Plan 4 merged before PR merge.

## Adversarial Review Checklist

- [x] Proposal/skill autonomy claims are ignored.
- [x] `config autonomy set` goes through ChangeSet and cannot approve itself autonomously.
- [x] Autonomous approval uses this operation's own persisted evaluation.
- [x] Policy fingerprint is recomputed from confirmed config at approval time.
- [x] Human approval is not blocked by policy fingerprint drift.
- [x] Omitted `--mode` is human.
- [x] Actor labels cannot satisfy capability checks; only trusted runtime authorization context can.
- [x] `default:auto-approve` without a source family override remains blocked with `family_not_allowlisted` because no authority ceiling exists.
- [x] `autonomyEvaluation` is bound to the exact operation and validated ChangeSet hash.
- [x] Move/remove and scope add hard-pause before effective mode.
- [x] Family update is evaluated with the new family.
- [x] Authority escalation blocks even if the new value is within ceiling.
- [x] `method` persisted on discovery commands reflects actual approval path.
- [x] Plan 3 stale/recovery protections remain untouched.

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
