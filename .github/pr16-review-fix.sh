#!/usr/bin/env bash
set -euo pipefail

python3 <<'PY'
from pathlib import Path
import json

ROOT = Path('.')

def replace_once(path, old, new):
    p = ROOT / path
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing expected text in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'expected exactly one match in {path}, found {text.count(old)}')
    p.write_text(text.replace(old, new, 1))

# Shared Project Context relational validation. It is used both by render-time
# ChangeSet validation and by query-only check schema so invalid state cannot be
# persisted and then merely discovered afterwards.
(ROOT / 'runtime/src/lib/projectContextValidation.mjs').write_text('''import path from "node:path";\n\nexport function projectContextConsistencyFindings(config) {\n  const findings = [];\n  if (!config || typeof config !== "object") return findings;\n\n  if (config.project?.name !== config.name) {\n    findings.push("config.yml: project.name must match compatibility field name");\n  }\n\n  const scopeRefIds = new Set((config.scopeRefs || []).map((entry) => entry.id));\n  for (const enabledId of config.scopeCatalog?.enabled || []) {\n    if (!scopeRefIds.has(enabledId)) {\n      findings.push(`config.yml: scopeCatalog.enabled references unknown scope id ${enabledId}`);\n    }\n  }\n\n  const git = config.git;\n  if (git) {\n    if ((git.enabled ? "git" : "none") !== config.vcs) {\n      findings.push("config.yml: git.enabled must agree with compatibility field vcs");\n    }\n    if (!git.enabled && git.provider !== "none") {\n      findings.push("config.yml: disabled Git policy must use provider none");\n    }\n    const workBase = git.branches?.work_base ?? null;\n    if ((config.baseBranch ?? null) !== workBase) {\n      findings.push("config.yml: git.branches.work_base must match compatibility field baseBranch");\n    }\n    const integration = git.branches?.integration;\n    const production = git.branches?.production;\n    const promotion = git.pull_requests?.promotion;\n    if (git.pull_requests?.work_target && integration && git.pull_requests.work_target !== integration) {\n      findings.push("config.yml: git.pull_requests.work_target must match git.branches.integration");\n    }\n    if (promotion?.source && integration && promotion.source !== integration) {\n      findings.push("config.yml: Git promotion source must match integration branch");\n    }\n    if (promotion?.target && production && promotion.target !== production) {\n      findings.push("config.yml: Git promotion target must match production branch");\n    }\n  }\n\n  const ids = new Set();\n  for (const source of config.work_sources || []) {\n    if (ids.has(source.id)) findings.push(`config.yml: duplicate work source id ${source.id}`);\n    ids.add(source.id);\n\n    if (source.provider === "local_repository" && source.transport && source.transport !== "filesystem") {\n      findings.push(`config.yml: local_repository work source ${source.id} must use filesystem transport`);\n    }\n    if (source.provider !== "local_repository" && source.transport === "filesystem") {\n      findings.push(`config.yml: non-local work source ${source.id} cannot use filesystem transport`);\n    }\n    for (const root of source.roots || []) {\n      const segments = root.split(/[\\\\/]+/);\n      if (path.posix.isAbsolute(root) || path.win32.isAbsolute(root) || segments.includes("..")) {\n        findings.push(`config.yml: work source ${source.id} root must remain inside the workspace`);\n      }\n    }\n    if (source.transport === "mcp" && !source.mcp_connection_ref) {\n      findings.push(`config.yml: MCP work source ${source.id} requires an opaque mcp_connection_ref`);\n    }\n    if (source.mcp_connection_ref && source.transport !== "mcp") {\n      findings.push(`config.yml: work source ${source.id} mcp_connection_ref requires mcp transport`);\n    }\n    if (source.mcp_connection_ref && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.mcp_connection_ref)) {\n      findings.push(`config.yml: work source ${source.id} has an invalid opaque connection reference`);\n    }\n  }\n\n  return findings;\n}\n\nexport function assertProjectContextConsistency(config) {\n  const findings = projectContextConsistencyFindings(config);\n  if (findings.length > 0) throw new Error(findings.join("; "));\n}\n''')

