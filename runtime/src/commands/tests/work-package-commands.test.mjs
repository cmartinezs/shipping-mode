import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit, runConfigScopeAdd } from "../init.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../changesetCommand.mjs";
import { runReleaseNew } from "../release.mjs";
import { runCheckItem, runCheckWorkPackage, runItemCreate, runItemPackageAdd, runItemPackageStatus } from "../item.mjs";
import { checkRelease, checkSchema } from "../check.mjs";
import { readChangeSet, readOperation, writeChangeSet } from "../../lib/operationStore.mjs";
import { computePersistedChangeSetHash } from "../../lib/changeset.mjs";
import { parseYaml, stringifyYaml } from "../../lib/yaml.mjs";
import { contentHash, revisionHash } from "../../lib/canonical.mjs";
import { generateUuidV7, isUuidV7 } from "../../lib/ids.mjs";
import { renderGuideMarkdown } from "../../lib/guideProjection.mjs";
import { renderWorkPackageReadme } from "../../lib/workPackageProjection.mjs";
import { updateWorkPackageRevision } from "../../lib/workPackageStore.mjs";
import { computeSourceFingerprint } from "../../lib/fingerprint.mjs";
import { DEFAULT_MAX_SOURCE_BYTES } from "../../lib/discoverScan.mjs";

function finish(planningRoot, operationsRoot, operationId) {
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId }).status, "VALIDATED");
  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "carlos", allowSelfApproval: true });
  assert.equal(runChangesetApply({ planningRoot, operationsRoot, operationId, actor: "carlos" }).status, "APPLIED");
}

function persistApprovedManualGuides({ workspace, planningRoot, scopeId, requiredGateRefs = [] }) {
  const sourceId = generateUuidV7();
  const sourcePath = "docs/work-package-guide-source.md";
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, sourcePath), "work package guide source\n");
  const observed = computeSourceFingerprint(path.join(workspace, sourcePath), { maxBytes: DEFAULT_MAX_SOURCE_BYTES });
  const source = {
    schemaVersion: 1,
    id: sourceId,
    path: sourcePath,
    family: "technical-sources",
    kind: "testing",
    role: "canonical",
    authority: { standing: "authoritative", force: "normative" },
    availability: "implemented",
    confirmedFingerprint: observed.fingerprint,
    confirmedContentHash: observed.contentHash,
    provenance: { discoveredBy: "test", confirmedBy: "test", confirmedAt: "2026-07-29T00:00:00.000Z", confirmedOperationId: generateUuidV7() }
  };
  fs.mkdirSync(path.join(planningRoot, "sources", sourceId), { recursive: true });
  fs.writeFileSync(path.join(planningRoot, "sources", sourceId, "source.yml"), stringifyYaml(source));

  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.documentation.source_refs = [...new Set([...(config.documentation.source_refs || []), sourceId])].sort();
  fs.writeFileSync(configPath, stringifyYaml(config));

  const scopePath = path.join(planningRoot, "scopes", scopeId, "scope.yml");
  const scope = parseYaml(fs.readFileSync(scopePath, "utf8"));
  const guides = {};
  for (const kind of ["task", "test"]) {
    const guideId = generateUuidV7();
    const body = kind === "task"
      ? { workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs, templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" } }
      : { gatesByWorkPackageType: [], gatesByTaskType: [], commandRefs: [], evidenceRequirements: [], testData: [], executionContexts: [], environments: [] };
    const document = { sourceRefs: [sourceId], ...body, openGaps: [] };
    const provenance = {
      sourceMapRevision: revisionHash({ sourceRefs: [sourceId], sourceFingerprints: { [sourceId]: source.confirmedFingerprint } }),
      generationMethod: "manual",
      generatorVersion: "shipping-mode:manual-guide-input/1",
      generatorFingerprint: null,
      generatedAt: "2026-07-29T00:00:00.000Z",
      sourceFingerprints: { [sourceId]: source.confirmedFingerprint },
      generationInputHash: revisionHash({ scopeId, guideKind: kind, document }),
      generationOutputHash: revisionHash(document)
    };
    const withoutRevision = { schemaVersion: 1, dslVersion: 1, id: guideId, scopeId, kind, sourceRefs: [sourceId], provenance, openGaps: [], ...body };
    const guide = { ...withoutRevision, revision: `sha256:${revisionHash(withoutRevision)}` };
    const bytes = Buffer.from(stringifyYaml(guide));
    const hash = contentHash(bytes);
    guides[kind] = {
      id: guideId,
      scopeId,
      kind,
      status: "approved",
      path: `${kind}-guide.yml`,
      projection: `${kind}-guide.md`,
      revision: guide.revision,
      contentHash: hash,
      sourceRefs: guide.sourceRefs,
      provenance: guide.provenance,
      approval: { actor: "reviewer", approvedAt: "2026-07-29T00:00:00.000Z", changeSetHash: revisionHash({ scopeId, kind, guideId }), revision: guide.revision, contentHash: hash }
    };
    fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, `${kind}-guide.yml`), bytes);
    fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, `${kind}-guide.md`), renderGuideMarkdown(guide));
  }
  fs.writeFileSync(scopePath, stringifyYaml({ ...scope, guides }));
}

