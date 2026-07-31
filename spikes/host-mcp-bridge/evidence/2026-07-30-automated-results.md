# P4-0 Automated Results

## Official Spike Suite

The spike suite is a named package script and part of the official
`verify:next-generation` path:

```text
npm run test:host-mcp-bridge
node --test spikes/host-mcp-bridge/tests/*.test.mjs
```

Test files include:

```text
bridge-core.test.mjs
bridge-adversarial.test.mjs
bridge-hardening.test.mjs
bridge-cli-plugin-data.test.mjs
bridge-hook-cli-plugin-data.test.mjs
bridge-plugin-hook-placement.test.mjs
```

## Covered Mechanics

The suite covers:

- canonical request hashing;
- HMAC validation and tamper rejection;
- constant-time verification path for unequal signatures;
- request and envelope TTL;
- one-time consumption and replay rejection;
- project, server, exact tool and input binding;
- preparing-session binding and cross-session rejection;
- response size, depth, node-count and finite-number limits;
- credential-like key rejection without rejecting legitimate fields such as
  `author`;
- atomic request and envelope writes;
- concurrent capture and consume failure behavior;
- stale cleanup;
- malformed and unsigned payload rejection;
- immutable signed envelope after consume;
- recovery of capture metadata from valid signed evidence;
- bounded `PostToolUseFailure` normalization;
- raw provider error exclusion;
- redacted inspect output;
- explicit installed-plugin data path for Bash entrypoints;
- success and failure capture scripts as real child processes when
  `CLAUDE_PLUGIN_DATA` is absent from their inherited environment;
- plugin-level hook placement in `hooks/hooks.json`;
- prohibition of capture hooks in the skill frontmatter;
- one default plugin hook discovery path.

## Host Integration Finding

The tested Claude Code 2.1.220 host rejected `${CLAUDE_PLUGIN_DATA}` in
skill-scoped hook commands as plugin-only. The productive architecture therefore
registers `PostToolUse` and `PostToolUseFailure` in the plugin-level
`hooks/hooks.json` file. Structural tests prevent moving them back into the skill.

## Official Verification

The final verification path runs:

```text
npm run verify:next-generation
```

It includes the host MCP bridge suite, host integration, runtime unit tests, CLI
end-to-end tests, crash recovery, security, bundle self-containment and generated
artifact determinism.

The latest verification after moving capture to plugin-level hooks completed
successfully.

## Synthetic Harness Boundary

The deterministic harness validates bridge mechanics and adversarial behavior.
It does not replace real host evidence.

The normalized synthetic sequence is:

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

## Relationship To Manual Evidence

Automatic verification establishes deterministic security and lifecycle
properties. The installed-plugin manual run separately established the productive
host transport path with a real approved MCP call, real plugin-level
`PostToolUse`, signed envelope consumption and real replay rejection.

## Classification

```text
PASSED
```

This classification combines the automated guarantees documented here with the
real host evidence recorded in
`spikes/host-mcp-bridge/evidence/2026-07-30-manual-evidence.md`.
