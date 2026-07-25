---
description: Read-only discovery scan of the host repository (git, scope candidates, source candidates, drift).
argument-hint: scan [--max-source-bytes <bytes>]
disable-model-invocation: true
allowed-tools: Bash(shipping-mode discover:*)
---

Use `shipping-mode discover scan [--max-source-bytes <bytes>]` to get a
read-only, deterministic report of the host repository: git branch/remote
detection, candidate scopes (folders with manifest signals), candidate
sources (by family, with mechanical rule provenance only — never a
confirmed classification), and drift for already-confirmed sources/scope
commands against the live workspace.

This command never writes to `.planning/` and never requires the workspace
lock. It produces a `ScanResult` JSON object on stdout for you to interpret;
turning any of it into confirmed `.planning` state is a separate, later
capability (`discover propose`, not yet implemented) that goes through the
same ChangeSet `propose → validate → approve → apply` cycle as every other
mutation in this plugin. Do not write `sources/**` or a scope's `commands`
field directly — there is no supported way to do that yet, and there never
will be one that bypasses ChangeSet.
