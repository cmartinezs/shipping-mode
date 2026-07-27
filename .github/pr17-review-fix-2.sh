#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path

p = Path("runtime/src/commands/renderers.mjs")
text = p.read_text()

wrong_scope_add = '''      gaps: [...(documentation.gaps || []), {
        id: scopeAssignment.guideGapId,
        concern: "guides",
        status: "missing",
        description: `scope ${normalizedKey} has no approved guide`,
        scope_ref: id
      }]
'''
right_scope_add = '''      gaps: [...(documentation.gaps || []), {
        id: guideGapId,
        concern: "guides",
        status: "missing",
        description: `scope ${normalizedKey} has no approved guide`,
        scope_ref: id
      }]
'''
if wrong_scope_add in text:
    text = text.replace(wrong_scope_add, right_scope_add, 1)
elif right_scope_add not in text:
    raise SystemExit("could not locate scope.add guide gap block")

discovery_old = '''        gaps: [...(nextConfig.documentation?.gaps || []), {
          id: scopeId,
          concern: "guides",
          status: "missing",
          description: `scope ${scope.key} has no approved guide`,
          scope_ref: scopeId
        }]
'''
discovery_new = '''        gaps: [...(nextConfig.documentation?.gaps || []), {
          id: scopeAssignment.guideGapId,
          concern: "guides",
          status: "missing",
          description: `scope ${scope.key} has no approved guide`,
          scope_ref: scopeId
        }]
'''
if discovery_new not in text:
    if discovery_old not in text:
        raise SystemExit("could not locate Discovery guide gap block")
    text = text.replace(discovery_old, discovery_new, 1)

p.write_text(text.rstrip() + "\n")
PY

git diff --check
