#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS_ROOT="${NEXT_GENERATION_DOCS_ROOT:-$ROOT/docs/plugin-redesign-release-flow}"
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

command -v node >/dev/null 2>&1 || fail "Node.js 20+ is required"
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || fail "Node.js 20+ is required"

if [[ "${VERIFY_NEXT_GENERATION_SKIP_TESTS:-0}" != "1" ]]; then
  (cd "$ROOT" && npm ci --silent)
  (cd "$ROOT" && npm run --silent verify:artifacts)
  (cd "$ROOT" && npm run --silent build:test-bundle)
  (cd "$ROOT" && node hooks/tests/protect-planning-state.test.mjs)
  (cd "$ROOT" && node spikes/tests/verify-corte-1.2.test.mjs)
  (cd "$ROOT" && node scripts/tests/verify-next-generation.test.mjs)
  (cd "$ROOT" && node spikes/host-integration/tests/host-integration.test.mjs)
  (cd "$ROOT" && npm run --silent test:unit)
  (cd "$ROOT" && npm run --silent test:cli-e2e)
  (cd "$ROOT" && npm run --silent test:real-crash-e2e)
  (cd "$ROOT" && npm run --silent test:security-e2e)
  (cd "$ROOT" && npm run --silent test:bundle)
  (cd "$ROOT" && node spikes/verify-corte-1.2.mjs --structure-only)
fi

for required in hooks/hooks.json package.json scripts/protect-planning-state-hook.sh scripts/protect-planning-state.mjs; do
  [[ -f "$ROOT/$required" ]] || fail "$required is missing"
done
[[ -x "$ROOT/scripts/protect-planning-state-hook.sh" ]] || fail "planning hook wrapper is not executable"

manifest_count="$(find "$ROOT/spikes" -mindepth 2 -maxdepth 2 -name spike.json | wc -l | tr -d ' ')"
[[ "$manifest_count" == 6 ]] || fail "six spike manifests are required"
node "$ROOT/scripts/scan-next-generation-docs.mjs" "$DOCS_ROOT"

node -e 'const p=require("./package.json"); if (!p.engines || p.engines.node !== ">=20") process.exit(1)' --input-type=commonjs --no-warnings 2>/dev/null || fail "package.json must require Node >=20"
for manifest in "$ROOT"/spikes/*/spike.json; do
  node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if ("decision_record" in m || ![...(m.pass_criteria||[]), ...(m.fail_criteria||[])].every(c => ["PENDING","PASSED","FAILED","NOT_APPLICABLE"].includes(c.status))) process.exit(1)' "$manifest" || fail "invalid spike criteria in $manifest"
done
pass "next-generation contract verification passed"
