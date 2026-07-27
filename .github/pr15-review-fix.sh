#!/usr/bin/env bash
set -euo pipefail

python3 <<'PY'
from pathlib import Path
import json

ROOT = Path('.')
UUIDV7 = r'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
DIRECTORY_HASH = '20dc703a130e4ad628a2659be71da655ef204d7c774431a82908cf46c2498c75'

def replace_once(path, old, new):
    p = ROOT / path
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing expected text in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'expected exactly one match in {path}, found {text.count(old)}')
    p.write_text(text.replace(old, new, 1))

# Project Context rendering: do not guess software, and keep the canonical scope catalog
# synchronized by UUIDv7 whenever a scope is added.
replace_once('runtime/src/commands/renderers.mjs',
'''function toKebabCase(value) {\n  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");\n}\n\nexport function renderWorkspaceInit({ name, baseBranch = null, vcs, pluginVersion, templatePackFingerprint }) {''',
'''function toKebabCase(value) {\n  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");\n}\n\nfunction withEnabledScope(config, scopeId) {\n  const currentCatalog = config.scopeCatalog || { directory: ".planning/scopes", enabled: [] };\n  return {\n    ...config,\n    scopeCatalog: {\n      ...currentCatalog,\n      enabled: [...new Set([...(currentCatalog.enabled || []), scopeId])]\n    }\n  };\n}\n\nexport function renderWorkspaceInit({ name, baseBranch = null, vcs, projectType = "unknown", pluginVersion, templatePackFingerprint }) {''')
replace_once('runtime/src/commands/renderers.mjs', 'project: { name, type: "software" },', 'project: { name, type: projectType },')
replace_once('runtime/src/commands/renderers.mjs',
'''  const nextConfig = {\n    ...currentConfig,\n    scopeRefs: [...(currentConfig.scopeRefs || []), { id, key: normalizedKey }]\n  };''',
'''  const nextConfig = withEnabledScope({\n    ...currentConfig,\n    scopeRefs: [...(currentConfig.scopeRefs || []), { id, key: normalizedKey }]\n  }, id);''')
replace_once('runtime/src/commands/renderers.mjs',
'''    nextConfig = {\n      ...nextConfig,\n      scopeRefs: [...(nextConfig.scopeRefs || []), { id: scopeId, key: scope.key }]\n    };''',
'''    nextConfig = withEnabledScope({\n      ...nextConfig,\n      scopeRefs: [...(nextConfig.scopeRefs || []), { id: scopeId, key: scope.key }]\n    }, scopeId);''')

# init must allow the caller to confirm project type; absence is explicitly unknown.
replace_once('runtime/src/commands/init.mjs',
'''    name: args.name,\n    baseBranch: args.baseBranch || null,''',
'''    name: args.name,\n    projectType: args.projectType || "unknown",\n    baseBranch: args.baseBranch || null,''')

replace_once('runtime/src/index.mjs',
'''const IN_SCOPE_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set"]);\n''',
'''const IN_SCOPE_KINDS = new Set(["workspace.init", "config.update", "config.autonomy.set", "scope.add", "scope.command.set"]);\nconst PROJECT_TYPES = new Set(["software", "non_software", "mixed", "unknown"]);\n\nfunction requireProjectType(value) {\n  if (value === undefined) return "unknown";\n  if (!PROJECT_TYPES.has(value)) {\n    throw new UsageError("--project-type must be one of software|non_software|mixed|unknown");\n  }\n  return value;\n}\n''')
replace_once('runtime/src/index.mjs',
'''    return runInit({ planningRoot, args: { name: options.name, vcs: options.vcs, baseBranch: options.base_branch, actor: options.actor } });''',
'''    return runInit({ planningRoot, args: { name: options.name, projectType: requireProjectType(options.project_type), vcs: options.vcs, baseBranch: options.base_branch, actor: options.actor } });''')

replace_once('bin/shipping-mode.mjs',
'''      "init --name <name> [--base-branch <b>] [--vcs git|none] --actor <actor>",''',
'''      "init --name <name> [--project-type software|non_software|mixed|unknown] [--base-branch <b>] [--vcs git|none] --actor <actor>",''')

