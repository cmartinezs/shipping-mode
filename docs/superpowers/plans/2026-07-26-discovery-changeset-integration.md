# Discovery ChangeSet Integration Implementation Plan

> **For agentic workers:** REQUIRED PROCESS: use the repo-native `writing-plans` convention shown in the previous Discovery plans: write a concrete task-by-task plan with checkbox steps, run an adversarial review against the approved spec before implementation, then execute the plan by TDD. Do not reopen brainstorming or general Discovery design.

**Goal:** Implement Discovery Iteration Plan 3: hand off a validated `DiscoveryProposal` into a real ChangeSet, persist confirmed sources/scopes/commands only through the Corte 0 ChangeSet engine, and close the propose-to-apply TOCTOU window with `preconditions.discoveryWorkspace`.

**Normative sources:**

- `docs/superpowers/specs/2026-07-25-discovery-iteration-design.md`, especially D.3 step 5 and D.4.
- `docs/specs/corte-0-runtime-foundation.md`.
- `docs/plugin-redesign-release-flow/11-git-work-execution-contract.md`.
- `docs/plugin-redesign-release-flow/12-work-source-provider-contract.md`.

**Out of scope:** Plan 4 autonomy. Do not implement `autonomyEvaluation`, `policyFingerprint`, `approve --mode autonomous`, autonomous approval gates, or Work Source/Jira adapters. Leave only small extension points where needed.

## Architecture

Plan 2 already validates a `DiscoveryProposal` read-only with `validateDiscoveryProposal()`. Plan 3 adds a mutating path:

```text
discover propose --file <path>|--stdin --actor <actor>
  -> parse untrusted proposal
  -> validateDiscoveryProposal() steps 1-4
  -> runtime assigns definitive ids for added scopes/sources
  -> runtime generates provenance
  -> changeset kind discovery.propose
  -> validate/approve/apply through existing ChangeSet lifecycle
  -> apply re-runs discover scan with persisted scanParameters
  -> StaleError + terminal STALE if workspaceHash changed
  -> otherwise persist .planning/sources/**, .planning/scopes/**, and config.yml
```

The ChangeSet engine remains the only writer. `discover validate` stays read-only. `discover propose` creates an operation, but writes only under `.planning/operations/**` until `changeset apply`.

`scope.command.set` is included because the current Discovery spec explicitly separates `declared` commands from the discovery pipeline. It is a small manual ChangeSet kind for declared scope commands only; it is not autonomy and it does not participate in `discover propose`.

## Global constraints

- No direct writes to `.planning/sources/**`, `.planning/scopes/**`, or `config.yml` outside ChangeSet apply.
- `DiscoveryProposal` input is untrusted. The caller never supplies definitive ids, provenance, confirmed timestamps, confirmed actor, confirmed operation id, or apply preconditions.
- Added source IDs and added scope IDs are assigned by the runtime during the ChangeSet handoff, after Plan 2 validation and before persisting `change-set.json`. They are definitive for that operation and reused through validate/approve/apply/recovery.
- A source being added in the same proposal remains unreferenceable by `scopeCommands[]`; Plan 2 already enforces this. Plan 3 must not add temporary proposal-local ids.
- `preconditions.discoveryWorkspace.workspaceHash` and `scanParameters` are copied from the validated live observation, not from caller claims.
- Apply re-scans the host workspace immediately before any staging/canonical write using the persisted scan parameters. A mismatch transitions the operation to terminal `STALE`, throws the existing `StaleError`, writes no canonical files, and requires a fresh scan/proposal/operation.
- Deletes are real mutations. `sources[].action: remove` must remove `sources/<id>/source.yml` through the same file plan, recovery, result, event, and idempotency machinery as writes.
- Git policy and Work Sources contracts are canonical design context but do not expand this plan. Discovery only records host repository Documentation Sources and scope commands.

## Task 1: Schemas accept discovery ChangeSets, preconditions, and delete-capable file plans

**Files:**

- Modify: `runtime/src/schemas/change-set.schema.json`
- Modify: `runtime/src/schemas/operation.schema.json`
- Modify: `runtime/src/schemas/result.schema.json`
- Test: `runtime/src/lib/tests/schema-fixtures.test.mjs`
- Test: `runtime/src/lib/tests/schema.test.mjs`

**Steps:**

