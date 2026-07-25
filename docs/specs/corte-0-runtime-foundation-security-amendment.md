# Corte 0 — Security and Verification Amendment

Status: **normative**  
Date: 2026-07-25  
Applies to: `docs/specs/corte-0-runtime-foundation.md` and
`docs/plans/corte-0-runtime-foundation-implementation.md`

This amendment resolves the adversarial review findings raised against Draft
PR #7. Where this document conflicts with the earlier spec or implementation
plan, this document takes precedence.

## 1. Workspace lock: fail closed, no automatic reclaim

Corte 0 uses an atomic `mkdir` to acquire
`.planning/.runtime/workspace.lock/`, followed by an exclusive creation of
`lock.json`.

A lock is never removed automatically when:

- its metadata is missing, malformed, or unreadable;
- its hostname differs from the current host;
- its PID is alive;
- its PID is dead.

A dead PID is evidence that the prior process terminated, but it is not a
fencing proof. Automatically moving or deleting the directory can temporarily
vacate the lock path and permit a second writer while another process still
executes under an obsolete ownership assumption. `mkdir` and `rename` alone
cannot close that race.

The required behavior is therefore:

1. Return a typed `LockHeldError` with exit code `1`.
2. Preserve `lock.json` and the lock directory byte-for-byte.
3. Require an operator to inspect the PID/hostname and confirm no writer is
   active.
4. Permit the operator to remove the lock directory manually.
5. On the next mutating invocation, acquire a new lock and run the normal
   recovery sweep before executing the requested callback.

Automatic dead-lock recovery requires a future lease/fencing design and is
outside Corte 0.

## 2. Trusted roots and mutation-path confinement

`assertTrustedRoots(planningRoot)` validates all existing control-plane roots:

- `.planning/`
- `.planning/operations/`
- `.planning/events/`
- `.planning/scopes/`
- `.planning/.runtime/`
- `.planning/.runtime/operations/`

Each root must be a real directory, never a symlink or dangling symlink.

Every mutation path is subject to a stricter rule than a read-only scope
reference: **no existing component may be a symlink**, even when the symlink
resolves inside `.planning/`.

This applies to:

- canonical targets (`config.yml`, `plugin.lock.yml`, `.gitignore`,
  `scopes/**`);
- permanent operation files (`operation.yml`, `change-set.json`,
  `result.json`);
- `.runtime/operations/<operation-id>/before/**`;
- `.runtime/operations/<operation-id>/staged/**`;
- event files and all temporary files.

All staging, snapshot, and canonical paths are derived from `planningRoot`.
Nested directories are created segment-by-segment and revalidated as real
directories. A pre-existing symlink at `.runtime/operations`, an operation-ID
directory, `before`, `staged`, a canonical target, or an atomic-write target
must cause a typed confinement failure before bytes are written outside the
named root.

## 3. Atomic file publication

Replaceable records use:

1. a cryptographically random temporary filename;
2. exclusive creation (`wx`);
3. a final atomic `rename` after the target path is revalidated.

Create-once event files use:

1. a cryptographically random temporary filename;
2. exclusive creation (`wx`);
3. atomic no-clobber publication with `link`;
4. content-hash verification when the target already exists.

Predictable `<target>.tmp-<pid>` paths and unconditional temporary writes are
not permitted.

Rendered mutation targets must resolve to a distinct set of normalized paths.
Duplicate or aliased targets are rejected before staging.

## 4. Reserved events

`operation.reservedEvents` is part of the normative persisted operation model,
not an implementation detail.

Each event ID is generated exactly once at `propose` time. `apply` materializes
the immutable event document from that reservation before entering `APPLYING`.
Recovery reuses the persisted document verbatim and never regenerates IDs,
timestamps, actors, payloads, or hashes.

## 5. Real crash verification

Exception-based fault injection remains useful for deterministic coverage of
all durable boundaries, but it does not prove abandoned-lock behavior because
JavaScript `finally` blocks still execute.

The CLI e2e suite must additionally execute at least one hard process exit
inside the critical section after the operation reaches `APPLYING`:

1. the test-only bundle exits the process without unwinding;
2. `workspace.lock/lock.json` remains with the dead PID;
3. a normal invocation fails closed and does not auto-reclaim it;
4. the test performs the explicit operator removal;
5. the next invocation acquires a new lock and completes recovery;
6. a subsequent `check schema` reports `PASS` with no pending operation;
7. exactly one event and one result are present.

The production bundle must not contain either fault-injection environment
variable or any environment-armed crash path.

## 6. Query-only integrity checks

`check schema` remains strictly query-only. It must:

- reject symlinked trusted roots and entries as findings;
- validate each operation against `operation.schema.json`;
- verify the relational invariant
  `operation.id === operations/<directory-id>`;
- report unreadable, malformed, or self-inconsistent operations;
- never create directories, rewrite records, acquire the lock, or trigger
  recovery.

## 7. Payload classification

A ChangeSet payload must be a non-null mapping/object. Empty YAML, scalars, and
arrays are typed `UsageError` rejections with exit code `1`; they must never
escape as `TypeError` or internal-error exit code `2`.

## 8. Build determinism and committed artifact freshness

The verification gate must not rebuild the production bundle in place before
checking freshness.

It must:

1. install dependencies from `package-lock.json`;
2. build validators, build metadata, and the production bundle twice in two
   isolated temporary directories;
3. require both clean builds to be byte-identical;
4. require the clean build to be byte-identical to every committed generated
   artifact;
5. execute the isolated production bundle without `node_modules` through a
   real `init -> validate -> approve -> apply -> check schema` lifecycle;
6. use a portable Node-based documentation scanner rather than silently
   depending on optional `ripgrep`;
7. run in GitHub Actions on pushes to the feature branch and pull requests
   targeting `develop`.

## 9. Revised Definition of Done

Corte 0 remains open until all of the following are true:

- dead and metadata-less locks fail closed and require explicit manual
  resolution;
- no staging, snapshot, temporary, event, operation, or canonical write can be
  redirected through a pre-existing symlink;
- a hard-exit e2e test proves the dead-lock/manual-resolution/recovery flow;
- `check schema` verifies operation directory identity;
- null/scalar/array payloads are typed usage failures;
- two isolated production builds match each other and the committed bundle;
- the isolated bundle completes a full lifecycle without `node_modules`;
- the GitHub Actions verification job passes from a clean checkout;
- Corte 0 is still not described as closed or finished.
