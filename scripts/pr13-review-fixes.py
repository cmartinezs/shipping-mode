from pathlib import Path


def replace_once(path_str: str, old: str, new: str) -> None:
    path = Path(path_str)
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path_str}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1))


# 1) Server-owned authorization capability: actor labels are audit metadata only.
replace_once(
    "runtime/src/lib/autonomy.mjs",
    'export const AUTOMATION_CAPABLE_ACTORS = new Set(["system:automation:discovery", "discovery-skill"]);\n',
    'export const AUTONOMOUS_APPROVAL_CAPABILITY = "discovery.autonomous-approve";\n'
)
replace_once(
    "runtime/src/lib/autonomy.mjs",
    '''export function isAutomationCapableActor(actor) {\n  return AUTOMATION_CAPABLE_ACTORS.has(actor);\n}\n''',
    '''export function hasAutonomousApprovalCapability(authorizationContext = null) {\n  const capabilities = authorizationContext?.capabilities;\n  return Array.isArray(capabilities) && capabilities.includes(AUTONOMOUS_APPROVAL_CAPABILITY);\n}\n'''
)

# Bind every persisted evaluation to the exact operation and validated ChangeSet.
replace_once(
    "runtime/src/lib/autonomy.mjs",
    '''export function autonomyConfigChangeEvaluation(planningRoot) {\n  return {\n    policyFingerprint: currentPolicyFingerprint(planningRoot),\n    autoApprovable: false,\n    blockedBy: [{ itemRef: "changeSet", reason: REASON_CODES.AUTONOMY_CONFIG_CHANGE }]\n  };\n}\n''',
    '''export function autonomyConfigChangeEvaluation(planningRoot) {\n  return {\n    policyFingerprint: currentPolicyFingerprint(planningRoot),\n    autoApprovable: false,\n    blockedBy: [{ itemRef: "changeSet", reason: REASON_CODES.AUTONOMY_CONFIG_CHANGE }]\n  };\n}\n\nexport function bindAutonomyEvaluation({ evaluation, operationId, changeSetHash }) {\n  if (!evaluation) return null;\n  return { operationId, changeSetHash, ...evaluation };\n}\n'''
)

# Resolve default explicitly, while keeping source-family auto-approval fail-closed:
# a default cannot invent the required family-specific authority ceiling.
replace_once(
    "runtime/src/lib/autonomy.mjs",
    '''  const state = sourceStateFor(entry, confirmedSources);\n  const override = sourceOverrideFor(policy, state.family);\n  if (!override) {\n    block(blockedBy, itemRef, REASON_CODES.FAMILY_NOT_ALLOWLISTED);\n    return blockedBy;\n  }\n  if (override.mode === "pause") {\n    block(blockedBy, itemRef, REASON_CODES.DEFAULT_PAUSE);\n    return blockedBy;\n  }\n''',
    '''  const state = sourceStateFor(entry, confirmedSources);\n  const override = sourceOverrideFor(policy, state.family);\n  const effectiveMode = override?.mode ?? policy.discovery.default;\n  if (!override) {\n    // `default:auto-approve` is not an implicit source-family allowlist: sources\n    // require an explicit override because that is where the authority ceiling lives.\n    block(blockedBy, itemRef, REASON_CODES.FAMILY_NOT_ALLOWLISTED);\n    return blockedBy;\n  }\n  if (effectiveMode === "pause") {\n    block(blockedBy, itemRef, REASON_CODES.DEFAULT_PAUSE);\n    return blockedBy;\n  }\n'''
)

# 2) Evaluation is produced at validation, not trusted/persisted from propose-time callers.
replace_once(
    "runtime/src/commands/discoveryChangeSet.mjs",
    'import { evaluateDiscoveryProposalAutonomy, readConfirmedAutonomyPolicy } from "../lib/autonomy.mjs";\nimport { readConfirmedSources } from "../lib/discoverScan.mjs";\n',
    ''
)
replace_once(
    "runtime/src/commands/discoveryChangeSet.mjs",
    '''  const autonomyEvaluation = evaluateDiscoveryProposalAutonomy({\n    proposal,\n    policy: readConfirmedAutonomyPolicy(planningRoot),\n    confirmedSources: readConfirmedSources(planningRoot)\n  });\n\n''',
    ''
)
replace_once(
    "runtime/src/commands/discoveryChangeSet.mjs",
    '''    },\n    autonomyEvaluation,\n    payload: {\n''',
    '''    },\n    payload: {\n'''
)
replace_once(
    "runtime/src/commands/discoveryChangeSet.mjs",
    '''    preconditions: prepared.preconditions,\n    autonomyEvaluation: prepared.autonomyEvaluation\n''',
    '''    preconditions: prepared.preconditions\n'''
)