function initializedWorkspace({ requiredGateRefs = [] } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "work-package-commands-"));
  const planningRoot = path.join(workspace, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "packages", vcs: "git", actor: "carlos" } });
  finish(planningRoot, operationsRoot, init.operationId);
  const scope = runConfigScopeAdd({ planningRoot, args: { key: "api", label: "API", kind: "code", path: "src/", actor: "carlos" } });
  finish(planningRoot, operationsRoot, scope.operationId);
  persistApprovedManualGuides({ workspace, planningRoot, scopeId: scope.scopeId, requiredGateRefs });
  const release = runReleaseNew({ planningRoot, args: { title: "Release", objective: "Work packages", idempotencyKey: "release", actor: "carlos" } });
  finish(planningRoot, operationsRoot, release.operationId);
  const item = runItemCreate({ planningRoot, releaseRef: release.releaseId, args: { kind: "spike", title: "Item", question: "Q", timebox: "1d", expectedDecision: "D", idempotencyKey: "item", commandActor: "carlos" } });
  finish(planningRoot, operationsRoot, item.operationId);
  return { workspace, planningRoot, operationsRoot, release, item, scope };
}

function createPackage(planningRoot, operationsRoot, releaseId, itemId, scopeId, key, commitment = "required", dependencies = "") {
  const proposal = runItemPackageAdd({
    planningRoot,
    releaseRef: releaseId,
    itemRef: itemId,
    args: { scopeId, commitment, title: `Package ${key}`, description: "Created by item package add", design: "Design", dependencyRefs: dependencies, idempotencyKey: key, commandActor: "carlos" }
  });
  finish(planningRoot, operationsRoot, proposal.operationId);
  return proposal;
}

function completePackage(planningRoot, releaseId, itemId, packageId) {
  const filePath = path.join(planningRoot, "releases", releaseId, "items", itemId, "work-packages", packageId, "work-package.yml");
  const pkg = parseYaml(fs.readFileSync(filePath, "utf8"));
  const done = updateWorkPackageRevision({
    ...pkg,
    status: "DONE",
    resolution: {
      type: "DONE",
      reason: "Completed in fixture",
      approvedBy: "reviewer",
      approvedAt: "2026-07-29T00:00:00.000Z",
      riskAccepted: false,
      replacementId: null,
      operationId: pkg.audit.operationId,
      evidence: [{ id: "review", summary: "Reviewed fixture", detail: null }]
    }
  });
  fs.writeFileSync(filePath, stringifyYaml(done));
  fs.writeFileSync(path.join(path.dirname(filePath), "README.md"), renderWorkPackageReadme(done));
}