# Schema changes: canonical scope refs use UUIDv7, init accepts projectType, and mkdir
# carries a server-known deterministic directory marker hash.
config_path = ROOT / 'runtime/src/schemas/config.schema.json'
config = json.loads(config_path.read_text())
config['properties']['scopeCatalog']['properties']['enabled']['items'] = {'type': 'string', 'pattern': UUIDV7}
config_path.write_text(json.dumps(config, indent=2) + '\n')

cs_path = ROOT / 'runtime/src/schemas/change-set.schema.json'
cs = json.loads(cs_path.read_text())
workspace_payload = cs['allOf'][0]['then']['properties']['payload']['properties']
workspace_payload['projectType'] = {'enum': ['software', 'non_software', 'mixed', 'unknown']}
cs_path.write_text(json.dumps(cs, indent=2) + '\n')

op_path = ROOT / 'runtime/src/schemas/operation.schema.json'
op = json.loads(op_path.read_text())
file_plan_item = op['properties']['filePlan']['items']
mkdir_rule = next(rule for rule in file_plan_item['allOf'] if rule.get('if', {}).get('properties', {}).get('action', {}).get('const') == 'mkdir')
mkdir_rule['then'] = {
    'properties': {
        'stagedContentHash': {'const': DIRECTORY_HASH},
        'stagedRevisionHash': {'const': DIRECTORY_HASH}
    },
    'not': {'required': ['stagedRelativePath']}
}
op_path.write_text(json.dumps(op, indent=2) + '\n')

result_path = ROOT / 'runtime/src/schemas/result.schema.json'
result = json.loads(result_path.read_text())
result_item = result['properties']['files']['items']
result_item['allOf'] = [{
    'if': {'properties': {'action': {'const': 'mkdir'}}},
    'then': {'properties': {'contentHash': {'const': DIRECTORY_HASH}}}
}]
result_path.write_text(json.dumps(result, indent=2) + '\n')

# check schema must validate the relational integrity introduced by keeping compatibility
# fields alongside the new canonical Project Context representation.
replace_once('runtime/src/commands/check.mjs',
'''function checkRequiredFile(planningRoot, relativePath, schemaName, findings) {\n  let filePath;\n  try {\n    filePath = confineWritePath(planningRoot, relativePath);\n  } catch (error) {\n    findings.push(`${relativePath}: untrusted path (${error.message})`);\n    return;\n  }\n  if (!fs.existsSync(filePath)) {\n    findings.push(`${relativePath}: required file is missing`);\n    return;\n  }\n  let value;\n  try {\n    value = parseYaml(fs.readFileSync(filePath, "utf8"));\n  } catch (error) {\n    findings.push(`${relativePath}: failed to parse (${error.message})`);\n    return;\n  }\n  const result = validate(schemaName, value);\n  if (!result.valid) {\n    for (const error of result.errors) findings.push(`${relativePath}${error.path}: ${error.message}`);\n  }\n}\n''',
'''function checkRequiredFile(planningRoot, relativePath, schemaName, findings) {\n  let filePath;\n  try {\n    filePath = confineWritePath(planningRoot, relativePath);\n  } catch (error) {\n    findings.push(`${relativePath}: untrusted path (${error.message})`);\n    return null;\n  }\n  if (!fs.existsSync(filePath)) {\n    findings.push(`${relativePath}: required file is missing`);\n    return null;\n  }\n  let value;\n  try {\n    value = parseYaml(fs.readFileSync(filePath, "utf8"));\n  } catch (error) {\n    findings.push(`${relativePath}: failed to parse (${error.message})`);\n    return null;\n  }\n  const result = validate(schemaName, value);\n  if (!result.valid) {\n    for (const error of result.errors) findings.push(`${relativePath}${error.path}: ${error.message}`);\n    return null;\n  }\n  return value;\n}\n''')
replace_once('runtime/src/commands/check.mjs',
'''function checkRequiredDirectory(planningRoot, relativePath, findings) {''',
'''function checkProjectContextConsistency(config, findings) {\n  if (!config) return;\n  if (config.project.name !== config.name) {\n    findings.push("config.yml: project.name must match compatibility field name");\n  }\n  const scopeRefIds = new Set((config.scopeRefs || []).map((entry) => entry.id));\n  for (const enabledId of config.scopeCatalog.enabled || []) {\n    if (!scopeRefIds.has(enabledId)) {\n      findings.push(`config.yml: scopeCatalog.enabled references unknown scope id ${enabledId}`);\n    }\n  }\n}\n\nfunction checkPluginLockConsistency(pluginLock, findings) {\n  if (!pluginLock) return;\n  if (pluginLock.plugin.version !== pluginLock.pluginVersion) {\n    findings.push("plugin.lock.yml: plugin.version must match compatibility field pluginVersion");\n  }\n  if (pluginLock.plugin.templatePack.fingerprint !== pluginLock.templatePackFingerprint) {\n    findings.push("plugin.lock.yml: plugin.templatePack.fingerprint must match compatibility field templatePackFingerprint");\n  }\n  const expectedVendorSnapshot = `.planning/vendor/template-packs/${pluginLock.templatePackFingerprint.replace(":", "-")}`;\n  if (pluginLock.plugin.templatePack.vendorSnapshot !== expectedVendorSnapshot) {\n    findings.push("plugin.lock.yml: plugin.templatePack.vendorSnapshot must be derived from templatePackFingerprint");\n  }\n}\n\nfunction checkRequiredDirectory(planningRoot, relativePath, findings) {''')
replace_once('runtime/src/commands/check.mjs',
'''  checkRequiredFile(planningRoot, "config.yml", "config", findings);\n  checkRequiredFile(planningRoot, "plugin.lock.yml", "plugin-lock", findings);''',
'''  const config = checkRequiredFile(planningRoot, "config.yml", "config", findings);\n  const pluginLock = checkRequiredFile(planningRoot, "plugin.lock.yml", "plugin-lock", findings);\n  checkProjectContextConsistency(config, findings);\n  checkPluginLockConsistency(pluginLock, findings);''')