replace_once(
    "runtime/src/commands/changesetCommand.mjs",
    'import { autonomyConfigChangeEvaluation } from "../lib/autonomy.mjs";\n',
    ''
)
replace_once(
    "runtime/src/commands/changesetCommand.mjs",
    '''  if (kind === "config.autonomy.set") {\n    runtimeContext.autonomyEvaluation = autonomyConfigChangeEvaluation(planningRoot);\n  }\n''',
    ''
)
replace_once(
    "runtime/src/commands/changesetCommand.mjs",
    '''    operationId: runtimeContext.operationId || null,\n    proposedAt: runtimeContext.proposedAt || null,\n    autonomyEvaluation: runtimeContext.autonomyEvaluation || null\n''',
    '''    operationId: runtimeContext.operationId || null,\n    proposedAt: runtimeContext.proposedAt || null\n'''
)
replace_once(
    "runtime/src/commands/changesetCommand.mjs",
    '''export function runChangesetApprove({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval, mode = "human" }) {\n  approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval: Boolean(allowSelfApproval), mode });\n''',
    '''export function runChangesetApprove({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval, mode = "human", authorizationContext = null }) {\n  approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval: Boolean(allowSelfApproval), mode, authorizationContext });\n'''
)

replace_once(
    "runtime/src/lib/changeset.mjs",
    'import { evaluateChangeSetAutonomy, currentPolicyFingerprint, isAutomationCapableActor, REASON_CODES } from "./autonomy.mjs";',
    'import { bindAutonomyEvaluation, evaluateChangeSetAutonomy, currentPolicyFingerprint, hasAutonomousApprovalCapability, REASON_CODES } from "./autonomy.mjs";'
)
replace_once(
    "runtime/src/lib/changeset.mjs",
    '''export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor, operationId = null, proposedAt = null, preconditions = null, autonomyEvaluation = null }) {''',
    '''export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor, operationId = null, proposedAt = null, preconditions = null }) {'''
)
replace_once(
    "runtime/src/lib/changeset.mjs",
    '''    if (autonomyEvaluation) operation.autonomyEvaluation = autonomyEvaluation;\n    writeOperation(operationsRoot, operationId, operation);\n''',
    '''    writeOperation(operationsRoot, operationId, operation);\n'''
)
replace_once(
    "runtime/src/lib/changeset.mjs",
    '''    writeOperation(operationsRoot, operationId, {\n      ...operation,\n      status: "VALIDATED",\n      validation: { validatedAt, changeSetHash: result.recomputedHash, errors: [] },\n      history: [...operation.history, { at: validatedAt, from: operation.status, to: "VALIDATED", actor: "system:validator", reason: null }]\n    });\n''',
    '''    const nextOperation = {\n      ...operation,\n      status: "VALIDATED",\n      validation: { validatedAt, changeSetHash: result.recomputedHash, errors: [] },\n      history: [...operation.history, { at: validatedAt, from: operation.status, to: "VALIDATED", actor: "system:validator", reason: null }]\n    };\n    const evaluation = evaluateChangeSetAutonomy({ changeSet: result.changeSet, planningRoot });\n    if (evaluation) {\n      nextOperation.autonomyEvaluation = bindAutonomyEvaluation({\n        evaluation,\n        operationId,\n        changeSetHash: result.recomputedHash\n      });\n    } else {\n      delete nextOperation.autonomyEvaluation;\n    }\n    writeOperation(operationsRoot, operationId, nextOperation);\n'''
)
replace_once(
    "runtime/src/lib/changeset.mjs",
    '''export function approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval = false, mode = "human" }) {''',
    '''export function approveOperation({ operationsRoot, planningRoot, operationId, actor, allowSelfApproval = false, mode = "human", authorizationContext = null }) {'''
)
replace_once(
    "runtime/src/lib/changeset.mjs",
    '''    if (mode === "autonomous") {\n      if (!isAutomationCapableActor(actor)) {\n        throw new StateError("autonomous approval requires an automation-capable actor");\n      }\n      if (!operation.autonomyEvaluation) {\n        throw new StateError("autonomous approval requires this operation's autonomyEvaluation");\n      }\n      if (currentPolicyFingerprint(planningRoot) !== operation.autonomyEvaluation.policyFingerprint) {\n        transitionToStale(operationsRoot, operationId, operation, REASON_CODES.POLICY_CHANGED_SINCE_VALIDATION);\n      }\n      const freshEvaluation = evaluateChangeSetAutonomy({ changeSet, planningRoot });\n      if (!freshEvaluation || revisionHash(freshEvaluation) !== revisionHash(operation.autonomyEvaluation)) {\n        throw new StateError("autonomyEvaluation does not match this operation");\n      }\n      if (!operation.autonomyEvaluation.autoApprovable) {\n        throw new StateError("autonomous approval requires autoApprovable true");\n      }\n    }\n''',
    '''    if (mode === "autonomous") {\n      if (!hasAutonomousApprovalCapability(authorizationContext)) {\n        throw new StateError("autonomous approval requires a server-owned authorization capability");\n      }\n      if (!operation.autonomyEvaluation) {\n        throw new StateError("autonomous approval requires this operation's autonomyEvaluation");\n      }\n      if (operation.autonomyEvaluation.operationId !== operationId\n          || operation.autonomyEvaluation.changeSetHash !== recomputedHash) {\n        throw new StateError("autonomyEvaluation is not bound to this operation and validated ChangeSet");\n      }\n      if (currentPolicyFingerprint(planningRoot) !== operation.autonomyEvaluation.policyFingerprint) {\n        transitionToStale(operationsRoot, operationId, operation, REASON_CODES.POLICY_CHANGED_SINCE_VALIDATION);\n      }\n      const evaluation = evaluateChangeSetAutonomy({ changeSet, planningRoot });\n      const freshEvaluation = bindAutonomyEvaluation({ evaluation, operationId, changeSetHash: recomputedHash });\n      if (!freshEvaluation || revisionHash(freshEvaluation) !== revisionHash(operation.autonomyEvaluation)) {\n        throw new StateError("autonomyEvaluation does not match this operation");\n      }\n      if (!operation.autonomyEvaluation.autoApprovable) {\n        throw new StateError("autonomous approval requires autoApprovable true");\n      }\n    }\n'''
)

