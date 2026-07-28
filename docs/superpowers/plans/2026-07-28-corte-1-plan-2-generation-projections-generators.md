# Corte 1 Plan 2 — Generation, Executable DSL, Projections and Generators

## Objective

Extend the Guide domain merged in PR #18 so task and test guides contain a
closed, typed, deterministic DSL; can be generated from approved Project
Context and Documentation Sources; can render deterministic Markdown
projections; and can invoke an explicitly configured host generator through a
constrained structured-I/O contract.

Plan 2 does not implement automatic staleness, strict-mode enforcement,
`check guides`, Release/Work Package/Task aggregates, or execution engines.

## Current-state audit after PR #18

| Requirement | Canonical evidence | Existing primitive | Status | Delta | Resolution |
|---|---|---|---|---|---|
| Guide YAML is canonical | `05-scope-task-guides.md`; `08-corte-1-1-contratos-runtime.md` | `guide.schema.json`, `guide.update`, revision/content hash | PARTIAL | Envelope has generic `sections` and no typed DSL | Replace with discriminated task/test DSL |
| Typed conditions/evaluator | `05-scope-task-guides.md` | None | MISSING | No AST, resolver, trace, or error model | Add pure evaluator and tests |
| Task/test rule structures | `05-scope-task-guides.md` | Same generic Guide envelope | MISSING | No work package/task/test matrix fields | Add closed variant schemas and references |
| Source-driven generation | Discovery source catalog and Plan 1 sourceRefs/provenance | `guide.update` accepts server-validated documents | PARTIAL | No input snapshot or deterministic fallback | Add server generation input and fallback |
| Custom generator contract | `05-scope-task-guides.md` | Safe path/hash primitives, no runner | MISSING | No configured runner or output validation | Add constrained runner; no false sandbox claim |
| Markdown projections | Architecture/guide contracts | Metadata projection path only | MISSING | No renderer or atomic YAML+MD publication | Add pure deterministic renderer and ChangeSet targets |
| Gate/profile refs | Scope/gate contracts | Gate topology only | PARTIAL | No Guide refs or dangling-ref checks | Add ID-only refs only where canonical IDs exist |
| Generator provenance | Discovery fingerprints and Guide provenance | source fingerprints only | PARTIAL | Missing generator/input/output binding | Extend closed provenance fields |
| Plan 3 staleness/check guides/strict mode | `05-scope-task-guides.md` | No dependent runtime | DEFERRED_BY_DESIGN | Explicitly outside Plan 2 | Leave to Plan 3 |

## Canonical decisions

### Guide shape

There remains one Guide domain with `kind: task|test`. The executable document
is a closed discriminated object. Task guides use `workPackageTypes`,
`taskTypes`, `requiredSections`, `requiredGateRefs`, `templateRefs`,
`decompositionRules`, `automation`, and `openGaps`. Test guides use
`gatesByWorkPackageType`, `gatesByTaskType`, `commandRefs`,
`evidenceRequirements`, `testData`, `executionContexts`, `environments`, and
`openGaps`. All persisted names use the runtime's camelCase convention. No
paths, scope keys, caller IDs, status, approval, revision, or contentHash are
accepted from a generator/document payload.

### Conditions and evaluator

Conditions are an explicit AST with exactly one of `field/op/value`, `all`,
`any`, or `not`. Operators are `equals`, `not_equals`, `contains`, `exists`,
`in`, and `matches`, with recursive composition. Field paths are read-only
dotted paths and reject `__proto__`, `prototype`, and `constructor` segments.
Missing and `null` are distinct. Values use explicit typed wrappers for
`date` and `datetime`; no coercion occurs. The evaluator is pure, returns
`{ matched, trace }`, short-circuits `all`/`any`, and returns structured
errors. It never reads files, Markdown, or invokes commands/AI.

`matches` runs in a terminable worker with bounded pattern/input sizes and an
explicit timeout. A timeout or worker failure is an error, not a match. The
runtime does not claim that this subprocess is a filesystem sandbox.

### Generation

The server builds a bounded `GuideGenerationInput` from the approved scope,
approved Project Context references, resolved Documentation Source snapshots,
source fingerprints, structured commands, and schema/DSL versions. It never
passes all of `.planning/**` or secrets. Without a custom generator, the
fallback emits only deterministic known references and explicit open gaps.
Generated output is validated, normalized, and passed to the existing
`guide.update` generate/regenerate ChangeSet. Generation never approves a
Guide and never clears the `guides/missing` gap.

Source authority is preserved by Discovery metadata. Conflicting normative
inputs produce an `openGap`; they are not silently selected.

### Custom generators

