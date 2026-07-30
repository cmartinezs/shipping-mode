# P4-0 Automated Results

## Spike Tests

```text
node --test spikes/host-mcp-bridge/tests/*.test.mjs

bridge-adversarial.test.mjs PASS
bridge-core.test.mjs PASS
```

Covered:

- canonical request hashing;
- HMAC valid and modified;
- constant-time verification path for unequal signatures;
- TTL;
- one-time consumption;
- session, project, tool and input binding;
- response size limit;
- secret-like key rejection;
- atomic write;
- concurrent capture;
- concurrent consume lock;
- stale cleanup;
- crash recovery;
- fake `PostToolUse` harness;
- malformed response rejection;
- raw/manual payload rejection.

## Plugin Validation

```text
claude plugin validate .

Validation passed
```

## Local Synthetic Harness

The synthetic harness was used only to validate deterministic bridge mechanics.
It is not counted as real MCP evidence and cannot produce `PASSED`.

Observed normalized sequence:

```text
BRIDGE_PREPARED
BRIDGE_CAPTURED
BRIDGE_CONSUMED
BRIDGE_REPLAYED
```
