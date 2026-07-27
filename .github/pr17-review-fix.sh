#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"missing expected text in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# 1) Discovery-created scopes receive an independent server-owned gap UUID.
replace_once(
    "runtime/src/commands/discoveryChangeSet.mjs",
    'function assignmentForScope(index) {\n  return { scopeIndex: index, scopeId: generateUuidV7() };\n}',
    'function assignmentForScope(index) {\n  return { scopeIndex: index, scopeId: generateUuidV7(), guideGapId: generateUuidV7() };\n}'
)

# 2) Renderers: protect approved Project Context refs from source removal and use gap assignment.
replace_once(
    "runtime/src/commands/renderers.mjs",
    'function scopeIdForProposal(index, assignments) {\n  const assigned = assignments.find((candidate) => candidate.scopeIndex === index);\n  if (!assigned) throw new Error(`missing scope id assignment for scopes[${index}]`);\n  return assigned.scopeId;\n}',
    'function scopeAssignmentForProposal(index, assignments) {\n  const assigned = assignments.find((candidate) => candidate.scopeIndex === index);\n  if (!assigned) throw new Error(`missing scope id assignment for scopes[${index}]`);\n  return assigned;\n}\n\nfunction referencedDocumentationSourceIds(config) {\n  return new Set([\n    ...(config.documentation?.source_refs || []),\n    ...(config.documentation?.gaps || []).flatMap((gap) => gap.source_refs || [])\n  ]);\n}'
)
replace_once(
    "runtime/src/commands/renderers.mjs",
    '  const rendered = new Map();\n  const sourcesById = new Map(currentSources.map((source) => [source.id, source]));\n  const scopesById = new Map(currentScopes.map((scope) => [scope.id, scope]));\n\n  for (const [index, entry] of (proposal.sources || []).entries()) {\n    const sourceId = sourceIdForAction(index, entry, sourceIdAssignments);\n    const existing = sourcesById.get(sourceId);',
    '  const rendered = new Map();\n  const sourcesById = new Map(currentSources.map((source) => [source.id, source]));\n  const scopesById = new Map(currentScopes.map((scope) => [scope.id, scope]));\n  const protectedDocumentationSourceIds = referencedDocumentationSourceIds(currentConfig);\n\n  for (const [index, entry] of (proposal.sources || []).entries()) {\n    const sourceId = sourceIdForAction(index, entry, sourceIdAssignments);\n    if (entry.action === "remove" && protectedDocumentationSourceIds.has(sourceId)) {\n      throw new Error(`cannot remove Documentation Source ${sourceId}: Project Context still references it; remove the approved reference with config.update first`);\n    }\n    const existing = sourcesById.get(sourceId);'
)
replace_once(
    "runtime/src/commands/renderers.mjs",
    '    const scopeId = scopeIdForProposal(index, scopeIdAssignments);\n    const scope = {',
    '    const scopeAssignment = scopeAssignmentForProposal(index, scopeIdAssignments);\n    const scopeId = scopeAssignment.scopeId;\n    const scope = {'
)
replace_once(
    "runtime/src/commands/renderers.mjs",
    '          id: scopeId,\n          concern: "guides",',
    '          id: scopeAssignment.guideGapId,\n          concern: "guides",'
)

# 3) ChangeSet schema binds guideGapId to each Discovery scope assignment.
replace_once(
    "runtime/src/schemas/change-set.schema.json",
    '                  "required": [\n                    "scopeIndex",\n                    "scopeId"\n                  ],',
    '                  "required": [\n                    "scopeIndex",\n                    "scopeId",\n                    "guideGapId"\n                  ],'
)
replace_once(
    "runtime/src/schemas/change-set.schema.json",
    '                    "scopeId": {\n                      "type": "string",\n                      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"\n                    }\n                  }\n                }\n              },\n              "confirmedBy": {',
    '                    "scopeId": {\n                      "type": "string",\n                      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"\n                    },\n                    "guideGapId": {\n                      "type": "string",\n                      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"\n                    }\n                  }\n                }\n              },\n              "confirmedBy": {'
)

