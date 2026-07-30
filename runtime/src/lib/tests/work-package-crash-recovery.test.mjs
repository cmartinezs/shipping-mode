import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit, runConfigScopeAdd } from "../../commands/init.mjs";
import { runReleaseNew } from "../../commands/release.mjs";
import { runItemCreate, runItemPackageAdd } from "../../commands/item.mjs";
import { runChangesetApply, runChangesetApprove, runChangesetValidate } from "../../commands/changesetCommand.mjs";
import { renderWorkPackageCreateChangeSet } from "../../commands/renderers.mjs";
import { applyOperation } from "../changeset.mjs";
import { recoverWorkspace } from "../mutation.mjs";
import { setFaultCheckpoint, clearFaultCheckpoint, SimulatedCrashError } from "../faultInjection.mjs";
import { readOperation } from "../operationStore.mjs";
import { parseYaml, stringifyYaml } from "../yaml.mjs";
import { contentHash, revisionHash } from "../canonical.mjs";
import { generateUuidV7 } from "../ids.mjs";
import { renderGuideMarkdown } from "../guideProjection.mjs";
import { computeSourceFingerprint } from "../fingerprint.mjs";
import { DEFAULT_MAX_SOURCE_BYTES } from "../discoverScan.mjs";

function finish(planningRoot, operationsRoot, operationId) {
  runChangesetValidate({ planningRoot, operationsRoot, operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId, actor: "carlos" });
}

function persistApprovedManualGuides({ workspace, planningRoot, scopeId }) {
  const sourceId = generateUuidV7();
  const sourcePath = "docs/wp-crash-guide.md";
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, sourcePath), "guide\n");
  const observed = computeSourceFingerprint(path.join(workspace, sourcePath), { maxBytes: DEFAULT_MAX_SOURCE_BYTES });
  fs.mkdirSync(path.join(planningRoot, "sources", sourceId), { recursive: true });
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
  fs.writeFileSync(path.join(planningRoot, "sources", sourceId, "source.yml"), stringifyYaml(source));
  const configPath = path.join(planningRoot, "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.documentation.source_refs = [sourceId];
  fs.writeFileSync(configPath, stringifyYaml(config));
  const scopePath = path.join(planningRoot, "scopes", scopeId, "scope.yml");
  const scope = parseYaml(fs.readFileSync(scopePath, "utf8"));
  const guides = {};
  for (const kind of ["task", "test"]) {
    const guideId = generateUuidV7();
    const body = kind === "task"
      ? { workPackageTypes: [], taskTypes: [], requiredSections: [], requiredGateRefs: [], templateRefs: [], decompositionRules: [], automation: { fallback: "markGaps" } }
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
    guides[kind] = { id: guideId, scopeId, kind, status: "approved", path: `${kind}-guide.yml`, projection: `${kind}-guide.md`, revision: guide.revision, contentHash: hash, sourceRefs: guide.sourceRefs, provenance: guide.provenance, approval: { actor: "reviewer", approvedAt: "2026-07-29T00:00:00.000Z", changeSetHash: revisionHash({ scopeId, kind, guideId }), revision: guide.revision, contentHash: hash } };
    fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, `${kind}-guide.yml`), bytes);
    fs.writeFileSync(path.join(planningRoot, "scopes", scopeId, `${kind}-guide.md`), renderGuideMarkdown(guide));
  }
  fs.writeFileSync(scopePath, stringifyYaml({ ...scope, guides }));
}