- [ ] Add `discovery.propose` and `scope.command.set` to `change-set.schema.json.kind` and `operation.schema.json.kind`.
- [ ] Add `preconditions.discoveryWorkspace` to `change-set.schema.json` with `{ workspaceHash, scanParameters: { maxSourceBytes } }`.
- [ ] Require that `discovery.propose` payload is an object containing:
  - `proposal` (the validated proposal object);
  - `sourceIdAssignments: [{ sourceActionIndex, sourceId }]`;
  - `scopeIdAssignments: [{ scopeIndex, scopeId }]`;
  - `confirmedBy`;
  - `confirmedAt`.
- [ ] Keep autonomy fields absent from the schema for Plan 3.
- [ ] Add `scope.command.set` payload schema with `scopeId`, `role`, `command`, `requiresEnvironment`, and `requiresSecrets`.
- [ ] Extend `operation.filePlan[]` and `result.files[]` with `action: "write" | "delete"`.
- [ ] For write entries, require `stagedRelativePath`, `stagedContentHash`, and `stagedRevisionHash`.
- [ ] For delete entries, require `stagedContentHash: "ABSENT"` and `stagedRevisionHash: "ABSENT"` and do not require a staged file.
- [ ] Add valid/invalid fixtures proving `discovery.propose`, `preconditions.discoveryWorkspace`, write entries, and delete entries validate.
- [ ] Run `npm run build:schemas` and schema tests.

## Task 2: ChangeSet core supports runtime-supplied operation ids and delete actions

**Files:**

- Modify: `runtime/src/lib/changeset.mjs`
- Modify: `runtime/src/lib/recovery.mjs`
- Modify: `runtime/src/lib/safeFs.mjs`
- Test: `runtime/src/lib/tests/changeset-propose.test.mjs`
- Test: `runtime/src/lib/tests/changeset-apply-prepare.test.mjs`
- Test: `runtime/src/lib/tests/changeset-apply.test.mjs`
- Test: `runtime/src/lib/tests/recovery.test.mjs`
- Test: `runtime/src/lib/tests/crash-matrix.test.mjs`

**Steps:**

- [ ] Let `propose()` accept optional `operationId`, `proposedAt`, and `preconditions`; defaults preserve all Corte 0 behavior.
- [ ] Persist `preconditions` in `change-set.json` only when provided.
- [ ] Extend `eventTypeFor()` with `discovery.propose -> discovery.proposed` and `scope.command.set -> scope.command.set`.
- [ ] Treat renderer values as either string content or `null` delete markers.
- [ ] During `revalidateChangeSet()`, include delete targets in the rendered file set and skip YAML schema validation for delete markers.
- [ ] During `prepareApply()`, build `filePlan` entries with `action`.
- [ ] For writes, keep current staging behavior.
- [ ] For deletes, snapshot `before/` when the target exists but create no staged file.
- [ ] During `applyOperation()`, delete target files for delete entries using a confined write path. Missing delete targets after a valid `expectedBefore: ABSENT` remains idempotent; a delete with changed content is stale before apply.
- [ ] Update recovery classification so delete entries classify:
  - actual `ABSENT` as `APPLIED`;
  - actual `beforeContentHash` as `PENDING`;
  - anything else as `DIVERGENT`.
- [ ] Recovery replays pending deletes by removing the confined target, then continues result/event/APPLIED logic.
- [ ] Result files record `contentHash: "ABSENT"` for deletes.
- [ ] Preserve crash consistency and idempotency for all existing write-only operations.

## Task 3: Discovery renderer creates deterministic source/scope/command mutations

**Files:**

- Modify: `runtime/src/commands/renderers.mjs`
- Test: `runtime/src/commands/tests/renderers.test.mjs`

**Steps:**

- [ ] Add `renderDiscoveryPropose(payload, currentConfig, workspaceRoot)`.
- [ ] Build current source and scope maps from `payload.proposal`, `currentConfig`, and persisted files provided by the command layer.
- [ ] Render added sources to `sources/<runtime-source-id>/source.yml`.
- [ ] Render updated/moved sources to `sources/<existing-source-id>/source.yml`.
- [ ] Render removed sources as `sources/<existing-source-id>/source.yml -> null`.
- [ ] Render added scopes to `scopes/<runtime-scope-id>/scope.yml` and append `{id,key}` to `config.yml`.
- [ ] Render `scopeCommands[]` into each target scope's `commands` object, including `custom.<name>` roles.
- [ ] Preserve unrelated scope fields and unrelated command roles.
- [ ] Runtime-generated source provenance must be:
  - `discoveredBy: discovery.propose`;
  - `confirmedBy: payload.confirmedBy`;
  - `confirmedAt: payload.confirmedAt`;
  - `confirmedOperationId: payload.operationId`.
