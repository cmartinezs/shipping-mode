#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path

def replace(path, old, new, count=None):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'expected snippet not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, -1 if count is None else count), encoding='utf-8')

replace('runtime/src/commands/proposalPreparation.mjs',
'''export function prepareProposal(kind, rawPayload, { operationId = null, actor = null, proposedAt = null, existingReleases = [] } = {}) {''',
'''export function prepareProposal(kind, rawPayload, { operationId = null, actor = null, proposedAt = null, existingReleases = [], currentConfig = null } = {}) {''')
replace('runtime/src/commands/proposalPreparation.mjs',
'''    const title = requireTrimmedString(rawPayload.title, "title");
    const objective = requireTrimmedString(rawPayload.objective, "objective");
    const laneId = normalizeOptionalString(rawPayload.laneId, "laneId");
    const policyMode = normalizeOptionalString(rawPayload.policyMode, "policyMode");
    const slug = normalizeSlug(rawPayload.slug);''',
'''    if (!currentConfig?.policies?.release) throw new UsageError("release.create requires initialized Project Context release policy");
    const title = requireTrimmedString(rawPayload.title, "title");
    const objective = requireTrimmedString(rawPayload.objective, "objective");
    const laneId = normalizeOptionalString(rawPayload.laneId, "laneId")
      ?? requireTrimmedString(currentConfig.policies.release.defaultLane, "Project Context policies.release.defaultLane");
    const policyMode = normalizeOptionalString(rawPayload.policyMode, "policyMode")
      ?? requireTrimmedString(currentConfig.policies.release.mode, "Project Context policies.release.mode");
    if (!["strict_sequence", "dependency_graph"].includes(policyMode)) throw new UsageError(`unsupported release policy mode: ${policyMode}`);
    const slug = normalizeSlug(rawPayload.slug);''')

replace('runtime/src/commands/changesetCommand.mjs',
'''  if (kind === "release.create") runtimeContext.existingReleases = listReleaseDocuments(planningRoot);''',
'''  if (kind === "release.create") {
    runtimeContext.existingReleases = listReleaseDocuments(planningRoot);
    runtimeContext.currentConfig = readCurrentConfig(planningRoot);
  }''')
replace('runtime/src/commands/changesetCommand.mjs',
'''  if (kind === "release.create") return renderReleaseCreate(payload, currentConfig);''',
'''  if (kind === "release.create") return renderReleaseCreate(payload);''')

replace('runtime/src/commands/release.mjs',
'''import { validate } from "../lib/schema.mjs";''',
'''import { validate } from "../lib/schema.mjs";
import { parseYaml } from "../lib/yaml.mjs";''')
replace('runtime/src/commands/release.mjs',
'''function pendingRecovery(planningRoot) {''',
'''function readCurrentConfig(planningRoot) {
  const configPath = confineWritePath(planningRoot, "config.yml");
  if (!fs.existsSync(configPath)) throw new Error("release.create requires initialized Project Context");
  return parseYaml(fs.readFileSync(configPath, "utf8"));
}

function pendingRecovery(planningRoot) {''')
replace('runtime/src/commands/release.mjs',
'''    proposedAt,
    existingReleases: listReleaseDocuments(planningRoot)
  });''',
'''    proposedAt,
    existingReleases: listReleaseDocuments(planningRoot),
    currentConfig: readCurrentConfig(planningRoot)
  });''')

replace('runtime/src/commands/renderers.mjs',
'''export function renderReleaseCreate(payload, currentConfig) {
  if (!currentConfig) throw new Error("release.create requires initialized Project Context");
  const policyMode = payload.policyMode || currentConfig.policies?.release?.mode || "strict_sequence";
  if (!["strict_sequence", "dependency_graph"].includes(policyMode)) throw new Error(`unsupported release policy mode: ${policyMode}`);
  const laneId = payload.laneId || currentConfig.policies?.release?.defaultLane || "main";''',
'''export function renderReleaseCreate(payload) {
  const policyMode = payload.policyMode;
  if (!["strict_sequence", "dependency_graph"].includes(policyMode)) throw new Error(`unsupported release policy mode: ${policyMode}`);
  const laneId = payload.laneId;
  if (typeof laneId !== "string" || laneId.length === 0) throw new Error("release.create payload requires resolved laneId");''')

