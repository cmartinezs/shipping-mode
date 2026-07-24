#!/usr/bin/env bash
set -euo pipefail

fail_closed() {
  printf '%s\n' "Planning-state protection unavailable." "Node.js 20+ is required. Tool call denied." >&2
  exit 2
}

command -v node >/dev/null 2>&1 || fail_closed
node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')"
[[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 20 )) || fail_closed

plugin_root="${CLAUDE_PLUGIN_ROOT:-}"
[[ -n "$plugin_root" ]] || fail_closed

hook_script="$plugin_root/scripts/protect-planning-state.mjs"
[[ -f "$hook_script" ]] || fail_closed

set +e
node "$hook_script"
status=$?
set -e
(( status == 0 )) || exit 2
