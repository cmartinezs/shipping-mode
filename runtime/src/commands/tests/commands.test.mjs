import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit, runConfigSet, runConfigScopeAdd } from "../init.mjs";
import { runChangesetPropose, runChangesetValidate, runChangesetApprove, runChangesetApply } from "../changesetCommand.mjs";
import { checkRelease } from "../check.mjs";
import { runReleaseNew, runReleaseStatus, runReleasePolicyConfigure, runReleaseScopeSet, runReleaseRefsSet, runReleaseDeploymentRecord, runReleaseFinalize } from "../release.mjs";
import { runItemCreate } from "../item.mjs";
import { readOperation, readChangeSet, writeChangeSet } from "../../lib/operationStore.mjs";
import { computePersistedChangeSetHash } from "../../lib/changeset.mjs";
import { parseYaml, stringifyYaml } from "../../lib/yaml.mjs";
import { contentHash, revisionHash } from "../../lib/canonical.mjs";
import { generateUuidV7, isUuidV7 } from "../../lib/ids.mjs";
import { updateReleaseRevision } from "../../lib/releaseMutations.mjs";
import { renderReleaseReadme } from "../../lib/releaseProjection.mjs";
import { renderGuideMarkdown } from "../../lib/guideProjection.mjs";
import { computeSourceFingerprint } from "../../lib/fingerprint.mjs";
import { DEFAULT_MAX_SOURCE_BYTES } from "../../lib/discoverScan.mjs";
import { UsageError } from "../../lib/errors.mjs";
import { PLUGIN_VERSION, TEMPLATE_PACK_FINGERPRINT } from "../../generated/build-meta.mjs";

function persistApprovedManualGuides({ workspace, planningRoot, scopeId }) {
  const sourceId = generateUuidV7();
  const sourcePath = "docs/release-guide-source.md";
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, sourcePath), "release guide source\n");
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
    confirmedContentHash: observed.contentHash
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

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "commands-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
const operationsRoot = path.join(planningRoot, "operations");

const initResult = runInit({ planningRoot, args: { name: "demo", vcs: "git", actor: "carlos" } });
const initChangeSet = readChangeSet(operationsRoot, initResult.operationId);
assert.equal(initChangeSet.payload.pluginVersion, PLUGIN_VERSION, "pluginVersion must be exactly the build-time constant, never a runtime fallback");
assert.equal(initChangeSet.payload.templatePackFingerprint, TEMPLATE_PACK_FINGERPRINT, "templatePackFingerprint must be exactly the build-time constant, never a placeholder string");

let outcome = runChangesetValidate({ planningRoot, operationsRoot, operationId: initResult.operationId });
assert.equal(outcome.status, "VALIDATED");
runChangesetApprove({ operationsRoot, planningRoot, operationId: initResult.operationId, actor: "carlos", allowSelfApproval: true });
outcome = runChangesetApply({ planningRoot, operationsRoot, operationId: initResult.operationId, actor: "carlos" });
assert.equal(outcome.status, "APPLIED");
assert.equal(readOperation(operationsRoot, initResult.operationId).status, "APPLIED");
assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")).name, "demo");

// Git and Work Source policy changes use the existing config.update ChangeSet lifecycle.
const policyUpdate = runChangesetPropose({
  planningRoot,
  kind: "config.update",
  actor: "carlos",
  payloadText: JSON.stringify({
    git: {
      enabled: true,
      provider: "github",
      branches: { work_base: "develop", integration: "develop", production: "master" },
      pull_requests: {
        enabled: true,
        work_target: "develop",
        draft_by_default: true,
        merge_strategy: "provider_default",
        promotion: { source: "develop", target: "master" }
      }
    },
    work_sources: [{
      id: "jira-gradeops",
      provider: "jira",
      enabled: false,
      transport: "mcp",
      source_policy: "external_authoritative",
      sync_mode: "pull",
      mcp_connection_ref: "atlassian"
    }]
  })
});
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: policyUpdate.operationId }).status, "VALIDATED");
runChangesetApprove({ operationsRoot, planningRoot, operationId: policyUpdate.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: policyUpdate.operationId, actor: "carlos" });
const persistedPolicy = parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"));
assert.equal(persistedPolicy.git.pull_requests.promotion.target, "master");
assert.equal(persistedPolicy.vcs, "git");
assert.equal(persistedPolicy.baseBranch, "develop");
assert.equal(persistedPolicy.work_sources[0].mcp_connection_ref, "atlassian");

