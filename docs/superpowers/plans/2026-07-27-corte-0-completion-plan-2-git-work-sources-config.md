# Corte 0 Completion — Plan 2: Git/config policies and Work Source extensibility

## Objective

Close the remaining Corte 0 configuration boundary for approved host Git policy
and Work Sources. Persist both through the existing `config.update` ChangeSet
lifecycle, with generated schemas, deterministic runtime output, and relational
checks. Do not implement Git execution, provider adapters, import/sync, Jira,
MCP integration, guides, or Corte 1 behavior.

## Findings

| Requirement | Current evidence | Status | Delta |
|---|---|---|---|
| Approved Git policy in Project Context | `config.yml` has only compatibility `vcs` and `baseBranch`; no `git` policy | MISSING | Add closed `git` schema with branches, work, worktrees, commits, PR promotion, and automation policy |
| Disabled Git | `vcs: none` exists but no canonical policy block | PARTIAL | Render and validate `git.enabled: false` with provider `none` |
| Work Sources configuration shell | No `work_sources` property; Discovery owns Documentation Sources under `.planning/sources/` | MISSING | Add closed source entries with safe roots/queries/policies/refs |
| Secret rejection | Config schema is closed but has no Work Source model | MISSING | Reject credentials by `additionalProperties: false` and adversarial fixtures |
| Compatibility consistency | `check schema` checks Project Context name and plugin lock only | PARTIAL | Require `vcs`/`baseBranch` to agree with `git` when `git` is present |
| ChangeSet mutation | Existing `config.update` renders a name-only payload through propose/validate/approve/apply | PARTIAL | Extend its typed payload and renderer for Git/Work Sources without an open merge |
| Relational checks | `check schema` is query-only and checks a few Project Context relations | PARTIAL | Add unique IDs, branch/promotion, provider/transport, and opaque-ref checks |

## Decisions

1. `git` and `work_sources` are the canonical new Project Context fields. The
   existing `vcs` and `baseBranch` remain compatibility fields for this
   completion sequence, and `check schema` rejects divergence rather than
   choosing a winner silently.
2. Git policy is descriptive only. No default branch, provider, lane, branch
   unit, worktree mode, PR requirement, or merge strategy is inferred as an
   approved policy. An incomplete policy can be represented while init is
   awaiting explicit configuration; complete enabled policies are validated by
   their closed schema.
3. `work_sources` is separate from the Discovery Documentation Source catalog.
   It stores only safe selection and policy metadata. Provider implementations
   and normalized work items remain out of scope.
4. `config.update` remains the single mutation boundary. Its payload accepts
   only `name`, `git`, and `work_sources`; the rendered document is the
   current config plus those typed replacements, never an arbitrary object
   merge.
5. External credentials are not modeled. Opaque connection references are
   constrained to identifier syntax and cannot contain secret-bearing fields.

## Implementation tasks (TDD)

1. Add failing schema fixtures for enabled/disabled Git policies, branch and
   promotion shapes, automation values, valid Work Sources, duplicate IDs, bad
   provider/transport combinations, and credential/unknown-field rejection.
2. Extend `config.schema.json` and `change-set.schema.json` with closed Git and
   Work Source definitions; regenerate standalone validators and runtime
   artifacts.
3. Extend workspace init rendering with an explicit disabled/enabled Git shell
   synchronized to compatibility fields and an empty `work_sources` list.
4. Extend `config.update` rendering and its public payload path to replace Git
   policy and Work Sources only through ChangeSet propose/validate/approve/apply.
5. Add query-only `check schema` relational checks for compatibility fields,
   branch topology, promotion, provider/transport, unique IDs, and opaque
   connection refs.
6. Add CLI/e2e coverage proving persisted config survives the full ChangeSet
   lifecycle and that Documentation Sources remain in `.planning/sources/`.
7. Run the complete regression/build gate set and record real results here.

## Adversarial review

- Git defaults could accidentally turn detected `develop` or `master` into
  policy. Blocked by requiring policy values from the payload and treating init
  values only as explicit compatibility input.
- `vcs` and `git` could diverge. Blocked by relational checks for enabled/provider
  and `baseBranch`/`branches.work_base`.
- Work Sources could become a second Documentation Source registry. Blocked by
  keeping `work_sources` in config and leaving `.planning/sources/` unchanged.
- Secrets could enter through provider-specific fields. Blocked by strict item
  schemas and only an opaque `mcp_connection_ref` reference.
- `config.update` could become an open merge. Blocked by the payload schema,
  renderer allowlist, and full rendered-config validation.
- A provider or Git executor could leak into this plan. No adapters, registry
  activation, subprocesses, import, sync, or external writes are included.
- Direct config writes could bypass approval/recovery. No new write path is
  added; tests exercise the existing ChangeSet lifecycle.

## Regression gates

Run `npm ci`, schema/runtime/test-bundle builds, unit, CLI E2E, real-crash E2E,
security E2E, bundle, artifact, next-generation, and `git diff --check` gates.

## Completion criteria

- Git policy and disabled Git are representable and schema-valid without
  hardcoded topology.
- Compatibility fields cannot diverge silently.
- Work Sources are safe, closed, extensible configuration only.
- Discovery Documentation Sources remain separate.
- All configuration changes use ChangeSet lifecycle and `check schema` remains
  query-only.
- All required gates pass and the Completion Index records implementation state.

## Explicit out of scope

Git branch/worktree/commit/push/PR/merge execution, provider APIs, provider
registry, LocalRepositoryWorkSource, Jira, Atlassian MCP, import/sync,
NormalizedWorkSourceItem, Release Items, guides, Plan 3, and Corte 1.

## Results

- [x] Implementation complete
- [x] Full regression gates green
- [x] Draft PR opened against `develop` (PR #16)

### Verification record

All required gates passed on 2026-07-27: `npm ci`, schema/runtime/test-bundle
builds, `test:unit` (55 files), CLI E2E, real-crash E2E, security E2E, bundle,
artifact verification, next-generation verification, and `git diff --check`.
`npm ci` reports one pre-existing moderate audit vulnerability; dependency
upgrades are outside this plan.

## Post-review corrections

The PR review found and closed three Plan 2 integrity gaps before merge:

- Project Context relational invariants are now shared by `config.update` validation and `check schema`, so an invalid Git/Work Source configuration becomes `INVALID` before approval/apply instead of producing an `APPLIED` but inconsistent workspace.
- Canonical Git updates synchronize temporary compatibility fields (`vcs`, `baseBranch`) while they remain in the schema, preventing two writable sources of truth.
- Trunk-based topology is explicitly supported; work/integration/production branches may be identical when the declared relationships are internally coherent.
- `git` and `work_sources` are now required canonical Project Context fields; legacy-only workspaces are not silently accepted as current Plan 2 state.