# 4) Unit tests prove independent gap IDs and fail-closed removals for both ref locations.
replace_once(
    "runtime/src/commands/tests/renderers.test.mjs",
    'const newScopeId = "018f0000-0000-7000-8000-000000000012";\nconst discoveryFiles = renderDiscoveryPropose({',
    'const newScopeId = "018f0000-0000-7000-8000-000000000012";\nconst newGuideGapId = "018f0000-0000-7000-8000-000000000014";\nconst discoveryFiles = renderDiscoveryPropose({'
)
replace_once(
    "runtime/src/commands/tests/renderers.test.mjs",
    '  scopeIdAssignments: [{ scopeIndex: 0, scopeId: newScopeId }],',
    '  scopeIdAssignments: [{ scopeIndex: 0, scopeId: newScopeId, guideGapId: newGuideGapId }],'
)
replace_once(
    "runtime/src/commands/tests/renderers.test.mjs",
    'assert.deepEqual(discoveryConfig.scopeCatalog.enabled, [newScopeId], "Discovery-added scopes must update the canonical enabled catalog");\nconst scopeWithDiscoveryCommands',
    'assert.deepEqual(discoveryConfig.scopeCatalog.enabled, [newScopeId], "Discovery-added scopes must update the canonical enabled catalog");\nconst discoveryGuideGap = discoveryConfig.documentation.gaps.find((gap) => gap.scope_ref === newScopeId);\nassert.equal(discoveryGuideGap.id, newGuideGapId, "Discovery guide gaps must use their own server-owned UUIDv7 identity");\nassert.notEqual(discoveryGuideGap.id, newScopeId, "gap identity must not be overloaded with scope identity");\n\nconst referencedRemovalPayload = {\n  operationId: "018f0000-0000-7000-8000-000000000021",\n  confirmedBy: "runtime-actor",\n  confirmedAt: "2026-07-26T01:00:00.000Z",\n  sourceIdAssignments: [],\n  scopeIdAssignments: [],\n  proposal: { sources: [{ action: "remove", sourceId: removedSourceId }], scopes: [], scopeCommands: [], diagnostics: [] }\n};\nassert.throws(() => renderDiscoveryPropose(referencedRemovalPayload, {\n  ...parsedConfig,\n  documentation: { source_refs: [removedSourceId], gaps: [] }\n}, workspace, { currentSources: [{ id: removedSourceId }], currentScopes: [] }), /still references it/);\nassert.throws(() => renderDiscoveryPropose(referencedRemovalPayload, {\n  ...parsedConfig,\n  documentation: { source_refs: [], gaps: [{ id: newGuideGapId, concern: "security", status: "conflicting", description: "evidence conflict", source_refs: [removedSourceId] }] }\n}, workspace, { currentSources: [{ id: removedSourceId }], currentScopes: [] }), /still references it/);\n\nconst scopeWithDiscoveryCommands'
)

replace_once(
    "runtime/src/commands/tests/discoveryChangeSet.test.mjs",
    '  assert.equal(prepared.payload.scopeIdAssignments.length, 1);\n  assert.ok(isUuidV7(prepared.payload.scopeIdAssignments[0].scopeId));',
    '  assert.equal(prepared.payload.scopeIdAssignments.length, 1);\n  assert.ok(isUuidV7(prepared.payload.scopeIdAssignments[0].scopeId));\n  assert.ok(isUuidV7(prepared.payload.scopeIdAssignments[0].guideGapId));\n  assert.notEqual(prepared.payload.scopeIdAssignments[0].guideGapId, prepared.payload.scopeIdAssignments[0].scopeId, "Discovery gap identity must be independent from scope identity");'
)

