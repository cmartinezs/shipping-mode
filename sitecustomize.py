from pathlib import Path

helper = Path("scripts/pr26-review-fix.py")
if helper.exists():
    text = helper.read_text(encoding="utf-8")
    old = '''  const result = checkWorkSources({ planningRoot, workspaceRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.sources[0].contractTests.itemCount, 1, ".planning must never be traversed by a broad local root");
}'''
    new = '''  const result = checkWorkSources({ planningRoot, workspaceRoot });
  assert.equal(result.status, "FAIL", "the workspace root is rejected before provider discovery");
  assert.match(result.findings.join("\\n"), /SOURCE_MISCONFIGURED/);
}'''
    if old not in text:
        raise RuntimeError("PR 26 broad-root fixture anchor not found")
    helper.write_text(text.replace(old, new, 1), encoding="utf-8")

Path(__file__).unlink(missing_ok=True)
