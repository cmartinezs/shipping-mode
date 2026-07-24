# S2 Runtime Node 20+ Evidence

Result: PASSED.

`runtime-preflight.mjs` rejects Node 18, accepts Node 20 and newer, and keeps
the runtime self-contained. The test covers JSON output and the path matrix.

```bash
node spikes/runtime-node20/tests/runtime-node20.test.mjs
```
