from pathlib import Path


def replace_once(path_str: str, old: str, new: str) -> None:
    path = Path(path_str)
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path_str}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1))


# 1) Recovery-safe cleanup of empty source directories after delete.
replace_once(
    "runtime/src/lib/safeFs.mjs",
    '''export function deleteWithinRoot(root, relativePath) {\n  const targetPath = confineWritePath(root, relativePath);\n  fs.rmSync(targetPath, { force: true });\n}\n''',
    '''export function deleteWithinRoot(root, relativePath) {\n  const targetPath = confineWritePath(root, relativePath);\n  fs.rmSync(targetPath, { force: true });\n}\n\nexport function removeEmptyParentDirectoryWithinRoot(root, relativePath) {\n  const parent = parentRelative(relativePath);\n  if (!parent) return false;\n  const parentPath = confineWritePath(root, parent);\n  if (!fs.existsSync(parentPath)) return false;\n  const stat = fs.lstatSync(parentPath);\n  if (!stat.isDirectory()) return false;\n  if (fs.readdirSync(parentPath).length !== 0) return false;\n  fs.rmdirSync(parentPath);\n  return true;\n}\n'''
)

replace_once(
    "runtime/src/lib/changeset.mjs",
    'import { assertDistinctMutationTargets, copyFileAtomic, deleteWithinRoot, renameWithinRoot, writeFileAtomic } from "./safeFs.mjs";',
    'import { assertDistinctMutationTargets, copyFileAtomic, deleteWithinRoot, removeEmptyParentDirectoryWithinRoot, renameWithinRoot, writeFileAtomic } from "./safeFs.mjs";'
)
replace_once(
    "runtime/src/lib/changeset.mjs",
    '''      if (entry.action === "delete") {\n        deleteWithinRoot(planningRoot, entry.target);\n      } else {\n''',
    '''      if (entry.action === "delete") {\n        deleteWithinRoot(planningRoot, entry.target);\n        if (operation.kind === "discovery.propose") {\n          removeEmptyParentDirectoryWithinRoot(planningRoot, entry.target);\n        }\n      } else {\n'''
)

replace_once(
    "runtime/src/lib/recovery.mjs",
    'import { deleteWithinRoot, renameWithinRoot } from "./safeFs.mjs";',
    'import { deleteWithinRoot, removeEmptyParentDirectoryWithinRoot, renameWithinRoot } from "./safeFs.mjs";'
)
replace_once(
    "runtime/src/lib/recovery.mjs",
    '''      if (classification === "PENDING") {\n        if (entry.action === "delete") {\n          deleteWithinRoot(planningRoot, entry.target);\n          continue;\n        }\n''',
    '''      if (entry.action === "delete" && classification === "APPLIED" && operation.kind === "discovery.propose") {\n        removeEmptyParentDirectoryWithinRoot(planningRoot, entry.target);\n      }\n\n      if (classification === "PENDING") {\n        if (entry.action === "delete") {\n          deleteWithinRoot(planningRoot, entry.target);\n          if (operation.kind === "discovery.propose") {\n            removeEmptyParentDirectoryWithinRoot(planningRoot, entry.target);\n          }\n          continue;\n        }\n'''
)

# 2) Explicit booleans for scope.command.set. No truthiness coercion.
replace_once(
    "runtime/src/commands/proposalPreparation.mjs",
    '''function requireObjectPayload(rawPayload) {\n  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {\n    throw new UsageError("changeset payload must be a mapping/object");\n  }\n  return rawPayload;\n}\n''',
    '''function requireObjectPayload(rawPayload) {\n  if (rawPayload === null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {\n    throw new UsageError("changeset payload must be a mapping/object");\n  }\n  return rawPayload;\n}\n\nfunction requireExplicitBoolean(rawPayload, field) {\n  if (typeof rawPayload[field] !== "boolean") {\n    throw new UsageError(`scope.command.set ${field} must be an explicit boolean`);\n  }\n  return rawPayload[field];\n}\n'''
)
replace_once(
    "runtime/src/commands/proposalPreparation.mjs",
    '''      requiresEnvironment: Boolean(rawPayload.requiresEnvironment),\n      requiresSecrets: Boolean(rawPayload.requiresSecrets),\n''',
    '''      requiresEnvironment: requireExplicitBoolean(rawPayload, "requiresEnvironment"),\n      requiresSecrets: requireExplicitBoolean(rawPayload, "requiresSecrets"),\n'''
)

