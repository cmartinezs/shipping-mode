from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"pattern not unique in {path}: {text.count(old)} matches")
    p.write_text(text.replace(old, new, 1))

# 1) check schema must never report PASS while a mutation/recovery is pending.
replace_once(
    "runtime/src/commands/check.mjs",
    '  return { status: findings.length === 0 ? "PASS" : "FAIL", findings, pendingOperations };\n',
    '  const status = findings.length > 0 ? "FAIL" : pendingOperations.length > 0 ? "RECOVERY_REQUIRED" : "PASS";\n  return { status, findings, pendingOperations };\n'
)

# 2) public Discovery scans fail closed while canonical catalog state is in-flight/recoverable.
replace_once(
    "runtime/src/lib/discoverScan.mjs",
    'import { UsageError } from "./errors.mjs";\n',
    'import { UsageError, StateError } from "./errors.mjs";\nimport { readOperation } from "./operationStore.mjs";\n'
)
replace_once(
    "runtime/src/lib/discoverScan.mjs",
    'export function runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES }) {\n  if (maxSourceBytes < MIN_MAX_SOURCE_BYTES || maxSourceBytes > MAX_MAX_SOURCE_BYTES) {\n    throw new UsageError(`--max-source-bytes must be between ${MIN_MAX_SOURCE_BYTES} and ${MAX_MAX_SOURCE_BYTES}, got ${maxSourceBytes}`);\n  }\n',
    '''export function pendingCatalogMutations(planningRoot) {\n  const operationsRoot = path.join(planningRoot, "operations");\n  if (!fs.existsSync(operationsRoot)) return [];\n  const pending = [];\n  for (const operationId of fs.readdirSync(operationsRoot)) {\n    if (!isUuidV7(operationId)) continue;\n    let operation;\n    try {\n      operation = readOperation(operationsRoot, operationId);\n    } catch {\n      continue;\n    }\n    if (operation.status === "APPLYING" || operation.status === "RECOVERY_REQUIRED") {\n      pending.push({ operationId, status: operation.status });\n    }\n  }\n  return pending.sort((a, b) => a.operationId.localeCompare(b.operationId));\n}\n\nexport function assertConfirmedCatalogReadable(planningRoot) {\n  const pending = pendingCatalogMutations(planningRoot);\n  if (pending.length === 0) return;\n  const detail = pending.map((entry) => `${entry.operationId}:${entry.status}`).join(", ");\n  throw new StateError(`confirmed catalog unavailable while recovery is required: ${detail}`);\n}\n\nexport function runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES }) {\n  if (maxSourceBytes < MIN_MAX_SOURCE_BYTES || maxSourceBytes > MAX_MAX_SOURCE_BYTES) {\n    throw new UsageError(`--max-source-bytes must be between ${MIN_MAX_SOURCE_BYTES} and ${MAX_MAX_SOURCE_BYTES}, got ${maxSourceBytes}`);\n  }\n  assertConfirmedCatalogReadable(planningRoot);\n'''
)

# 3) existing unit-level pending check now proves the fail-closed status too.
replace_once(
    "runtime/src/commands/tests/check.test.mjs",
    '''  const result = checkSchema({ planningRoot });\n  assert.equal(result.pendingOperations.length, 1);\n  assert.equal(result.pendingOperations[0].status, "APPLYING");\n''',
    '''  const result = checkSchema({ planningRoot });\n  assert.equal(result.status, "RECOVERY_REQUIRED", "pending canonical mutation must never be reported as PASS");\n  assert.equal(result.pendingOperations.length, 1);\n  assert.equal(result.pendingOperations[0].status, "APPLYING");\n'''
)

# 4) real crash E2E proves both health check and public scan fail closed, then recover.
replace_once(
    "runtime/tests/discovery-real-crash-e2e.test.mjs",
    '''const checkAfterCrash = run(["check", "schema"], cwd);\nassert.equal(checkAfterCrash.code, 0);\nassert.ok(checkAfterCrash.json.pendingOperations.some((entry) => entry.operationId === operationId && entry.status === "APPLYING"), "mixed catalog must be reported with a pending operation");\n''',
    '''const checkAfterCrash = run(["check", "schema"], cwd);\nassert.equal(checkAfterCrash.code, 1, "a partially applied catalog must never pass health checks");\nassert.equal(checkAfterCrash.json.status, "RECOVERY_REQUIRED");\nassert.ok(checkAfterCrash.json.pendingOperations.some((entry) => entry.operationId === operationId && entry.status === "APPLYING"), "mixed catalog must be reported with a pending operation");\n\nconst scanAfterCrash = run(["discover", "scan", "--max-source-bytes", "1048576"], cwd);\nassert.equal(scanAfterCrash.code, 1, "public Discovery reads must fail closed while recovery is pending");\nassert.match(scanAfterCrash.json.error, /confirmed catalog unavailable while recovery is required/);\n'''
)
replace_once(
    "runtime/tests/discovery-real-crash-e2e.test.mjs",
    '''assert.equal(checkAfterRecovery.json.status, "PASS");\nassert.deepEqual(checkAfterRecovery.json.pendingOperations, []);\n''',
    '''assert.equal(checkAfterRecovery.json.status, "PASS");\nassert.deepEqual(checkAfterRecovery.json.pendingOperations, []);\nassert.equal(run(["discover", "scan", "--max-source-bytes", "1048576"], cwd).code, 0, "Discovery reads resume only after recovery has restored a confirmed catalog");\n'''
)