replace('runtime/src/schemas/change-set.schema.json',
'''              "objective",
              "slug",''',
'''              "objective",
              "laneId",
              "policyMode",
              "slug",''', 1)

replace('runtime/src/commands/tests/commands.test.mjs',
'''import { parseYaml } from "../../lib/yaml.mjs";''',
'''import { parseYaml, stringifyYaml } from "../../lib/yaml.mjs";''')
replace('runtime/src/commands/tests/commands.test.mjs',
'''assert.equal(releaseCreateChangeSet.payload.status, "DRAFT");
assert.equal(releaseCreateChangeSet.payload.slug, "ignored-for-identity");
assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseCreate.releaseId, "release.yml")), false, "release new must only propose");
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: releaseCreate.operationId }).status, "VALIDATED");
runChangesetApprove({ operationsRoot, planningRoot, operationId: releaseCreate.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: releaseCreate.operationId, actor: "carlos" });''',
'''assert.equal(releaseCreateChangeSet.payload.status, "DRAFT");
assert.equal(releaseCreateChangeSet.payload.slug, "ignored-for-identity");
assert.equal(releaseCreateChangeSet.payload.laneId, "main", "Project Context lane default must be fixed at propose time");
assert.equal(releaseCreateChangeSet.payload.policyMode, "strict_sequence", "Project Context policy default must be fixed at propose time");
assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseCreate.releaseId, "release.yml")), false, "release new must only propose");
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: releaseCreate.operationId }).status, "VALIDATED");
const configPathDuringRelease = path.join(planningRoot, "config.yml");
const configBeforeReleaseApply = fs.readFileSync(configPathDuringRelease, "utf8");
const configChangedAfterValidate = parseYaml(configBeforeReleaseApply);
configChangedAfterValidate.policies.release.defaultLane = "hotfix";
fs.writeFileSync(configPathDuringRelease, stringifyYaml(configChangedAfterValidate));
runChangesetApprove({ operationsRoot, planningRoot, operationId: releaseCreate.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: releaseCreate.operationId, actor: "carlos" });''')
replace('runtime/src/commands/tests/commands.test.mjs',
'''assert.equal(releaseDocument.status, "DRAFT");
assert.deepEqual(releaseDocument.itemRefs, []);''',
'''assert.equal(releaseDocument.status, "DRAFT");
assert.equal(releaseDocument.lane.id, "main", "apply must use the validated/proposed lane snapshot, not the current mutable config default");
assert.equal(releaseDocument.policy.mode, "strict_sequence");
assert.deepEqual(releaseDocument.itemRefs, []);
fs.writeFileSync(configPathDuringRelease, configBeforeReleaseApply);''')

replace('docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md',
'''Payload accepted from caller:
''',
'''Project Context defaults are resolved once during `propose` and persisted in the server-owned ChangeSet payload. Validation and apply never re-read mutable defaults to decide the Release content.

Payload accepted from caller:
''')
replace('docs/superpowers/plans/2026-07-28-corte-2-plan-1-release-core.md',
'''| `release status` could crash or trust a valid-looking corrupted aggregate | Safe resolver and shared schema/identity/revision integrity checks fail closed |''',
'''| `release status` could crash or trust a valid-looking corrupted aggregate | Safe resolver and shared schema/identity/revision integrity checks fail closed |
| Project Context defaults could change between validate and apply | Resolve lane/policy at propose time and bind them into the ChangeSet/idempotency request hash |''')

print('final PR21 policy snapshot correction applied')
PY