# 3) Public config scope set-command command, backed by the internal ChangeSet kind.
replace_once(
    "runtime/src/index.mjs",
    '''function requireOperationId(value) {\n  if (!isUuidV7(value)) throw new UsageError(`invalid operation id: ${value}`);\n  return value;\n}\n''',
    '''function requireOperationId(value) {\n  if (!isUuidV7(value)) throw new UsageError(`invalid operation id: ${value}`);\n  return value;\n}\n\nfunction requireExplicitBooleanOption(value, flagName) {\n  if (value === "true") return true;\n  if (value === "false") return false;\n  throw new UsageError(`${flagName} requires explicit true or false`);\n}\n'''
)
replace_once(
    "runtime/src/index.mjs",
    '''    if (stage === "scope" && rest[0] === "add") {\n      const options = argsToOptions(rest.slice(1));\n      if (!options.key || !options.label || !options.kind || !options.path || !options.actor) {\n        throw new UsageError("config scope add requires --key, --label, --kind, --path, --actor");\n      }\n      return runConfigScopeAdd({ planningRoot, args: { key: options.key, label: options.label, kind: options.kind, path: options.path, owner: options.owner, actor: options.actor } });\n    }\n    return notImplemented(`config ${stage || ""}`.trim());\n''',
    '''    if (stage === "scope" && rest[0] === "add") {\n      const options = argsToOptions(rest.slice(1));\n      if (!options.key || !options.label || !options.kind || !options.path || !options.actor) {\n        throw new UsageError("config scope add requires --key, --label, --kind, --path, --actor");\n      }\n      return runConfigScopeAdd({ planningRoot, args: { key: options.key, label: options.label, kind: options.kind, path: options.path, owner: options.owner, actor: options.actor } });\n    }\n    if (stage === "scope" && rest[0] === "set-command") {\n      const options = argsToOptions(rest.slice(1));\n      if (!options.scope_id || !options.role || !options.command || !options.actor) {\n        throw new UsageError("config scope set-command requires --scope-id, --role, --command, --requires-environment, --requires-secrets, --actor");\n      }\n      if (options.requires_environment === undefined || options.requires_secrets === undefined) {\n        throw new UsageError("config scope set-command requires explicit --requires-environment true|false and --requires-secrets true|false");\n      }\n      const payloadText = JSON.stringify({\n        scopeId: options.scope_id,\n        role: options.role,\n        command: options.command,\n        requiresEnvironment: requireExplicitBooleanOption(options.requires_environment, "--requires-environment"),\n        requiresSecrets: requireExplicitBooleanOption(options.requires_secrets, "--requires-secrets")\n      });\n      return runChangesetPropose({ planningRoot, kind: "scope.command.set", payloadText, actor: options.actor });\n    }\n    return notImplemented(`config ${stage || ""}`.trim());\n'''
)

# Targeted unit assertions for strict boolean handling.
replace_once(
    "runtime/src/commands/tests/proposalPreparation.test.mjs",
    '''assert.equal(commandSet.payload.operationId, "018f0000-0000-7000-8000-000000000099");\nassert.throws(() => prepareProposal("scope.command.set", { scopeId: fixedId, role: "test", command: "npm test" }), UsageError);\n''',
    '''assert.equal(commandSet.payload.operationId, "018f0000-0000-7000-8000-000000000099");\nconst commandRuntimeContext = { operationId: "018f0000-0000-7000-8000-000000000099", actor: "runtime", proposedAt: "2026-07-26T00:00:00.000Z" };\nassert.throws(() => prepareProposal("scope.command.set", { scopeId: fixedId, role: "test", command: "npm test" }, commandRuntimeContext), UsageError, "required booleans must not default implicitly");\nassert.throws(() => prepareProposal("scope.command.set", { scopeId: fixedId, role: "test", command: "npm test", requiresEnvironment: "false", requiresSecrets: false }, commandRuntimeContext), UsageError, "string booleans must not be truthiness-coerced");\nassert.throws(() => prepareProposal("scope.command.set", { scopeId: fixedId, role: "test", command: "npm test" }), UsageError);\n'''
)