function tamperChangeSet(operationsRoot, operationId, mutate) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  mutate(changeSet);
  changeSet.hash = computePersistedChangeSetHash(changeSet);
  writeChangeSet(operationsRoot, operationId, changeSet);
}

{
  const { planningRoot, operationsRoot, release, item, scope } = initializedWorkspace();
  const proposal = runItemPackageAdd({
    planningRoot,
    releaseRef: release.displayId,
    itemRef: item.displayId,
    args: { scopeId: scope.scopeId, commitment: "required", title: "API package", description: "Created by item package add", design: "Design", idempotencyKey: "api-package", commandActor: "carlos" }
  });
  assert.ok(isUuidV7(proposal.packageId));
  assert.match(proposal.displayId, /^WP-[0-9A-HJKMNP-TV-Z]{8}$/);
  const packagePath = path.join(planningRoot, "releases", release.releaseId, "items", item.itemId, "work-packages", proposal.packageId, "work-package.yml");
  assert.equal(fs.existsSync(packagePath), false, "item package add must only propose");
  const changeSet = readChangeSet(operationsRoot, proposal.operationId);
  assert.equal(changeSet.kind, "work-package.create");
  assert.equal(changeSet.payload.releaseId, release.releaseId);
  assert.equal(changeSet.payload.releaseItemId, item.itemId);
  assert.equal(changeSet.payload.scopeId, scope.scopeId);
  assert.equal(changeSet.payload.guideRefs.length, 2);
  assert.deepEqual(changeSet.payload.targetPaths.sort(), [`releases/${release.releaseId}/items/${item.itemId}/work-packages/${proposal.packageId}/README.md`, `releases/${release.releaseId}/items/${item.itemId}/work-packages/${proposal.packageId}/work-package.yml`].sort());
  finish(planningRoot, operationsRoot, proposal.operationId);
  assert.equal(fs.existsSync(packagePath), true);
  const workPackage = parseYaml(fs.readFileSync(packagePath, "utf8"));
  assert.equal(workPackage.releaseId, release.releaseId);
  assert.equal(workPackage.releaseItemId, item.itemId);
  assert.equal(workPackage.scopeId, scope.scopeId);
  assert.equal(workPackage.status, "DRAFT");
  assert.equal(workPackage.commitment, "required");
  assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "releases", release.releaseId, "items", item.itemId, "release-item.yml"), "utf8")).id, item.itemId, "release-item.yml is not mutated by package creation");
  const event = readOperation(operationsRoot, proposal.operationId).expectedEvents[0];
  assert.equal(event.document.type, "work-package.created");
  assert.equal(event.document.aggregate.type, "work-package");
  assert.equal(event.document.payload.workPackageId, proposal.packageId);
  assert.equal(event.document.payload.scopeId, scope.scopeId);
  assert.equal(event.document.payload.commitment, "required");
  assert.equal(runItemPackageStatus({ planningRoot, releaseRef: release.displayId, itemRef: item.displayId, packageRef: proposal.displayId }).status, "FOUND");
  assert.equal(runCheckWorkPackage({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId, packageRef: proposal.packageId }).status, "PASS");
  assert.equal(runCheckItem({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId }).status, "FAIL", "required DRAFT package blocks item completion");
  completePackage(planningRoot, release.releaseId, item.itemId, proposal.packageId);
  const completedItem = runCheckItem({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId });
  assert.equal(completedItem.items[0].completion.complete, true);
  assert.equal(completedItem.items[0].completion.requiredCompletedCount, 1);
  assert.equal(checkSchema({ planningRoot }).status, "PASS");
  const releaseCheck = checkRelease({ planningRoot, reference: release.releaseId });
  assert.equal(releaseCheck.releases[0].derivedHealth.dimensions.find((entry) => entry.id === "releaseItems").evidence.packageCount, 1);
  const operationsBefore = fs.readdirSync(path.join(planningRoot, "operations")).length;
  const beforeTree = JSON.stringify(fs.readdirSync(path.join(planningRoot, "releases", release.releaseId, "items", item.itemId, "work-packages"), { recursive: true }).sort());
  runItemPackageStatus({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId, packageRef: proposal.packageId });
  runCheckWorkPackage({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId, packageRef: proposal.packageId });
  checkSchema({ planningRoot });
  assert.equal(fs.readdirSync(path.join(planningRoot, "operations")).length, operationsBefore, "package status and checks must be query-only");
  assert.equal(JSON.stringify(fs.readdirSync(path.join(planningRoot, "releases", release.releaseId, "items", item.itemId, "work-packages"), { recursive: true }).sort()), beforeTree, "checks must not rewrite packages");
}