const invalidPolicyUpdate = runChangesetPropose({
  planningRoot,
  kind: "config.update",
  actor: "test-user",
  payloadText: JSON.stringify({
    git: {
      enabled: true,
      provider: "github",
      branches: { work_base: "main", integration: "main", production: "main" },
      pull_requests: { enabled: true, work_target: "release", draft_by_default: true, merge_strategy: "provider_default", promotion: { source: "main", target: "main" } }
    }
  })
});
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: invalidPolicyUpdate.operationId }).status, "INVALID", "relationally-invalid Project Context must never reach APPROVED/APPLIED");
const duplicateWorkSourceUpdate = runChangesetPropose({
  planningRoot,
  kind: "config.update",
  actor: "test-user",
  payloadText: JSON.stringify({ work_sources: [
    { id: "local-backlog", provider: "local_repository", enabled: true, roots: ["docs/backlog/"], source_policy: "import_snapshot", sync_mode: "import_only" },
    { id: "local-backlog", provider: "local_repository", enabled: false, roots: ["docs/requirements/"], source_policy: "import_snapshot", sync_mode: "import_only" }
  ] })
});
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: duplicateWorkSourceUpdate.operationId }).status, "INVALID", "duplicate Work Source ids must be rejected before apply");

const danglingDocumentationUpdate = runChangesetPropose({
  planningRoot,
  kind: "config.update",
  actor: "test-user",
  payloadText: JSON.stringify({ documentation: {
    source_refs: ["018f0000-0000-7000-8000-000000000099"],
    gaps: []
  } })
});
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: danglingDocumentationUpdate.operationId }).status, "INVALID", "dangling Documentation Source refs must be rejected before apply");

// the scope id must already be fixed in change-set.json immediately after propose, before validate/approve/apply
const scopeResult = runConfigScopeAdd({ planningRoot, args: { key: "backend", label: "Backend", kind: "code", path: "api/", actor: "carlos" } });
assert.ok(isUuidV7(scopeResult.scopeId));
const scopeChangeSet = readChangeSet(operationsRoot, scopeResult.operationId);
assert.equal(scopeChangeSet.payload.id, scopeResult.scopeId, "the scope id in change-set.json must already match what runConfigScopeAdd returned");
assert.ok(scopeChangeSet.baseRevisions["config.yml"], "baseRevisions must include config.yml");
const scopeYmlPath = `scopes/${scopeResult.scopeId}/scope.yml`;
assert.ok(scopeChangeSet.baseRevisions[scopeYmlPath], "baseRevisions must include the new scope's own scope.yml path");
assert.equal(scopeChangeSet.baseRevisions[scopeYmlPath].revisionHash, "ABSENT");
assert.equal(scopeChangeSet.baseRevisions[scopeYmlPath].contentHash, "ABSENT");

runChangesetValidate({ planningRoot, operationsRoot, operationId: scopeResult.operationId });
runChangesetApprove({ operationsRoot, planningRoot, operationId: scopeResult.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: scopeResult.operationId, actor: "carlos" });
const config = parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"));
assert.equal(config.scopeRefs.length, 1);
assert.equal(config.scopeRefs[0].key, "backend");
assert.equal(config.scopeRefs[0].id, scopeResult.scopeId);
assert.equal(config.documentation.gaps[0].concern, "guides");
assert.equal(config.documentation.gaps[0].scope_ref, scopeResult.scopeId);

