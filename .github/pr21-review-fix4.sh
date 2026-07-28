#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
p = Path('runtime/tests/cli-e2e.test.mjs')
text = p.read_text(encoding='utf-8')
old = '''  const sameKey = run(["release", "new", "--title", "Release Core", "--objective", "Create release aggregate core", "--idempotency-key", "cli-release-core", "--actor", "carlos"], cwd);
  assert.equal(sameKey.json.operationId, release.json.operationId, "same idempotency key must not mint a second Release");
  assert.equal(fs.readdirSync(path.join(cwd, ".planning", "releases")).length, 1);'''
new = '''  const sameKey = run(["release", "new", "--title", "Release Core", "--objective", "Create release aggregate core", "--slug", "release-core", "--idempotency-key", "cli-release-core", "--actor", "carlos"], cwd);
  assert.equal(sameKey.code, 0);
  assert.equal(sameKey.json.operationId, release.json.operationId, "same idempotency key and request must not mint a second Release");
  assert.equal(sameKey.json.releaseId, release.json.releaseId);
  assert.equal(sameKey.json.displayId, release.json.displayId);
  assert.equal(sameKey.json.idempotent, true);
  const conflictingKeyReuse = run(["release", "new", "--title", "Release Core", "--objective", "Different request", "--slug", "release-core", "--idempotency-key", "cli-release-core", "--actor", "carlos"], cwd);
  assert.equal(conflictingKeyReuse.code, 1, "same idempotency key with a different request must fail closed");
  assert.match(conflictingKeyReuse.json.error, /idempotency key .* different release\\.create request/);
  assert.equal(fs.readdirSync(path.join(cwd, ".planning", "releases")).length, 1);'''
if old not in text:
    raise SystemExit('CLI idempotency snippet not found')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
PY