# 5) real public-binary unreadable-source E2E where POSIX permissions are enforceable.
replace_once(
    "runtime/tests/discovery-e2e.test.mjs",
    '''console.log("discovery-e2e: public Discovery semantics, human/autonomous approval, stale policy, and workspace stale paths pass");\n''',
    '''// Real unreadable-source E2E when the host can enforce POSIX file permissions.\n// Root and Windows keep the deterministic injected-EACCES unit coverage instead.\nif (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0) {\n  const cwd = freshWorkspace("discovery-unreadable-e2e-");\n  initWorkspace(cwd);\n  writePackage(cwd, "api", "{\\\"name\\\":\\\"api\\\"}\\n");\n  const unreadablePath = path.join(cwd, "api", "package.json");\n  fs.chmodSync(unreadablePath, 0o000);\n  try {\n    const scanned = run(["discover", "scan", "--max-source-bytes", "1048576"], cwd);\n    assert.equal(scanned.code, 0);\n    assert.ok(scanned.json.diagnostics.some((entry) => entry.code === "unreadable" && entry.path === "api/package.json"), "real unreadable source must produce a hard diagnostic");\n    assert.equal(scanned.json.sourceCandidates.some((entry) => entry.path === "api/package.json"), false, "an unreadable candidate must not be emitted as successfully observed evidence");\n  } finally {\n    fs.chmodSync(unreadablePath, 0o600);\n  }\n} else {\n  console.log("discovery-e2e: unreadable-source OS-permission case skipped (root/Windows); injected EACCES coverage remains active");\n}\n\nconsole.log("discovery-e2e: public Discovery semantics, human/autonomous approval, stale policy, workspace stale, and unreadable-source paths pass");\n'''
)

# 6) closure documentation reflects the stronger evidence and bug fixed during review.
replace_once(
    "docs/superpowers/plans/2026-07-26-discovery-e2e-dod-closure.md",
    '| H.1 unreadable source hard diagnostic | `runtime/src/lib/tests/fingerprint-file.test.mjs`, `runtime/src/lib/tests/fingerprint-directory.test.mjs` | COVERED | Real user-switch CLI remains environment-dependent per spec wording. | Reuse injected EACCES coverage; document no new privileged user-switch test. |',
    '| H.1 unreadable source hard diagnostic | `runtime/src/lib/tests/fingerprint-file.test.mjs`, `runtime/src/lib/tests/fingerprint-directory.test.mjs`, `runtime/tests/discovery-e2e.test.mjs` | COVERED | None on POSIX non-root environments; root/Windows explicitly skip the OS-permission case while injected EACCES remains mandatory. | Plan 5 adds a real public-binary `chmod(000)` E2E whenever host permissions are enforceable. |'
)
replace_once(
    "docs/superpowers/plans/2026-07-26-discovery-e2e-dod-closure.md",
    '- Fixed one real bug found during closure: `setFaultCheckpoint()` still referenced the removed `hardExitOnCheckpoint` variable after adding the wait-for-kill test hook. The fix restores Corte 0 simulated-crash tests and keeps the new SIGKILL path test-only.\n',
    '- Fixed one real bug found during closure: `setFaultCheckpoint()` still referenced the removed `hardExitOnCheckpoint` variable after adding the wait-for-kill test hook. The fix restores Corte 0 simulated-crash tests and keeps the new SIGKILL path test-only.\n- Fixed a second closure bug found in review: `check schema` could report `PASS` and `discover scan` could read canonical state while an operation was `APPLYING`/`RECOVERY_REQUIRED`. Pending canonical mutations now fail closed until Corte 0 recovery restores a confirmed catalog.\n- Added a real public-binary unreadable-source E2E using POSIX permissions when enforceable; root/Windows explicitly skip that OS-dependent case while deterministic injected-EACCES tests remain required.\n'
)

print("PR14 review fixes applied")