const commandSet = runChangesetPropose({
  planningRoot,
  kind: "scope.command.set",
  actor: "carlos",
  payloadText: JSON.stringify({ scopeId: scopeResult.scopeId, role: "test", command: "npm test", requiresEnvironment: false, requiresSecrets: false, declaredBy: "caller" })
});
const commandSetChangeSet = readChangeSet(operationsRoot, commandSet.operationId);
assert.equal(commandSetChangeSet.payload.operationId, commandSet.operationId);
assert.equal(commandSetChangeSet.payload.declaredBy, "carlos", "declared command provenance must come from runtime actor");
runChangesetValidate({ planningRoot, operationsRoot, operationId: commandSet.operationId });
runChangesetApprove({ operationsRoot, planningRoot, operationId: commandSet.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: commandSet.operationId, actor: "carlos" });
const scopeWithCommand = parseYaml(fs.readFileSync(path.join(planningRoot, scopeYmlPath), "utf8"));
assert.equal(scopeWithCommand.commands.test.method, "declared");
assert.equal(scopeWithCommand.commands.test.declaredOperationId, commandSet.operationId);
assert.deepEqual(scopeWithCommand.commands.test.alternatives, []);

const releaseCreate = runReleaseNew({
  planningRoot,
  args: {
    title: "Release Core",
    objective: "Create the Release aggregate core",
    slug: "ignored-for-identity",
    idempotencyKey: "release-core-key",
    actor: "carlos"
  }
});
assert.ok(isUuidV7(releaseCreate.releaseId));
assert.match(releaseCreate.displayId, /^REL-[0-9A-HJKMNP-TV-Z]{8}$/);
const releaseCreateChangeSet = readChangeSet(operationsRoot, releaseCreate.operationId);
assert.equal(releaseCreateChangeSet.kind, "release.create");
assert.equal(releaseCreateChangeSet.payload.status, "DRAFT");
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
runChangesetApply({ planningRoot, operationsRoot, operationId: releaseCreate.operationId, actor: "carlos" });
const releaseYmlPath = path.join(planningRoot, "releases", releaseCreate.releaseId, "release.yml");
const releaseReadmePath = path.join(planningRoot, "releases", releaseCreate.releaseId, "README.md");
assert.equal(fs.existsSync(releaseYmlPath), true);
assert.equal(fs.existsSync(releaseReadmePath), true);
const releaseDocument = parseYaml(fs.readFileSync(releaseYmlPath, "utf8"));
assert.equal(releaseDocument.id, releaseCreate.releaseId);
assert.equal(releaseDocument.displayId, releaseCreate.displayId);
assert.equal(releaseDocument.status, "DRAFT");
assert.equal(releaseDocument.lane.id, "main", "apply must use the validated/proposed lane snapshot, not the current mutable config default");
assert.equal(releaseDocument.policy.mode, "strict_sequence");
assert.deepEqual(releaseDocument.itemRefs, []);
fs.writeFileSync(configPathDuringRelease, configBeforeReleaseApply);
assert.equal(releaseDocument.audit.createdBy, "carlos");
const releaseOperation = readOperation(operationsRoot, releaseCreate.operationId);
assert.equal(releaseOperation.expectedEvents[0].document.aggregate.id, releaseCreate.releaseId);
assert.equal(releaseOperation.expectedEvents[0].document.payload.previousStatus, null);
assert.equal(releaseOperation.expectedEvents[0].document.payload.nextStatus, "DRAFT");
assert.equal(releaseOperation.expectedEvents[0].document.payload.changeSetHash, releaseCreateChangeSet.hash);
assert.equal(runReleaseStatus({ planningRoot, reference: releaseCreate.releaseId }).status, "FOUND");
assert.equal(runReleaseStatus({ planningRoot, reference: releaseCreate.displayId }).release.id, releaseCreate.releaseId);
assert.equal(runReleaseStatus({ planningRoot, reference: "ignored-for-identity" }).status, "NOT_FOUND", "slug must not resolve");
const scopeRefsSet = runReleaseScopeSet({
  planningRoot,
  args: { releaseRef: releaseCreate.releaseId, scopeIds: scopeResult.scopeId, policyMode: "strict", idempotencyKey: "scope-refs-plan2", actor: "carlos" }
});
runChangesetValidate({ planningRoot, operationsRoot, operationId: scopeRefsSet.operationId });
runChangesetApprove({ operationsRoot, planningRoot, operationId: scopeRefsSet.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: scopeRefsSet.operationId, actor: "carlos" });
const releaseAfterScopeRefs = parseYaml(fs.readFileSync(releaseYmlPath, "utf8"));
assert.equal(releaseAfterScopeRefs.scopeRefs.length, 1);
assert.equal(releaseAfterScopeRefs.scopeRefs[0].scopeId, scopeResult.scopeId);
assert.equal(releaseAfterScopeRefs.scopeRefs[0].readiness.ready, false, "missing guides must not become vacuous readiness");
assert.ok(releaseAfterScopeRefs.scopeRefs[0].findings.some((finding) => finding.code === "GUIDE_MISSING"));
const configForPlan2 = parseYaml(fs.readFileSync(configPathDuringRelease, "utf8"));
configForPlan2.policies.release.lanes.push({ id: "hotfix", label: "Hotfix" });
fs.writeFileSync(configPathDuringRelease, stringifyYaml(configForPlan2));
const policyConfigure = runReleasePolicyConfigure({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, laneId: "hotfix", policyMode: "dependency_graph", dependencyRefs: "", idempotencyKey: "policy-plan2", actor: "carlos" }
});
runChangesetValidate({ planningRoot, operationsRoot, operationId: policyConfigure.operationId });
runChangesetApprove({ operationsRoot, planningRoot, operationId: policyConfigure.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: policyConfigure.operationId, actor: "carlos" });
let releaseAfterPolicy = parseYaml(fs.readFileSync(releaseYmlPath, "utf8"));
assert.equal(releaseAfterPolicy.lane.id, "hotfix");
assert.equal(releaseAfterPolicy.policy.mode, "dependency_graph");
const executionContextId = generateUuidV7();
const environmentId = generateUuidV7();
fs.mkdirSync(path.join(planningRoot, "execution-contexts", executionContextId), { recursive: true });
fs.writeFileSync(path.join(planningRoot, "execution-contexts", executionContextId, "execution-context.yml"), stringifyYaml({ schemaVersion: 1, id: executionContextId, kind: "ci", label: "CI" }));
fs.mkdirSync(path.join(planningRoot, "environments", environmentId), { recursive: true });
fs.writeFileSync(path.join(planningRoot, "environments", environmentId, "environment.yml"), stringifyYaml({ schemaVersion: 1, id: environmentId, kind: "staging", label: "Staging", laneRefs: ["hotfix"] }));
const refsSet = runReleaseRefsSet({
  planningRoot,
  args: { releaseRef: releaseCreate.releaseId, executionContextRefs: executionContextId, environmentRefs: environmentId, idempotencyKey: "ops-refs-plan2", actor: "carlos" }
});
runChangesetValidate({ planningRoot, operationsRoot, operationId: refsSet.operationId });
runChangesetApprove({ operationsRoot, planningRoot, operationId: refsSet.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: refsSet.operationId, actor: "carlos" });
const deploymentRecord = runReleaseDeploymentRecord({
  planningRoot,
  args: { releaseRef: releaseCreate.releaseId, environmentRef: environmentId, executionContextRef: executionContextId, status: "succeeded", evidenceRefs: "evidence://deploy/1", idempotencyKey: "deploy-plan2", actor: "carlos" }
});
runChangesetValidate({ planningRoot, operationsRoot, operationId: deploymentRecord.operationId });
runChangesetApprove({ operationsRoot, planningRoot, operationId: deploymentRecord.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: deploymentRecord.operationId, actor: "carlos" });
const releaseAfterDeployment = parseYaml(fs.readFileSync(releaseYmlPath, "utf8"));
assert.equal(releaseAfterDeployment.status, "DRAFT", "deployment evidence must not auto-transition lifecycle");
assert.deepEqual(releaseAfterDeployment.executionContextRefs, [executionContextId]);
assert.deepEqual(releaseAfterDeployment.environmentRefs, [environmentId]);
assert.equal(releaseAfterDeployment.deploymentEvents.length, 1);
assert.equal(readOperation(operationsRoot, deploymentRecord.operationId).expectedEvents[0].document.payload.deploymentEventId, releaseAfterDeployment.deploymentEvents[0].id);
const tamperedDeployment = runReleaseDeploymentRecord({
  planningRoot,
  args: { releaseRef: releaseCreate.releaseId, environmentRef: environmentId, executionContextRef: executionContextId, status: "started", idempotencyKey: "deploy-plan2-tampered", actor: "carlos" }
});
const tamperedChangeSet = readChangeSet(operationsRoot, tamperedDeployment.operationId);
tamperedChangeSet.payload.updatedBy = "mallory";
tamperedChangeSet.payload.deploymentEvent.actor = "mallory";
tamperedChangeSet.payload.requestSnapshot.status = "failed";
tamperedChangeSet.payload.deploymentEvent.status = "failed";
tamperedChangeSet.payload.idempotencyRequestHash = "0".repeat(64);
tamperedChangeSet.hash = computePersistedChangeSetHash(tamperedChangeSet);
writeChangeSet(operationsRoot, tamperedDeployment.operationId, tamperedChangeSet);
const tamperedOutcome = runChangesetValidate({ planningRoot, operationsRoot, operationId: tamperedDeployment.operationId });
assert.equal(tamperedOutcome.status, "INVALID", "recomputed ChangeSet hashes must not permit caller edits to server-bound Plan 2 state");
assert.ok(tamperedOutcome.errors.some((error) => error.includes("server-owned proposal hash") || error.includes("server-owned Operation")));
const plan2Status = runReleaseStatus({ planningRoot, reference: releaseCreate.releaseId });
assert.equal(plan2Status.deployment.count, 1);
assert.deepEqual(plan2Status.refs.executionContextRefs, [executionContextId]);
assert.deepEqual(plan2Status.refs.environmentRefs, [environmentId]);
assert.equal(plan2Status.completion.status, "unavailable", "completion must not be inferred from empty itemRefs");
assert.ok(plan2Status.derivedHealth.findings.some((finding) => finding.code === "CAPABILITY_UNAVAILABLE"));
assert.throws(() => runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.releaseId, idempotencyKey: "finalize-draft-plan3", actor: "carlos" }
}), /requires lifecycle RELEASED/, "non-RELEASED lifecycles must fail closed for finalization");
const checkReleaseResult = checkRelease({ planningRoot, reference: releaseCreate.displayId });
assert.equal(checkReleaseResult.scope, "single");
  assert.equal(checkReleaseResult.releases[0].release.id, releaseCreate.releaseId);
  assert.equal(checkRelease({ planningRoot, reference: "ignored-for-identity" }).status, "NOT_FOUND", "check release must not resolve slugs");

  const finalizationItem = runItemCreate({
    planningRoot,
    releaseRef: releaseCreate.releaseId,
    args: {
      kind: "spike",
      title: "Finalization scope item",
      question: "Can Release health discover items?",
      timebox: "1d",
      expectedDecision: "Release Item catalog is evaluable",
      idempotencyKey: "finalization-item-plan3-regression",
      commandActor: "carlos"
    }
  });
  assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: finalizationItem.operationId }).status, "VALIDATED");
  runChangesetApprove({ operationsRoot, planningRoot, operationId: finalizationItem.operationId, actor: "carlos", allowSelfApproval: true });
  runChangesetApply({ planningRoot, operationsRoot, operationId: finalizationItem.operationId, actor: "carlos" });

  let releasableFixture = parseYaml(fs.readFileSync(releaseYmlPath, "utf8"));