# Trusted runtime context is a fourth, non-argv parameter; the public CLI passes none.
replace_once(
    "runtime/src/index.mjs",
    '''export function dispatch(command, args, cwd) {''',
    '''export function dispatch(command, args, cwd, runtimeContext = null) {'''
)
replace_once(
    "runtime/src/index.mjs",
    '''      return runChangesetApprove({ operationsRoot, planningRoot, operationId, actor: options.actor, allowSelfApproval: Boolean(options.allow_self_approval), mode: options.mode || "human" });''',
    '''      return runChangesetApprove({\n        operationsRoot,\n        planningRoot,\n        operationId,\n        actor: options.actor,\n        allowSelfApproval: Boolean(options.allow_self_approval),\n        mode: options.mode || "human",\n        authorizationContext: runtimeContext?.authorizationContext || null\n      });'''
)

# 3) Schema binds autonomyEvaluation and requires it on autonomy-governed VALIDATED+ operations.
replace_once(
    "runtime/src/schemas/operation.schema.json",
    '''      "required": ["policyFingerprint", "autoApprovable", "blockedBy"],\n      "properties": {\n        "policyFingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" },\n''',
    '''      "required": ["operationId", "changeSetHash", "policyFingerprint", "autoApprovable", "blockedBy"],\n      "properties": {\n        "operationId": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },\n        "changeSetHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },\n        "policyFingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" },\n'''
)
replace_once(
    "runtime/src/schemas/operation.schema.json",
    '''    {\n      "if": { "properties": { "status": { "enum": ["APPROVED", "APPLYING", "APPLIED"] } } },\n''',
    '''    {\n      "if": {\n        "required": ["kind", "status"],\n        "properties": {\n          "kind": { "enum": ["discovery.propose", "config.autonomy.set"] },\n          "status": { "enum": ["VALIDATED", "APPROVED", "APPLYING", "APPLIED"] }\n        }\n      },\n      "then": { "required": ["autonomyEvaluation"] }\n    },\n    {\n      "if": { "properties": { "status": { "enum": ["APPROVED", "APPLYING", "APPLIED"] } } },\n'''
)

