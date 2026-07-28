#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
p = Path('runtime/src/commands/tests/commands.test.mjs')
text = p.read_text(encoding='utf-8')
old = '''    objective: "Create the Release aggregate core",
    idempotencyKey: "release-core-key",
    actor: "carlos"
  }
});
assert.equal(idempotent.operationId, releaseCreate.operationId);'''
new = '''    objective: "Create the Release aggregate core",
    slug: "ignored-for-identity",
    idempotencyKey: "release-core-key",
    actor: "carlos"
  }
});
assert.equal(idempotent.operationId, releaseCreate.operationId);'''
if old not in text:
    raise SystemExit('idempotent regression snippet not found')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
PY