releasableFixture = {
  ...releasableFixture,
  status: "RELEASED",
  scopeRefs: releasableFixture.scopeRefs.map((scopeRef) => ({ ...scopeRef, readiness: { ...scopeRef.readiness, ready: true }, findings: [] }))
};
releasableFixture = updateReleaseRevision(releasableFixture);
fs.writeFileSync(releaseYmlPath, stringifyYaml(releasableFixture));
fs.writeFileSync(releaseReadmePath, renderReleaseReadme(releasableFixture));
assert.throws(() => runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-stale-scope-plan3", actor: "carlos" }
}), /scope|GUIDE_EVIDENCE_STALE/, "caller-edited readiness cannot replace live Scope/Guide evaluation");

persistApprovedManualGuides({ workspace, planningRoot, scopeId: scopeResult.scopeId });
const currentScopeEvidence = runReleaseScopeSet({
  planningRoot,
  args: { releaseRef: releaseCreate.releaseId, scopeIds: scopeResult.scopeId, policyMode: "strict", idempotencyKey: "scope-refs-current-plan3", actor: "carlos" }
});
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: currentScopeEvidence.operationId }).status, "VALIDATED");
runChangesetApprove({ operationsRoot, planningRoot, operationId: currentScopeEvidence.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: currentScopeEvidence.operationId, actor: "carlos" });
assert.equal(parseYaml(fs.readFileSync(releaseYmlPath, "utf8")).scopeRefs[0].readiness.ready, true);

