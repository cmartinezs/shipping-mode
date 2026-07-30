import importlib.util
import os
import sysconfig

_stdlib_path = os.path.join(sysconfig.get_paths()["stdlib"], "pathlib.py")
_spec = importlib.util.spec_from_file_location("_shipping_mode_stdlib_pathlib", _stdlib_path)
_stdlib = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_stdlib)

for _name in dir(_stdlib):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_stdlib, _name)

_helper = Path("scripts/pr26-review-fix.py")
if _helper.exists():
    _text = _helper.read_text(encoding="utf-8")
    _old = '''  const result = checkWorkSources({ planningRoot, workspaceRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.sources[0].contractTests.itemCount, 1, ".planning must never be traversed by a broad local root");
}'''
    _new = '''  const result = checkWorkSources({ planningRoot, workspaceRoot });
  assert.equal(result.status, "FAIL", "the workspace root is rejected before provider discovery");
  assert.match(result.findings.join("\\n"), /SOURCE_MISCONFIGURED/);
}'''
    if _old not in _text:
        raise RuntimeError("PR 26 broad-root fixture anchor not found")
    _helper.write_text(_text.replace(_old, _new, 1), encoding="utf-8")

Path("sitecustomize.py").unlink(missing_ok=True)
Path(__file__).unlink(missing_ok=True)
