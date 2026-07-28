#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
p = Path('runtime/tests/cli-e2e.test.mjs')
text = p.read_text(encoding='utf-8')
old = 'assert.match(release.json.displayId, /^REL-[0-9A-F]{8}/);'
new = 'assert.match(release.json.displayId, /^REL-[0-9A-HJKMNP-TV-Z]{8}$/);'
if old not in text:
    raise SystemExit('CLI display ID assertion not found')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
PY
