# ADR-0005: ChangeSet transaction recovery

Every operation records a started and committed journal entry. Recovery
replays an operation only when its commit record is absent, and replay is
idempotent once committed. Partial application preserves the canonical file
map and requires verification before the transaction is considered complete.