# Unit tests: default:auto-approve does not implicitly whitelist a source family.
replace_once(
    "runtime/src/lib/tests/autonomy.test.mjs",
    'import { evaluateDiscoveryProposalAutonomy, normalizeAutonomyPolicy, policyFingerprint, REASON_CODES, isAutomationCapableActor } from "../autonomy.mjs";',
    'import { AUTONOMOUS_APPROVAL_CAPABILITY, evaluateDiscoveryProposalAutonomy, hasAutonomousApprovalCapability, normalizeAutonomyPolicy, policyFingerprint, REASON_CODES } from "../autonomy.mjs";'
)
replace_once(
    "runtime/src/lib/tests/autonomy.test.mjs",
    '''{\n  const result = evaluate({ sources: [addSource({ family: "technical-sources" })] });\n  assert.deepEqual(result.blockedBy, [{ itemRef: "sources[0]", reason: REASON_CODES.FAMILY_NOT_ALLOWLISTED }]);\n}\n''',
    '''{\n  const result = evaluate({ sources: [addSource({ family: "technical-sources" })] });\n  assert.deepEqual(result.blockedBy, [{ itemRef: "sources[0]", reason: REASON_CODES.FAMILY_NOT_ALLOWLISTED }]);\n}\n\n{\n  const defaultAutoPolicy = normalizeAutonomyPolicy({\n    discovery: { ...policy.discovery, default: "auto-approve", sourceOverrides: [] }\n  });\n  const result = evaluateDiscoveryProposalAutonomy({\n    proposal: { scopes: [], sources: [addSource()], scopeCommands: [] },\n    policy: defaultAutoPolicy,\n    confirmedSources: []\n  });\n  assert.deepEqual(\n    result.blockedBy,\n    [{ itemRef: "sources[0]", reason: REASON_CODES.FAMILY_NOT_ALLOWLISTED }],\n    "default:auto-approve must not implicitly whitelist a source family without an authority ceiling"\n  );\n}\n'''
)
replace_once(
    "runtime/src/lib/tests/autonomy.test.mjs",
    '''{\n  assert.equal(isAutomationCapableActor("cualquier-string"), false);\n  assert.equal(isAutomationCapableActor("system:automation:discovery"), true);\n}\n''',
    '''{\n  assert.equal(hasAutonomousApprovalCapability(null), false);\n  assert.equal(hasAutonomousApprovalCapability({ capabilities: ["discovery-skill"] }), false, "actor-like strings are not capabilities");\n  assert.equal(hasAutonomousApprovalCapability({ capabilities: [AUTONOMOUS_APPROVAL_CAPABILITY] }), true);\n}\n'''
)