function approvedPackageOperation() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "work-package-crash-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  const operationsRoot = path.join(planningRoot, "operations");
  const init = runInit({ planningRoot, args: { name: "packages", vcs: "git", actor: "carlos" } });
  finish(planningRoot, operationsRoot, init.operationId);
  const scope = runConfigScopeAdd({ planningRoot, args: { key: "api", label: "API", kind: "code", path: "src/", actor: "carlos" } });
  finish(planningRoot, operationsRoot, scope.operationId);
  persistApprovedManualGuides({ workspace: workspaceRoot, planningRoot, scopeId: scope.scopeId });
  const release = runReleaseNew({ planningRoot, args: { title: "Release", objective: "Crash package", idempotencyKey: "release", actor: "carlos" } });
  finish(planningRoot, operationsRoot, release.operationId);
  const item = runItemCreate({ planningRoot, releaseRef: release.releaseId, args: { kind: "spike", title: "Item", question: "Q", timebox: "1d", expectedDecision: "D", idempotencyKey: "item", commandActor: "carlos" } });
  finish(planningRoot, operationsRoot, item.operationId);
  const wp = runItemPackageAdd({ planningRoot, releaseRef: release.releaseId, itemRef: item.itemId, args: { scopeId: scope.scopeId, commitment: "required", title: "Crash package", idempotencyKey: "package", commandActor: "carlos" } });
  runChangesetValidate({ planningRoot, operationsRoot, operationId: wp.operationId });
  runChangesetApprove({ planningRoot, operationsRoot, operationId: wp.operationId, actor: "carlos", allowSelfApproval: true });
  return { planningRoot, operationsRoot, operationId: wp.operationId, releaseId: release.releaseId, itemId: item.itemId, packageId: wp.packageId };
}

function crashAt(boundary, planningRoot, operationsRoot, operationId) {
  setFaultCheckpoint(boundary);
  assert.throws(
    () => applyOperation({ operationsRoot, planningRoot, operationId, render: (payload) => renderWorkPackageCreateChangeSet(payload, planningRoot), actor: "carlos" }),
    SimulatedCrashError
  );
  clearFaultCheckpoint();
}

{
  const { planningRoot, operationsRoot, operationId, releaseId, itemId, packageId } = approvedPackageOperation();
  const reservedEventId = readOperation(operationsRoot, operationId).reservedEvents[0].eventId;
  crashAt("AFTER_MANIFEST", planningRoot, operationsRoot, operationId);
  assert.equal(readOperation(operationsRoot, operationId).status, "APPROVED");
  const retry = applyOperation({ operationsRoot, planningRoot, operationId, render: (payload) => renderWorkPackageCreateChangeSet(payload, planningRoot), actor: "carlos" });
  assert.equal(retry.status, "APPLIED");
  assert.equal(readOperation(operationsRoot, operationId).expectedEvents[0].eventId, reservedEventId);
  assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseId, "items", itemId, "work-packages", packageId, "work-package.yml")), true);
}

for (const boundary of ["AFTER_FIRST_RENAME", "AFTER_ALL_RENAMES", "AFTER_RESULT", "AFTER_FIRST_EVENT"]) {
  const { planningRoot, operationsRoot, operationId, releaseId, itemId, packageId } = approvedPackageOperation();
  const itemBefore = fs.readFileSync(path.join(planningRoot, "releases", releaseId, "items", itemId, "release-item.yml"), "utf8");
  crashAt(boundary, planningRoot, operationsRoot, operationId);
  const outcomes = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(outcomes.find((entry) => entry.operationId === operationId)?.outcome, "COMPLETED");
  const operation = readOperation(operationsRoot, operationId);
  assert.equal(operation.status, "APPLIED");
  assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseId, "items", itemId, "work-packages", packageId, "work-package.yml")), true);
  assert.equal(fs.readFileSync(path.join(planningRoot, "releases", releaseId, "items", itemId, "release-item.yml"), "utf8"), itemBefore, "work-package.create must not mutate its parent item");
  const eventPath = path.join(planningRoot, "events", operation.expectedEvents[0].relativePath);
  const eventBefore = fs.readFileSync(eventPath, "utf8");
  const secondPass = recoverWorkspace({ planningRoot, operationsRoot });
  assert.equal(secondPass.find((entry) => entry.operationId === operationId)?.outcome, "NOT_APPLICABLE");
  assert.equal(fs.readFileSync(eventPath, "utf8"), eventBefore, "recovery must not duplicate or rewrite work-package.created events");
}

console.log("work-package-crash-recovery: work-package.create retries and recovers without duplicate package or event");