# Renderer tests: default is unknown; explicit types work; canonical enabled refs are UUIDv7.
replace_once('runtime/src/commands/tests/renderers.test.mjs',
'''assert.equal(parsedConfig.project.type, "software");''',
'''assert.equal(parsedConfig.project.type, "unknown");\nconst explicitTypeConfig = parseYaml(renderWorkspaceInit({ name: "mixed-demo", projectType: "mixed", baseBranch: null, vcs: "none", pluginVersion: "1.0.0", templatePackFingerprint: `sha256:${"a".repeat(64)}` }).get("config.yml"));\nassert.equal(explicitTypeConfig.project.type, "mixed");''')
replace_once('runtime/src/commands/tests/renderers.test.mjs',
'''assert.equal(parsedScope.id, scopeId, "the scope id must be the one already fixed in the payload, never regenerated");''',
'''assert.equal(parsedScope.id, scopeId, "the scope id must be the one already fixed in the payload, never regenerated");\nassert.deepEqual(parseYaml(scopeFiles.get("config.yml")).scopeCatalog.enabled, [scopeId], "new scopes must be enabled by canonical UUIDv7 reference");''')
replace_once('runtime/src/commands/tests/renderers.test.mjs',
'''assert.equal(parseYaml(discoveryFiles.get("config.yml")).scopeRefs[0].id, newScopeId);''',
'''const discoveryConfig = parseYaml(discoveryFiles.get("config.yml"));\nassert.equal(discoveryConfig.scopeRefs[0].id, newScopeId);\nassert.deepEqual(discoveryConfig.scopeCatalog.enabled, [newScopeId], "Discovery-added scopes must update the canonical enabled catalog");''')

