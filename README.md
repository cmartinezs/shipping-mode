# Shipping Mode

Shipping Mode is the clean next-generation implementation of the planning
plugin. It starts at version `1.0.0`, requires Node.js `20+`, and uses the
namespaced Claude Code API `/<plugin-name>:<skill-name>`.

This repository intentionally does not contain the v3 planning template,
legacy skills, v3 command scripts, or active/finished storage.

## Bootstrap

```bash
npm run verify:next-generation
npm run verify:corte-1.2
npm run test:vertical-slice
```

The product launcher is `bin/shipping-mode.mjs` and returns JSON for host
skills. Productive runtime work remains blocked until all Corte -1.2 spikes
are closed. Corte -1.2 is now closed; Corte 0 contains the first vertical
slice behind the launcher and remains intentionally minimal.