const driftedFinalize = runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-drift-plan3", actor: "carlos" }
});
const environmentPath = path.join(planningRoot, "environments", environmentId, "environment.yml");
const environmentBeforeDrift = fs.readFileSync(environmentPath, "utf8");
const changedEnvironment = parseYaml(environmentBeforeDrift);
changedEnvironment.label = "Staging changed after propose";
fs.writeFileSync(environmentPath, stringifyYaml(changedEnvironment));
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: driftedFinalize.operationId }).status, "STALE", "external evidence revision drift must stale finalization even when health remains valid");
fs.writeFileSync(environmentPath, environmentBeforeDrift);

const tamperedFinalize = runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-tampered-plan3", actor: "carlos" }
});
const tamperedFinalizeChangeSet = readChangeSet(operationsRoot, tamperedFinalize.operationId);
tamperedFinalizeChangeSet.payload.nextFinalization.completedBy = "mallory";
tamperedFinalizeChangeSet.payload.guardSummary.healthRevision = "0".repeat(64);
tamperedFinalizeChangeSet.hash = computePersistedChangeSetHash(tamperedFinalizeChangeSet);
writeChangeSet(operationsRoot, tamperedFinalize.operationId, tamperedFinalizeChangeSet);
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: tamperedFinalize.operationId }).status, "INVALID", "recomputed public hashes must not permit forged finalization evidence");