# Config schema facade: a canonical enabled scope uses its UUID, never its decorative key.
replace_once('runtime/src/lib/tests/schema.test.mjs',
'''assert.deepEqual(result.errors, []);\n\nconst invalidConfig =''',
'''assert.deepEqual(result.errors, []);\n\nconst scopeId = "018f0000-0000-7000-8000-000000000123";\nconst configWithEnabledScope = structuredClone(validConfig);\nconfigWithEnabledScope.scopeRefs = [{ id: scopeId, key: "backend" }];\nconfigWithEnabledScope.scopeCatalog.enabled = [scopeId];\nassert.equal(validate("config", configWithEnabledScope).valid, true, "scopeCatalog.enabled must accept primary UUIDv7 refs");\nconst configWithDecorativeEnabledKey = structuredClone(configWithEnabledScope);\nconfigWithDecorativeEnabledKey.scopeCatalog.enabled = ["backend"];\nassert.equal(validate("config", configWithDecorativeEnabledKey).valid, false, "scopeCatalog.enabled must not use decorative keys as primary refs");\n\nconst invalidConfig =''')

# Operation/result fixtures prove a forged mkdir marker cannot pass structural validation.
replace_once('runtime/src/lib/tests/schema-fixtures.test.mjs',
'''import { validate } from "../schema.mjs";''',
'''import { validate } from "../schema.mjs";\nimport { DIRECTORY_CONTENT_HASH } from "../bootstrapTopology.mjs";''')
replace_once('runtime/src/lib/tests/schema-fixtures.test.mjs',
'''  filePlan: [{ target: "vendor/template-packs", action: "mkdir", expectedBefore: "ABSENT", beforeContentHash: "ABSENT", beforeRevisionHash: "ABSENT", stagedContentHash: "d".repeat(64), stagedRevisionHash: "d".repeat(64) }],''',
'''  filePlan: [{ target: "vendor/template-packs", action: "mkdir", expectedBefore: "ABSENT", beforeContentHash: "ABSENT", beforeRevisionHash: "ABSENT", stagedContentHash: DIRECTORY_CONTENT_HASH, stagedRevisionHash: DIRECTORY_CONTENT_HASH }],''')
replace_once('runtime/src/lib/tests/schema-fixtures.test.mjs',
'''assert.equal(validate("operation", mkdirFilePlanOperation).valid, true, "mkdir filePlan entries must be schema-valid");\nassert.equal(validate("result", { operationId: opBase.id, files: [{ target: "vendor/template-packs", action: "mkdir", contentHash: "d".repeat(64) }] }).valid, true, "mkdir result entries must be schema-valid");''',
'''assert.equal(validate("operation", mkdirFilePlanOperation).valid, true, "mkdir filePlan entries must be schema-valid");\nconst forgedMkdirOperation = structuredClone(mkdirFilePlanOperation);\nforgedMkdirOperation.filePlan[0].stagedContentHash = "d".repeat(64);\nassert.equal(validate("operation", forgedMkdirOperation).valid, false, "mkdir stagedContentHash is server-owned and must not be forgeable");\nassert.equal(validate("result", { operationId: opBase.id, files: [{ target: "vendor/template-packs", action: "mkdir", contentHash: DIRECTORY_CONTENT_HASH }] }).valid, true, "mkdir result entries must carry the canonical directory marker");\nassert.equal(validate("result", { operationId: opBase.id, files: [{ target: "vendor/template-packs", action: "mkdir", contentHash: "d".repeat(64) }] }).valid, false, "mkdir result entries must reject arbitrary content hashes");''')

