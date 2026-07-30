# P4-0 Automated Results

## Official Spike Suite

The spike suite is now a named package script and part of the official
`verify:next-generation` path:

```text
npm run test:host-mcp-bridge
node --test spikes/host-mcp-bridge/tests/*.test.mjs
```

Test files:

```text
bridge-core.test.mjs
bridge-adversarial.test.mjs
bridge-hardening.test.mjs
```

## Covered Mechanics

Original coverage:

- canonical request hashing;
- HMAC valid and modified;
- constant-time verification path for unequal signatures;
- TTL;
- one-time consumption;
- project, tool and input binding;
- response size limit;
- credential-like key rejection;
- atomic file writes;
- concurrent consume lock;
- stale cleanup;
- synthetic `PostToolUse` harness;
- malformed response rejection;
- raw/manual payload rejection.

Post-review coverage:

- prepare requires a Claude Code session;
- challenge is bound to the preparing session before capture;
- same tool/input in two sessions is not ambiguous;
- full MCP tool name must belong to the declared server;
- legitimate `author` fields are not falsely rejected;
- credential fields such as `access_token` are rejected;
- `PostToolUseFailure` produces bounded unavailable/timeout/cancelled state;
- raw provider error text is not persisted;
- signed capture envelope remains immutable during consume;
- consume updates one canonical request lifecycle record;
- replay is rejected after consumption;
- missing capture metadata is reconstructed from a valid signed envelope;
- cross-session consume is rejected;
- inspect redacts nonce, response and signature;
- plugin manifest uses one default hooks discovery path.

## Plugin Validation

The initial run recorded:

```text
claude plugin validate .
Validation passed
```

The post-review branch also relies on host-integration and the official workflow
to validate the default hooks path and plugin structure.

## Synthetic Harness Boundary

The deterministic harness validates bridge mechanics only. It is not real MCP
evidence and cannot classify P4-0 as `PASSED`.

The normalized synthetic sequence remains:

```text
BRIDGE_PREPARED
BRIDGE_CAPTURED
BRIDGE_CONSUMED
BRIDGE_REPLAYED
```

Failed-tool fixtures additionally cover:

```text
BRIDGE_UNAVAILABLE
BRIDGE_TIMEOUT
BRIDGE_CANCELLED
```

## Classification

Automatic tests support the design as a cooperative, fail-closed prototype.
They do not replace the required real loaded-plugin MCP invocation and host hook
capture. Final spike result remains `INCONCLUSIVE`.