# Remove tests must prove the catalog stays schema-valid and no empty UUID directory remains.
replace_once(
    "runtime/src/commands/tests/discoveryChangeSet.test.mjs",
    'import { StaleError } from "../../lib/errors.mjs";',
    'import { StaleError } from "../../lib/errors.mjs";\nimport { checkSchema } from "../check.mjs";'
)
replace_once(
    "runtime/src/commands/tests/discoveryChangeSet.test.mjs",
    '''  assert.equal(removed.outcome.status, "APPLIED");\n  assert.equal(fs.existsSync(path.join(planningRoot, sourceRelative)), false, "remove source action must delete source.yml through ChangeSet apply");\n  assert.deepEqual(readResult(operationsRoot, removed.result.operationId).files, [{ target: sourceRelative, action: "delete", contentHash: "ABSENT" }]);\n''',
    '''  assert.equal(removed.outcome.status, "APPLIED");\n  assert.equal(fs.existsSync(path.join(planningRoot, sourceRelative)), false, "remove source action must delete source.yml through ChangeSet apply");\n  assert.equal(fs.existsSync(path.join(planningRoot, "sources", sourceId)), false, "remove source action must prune the now-empty source directory");\n  assert.deepEqual(readResult(operationsRoot, removed.result.operationId).files, [{ target: sourceRelative, action: "delete", contentHash: "ABSENT" }]);\n  assert.equal(checkSchema({ planningRoot }).status, "PASS", "a successful source remove must leave the catalog schema-valid");\n'''
)
replace_once(
    "runtime/src/commands/tests/discoveryChangeSet.test.mjs",
    '''  assert.equal(readOperation(operationsRoot, remove.operationId).status, "APPLIED");\n  assert.equal(fs.existsSync(path.join(planningRoot, sourceRelative)), false, "recovery must replay pending deletes");\n  assert.deepEqual(readResult(operationsRoot, remove.operationId).files, [{ target: sourceRelative, action: "delete", contentHash: "ABSENT" }]);\n''',
    '''  assert.equal(readOperation(operationsRoot, remove.operationId).status, "APPLIED");\n  assert.equal(fs.existsSync(path.join(planningRoot, sourceRelative)), false, "recovery must replay pending deletes");\n  assert.equal(fs.existsSync(path.join(planningRoot, "sources", sourceId)), false, "recovery must also prune the empty source directory");\n  assert.deepEqual(readResult(operationsRoot, remove.operationId).files, [{ target: sourceRelative, action: "delete", contentHash: "ABSENT" }]);\n  assert.equal(checkSchema({ planningRoot }).status, "PASS", "recovered source removal must leave the catalog schema-valid");\n'''
)