# Renderer: canonical Git update owns compatibility synchronization and refuses
# relationally-invalid output before the ChangeSet can become VALIDATED/APPLIED.
replace_once('runtime/src/commands/renderers.mjs',
'''import { BOOTSTRAP_CANONICAL_DIRECTORIES, DIRECTORY_RENDER_ENTRY } from "../lib/bootstrapTopology.mjs";\n''',
'''import { BOOTSTRAP_CANONICAL_DIRECTORIES, DIRECTORY_RENDER_ENTRY } from "../lib/bootstrapTopology.mjs";\nimport { assertProjectContextConsistency } from "../lib/projectContextValidation.mjs";\n''')
replace_once('runtime/src/commands/renderers.mjs',
'''  if (payload.git !== undefined) nextConfig.git = payload.git;\n  if (payload.work_sources !== undefined) nextConfig.work_sources = payload.work_sources;\n  return new Map([["config.yml", stringifyYaml(nextConfig)]]);''',
'''  if (payload.git !== undefined) {\n    nextConfig.git = payload.git;\n    nextConfig.vcs = payload.git.enabled ? "git" : "none";\n    nextConfig.baseBranch = payload.git.enabled ? (payload.git.branches?.work_base ?? null) : null;\n  }\n  if (payload.work_sources !== undefined) nextConfig.work_sources = payload.work_sources;\n  assertProjectContextConsistency(nextConfig);\n  return new Map([["config.yml", stringifyYaml(nextConfig)]]);''')

# check schema reuses the exact same relational rules; remove the duplicate
# implementation, including the accidental anti-trunk-based restriction.
replace_once('runtime/src/commands/check.mjs',
'''import { REQUIRED_BOOTSTRAP_DIRECTORIES } from "../lib/bootstrapTopology.mjs";\n''',
'''import { REQUIRED_BOOTSTRAP_DIRECTORIES } from "../lib/bootstrapTopology.mjs";\nimport { projectContextConsistencyFindings } from "../lib/projectContextValidation.mjs";\n''')
replace_once('runtime/src/commands/check.mjs',
'''  checkGitPolicyConsistency(config, findings);\n  checkWorkSourcesConsistency(config, findings);\n}\n\nfunction checkGitPolicyConsistency(config, findings) {\n  const git = config.git;\n  if (!git) return;\n  if ((git.enabled ? "git" : "none") !== config.vcs) {\n    findings.push("config.yml: git.enabled must agree with compatibility field vcs");\n  }\n  if (!git.enabled && git.provider !== "none") {\n    findings.push("config.yml: disabled Git policy must use provider none");\n  }\n  const workBase = git.branches?.work_base;\n  if ((config.baseBranch ?? null) !== (workBase ?? null)) {\n    findings.push("config.yml: git.branches.work_base must match compatibility field baseBranch");\n  }\n  const integration = git.branches?.integration;\n  const production = git.branches?.production;\n  const promotion = git.pull_requests?.promotion;\n  if (git.pull_requests?.work_target && integration && git.pull_requests.work_target !== integration) {\n    findings.push("config.yml: git.pull_requests.work_target must match git.branches.integration");\n  }\n  if (promotion?.source && integration && promotion.source !== integration) {\n    findings.push("config.yml: Git promotion source must match integration branch");\n  }\n  if (promotion?.target && production && promotion.target !== production) {\n    findings.push("config.yml: Git promotion target must match production branch");\n  }\n  if (workBase && integration && workBase === production && production !== null) {\n    findings.push("config.yml: work_base and production cannot be the same branch when integration is configured");\n  }\n}\n\nfunction checkWorkSourcesConsistency(config, findings) {\n  const sources = config.work_sources || [];\n  const ids = new Set();\n  for (const source of sources) {\n    if (ids.has(source.id)) findings.push(`config.yml: duplicate work source id ${source.id}`);\n    ids.add(source.id);\n    if (source.provider === "local_repository" && source.transport && source.transport !== "filesystem") {\n      findings.push(`config.yml: local_repository work source ${source.id} must use filesystem transport`);\n    }\n    if (source.provider !== "local_repository" && source.transport === "filesystem") {\n      findings.push(`config.yml: non-local work source ${source.id} cannot use filesystem transport`);\n    }\n    for (const root of source.roots || []) {\n      if (path.isAbsolute(root) || root.split(/[\\\\/]+/).includes("..")) {\n        findings.push(`config.yml: work source ${source.id} root must remain inside the workspace`);\n      }\n    }\n    if (source.transport === "mcp" && !source.mcp_connection_ref) {\n      findings.push(`config.yml: MCP work source ${source.id} requires an opaque mcp_connection_ref`);\n    }\n    if (source.mcp_connection_ref && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.mcp_connection_ref)) {\n      findings.push(`config.yml: work source ${source.id} has an invalid opaque connection reference`);\n    }\n  }\n}\n''',
'''  findings.push(...projectContextConsistencyFindings(config));\n}\n''')