{
  const { planningRoot, operationsRoot, release, item, scope } = initializedWorkspace();
  const exact = runItemPackageAdd({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId, args: { scopeId: scope.scopeId, commitment: "required", title: "Retry", idempotencyKey: "retry", commandActor: "carlos" } });
  const retry = runItemPackageAdd({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId, args: { scopeId: scope.scopeId, commitment: "required", title: "Retry", idempotencyKey: "retry", commandActor: "carlos" } });
  assert.equal(retry.operationId, exact.operationId);
  assert.equal(retry.packageId, exact.packageId);
  assert.throws(
    () => runItemPackageAdd({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId, args: { scopeId: scope.scopeId, commitment: "optional", title: "Retry", idempotencyKey: "retry", commandActor: "carlos" } }),
    /idempotency key retry was already used for a different work-package\.create request/
  );
  tamperChangeSet(operationsRoot, exact.operationId, (changeSet) => {
    changeSet.payload.scopeId = generateUuidV7();
  });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: exact.operationId }).status, "INVALID", "tampering server-owned Scope must be rejected even if public hash is recalculated");
}

{
  const first = initializedWorkspace();
  const a = createPackage(first.planningRoot, first.operationsRoot, first.release.releaseId, first.item.itemId, first.scope.scopeId, "a");
  assert.throws(
    () => runItemPackageAdd({ planningRoot: first.planningRoot, releaseRef: first.release.releaseId, itemRef: first.item.itemId, args: { scopeId: first.scope.scopeId, commitment: "required", title: "Bad dep", dependencyRefs: "not-a-uuid", idempotencyKey: "bad-dep", commandActor: "carlos" } }),
    /dependencies entries must be UUIDv7|dependency/
  );
  const b = createPackage(first.planningRoot, first.operationsRoot, first.release.releaseId, first.item.itemId, first.scope.scopeId, "b", "required", a.packageId);
  assert.equal(runItemPackageStatus({ planningRoot: first.planningRoot, releaseRef: first.release.releaseId, itemRef: first.item.itemId, packageRef: b.packageId }).status, "FOUND");
  const second = initializedWorkspace();
  const other = createPackage(second.planningRoot, second.operationsRoot, second.release.releaseId, second.item.itemId, second.scope.scopeId, "other");
  assert.throws(
    () => runItemPackageAdd({ planningRoot: first.planningRoot, releaseRef: first.release.releaseId, itemRef: first.item.itemId, args: { scopeId: first.scope.scopeId, commitment: "required", title: "Cross", dependencyRefs: other.packageId, idempotencyKey: "cross", commandActor: "carlos" } }),
    /does not resolve to a Work Package/
  );
}

{
  const { planningRoot, operationsRoot, release, item, scope } = initializedWorkspace({ requiredGateRefs: ["unit"] });
  const gated = createPackage(planningRoot, operationsRoot, release.releaseId, item.itemId, scope.scopeId, "gated");
  completePackage(planningRoot, release.releaseId, item.itemId, gated.packageId);
  const check = runCheckWorkPackage({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId, packageRef: gated.packageId });
  assert.equal(check.status, "FAIL", "required declarative gates cannot be counted as PASS without execution");
  assert.equal(runCheckItem({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId }).items[0].completion.status, "unavailable");
}

console.log("work-package-commands: create, idempotency, queries, trust boundary, dependencies and completion pass");