const finalize = runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-plan3", actor: "carlos" }
});
assert.equal(readChangeSet(operationsRoot, finalize.operationId).kind, "release.finalization.complete");
runChangesetValidate({ planningRoot, operationsRoot, operationId: finalize.operationId });
runChangesetApprove({ operationsRoot, planningRoot, operationId: finalize.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: finalize.operationId, actor: "carlos" });
const releaseAfterFinalize = parseYaml(fs.readFileSync(releaseYmlPath, "utf8"));
assert.equal(releaseAfterFinalize.status, "RELEASED", "finalization metadata must not change lifecycle");
assert.equal(releaseAfterFinalize.finalization.completed, true);
assert.equal(releaseAfterFinalize.finalization.completedBy, "carlos");
const finalizationEvent = readOperation(operationsRoot, finalize.operationId).expectedEvents[0].document;
assert.equal(finalizationEvent.type, "release.finalization.completed");
assert.equal(finalizationEvent.payload.previousFinalization.completed, false);
assert.equal(finalizationEvent.payload.nextFinalization.completed, true);
assert.equal(finalizationEvent.payload.derivedGuardSummary.lifecycle, "RELEASED");

const finalizeRetry = runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "not_required", idempotencyKey: "finalize-plan3", actor: "carlos" }
});
assert.equal(finalizeRetry.operationId, finalize.operationId, "exact finalization retry must be idempotent");
assert.throws(() => runReleaseFinalize({
  planningRoot,
  args: { releaseRef: releaseCreate.displayId, retrospectiveStatus: "approved", idempotencyKey: "finalize-plan3", actor: "carlos" }
}), /different release\.finalization\.complete request/);
const idempotent = runReleaseNew({
  planningRoot,
  args: {
    title: "Release Core",
    objective: "Create the Release aggregate core",
    slug: "ignored-for-identity",
    idempotencyKey: "release-core-key",
    actor: "carlos"
  }
});
assert.equal(idempotent.operationId, releaseCreate.operationId);
assert.equal(idempotent.releaseId, releaseCreate.releaseId);
assert.equal(idempotent.idempotent, true);
assert.throws(() => runReleaseNew({
  planningRoot,
  args: { title: "Release Core", objective: "Different request", idempotencyKey: "release-core-key", actor: "carlos" }
}), /idempotency key .* different release\.create request/, "same idempotency key must not alias a different create request");
const pendingReleaseA = runReleaseNew({ planningRoot, args: { title: "Pending A", objective: "A", idempotencyKey: "pending-a", actor: "carlos" } });
const pendingReleaseB = runReleaseNew({ planningRoot, args: { title: "Pending B", objective: "B", idempotencyKey: "pending-b", actor: "carlos" } });
assert.notEqual(pendingReleaseA.displayId, pendingReleaseB.displayId, "separate pending releases must not inherit the same UUIDv7 timestamp-prefix display ID");
const genericPayload = JSON.stringify({ title: "Generic", objective: "Generic path", idempotencyKey: "generic-release", slug: null });
const genericFirst = runChangesetPropose({ planningRoot, kind: "release.create", actor: "carlos", payloadText: genericPayload });
const genericSecond = runChangesetPropose({ planningRoot, kind: "release.create", actor: "carlos", payloadText: genericPayload });
assert.equal(genericSecond.operationId, genericFirst.operationId, "generic changeset entrypoint must share release.create idempotency");
assert.equal(genericSecond.idempotent, true);

