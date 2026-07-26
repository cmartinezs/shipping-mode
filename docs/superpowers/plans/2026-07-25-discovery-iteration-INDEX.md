# Discovery Iteration — Plan Index

Tracks execution of the full design in
`docs/superpowers/specs/2026-07-25-discovery-iteration-design.md` (Sections A–H).
**The Discovery Iteration is not complete until every plan below is merged.**
Completing Plan 1 alone must never be read as "discovery iteration done."

| # | Plan | Design sections covered | Status | Doc |
|---|------|--------------------------|--------|-----|
| 1 | Scan foundation | A (goals/non-goals), B (fingerprint algorithm, sources catalog schema), C (scope `commands` schema), D.1 (`discover scan`, read-only) | **Merged** (PR #9 to `develop`, reviewed and fixed post-merge) | `2026-07-25-discovery-scan-foundation.md` |
| 2 | `DiscoveryProposal` and validation | D.2 (proposal contract), D.3 steps 1–4 (structural/semantic validation, live re-verification, reference resolution, drift reconciliation) | **Merged** (PR #10 to `develop`) | `2026-07-25-discovery-proposal-validation.md` |
| 3 | ChangeSet integration and apply precondition | D.3 step 5 handoff into a real ChangeSet, D.4 (`preconditions.discoveryWorkspace`, `StaleError` re-check at apply) — new `discovery.propose` (and `scope.command.set`) kinds wired into `changeset.mjs`/`changesetCommand.mjs` | Plan written, ready for execution | `2026-07-26-discovery-changeset-integration.md` |
| 4 | Autonomy and server-side `approve` | E (autonomy config, `effectiveMode`, gates, `autonomyEvaluation`, `policyFingerprint`, `changeset approve --mode autonomous\|human`, self-approval prevention) | Not started | *(to be written)* |
| 5 | E2E, real crash recovery, DoD closure | H.4–H.6 end-to-end (real process-kill test through the full discovery apply path), full spec-to-task traceability check, final Definition of Done sign-off | Not started | *(to be written)* |

## Sequencing

Each plan is written (brainstorming already done once for the whole iteration; each
plan still gets its own `writing-plans` pass), executed, and merged before the next
plan is written — mirroring how Plan 1 was scoped only once its own file-level
architecture was understood. Plan 2 in particular depends on Plan 1's `fingerprint.mjs`
and `discoverScan.mjs` existing and being merged.

## Why 5 plans, not 2

The original brainstorming split was "read-only scan" vs. "everything else." Writing
Plan 1 in full surfaced how much real complexity actually lives in "everything else"
(untrusted-input validation, a new ChangeSet kind, an apply-time precondition, and a
security-critical server-side autonomy enforcement layer) — each deserving its own
focused adversarial review pass, the same way Plan 1 just got one. Splitting further
costs nothing but an index file and buys back reviewability.
