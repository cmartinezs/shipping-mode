# ADR-0001: Host integration contract

## Decision

Adopt `shipping-mode` as the plugin name and expose skills through the single
namespaced form `/<plugin-name>:<skill-name>`. The plugin manifest owns
discovery, `hooks/hooks.json` owns hook loading, and `bin/shipping-mode.mjs` is
the stable JSON launcher used by skills.

## Evidence

The local host contract test verifies manifest metadata, all nine namespaced
skills, autocomplete entries, hook loading, launcher help/version/check
access, and reload/update version source. The host integration fixture records
the supported reload and update commands.

## Limits

This closes the technical host contract without claiming a live Claude Code
marketplace installation. Productive runtime behavior remains blocked until
the other Corte -1.2 spikes close.