// changeset propose --payload-file equivalent: raw JSON text in, operationId out
const proposeFromText = runChangesetPropose({
  planningRoot, kind: "config.update", actor: "carlos",
  payloadText: JSON.stringify({ name: "renamed-via-propose" })
});
assert.ok(proposeFromText.operationId);
const textValidate = runChangesetValidate({ planningRoot, operationsRoot, operationId: proposeFromText.operationId });
assert.equal(textValidate.status, "VALIDATED");

// invalid payload text must be rejected with a UsageError, not a crash
assert.throws(() => runChangesetPropose({ planningRoot, kind: "config.update", actor: "carlos", payloadText: "{not json or yaml::" }), UsageError);


const corruptReleaseId = generateUuidV7();
fs.mkdirSync(path.join(planningRoot, "releases", corruptReleaseId), { recursive: true });
fs.writeFileSync(path.join(planningRoot, "releases", corruptReleaseId, "release.yml"), "schemaVersion: 1\n");
fs.writeFileSync(path.join(planningRoot, "releases", corruptReleaseId, "README.md"), "invalid\n");
const corruptCatalogCheck = checkRelease({ planningRoot });
assert.equal(corruptCatalogCheck.status, "FAIL");
assert.ok(corruptCatalogCheck.releases.some((entry) => entry.release.id === corruptReleaseId), "catalog checks must retain schema-invalid Release records instead of omitting or crashing");

console.log("commands: all tests passed");
