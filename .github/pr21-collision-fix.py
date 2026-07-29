from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_exact(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"expected snippet not found in {relative_path}")
    path.write_text(text.replace(old, new, 1))


replace_exact(
    "runtime/src/lib/releaseCreate.mjs",
    "export function releaseCreateInvariantFindings(changeSet, operation = null) {",
    "export function releaseCreateInvariantFindings(changeSet, operation = null, existingReleases = []) {"
)
replace_exact(
    "runtime/src/lib/releaseCreate.mjs",
    '''  if (!isReleaseDisplayIdForUuid(payload.id, payload.displayId)) {
    findings.push(`release.create displayId ${payload.displayId} is not derived from release UUIDv7 ${payload.id}`);
  }

  for (const field of ["title", "objective", "laneId", "idempotencyKey"]) {''',
    '''  if (!isReleaseDisplayIdForUuid(payload.id, payload.displayId)) {
    findings.push(`release.create displayId ${payload.displayId} is not derived from release UUIDv7 ${payload.id}`);
  }
  const displayIdCollision = existingReleases.find((release) => release.id !== payload.id && release.displayId === payload.displayId);
  if (displayIdCollision) {
    findings.push(`release.create displayId ${payload.displayId} is already owned by release ${displayIdCollision.id}`);
  }

  for (const field of ["title", "objective", "laneId", "idempotencyKey"]) {'''
)

replace_exact(
    "runtime/src/lib/changeset.mjs",
    'import { releaseCreateInvariantFindings } from "./releaseCreate.mjs";\n',
    'import { releaseCreateInvariantFindings } from "./releaseCreate.mjs";\nimport { listReleaseDocuments } from "./releaseStore.mjs";\n'
)
replace_exact(
    "runtime/src/lib/changeset.mjs",
    "function checkKindInvariants(changeSet, operation = null) {",
    "function checkKindInvariants(changeSet, operation = null, planningRoot = null) {"
)
replace_exact(
    "runtime/src/lib/changeset.mjs",
    '''  if (changeSet.kind === "release.create") {
    errors.push(...releaseCreateInvariantFindings(changeSet, operation));
    const releasePath = `releases/${changeSet.payload.id}/release.yml`;''',
    '''  if (changeSet.kind === "release.create") {
    let existingReleases = [];
    try {
      existingReleases = listReleaseDocuments(planningRoot);
    } catch (error) {
      errors.push(`release.create cannot verify display ID uniqueness: ${error.message}`);
    }
    errors.push(...releaseCreateInvariantFindings(changeSet, operation, existingReleases));
    const releasePath = `releases/${changeSet.payload.id}/release.yml`;'''
)
replace_exact(
    "runtime/src/lib/changeset.mjs",
    "  const invariantErrors = checkKindInvariants(changeSet, operation);",
    "  const invariantErrors = checkKindInvariants(changeSet, operation, planningRoot);"
)

replace_exact(
    "runtime/src/lib/tests/release-create-integrity.test.mjs",
    'import { computePersistedChangeSetHash } from "../changeset.mjs";\n',
    'import { computePersistedChangeSetHash } from "../changeset.mjs";\nimport { releaseCreateInvariantFindings } from "../releaseCreate.mjs";\n'
)
replace_exact(
    "runtime/src/lib/tests/release-create-integrity.test.mjs",
    '''{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const args = { title: "Permanent key", objective: "Preserve idempotency after invalidation", idempotencyKey: "permanent-key", actor: "carlos" };''',
    '''{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const proposal = runReleaseNew({ planningRoot, args: { title: "Collision guard", objective: "Reject a display ID already owned by another Release", idempotencyKey: "collision-guard", actor: "carlos" } });
  const changeSet = readChangeSet(operationsRoot, proposal.operationId);
  const operation = readOperation(operationsRoot, proposal.operationId);
  const findings = releaseCreateInvariantFindings(changeSet, operation, [{ id: generateUuidV7(), displayId: proposal.displayId }]);
  assert.ok(findings.some((finding) => finding.includes("is already owned by release")), "validate/apply invariants must reject a persisted display ID collision");
}

{
  const { planningRoot, operationsRoot } = initializedWorkspace();
  const args = { title: "Permanent key", objective: "Preserve idempotency after invalidation", idempotencyKey: "permanent-key", actor: "carlos" };'''
)
replace_exact(
    "runtime/src/lib/tests/release-create-integrity.test.mjs",
    'console.log("release-create-integrity: relational server fields and permanent idempotency bindings pass");',
    'console.log("release-create-integrity: relational server fields, collision guards and permanent idempotency bindings pass");'
)

replace_exact(
    "docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md",
    '- the normalized idempotency request hash is recomputed during validation rather than trusted from editable ChangeSet content.\n',
    '- the normalized idempotency request hash is recomputed during validation rather than trusted from editable ChangeSet content;\n- validate and apply re-check display-ID ownership against the persisted Release catalog under the workspace mutation lock, so concurrent pending proposals cannot both persist the same display ID.\n'
)
replace_exact(
    "docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md",
    '| Project Context defaults could change between validate and apply | Resolve lane/policy at propose time and bind them into the ChangeSet/idempotency request hash |\n',
    '| Project Context defaults could change between validate and apply | Resolve lane/policy at propose time and bind them into the ChangeSet/idempotency request hash |\n| Concurrent pending proposals could reserve the same compact display ID | Re-check persisted display-ID ownership during validate and apply under the workspace mutation lock; the later operation fails closed |\n'
)