# Public CLI coverage now exercises config scope set-command and strict boolean options.
replace_once(
    "runtime/tests/cli-e2e.test.mjs",
    '''// changeset propose --kind scope.command.set: declared command update through the public binary\n{\n  const cwd = freshWorkspace();\n  fullyInit(cwd);\n  fs.mkdirSync(path.join(cwd, "api"), { recursive: true });\n  const scope = run(["config", "scope", "add", "--key", "backend", "--label", "Backend", "--kind", "code", "--path", "api/", "--actor", "carlos"], cwd);\n  run(["changeset", "validate", scope.json.operationId], cwd);\n  run(["changeset", "approve", scope.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);\n  run(["changeset", "apply", scope.json.operationId, "--actor", "carlos"], cwd);\n\n  const payloadFile = path.join(cwd, "scope-command.json");\n  fs.writeFileSync(payloadFile, JSON.stringify({ scopeId: scope.json.scopeId, role: "test", command: "npm test", requiresEnvironment: false, requiresSecrets: false, declaredBy: "caller" }));\n  const proposed = run(["changeset", "propose", "--kind", "scope.command.set", "--payload-file", payloadFile, "--actor", "carlos"], cwd);\n  assert.equal(proposed.code, 0);\n  run(["changeset", "validate", proposed.json.operationId], cwd);\n  run(["changeset", "approve", proposed.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);\n  run(["changeset", "apply", proposed.json.operationId, "--actor", "carlos"], cwd);\n\n  const scopeDoc = parseYaml(fs.readFileSync(path.join(cwd, ".planning", "scopes", scope.json.scopeId, "scope.yml"), "utf8"));\n  assert.equal(scopeDoc.commands.test.method, "declared");\n  assert.equal(scopeDoc.commands.test.declaredBy, "carlos");\n  assert.equal(scopeDoc.commands.test.declaredOperationId, proposed.json.operationId);\n  assert.deepEqual(scopeDoc.commands.test.alternatives, []);\n}\n''',
    '''// config scope set-command: public declared-command API backed by the internal ChangeSet kind\n{\n  const cwd = freshWorkspace();\n  fullyInit(cwd);\n  fs.mkdirSync(path.join(cwd, "api"), { recursive: true });\n  const scope = run(["config", "scope", "add", "--key", "backend", "--label", "Backend", "--kind", "code", "--path", "api/", "--actor", "carlos"], cwd);\n  run(["changeset", "validate", scope.json.operationId], cwd);\n  run(["changeset", "approve", scope.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);\n  run(["changeset", "apply", scope.json.operationId, "--actor", "carlos"], cwd);\n\n  const missingBoolean = run(["config", "scope", "set-command", "--scope-id", scope.json.scopeId, "--role", "test", "--command", "npm test", "--requires-environment", "false", "--actor", "carlos"], cwd);\n  assert.equal(missingBoolean.code, 1, "both descriptive booleans must be explicit");\n  const invalidBoolean = run(["config", "scope", "set-command", "--scope-id", scope.json.scopeId, "--role", "test", "--command", "npm test", "--requires-environment", "maybe", "--requires-secrets", "false", "--actor", "carlos"], cwd);\n  assert.equal(invalidBoolean.code, 1, "boolean options accept only literal true|false");\n\n  const proposed = run(["config", "scope", "set-command", "--scope-id", scope.json.scopeId, "--role", "test", "--command", "npm test", "--requires-environment", "false", "--requires-secrets", "false", "--actor", "carlos"], cwd);\n  assert.equal(proposed.code, 0);\n  run(["changeset", "validate", proposed.json.operationId], cwd);\n  run(["changeset", "approve", proposed.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);\n  run(["changeset", "apply", proposed.json.operationId, "--actor", "carlos"], cwd);\n\n  const scopeDoc = parseYaml(fs.readFileSync(path.join(cwd, ".planning", "scopes", scope.json.scopeId, "scope.yml"), "utf8"));\n  assert.equal(scopeDoc.commands.test.method, "declared");\n  assert.equal(scopeDoc.commands.test.declaredBy, "carlos");\n  assert.equal(scopeDoc.commands.test.declaredOperationId, proposed.json.operationId);\n  assert.deepEqual(scopeDoc.commands.test.alternatives, []);\n}\n'''
)

# Keep the implementation plan aligned with the reviewed public API and post-review fixes.
replace_once(
    "docs/superpowers/plans/2026-07-26-discovery-changeset-integration.md",
    '- [x] Add `changeset propose --kind scope.command.set --payload-file <file|-> --actor <actor>` for manual declared command updates.',
    '- [x] Keep `scope.command.set` as the internal ChangeSet kind and expose manual declared command updates through public `config scope set-command --scope-id <id> --role <role> --command <cmd> --requires-environment true|false --requires-secrets true|false --actor <actor>`.'
)
replace_once(
    "docs/superpowers/plans/2026-07-26-discovery-changeset-integration.md",
    '''- [x] Plan 4 autonomy fields are not implemented.\n- [x] Git execution and Work Sources/Jira contracts do not expand this plan.\n''',
    '''- [x] Plan 4 autonomy fields are not implemented.\n- [x] Git execution and Work Sources/Jira contracts do not expand this plan.\n\n## Post-review corrections\n\n- [x] `source remove` prunes the empty `sources/<uuid>/` directory in normal apply and recovery, and `check schema` remains `PASS`.\n- [x] `scope.command.set` rejects missing/non-boolean descriptive flags instead of coercing truthiness.\n- [x] The repo-facing API is `config scope set-command`; `scope.command.set` remains the underlying ChangeSet kind.\n'''
)

print("PR #12 review fixes applied")
