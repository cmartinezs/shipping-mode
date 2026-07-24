# ADR-0006: Integrated prototype boundary

The first vertical slice is modeled as an explicit sequence from `init` to
`report`. Mutating control-plane state requires a ChangeSet with a content
hash, and every apply/check/report transition is recorded in the event journal.
Direct writes to `.planning/**` remain denied by the distributed hook.

This is a reusable proof of the boundary, not the Corte 0 production runtime.
