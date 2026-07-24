# ADR-0004: Worktree merge protocol

Aggregate records merge by immutable primary ID. Identical records are
idempotent; divergent records produce an explicit conflict and cannot be
silently overwritten. Child indexes are projections regenerated from the
merged aggregate records.
