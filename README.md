# Shipping Mode

Shipping Mode is the clean next-generation implementation of the planning
plugin. It starts at version `1.0.0`, requires Node.js `20+`, and uses the
namespaced Claude Code API `/<plugin-name>:<skill-name>`.

This repository intentionally does not contain the v3 planning template,
legacy skills, v3 command scripts, or active/finished storage.

## Bootstrap

```bash
npm ci
npm run build:runtime
npm run verify:next-generation
```

## Corte 0 status

Real, tested surface: `init`, `config set`, `config scope add`,
`changeset propose|validate|approve|apply`, `check schema` — backed by real
JSON Schemas, UUIDv7 IDs, an explicit approval state machine, and a
crash-consistent event journal with idempotent recovery. See
`docs/specs/corte-0-runtime-foundation.md`.

**Not yet implemented (mandatory next iteration, not optional):**
git/scope/package discovery, guide registration, autonomy configuration,
`release`/`item`/`work-package`/`task`, `check health|guides|gates`,
`report`, and approval governance (role separation between proposer and
approver — self-approval is currently allowed but must be explicit). Any of
these commands returns `NOT_IMPLEMENTED` with exit code `3` rather than a
silent or partial result.

The product launcher is `bin/shipping-mode.mjs` and returns JSON for host
skills.
