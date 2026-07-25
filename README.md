# Shipping Mode

Shipping Mode is the clean next-generation implementation of the planning
plugin. It starts at version `1.0.0`, requires Node.js `20+`, and uses the
namespaced Claude Code API `/<plugin-name>:<skill-name>`.

This repository intentionally does not contain the v3 planning template,
legacy skills, v3 command scripts, or active/finished storage.

## Bootstrap

```bash
npm ci
npm run verify:next-generation
```

The verification gate rebuilds validators and the production bundle in
isolated temporary directories, compares them byte-for-byte with the committed
artifacts, builds the test-only fault-injection bundle, and executes unit,
concurrency, CLI, hard-crash, isolated-bundle, and regression suites.

## Corte 0 status

Real, tested surface: `init`, `config set`, `config scope add`,
`changeset propose|validate|approve|apply`, `check schema` — backed by real
JSON Schemas, UUIDv7 IDs, an explicit approval state machine, confined atomic
filesystem writes, and a crash-consistent event journal with idempotent
recovery. See:

- `docs/specs/corte-0-runtime-foundation.md`
- `docs/specs/corte-0-runtime-foundation-security-amendment.md`

The security amendment is normative and supersedes conflicting lock,
filesystem, crash-testing, and build-verification details in the earlier spec
and implementation plan.

### Lock recovery policy

Corte 0 never auto-reclaims a workspace lock whose owner PID is dead or whose
metadata is unreadable. An operator must inspect the lock metadata, confirm
that no writer is active, and remove the lock directory manually. This
fail-closed policy preserves mutual exclusion without pretending that
`mkdir`/`rename` provides leases or fencing.

**Not yet implemented (mandatory next iteration, not optional):**
git/scope/package discovery, guide registration, autonomy configuration,
`release`/`item`/`work-package`/`task`, `check health|guides|gates`,
`report`, and approval governance (role separation between proposer and
approver — self-approval is currently allowed but must be explicit). Any of
these commands returns `NOT_IMPLEMENTED` with exit code `3` rather than a
silent or partial result.

The product launcher is `bin/shipping-mode.mjs` and returns JSON for host
skills.