- [ ] Never copy provenance from the proposal.
- [ ] Render output order must be stable, and target paths must be deterministic from persisted ids.

## Task 4: Manual `scope.command.set` renderer and preparation

**Files:**

- Modify: `runtime/src/commands/renderers.mjs`
- Modify: `runtime/src/commands/proposalPreparation.mjs`
- Test: `runtime/src/commands/tests/renderers.test.mjs`
- Test: `runtime/src/commands/tests/proposalPreparation.test.mjs`

**Steps:**

- [ ] Add `renderScopeCommandSet(payload, currentScope)`.
- [ ] Payload identifies an existing scope by UUIDv7 `scopeId`.
- [ ] Payload `role` supports `build|test|smoke|lint|verify|custom.<name>`.
- [ ] Render a `declared` command entry with:
  - `command`;
  - `method: declared`;
  - `declaredBy: payload.declaredBy`;
  - `declaredAt: payload.declaredAt`;
  - `declaredOperationId: payload.operationId`;
  - `requiresEnvironment`;
  - `requiresSecrets`;
  - `alternatives: []`.
- [ ] Preserve unrelated scope fields and command roles.
- [ ] Add `scope.command.set` to `prepareProposal()` for caller-supplied payloads only through `changeset propose --kind scope.command.set`.
- [ ] Runtime fills `operationId`, `declaredBy`, and `declaredAt`; caller payload must not be trusted for those fields.
- [ ] Target files are exactly `scopes/<scopeId>/scope.yml`.
- [ ] This task does not implement inferred/reviewed discovery commands; those remain in `discovery.propose`.

## Task 5: Discovery ChangeSet preparation validates then assigns ids and target files

**Files:**

- Create: `runtime/src/commands/discoveryChangeSet.mjs`
- Modify: `runtime/src/commands/proposalPreparation.mjs`
- Test: `runtime/src/commands/tests/discoveryChangeSet.test.mjs`
- Test: `runtime/src/commands/tests/proposalPreparation.test.mjs`

**Steps:**

- [ ] Add `prepareDiscoveryChangeSet({ planningRoot, workspaceRoot, proposalText, actor })`.
- [ ] Parse JSON only, matching `discover validate`.
- [ ] Call `validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot })`.
- [ ] Reject invalid proposals with the existing `{ok:false,status:"INVALID",errors}` result from Plan 2; do not create an operation.
- [ ] Generate a definitive operation id before building payload.
- [ ] Generate definitive UUIDv7 ids for every `sources[].action === "add"`.
- [ ] Generate definitive UUIDv7 ids for every `scopes[]` entry.
- [ ] Create payload with proposal, assignments, `operationId`, `confirmedBy`, `confirmedAt`.
- [ ] Create `targetFiles`:
  - `config.yml` if any scope is added;
  - `sources/<id>/source.yml` for add/update/move/remove source actions;
  - `scopes/<id>/scope.yml` for added scopes and for existing scopes touched by `scopeCommands[]`.
- [ ] Create `preconditions.discoveryWorkspace` from `normalized.workspaceHash` and `normalized.scanParameters`.
- [ ] Do not compute or persist `autonomyEvaluation`.

## Task 6: Wire discovery.propose and scope.command.set into ChangeSet command paths and apply precondition

**Files:**

- Modify: `runtime/src/commands/changesetCommand.mjs`
- Modify: `runtime/src/index.mjs`
- Modify: `runtime/src/lib/changeset.mjs`
- Test: `runtime/src/commands/tests/commands.test.mjs`
- Test: `runtime/src/tests/dispatcher.test.mjs`
- Test: `runtime/src/lib/tests/changeset-apply-prepare.test.mjs`

**Steps:**

