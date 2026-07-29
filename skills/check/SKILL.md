---
description: Check Shipping Mode schema, guides and Release health query-only.
argument-hint: "schema | guides [--scope-id <uuid>] | release [id-or-display-id]"
disable-model-invocation: true
allowed-tools: Bash(shipping-mode check schema:*), Bash(shipping-mode check guides:*), Bash(shipping-mode check release:*)
---

Run query-only checks:

```text
shipping-mode check schema
shipping-mode check guides [--scope-id <uuid>] [--mode strict|advisory]
shipping-mode check release [id-or-display-id]
```

`check release` uses the same derived health evaluator as `release status`.
With a Release reference it checks one Release; without a reference it checks
the Release catalog. It reports schema/revision/identity/projection, lane and
policy consistency, scope evidence, operational refs, deployment evidence,
blockers, risks, finalization metadata and Corte 3+ unavailable capabilities.

Checks never mutate state, never create Operations, ChangeSets or Events, never
repair README projections and never trigger recovery. Stop on
`RECOVERY_REQUIRED`, `NOT_FOUND`, `AMBIGUOUS`, `FAIL` or `NOT_INITIALIZED`.