# Canonical Plan 2 fields must exist in every schema-valid Project Context.
config_path = ROOT / 'runtime/src/schemas/config.schema.json'
config = json.loads(config_path.read_text())
for field in ['git', 'work_sources']:
    if field not in config['required']:
        config['required'].append(field)
config_path.write_text(json.dumps(config, indent=2) + '\n')

# Schema facade fixture follows canonical required fields.
replace_once('runtime/src/lib/tests/schema.test.mjs',
'''  vcs: "git",\n  project: { name: "demo", type: "software" },''',
'''  vcs: "git",\n  git: { enabled: true, provider: "none", branches: { work_base: null, integration: null, production: null } },\n  work_sources: [],\n  project: { name: "demo", type: "software" },''')
replace_once('runtime/src/lib/tests/schema.test.mjs',
'''assert.deepEqual(result.errors, []);\n\nconst scopeId =''',
'''assert.deepEqual(result.errors, []);\nconst withoutCanonicalGit = structuredClone(validConfig);\ndelete withoutCanonicalGit.git;\nassert.equal(validate("config", withoutCanonicalGit).valid, false, "canonical git policy must be required");\nconst withoutWorkSources = structuredClone(validConfig);\ndelete withoutWorkSources.work_sources;\nassert.equal(validate("config", withoutWorkSources).valid, false, "canonical work_sources must be required");\n\nconst scopeId =''')

# Main schema fixtures also use the new canonical minimum.
replace_once('runtime/src/lib/tests/schema-fixtures.test.mjs',
'''      vcs: "none",\n      project: { name: "demo", type: "software" },''',
'''      vcs: "none",\n      git: { enabled: false, provider: "none" },\n      work_sources: [],\n      project: { name: "demo", type: "software" },''')
replace_once('runtime/src/lib/tests/schema-fixtures.test.mjs',
'''assert.equal(validate("config", { ...cases.config.valid, work_sources: [{ ...validWorkSources[1], mcp_connection_ref: "bad ref" }] }).valid, false, "connection refs must be opaque identifiers");\n''',
'''assert.equal(validate("config", { ...cases.config.valid, work_sources: [{ ...validWorkSources[1], mcp_connection_ref: "bad ref" }] }).valid, false, "connection refs must be opaque identifiers");\nconst missingGit = structuredClone(cases.config.valid);\ndelete missingGit.git;\nassert.equal(validate("config", missingGit).valid, false, "git is canonical and required");\nconst missingWorkSources = structuredClone(cases.config.valid);\ndelete missingWorkSources.work_sources;\nassert.equal(validate("config", missingWorkSources).valid, false, "work_sources is canonical and required");\n''')

# Renderer tests prove compatibility synchronization and pre-persistence rejection.
replace_once('runtime/src/commands/tests/renderers.test.mjs',
'''assert.equal(policyUpdate.git.enabled, false);\nassert.equal(policyUpdate.work_sources[0].mcp_connection_ref, "atlassian");\n''',
'''assert.equal(policyUpdate.git.enabled, false);\nassert.equal(policyUpdate.vcs, "none", "canonical git.enabled must synchronize compatibility vcs");\nassert.equal(policyUpdate.baseBranch, null, "disabled Git must clear compatibility baseBranch");\nassert.equal(policyUpdate.work_sources[0].mcp_connection_ref, "atlassian");\nconst enabledPolicyUpdate = parseYaml(renderConfigUpdate({\n  git: { enabled: true, provider: "github", branches: { work_base: "develop", integration: "develop", production: "master" } }\n}, parsedConfig).get("config.yml"));\nassert.equal(enabledPolicyUpdate.vcs, "git");\nassert.equal(enabledPolicyUpdate.baseBranch, "develop");\nassert.throws(() => renderConfigUpdate({\n  git: {\n    enabled: true,\n    provider: "github",\n    branches: { work_base: "main", integration: "main", production: "main" },\n    pull_requests: { enabled: true, work_target: "other", draft_by_default: true, merge_strategy: "provider_default", promotion: { source: "main", target: "main" } }\n  }\n}, parsedConfig), /work_target/);\n''')