# Command-level adversarial approval tests.
replace_once(
    "runtime/src/commands/tests/autonomy-approve.test.mjs",
    'import { REASON_CODES } from "../../lib/autonomy.mjs";',
    'import { AUTONOMOUS_APPROVAL_CAPABILITY, REASON_CODES } from "../../lib/autonomy.mjs";'
)
replace_once(
    "runtime/src/commands/tests/autonomy-approve.test.mjs",
    '''function buildWorkspace() {''',
    '''const TRUSTED_AUTOMATION_CONTEXT = { capabilities: [AUTONOMOUS_APPROVAL_CAPABILITY] };\n\nfunction buildWorkspace() {'''
)
# config autonomy self-auto test must reach the autonomy evaluation gate, not fail earlier on capability.
replace_once(
    "runtime/src/commands/tests/autonomy-approve.test.mjs",
    '''    () => runChangesetApprove({ planningRoot, operationsRoot, operationId: configOperationId, actor: "discovery-skill", mode: "autonomous" }),''',
    '''    () => runChangesetApprove({ planningRoot, operationsRoot, operationId: configOperationId, actor: "discovery-skill", mode: "autonomous", authorizationContext: TRUSTED_AUTOMATION_CONTEXT }),'''
)
replace_once(
    "runtime/src/commands/tests/autonomy-approve.test.mjs",
    '''  assert.throws(\n    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "cualquier-string", mode: "autonomous" }),\n    StateError,\n    "autonomous approval must require a recognized automation-capable actor"\n  );\n\n  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous" });\n''',
    '''  assert.throws(\n    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous" }),\n    StateError,\n    "spoofing an allowlisted-looking actor label must not grant autonomous approval"\n  );\n  assert.throws(\n    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "cualquier-string", mode: "autonomous" }),\n    StateError,\n    "arbitrary actors without server-owned capability must be rejected"\n  );\n\n  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous", authorizationContext: TRUSTED_AUTOMATION_CONTEXT });\n'''
)
replace_once(
    "runtime/src/commands/tests/autonomy-approve.test.mjs",
    '''    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous" }),\n    StateError,\n    "autoApprovable false must block autonomous approval"\n''',
    '''    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous", authorizationContext: TRUSTED_AUTOMATION_CONTEXT }),\n    StateError,\n    "autoApprovable false must block autonomous approval"\n'''
)
replace_once(
    "runtime/src/commands/tests/autonomy-approve.test.mjs",
    '''    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous" }),\n    StaleError,\n    "autonomous approval must stale when the confirmed policy changed after validation"\n''',
    '''    () => runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "discovery-skill", mode: "autonomous", authorizationContext: TRUSTED_AUTOMATION_CONTEXT }),\n    StaleError,\n    "autonomous approval must stale when the confirmed policy changed after validation"\n'''
)
replace_once(
    "runtime/src/commands/tests/autonomy-approve.test.mjs",
    '''    () => runChangesetApprove({ planningRoot, operationsRoot, operationId: trueOperationId, actor: "discovery-skill", mode: "autonomous" }),\n    StateError,\n    "an autonomyEvaluation copied from another operation must not authorize this operation"\n''',
    '''    () => runChangesetApprove({ planningRoot, operationsRoot, operationId: trueOperationId, actor: "discovery-skill", mode: "autonomous", authorizationContext: TRUSTED_AUTOMATION_CONTEXT }),\n    StateError,\n    "an autonomyEvaluation copied from another operation must not authorize this operation"\n'''
)
# Add the stronger identical-evaluation cross-operation attack.
replace_once(
    "runtime/src/commands/tests/autonomy-approve.test.mjs",
    '''}\n\nconsole.log("autonomy-approve: config changesets, approve modes, stale policy, actor capability, tamper, and method ownership pass");\n''',
    '''}\n\n{\n  const { workspaceRoot, planningRoot, operationsRoot, sourceId, scopeId } = prepareReadyWorkspace();\n  const operationIdA = proposeValidatedCommand(planningRoot, workspaceRoot, operationsRoot, sourceId, scopeId);\n  const operationIdB = proposeValidatedCommand(planningRoot, workspaceRoot, operationsRoot, sourceId, scopeId);\n  const operationA = readOperation(operationsRoot, operationIdA);\n  const evaluationB = readOperation(operationsRoot, operationIdB).autonomyEvaluation;\n  assert.equal(operationA.autonomyEvaluation.autoApprovable, true);\n  assert.equal(evaluationB.autoApprovable, true, "the copied evaluation must be semantically identical, not the easy true/false mismatch case");\n  assert.notEqual(operationA.autonomyEvaluation.operationId, evaluationB.operationId);\n  writeOperation(operationsRoot, operationIdA, { ...operationA, autonomyEvaluation: evaluationB });\n  assert.throws(\n    () => runChangesetApprove({ planningRoot, operationsRoot, operationId: operationIdA, actor: "discovery-skill", mode: "autonomous", authorizationContext: TRUSTED_AUTOMATION_CONTEXT }),\n    StateError,\n    "an identical evaluation copied from another operation must fail its operation/changeSet binding"\n  );\n}\n\nconsole.log("autonomy-approve: config changesets, approve modes, stale policy, trusted capability, binding tamper, and method ownership pass");\n'''
)