Generator configuration is structured and persisted through the existing
ChangeSet/configuration boundary. The runner resolves executable and args
inside the workspace, rejects traversal/symlink escape, uses `shell: false`,
explicit cwd, minimal allowlisted environment, stdin JSON, real timeout, and
stdout/stderr limits. It verifies exit status and structured JSON output,
redacts logs, and records executable fingerprint, input hash, and output hash.
The subprocess is an approved host executable with a constrained invocation
contract, not an OS filesystem sandbox. It cannot mutate canonical state
through the runtime because only validated output enters `guide.update`.

### Projections

YAML remains the only runtime source of truth. A pure renderer produces
`task-guide.md` or `test-guide.md` from the parsed canonical document with
stable ordering and no executable rules beyond those already represented in
YAML. YAML and Markdown are included in the same ChangeSet target plan. A
pure comparison function reports projection drift; it never repairs it.

### References

Guide command references resolve against the existing scope command model and
never copy shell strings. Gate/profile references are ID-only. If a canonical
Gate/GateProfile registry and identity are not present, Plan 2 does not invent
one; the Guide schema permits only the already-established reference form and
rejects unresolved references when the registry is available.

## Implementation tasks (TDD)

1. Write failing schema tests for discriminated task/test documents, typed
   conditions, closed fields, explicit dates, command refs, gate refs,
   generator output restrictions, and provenance hashes. Regenerate standalone
   validators and update fixtures.
2. Write failing evaluator tests for every operator, strict types, missing vs
   null, nested paths, prototype-path rejection, `all`/`any` short circuit,
   `not`, nested trace determinism, and worker-backed pathological regex.
3. Implement the pure field resolver, AST evaluator, structured errors, and
   bounded regex worker. Keep the evaluator independent of runtime storage.
4. Write failing generation tests for source snapshots, authority conflicts,
   generic fallback, explicit gaps, deterministic normalization, and
   generated-not-approved semantics. Implement input construction and
   fallback generation using existing Discovery catalog ownership.
5. Write failing custom-generator tests for valid execution, confined paths,
   symlink/traversal rejection, timeout, output limits, non-zero exit,
   malformed output, forbidden fields, environment allowlisting, and input/
   output hashes. Implement the runner without shell interpolation.
6. Write failing projection tests for deterministic task/test Markdown,
   deletion/recreation, no extra executable semantics, and manual-edit drift.
   Add pure render/compare helpers and include YAML+Markdown in the existing
   `guide.update` ChangeSet target plan with crash-safe apply.
7. Add scope references for configured generators and valid command/gate refs
   only where current contracts provide canonical identities. Add relational
   pre-apply validation; do not duplicate registries.
8. Add focused Guide generation/DSL/generator/projection E2E coverage and run
   the complete regression gates.

## Adversarial review before production

- Generic sections must no longer permit executable untyped data.
- Natural-language conditions, scripts, arbitrary shell, and inline code are
  rejected by schema.
- Date/datetime and scalar comparisons must not coerce types.
- Field resolution must not expose prototype-chain properties.
- Regex timeout must be technically interruptible; no main-thread `RegExp`
  claim or fake timeout.
- Generator identity/status/revision/approval and canonical paths remain
  server-owned.
- Generator subprocess is not described as a sandbox; inherited secrets and
  shell interpolation are prevented.
- Generator Markdown is input narrative at most, never canonical output.
- Markdown cannot influence runtime evaluation.
- YAML and Markdown cannot be published in separate operations.
- No duplicate command/source/gate registry is introduced.
- Source conflicts become open gaps, not silent choices.
- Generation cannot resolve `guides/missing` or auto-approve.
- No Plan 3 staleness, strict policy, or `check guides` implementation leaks
  into this branch.
- No Release, Work Package, Task, provider, Git, deployment, or execution
  behavior is added.

## Traceability and completion criteria

Plan 2 is complete only when the following are demonstrated:

- [x] task/test Guide schemas are closed and discriminated;
- [x] evaluator is pure, strict, traced, short-circuiting, and regex-safe;
- [x] source-driven generic generation is deterministic and gap-preserving;
- [x] custom generator contract is confined, bounded, structured, and hashed;
- [x] YAML is canonical and Markdown projection is deterministic;
- [x] YAML+Markdown publication uses existing ChangeSet/recovery;
- [x] commands/gates are references, not duplicated definitions;
- [x] generated Guides remain unapproved;
- [x] all Plan 1 approval and gap invariants remain green;
- [x] mandatory build, unit, E2E, crash, security, bundle, artifact, and
  next-generation gates pass;
- [x] no Plan 3 or later functionality is implemented.

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

## Explicit deferrals

Automatic source/config staleness, strict atomization blocking, waivers,
public `check guides`, full gate execution, environment lifecycle, Release,
Release Item, Work Package, Task, Jira/MCP, Work Source providers, Git
execution, deployment, and task/test execution remain Plan 3 or later.
