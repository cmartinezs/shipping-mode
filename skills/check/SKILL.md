---
description: Check Shipping Mode schema, guides, Release health and Release Item health query-only.
argument-hint: "schema | guides [--scope-id <uuid>] | release [id-or-display-id] [--format json] | item <release-id-or-display-id> <item-id-or-display-id> --format json"
disable-model-invocation: true
allowed-tools: Bash(shipping-mode check schema:*), Bash(shipping-mode check guides:*), Bash(shipping-mode check release:*), Bash(shipping-mode check item:*)
---

Run query-only checks:

```text
shipping-mode check schema
shipping-mode check guides [--scope-id <uuid>] [--mode strict|advisory]
shipping-mode check release [id-or-display-id] [--format json]
shipping-mode check item <release-id-or-display-id> <item-id-or-display-id> --format json
```

`check release` uses the same derived health evaluator as `release status`.
With a Release reference it checks one Release; without a reference it checks
the Release catalog. It reports schema/revision/identity/projection, lane and
policy consistency, scope evidence, operational refs, deployment evidence,
Release Item catalog health, blockers, risks, finalization metadata and
remaining unavailable Work Package/Task/gate capabilities.

`check item` uses the same evaluator as `item status`, but returns `PASS` or
`FAIL` for the evaluated health while `item status` continues to return `FOUND`. It checks one Release
Item only; catalog-wide Release Item discovery is part of `check release` and
`check schema`.

Checks never mutate state, never create Operations, ChangeSets or Events, never
repair README projections and never trigger recovery. Stop on
`RECOVERY_REQUIRED`, `NOT_FOUND`, `AMBIGUOUS`, `FAIL` or `NOT_INITIALIZED`.