# Schema fixtures prove evaluation binding fields are mandatory.
replace_once(
    "runtime/src/lib/tests/schema-fixtures.test.mjs",
    '''const deleteFilePlanOperation = {''',
    '''const autonomyEvaluation = {\n  operationId: discoveryChangeSet.operationId,\n  changeSetHash: "a".repeat(64),\n  policyFingerprint: "b".repeat(64),\n  autoApprovable: true,\n  blockedBy: []\n};\nconst validatedDiscoveryOperation = {\n  ...opBase,\n  kind: "discovery.propose",\n  status: "VALIDATED",\n  validation,\n  autonomyEvaluation\n};\nassert.equal(validate("operation", validatedDiscoveryOperation).valid, true, "validated discovery operation requires a bound autonomyEvaluation");\nassert.equal(validate("operation", { ...validatedDiscoveryOperation, autonomyEvaluation: { policyFingerprint: "b".repeat(64), autoApprovable: true, blockedBy: [] } }).valid, false, "unbound autonomyEvaluation must fail schema validation");\n\nconst deleteFilePlanOperation = {'''
)

# Documentation closes both semantic ambiguities explicitly.
replace_once(
    "docs/superpowers/specs/2026-07-25-discovery-iteration-design.md",
    '''3. Otherwise: `effectiveMode = most-specific-applicable-override ?? autonomy.discovery.default` (family override for sources; `scopeCommand.mode` for commands).\n4. Only if `effectiveMode == auto-approve` does the item proceed to its own gate:\n''',
    '''3. Otherwise: `effectiveMode = most-specific-applicable-override ?? autonomy.discovery.default` (family override for sources; `scopeCommand.mode` for commands). For sources specifically, `default:auto-approve` does **not** implicitly whitelist an unconfigured family: source auto-approval requires an explicit family override because the required `authorityCeiling` lives on that override. A source family with no override therefore blocks with `family_not_allowlisted`, even when the fallback mode is `auto-approve`.\n4. Only if `effectiveMode == auto-approve` does the item proceed to its own gate:\n'''
)
replace_once(
    "docs/superpowers/specs/2026-07-25-discovery-iteration-design.md",
    '''- the actor is a recognized automation-capable identity, not an arbitrary human actor name (kept intentionally minimal — a full capability/RBAC model is out of scope for this iteration).\n''',
    '''- the runtime invocation carries a server-owned `discovery.autonomous-approve` capability in trusted authorization context. `--actor` is audit metadata only and can never grant this capability; a caller spelling an actor such as `discovery-skill` is insufficient. The bare CLI has no way to manufacture this trusted context. A full capability/RBAC model remains out of scope for this iteration.\n- the persisted evaluation is structurally bound to this exact `operationId` and validated `changeSetHash`, in addition to its `policyFingerprint`; copying an otherwise identical evaluation from another operation is rejected.\n'''
)

replace_once(
    "docs/superpowers/plans/2026-07-26-discovery-autonomy-server-approve.md",
    '''- [x] Add minimal automation-capable actor model. Use a repo-native allowlist, not arbitrary actor strings. The initial allowlist is intentionally small, e.g. `system:automation:discovery`.\n- [x] Reject autonomous approval when actor is not automation-capable.\n''',
    '''- [x] Add a minimal server-owned authorization context with capability `discovery.autonomous-approve`; `--actor` remains audit metadata and cannot grant privilege.\n- [x] Reject autonomous approval when the trusted runtime invocation lacks that capability, including spoofed `--actor discovery-skill`.\n'''
)
replace_once(
    "docs/superpowers/plans/2026-07-26-discovery-autonomy-server-approve.md",
    '''- [x] Ensure an evaluation from another operation cannot be reused.\n''',
    '''- [x] Bind persisted evaluation to `operationId` + validated `changeSetHash` and ensure even an otherwise identical evaluation from another operation cannot be reused.\n'''
)
replace_once(
    "docs/superpowers/plans/2026-07-26-discovery-autonomy-server-approve.md",
    '''- [x] Actor capability cannot be satisfied by arbitrary strings.\n''',
    '''- [x] Actor labels cannot satisfy capability checks; only trusted runtime authorization context can.\n- [x] `default:auto-approve` without a source family override remains blocked with `family_not_allowlisted` because no authority ceiling exists.\n- [x] `autonomyEvaluation` is bound to the exact operation and validated ChangeSet hash.\n'''
)