# check schema relational integrity tests.
replace_once('runtime/src/commands/tests/check.test.mjs',
'''// missing required bootstrap topology -- FAIL, and check schema remains query-only''',
'''// canonical/compatibility Project Context fields must not silently diverge.\n{\n  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-context-drift-"));\n  writeValidBaseFiles(planningRoot);\n  ensureBaseTopology(planningRoot);\n  const configPath = path.join(planningRoot, "config.yml");\n  const config = parseYaml(fs.readFileSync(configPath, "utf8"));\n  config.project.name = "different-name";\n  fs.writeFileSync(configPath, stringifyYaml(config));\n  const result = checkSchema({ planningRoot });\n  assert.equal(result.status, "FAIL");\n  assert.ok(result.findings.some((finding) => finding.includes("project.name")));\n}\n\n// scopeCatalog.enabled contains primary ids and cannot point at an unknown scope ref.\n{\n  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-enabled-scope-drift-"));\n  writeValidBaseFiles(planningRoot);\n  ensureBaseTopology(planningRoot);\n  const configPath = path.join(planningRoot, "config.yml");\n  const config = parseYaml(fs.readFileSync(configPath, "utf8"));\n  config.scopeCatalog.enabled = ["018f0000-0000-7000-8000-000000000123"];\n  fs.writeFileSync(configPath, stringifyYaml(config));\n  const result = checkSchema({ planningRoot });\n  assert.equal(result.status, "FAIL");\n  assert.ok(result.findings.some((finding) => finding.includes("scopeCatalog.enabled") && finding.includes("unknown scope id")));\n}\n\n// structured plugin lock metadata must agree with the temporary compatibility fields.\n{\n  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-plugin-lock-drift-"));\n  writeValidBaseFiles(planningRoot);\n  ensureBaseTopology(planningRoot);\n  const lockPath = path.join(planningRoot, "plugin.lock.yml");\n  const pluginLock = parseYaml(fs.readFileSync(lockPath, "utf8"));\n  pluginLock.plugin.version = "9.9.9";\n  fs.writeFileSync(lockPath, stringifyYaml(pluginLock));\n  const result = checkSchema({ planningRoot });\n  assert.equal(result.status, "FAIL");\n  assert.ok(result.findings.some((finding) => finding.includes("plugin.version")));\n}\n\n// missing required bootstrap topology -- FAIL, and check schema remains query-only''')

# Public CLI: explicit project type is accepted and invalid values fail before propose.
replace_once('runtime/tests/cli-e2e.test.mjs',
'''  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);\n  assert.equal(init.code, 0);''',
'''  const init = run(["init", "--name", "demo", "--project-type", "software", "--vcs", "git", "--actor", "carlos"], cwd);\n  assert.equal(init.code, 0);''')
replace_once('runtime/tests/cli-e2e.test.mjs',
'''// config set''',
'''// invalid project type is rejected before an operation is proposed.\n{\n  const cwd = freshWorkspace();\n  const result = run(["init", "--name", "demo", "--project-type", "invalid", "--actor", "carlos"], cwd);\n  assert.equal(result.code, 1);\n  assert.match(result.json.error, /--project-type/);\n}\n\n// config set''')

# Record the review findings in the Plan 1 execution evidence.
plan = ROOT / 'docs/superpowers/plans/2026-07-27-corte-0-completion-plan-1-project-context-bootstrap.md'
plan_text = plan.read_text()
append = '''\n\n## Post-review corrections\n\nThe PR review found and closed four Plan 1 integrity gaps before merge:\n\n- `project.type` is no longer guessed as `software`; `init` accepts an explicit\n  `--project-type` and otherwise persists `unknown`.\n- `scopeCatalog.enabled` now uses UUIDv7 primary references and is updated by both\n  explicit `scope.add` and Discovery scope creation, instead of silently drifting\n  from the canonical scope catalog.\n- `check schema` now rejects divergence between canonical Project Context/plugin-lock\n  fields and the temporary compatibility fields retained during Corte 0 Completion.\n- `mkdir` filePlan/result entries now require the deterministic server-owned directory\n  marker hash, so corrupted operation metadata cannot be accepted as a valid recovered\n  directory mutation.\n'''
if '## Post-review corrections' not in plan_text:
    plan.write_text(plan_text.rstrip() + append + '\n')
PY

# Restore the trusted workflow and remove this temporary helper before producing the
# final commit. HEAD^ is the helper-file commit, where the normal workflow was intact.
git show HEAD^:.github/workflows/runtime-foundation.yml > .github/workflows/runtime-foundation.yml
rm -f .github/pr15-review-fix.sh

npm ci --silent
npm run build:schemas
npm run build:runtime
npm run build:test-bundle
npm run test:unit
npm run test:cli-e2e
npm run test:real-crash-e2e
npm run test:security-e2e
npm run test:bundle
npm run verify:artifacts
npm run verify:next-generation
git diff --check

git config user.name "shipping-mode-review-bot"
git config user.email "shipping-mode-review-bot@users.noreply.github.com"
git add -A
git diff --cached --check
git commit -m "fix(corte-0): address Plan 1 review findings"
git push origin HEAD:agent/corte-0-plan-1-project-context-bootstrap