- [ ] Add `discover propose --file <path> | --stdin --actor <actor>` to the dispatcher.
- [ ] Keep `changeset propose --kind discovery.propose` not implemented for caller-supplied payloads; discovery proposal handoff must go through `discover propose`.
- [ ] Add `changeset propose --kind scope.command.set --payload-file <file|-> --actor <actor>` for manual declared command updates.
- [ ] Add `renderFor("discovery.propose")` in `changesetCommand.mjs`.
- [ ] Add `renderFor("scope.command.set")` in `changesetCommand.mjs`.
- [ ] Extend `runChangesetValidate()` and `runChangesetApply()` so discovery renderers receive current config, workspace root, confirmed source files, and confirmed scope files.
- [ ] Before staging in `prepareApply()`, if `changeSet.preconditions.discoveryWorkspace` exists, run a fresh `runDiscoverScan()` using the persisted scan parameters.
- [ ] If the fresh workspace hash differs, call the existing stale transition helper, throw `StaleError`, and return before any `before/`, `staged/`, `filePlan`, or canonical write occurs.
- [ ] Persist terminal `STALE`; later validate/approve/apply attempts on the same operation must fail by state, forcing rescan and a new operation.
- [ ] Existing non-discovery operations must remain unchanged.

## Task 7: Adversarial integration tests for stale, delete, provenance, and no partial writes

**Files:**

- Test: `runtime/src/lib/tests/discovery-changeset-stale.test.mjs`
- Test: `runtime/src/commands/tests/discovery-apply.test.mjs`
- Test: `runtime/tests/cli-e2e.test.mjs`

**Steps:**

- [ ] E2E happy path: scan, build a proposal adding one source and one scope, `discover propose`, validate, approve, apply, then assert `config.yml`, `sources/<id>/source.yml`, and `scopes/<id>/scope.yml`.
- [ ] Assert added source provenance uses runtime actor/time/operation id, not caller fields.
- [ ] Assert added source ids and scope ids are UUIDv7 and are absent from the original proposal.
- [ ] Assert command entries are written into existing scopes only when their referenced sources are already confirmed or update/move entries from the same proposal.
- [ ] Stale test: create a valid discovery operation, approve it, mutate host workspace content, apply, expect `StaleError`, terminal `STALE`, no source/scope/config partial writes, no runtime staging residue.
- [ ] Rescan recovery test: after stale, a fresh scan/proposal creates a new operation that applies successfully.
- [ ] Delete test: confirmed source removed by proposal deletes `sources/<id>/source.yml`, records `ABSENT` in result, and remains crash-recoverable.
- [ ] Tamper tests: caller-supplied provenance-like fields in proposal are rejected by schema or ignored; tampered `preconditions`/payload hash after approve becomes `STALE` before writes.
- [ ] Manual `scope.command.set` E2E: declared command writes to an existing scope through ChangeSet and carries runtime-generated declared provenance.

## Task 8: CLI, bundle, and docs/index regression

**Files:**

- Modify: `runtime/src/index.mjs`
- Modify: `runtime/src/generated/validators.mjs`
- Modify: `runtime/dist/shipping-mode.mjs`
- Modify: `docs/superpowers/plans/2026-07-25-discovery-iteration-INDEX.md`
- Test: `runtime/tests/cli-e2e.test.mjs`
- Test: `runtime/tests/bundle-self-contained.test.mjs`

**Steps:**

- [ ] Build schemas/runtime after implementation.
- [ ] Ensure `docs/superpowers/plans/2026-07-25-discovery-iteration-INDEX.md` keeps Plan 2 as merged and Plan 3 pointing to this file, without marking Plan 3 merged before PR merge.
- [ ] Run targeted tests added by this plan.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run test:cli-e2e`.
- [ ] Run `npm run test:real-crash-e2e`.
- [ ] Run `npm run test:security-e2e`.
- [ ] Run `npm run test:bundle`.
- [ ] Run `npm run verify:next-generation`.
- [ ] Review `git diff --check` and the complete diff.

## Adversarial review checklist

- [ ] Plan 3 writes only via ChangeSet apply.
- [ ] `discover validate` remains read-only.
- [ ] `changeset propose --kind discovery.propose` does not accept caller-supplied mutation payloads.
- [ ] `scope.command.set` is limited to declared manual commands and never uses sourceRefs or autonomy.
- [ ] `preconditions.discoveryWorkspace` is produced by runtime validation and rechecked at apply from persisted scan parameters.
- [ ] Stale happens before staging and before canonical writes.
- [ ] `STALE` is terminal; only rescan and a new operation recover.
- [ ] Added sources/scopes get definitive runtime IDs after validation; no proposal-local refs are introduced.
- [ ] Provenance is runtime generated.
- [ ] Source removes are real deletes and recovery-safe.
- [ ] Plan 4 autonomy fields are not implemented.
- [ ] Git execution and Work Sources/Jira contracts do not expand this plan.
