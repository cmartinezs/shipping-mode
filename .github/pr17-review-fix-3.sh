#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path
p = Path("runtime/src/lib/tests/schema-fixtures.test.mjs")
text = p.read_text()
old = '    scopeIdAssignments: [{ scopeIndex: 0, scopeId: "018f0000-0000-7000-8000-000000000003" }],'
new = '    scopeIdAssignments: [{ scopeIndex: 0, scopeId: "018f0000-0000-7000-8000-000000000003", guideGapId: "018f0000-0000-7000-8000-000000000004" }],'
if new not in text:
    if old not in text:
        raise SystemExit("missing discovery change-set schema fixture")
    text = text.replace(old, new, 1)
p.write_text(text.rstrip() + "\n")
PY

git diff --check