# 5) Public E2E proves an approved source ref blocks Discovery remove at validate time.
replace_once(
    "runtime/tests/discovery-e2e.test.mjs",
    '  assert.deepEqual(readConfig(cwd).documentation.source_refs, [initial.sourceId]);\n  assert.ok(readConfig(cwd).documentation.gaps.some((gap) => gap.scope_ref === initial.scopeId && gap.status === "missing"));\n  assert.equal(run(["check", "schema"], cwd).json.status, "PASS");\n\n  const commandOperationId',
    '  assert.deepEqual(readConfig(cwd).documentation.source_refs, [initial.sourceId]);\n  const initialGuideGap = readConfig(cwd).documentation.gaps.find((gap) => gap.scope_ref === initial.scopeId && gap.status === "missing");\n  assert.ok(initialGuideGap);\n  assert.ok(isUuidV7(initialGuideGap.id));\n  assert.notEqual(initialGuideGap.id, initial.scopeId, "Discovery-created guide gap must have independent identity");\n  assert.equal(run(["check", "schema"], cwd).json.status, "PASS");\n\n  const removalScan = scan(cwd);\n  const referencedRemoveOperationId = proposeDiscovery(cwd, {\n    schemaVersion: 1,\n    scanId: removalScan.scanId,\n    baseRevision: removalScan.baseRevision,\n    scanParameters: removalScan.scanParameters,\n    scopes: [],\n    sources: [{ action: "remove", sourceId: initial.sourceId }],\n    scopeCommands: [],\n    diagnostics: []\n  });\n  const referencedRemoveValidation = run(["changeset", "validate", referencedRemoveOperationId], cwd);\n  assert.equal(referencedRemoveValidation.code, 1, "Discovery must not remove a source still approved by Project Context");\n  assert.equal(readOperation(operationsRoot(cwd), referencedRemoveOperationId).status, "INVALID");\n  assert.equal(readSource(cwd, initial.sourceId).id, initial.sourceId, "invalid remove must leave canonical source intact");\n  assert.deepEqual(readConfig(cwd).documentation.source_refs, [initial.sourceId]);\n  assert.equal(run(["check", "schema"], cwd).json.status, "PASS");\n\n  const commandOperationId'
)

# 6) Record the post-review corrections in the Plan 3 traceability doc.
p = Path("docs/superpowers/plans/2026-07-27-corte-0-completion-plan-3-final-closure.md")
text = p.read_text()
marker = 'Corte 0 remains pending Plan 3 PR merge and is not declared\ncomplete on this branch.\n'
addition = '''Corte 0 remains pending Plan 3 PR merge and is not declared
complete on this branch.

## Post-review corrections

The PR review found and closed two final integrity gaps before merge:

- Discovery source removal now fails validation when the source is still referenced by approved `documentation.source_refs` or any `documentation.gaps[*].source_refs`. References must be removed explicitly through an approved `config.update` before a later Discovery remove can succeed; Discovery never silently rewrites approved Project Context.
- Discovery-created scopes now receive an independent server-owned UUIDv7 `guideGapId`, matching direct `scope.add` semantics. Gap identity is no longer overloaded with scope identity; `scope_ref` is the sole relationship.
'''
if addition not in text:
    if marker not in text:
        raise SystemExit("missing Plan 3 results marker")
    p.write_text(text.replace(marker, addition, 1))

# Normalize edited files for git diff --check.
for name in [
    "runtime/src/commands/discoveryChangeSet.mjs",
    "runtime/src/commands/renderers.mjs",
    "runtime/src/schemas/change-set.schema.json",
    "runtime/src/commands/tests/renderers.test.mjs",
    "runtime/src/commands/tests/discoveryChangeSet.test.mjs",
    "runtime/tests/discovery-e2e.test.mjs",
    "docs/superpowers/plans/2026-07-27-corte-0-completion-plan-3-final-closure.md",
]:
    p = Path(name)
    lines = p.read_text().splitlines()
    p.write_text("\n".join(line.rstrip() for line in lines).rstrip() + "\n")
PY

git diff --check