# Command lifecycle: valid policy update must persist a schema-clean config, and
# relationally-invalid updates must stop at INVALID before approval/apply.
replace_once('runtime/src/commands/tests/commands.test.mjs',
'''assert.equal(persistedPolicy.git.pull_requests.promotion.target, "master");\nassert.equal(persistedPolicy.work_sources[0].mcp_connection_ref, "atlassian");\n''',
'''assert.equal(persistedPolicy.git.pull_requests.promotion.target, "master");\nassert.equal(persistedPolicy.vcs, "git");\nassert.equal(persistedPolicy.baseBranch, "develop");\nassert.equal(persistedPolicy.work_sources[0].mcp_connection_ref, "atlassian");\n\nconst invalidPolicyUpdate = runChangesetPropose({\n  planningRoot,\n  kind: "config.update",\n  actor: "test-user",\n  payloadText: JSON.stringify({\n    git: {\n      enabled: true,\n      provider: "github",\n      branches: { work_base: "main", integration: "main", production: "main" },\n      pull_requests: { enabled: true, work_target: "release", draft_by_default: true, merge_strategy: "provider_default", promotion: { source: "main", target: "main" } }\n    }\n  })\n});\nassert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: invalidPolicyUpdate.operationId }).status, "INVALID", "relationally-invalid Project Context must never reach APPROVED/APPLIED");\nconst duplicateWorkSourceUpdate = runChangesetPropose({\n  planningRoot,\n  kind: "config.update",\n  actor: "test-user",\n  payloadText: JSON.stringify({ work_sources: [\n    { id: "local-backlog", provider: "local_repository", enabled: true, roots: ["docs/backlog/"], source_policy: "import_snapshot", sync_mode: "import_only" },\n    { id: "local-backlog", provider: "local_repository", enabled: false, roots: ["docs/requirements/"], source_policy: "import_snapshot", sync_mode: "import_only" }\n  ] })\n});\nassert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: duplicateWorkSourceUpdate.operationId }).status, "INVALID", "duplicate Work Source ids must be rejected before apply");\n''')

# check schema: trunk-based topology is valid when all declared relationships agree.
check_path = ROOT / 'runtime/src/commands/tests/check.test.mjs'
check_text = check_path.read_text()
marker = '''// uninitialized workspace\n'''
trunk_test = '''// trunk-based Git is valid: work, integration and production may intentionally be the same branch.\n{\n  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-trunk-policy-"));\n  writeValidBaseFiles(planningRoot);\n  ensureBaseTopology(planningRoot);\n  const configPath = path.join(planningRoot, "config.yml");\n  const config = parseYaml(fs.readFileSync(configPath, "utf8"));\n  config.baseBranch = "main";\n  config.git = {\n    enabled: true,\n    provider: "github",\n    branches: { work_base: "main", integration: "main", production: "main" },\n    pull_requests: { enabled: true, work_target: "main", draft_by_default: true, merge_strategy: "provider_default", promotion: { source: "main", target: "main" } }\n  };\n  fs.writeFileSync(configPath, stringifyYaml(config));\n  const result = checkSchema({ planningRoot });\n  assert.equal(result.status, "PASS", `trunk-based topology must be valid: ${JSON.stringify(result.findings)}`);\n}\n\n'''
if trunk_test not in check_text:
    if marker not in check_text:
        raise SystemExit('missing check.test insertion marker')
    check_path.write_text(check_text.replace(marker, trunk_test + marker, 1))

# Record the review fixes in Plan 2.
plan_path = ROOT / 'docs/superpowers/plans/2026-07-27-corte-0-completion-plan-2-git-work-sources-config.md'
plan = plan_path.read_text().rstrip() + '''\n\n## Post-review corrections\n\nThe PR review found and closed three Plan 2 integrity gaps before merge:\n\n- Project Context relational invariants are now shared by `config.update` validation and `check schema`, so an invalid Git/Work Source configuration becomes `INVALID` before approval/apply instead of producing an `APPLIED` but inconsistent workspace.\n- Canonical Git updates synchronize temporary compatibility fields (`vcs`, `baseBranch`) while they remain in the schema, preventing two writable sources of truth.\n- Trunk-based topology is explicitly supported; work/integration/production branches may be identical when the declared relationships are internally coherent.\n- `git` and `work_sources` are now required canonical Project Context fields; legacy-only workspaces are not silently accepted as current Plan 2 state.\n'''
plan_path.write_text(plan + '\n')
PY
