import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit, runConfigSet, runConfigScopeAdd } from "../init.mjs";
import { runChangesetPropose, runChangesetValidate, runChangesetApprove, runChangesetApply } from "../changesetCommand.mjs";
import { runReleaseNew, runReleaseStatus } from "../release.mjs";
import { readOperation, readChangeSet } from "../../lib/operationStore.mjs";
import { parseYaml } from "../../lib/yaml.mjs";
import { isUuidV7 } from "../../lib/ids.mjs";
import { UsageError } from "../../lib/errors.mjs";
import { PLUGIN_VERSION, TEMPLATE_PACK_FINGERPRINT } from "../../generated/build-meta.mjs";

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
assert.equal(fs.existsSync(path.join(planningRoot, "releases", releaseCreate.releaseId, "release.yml")), false, "release new must only propose");
assert.equal(runChangesetValidate({ planningRoot, operationsRoot, operationId: releaseCreate.operationId }).status, "VALIDATED");
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
assert.deepEqual(releaseDocument.itemRefs, []);
assert.equal(releaseDocument.audit.createdBy, "carlos");
const releaseOperation = readOperation(operationsRoot, releaseCreate.operationId);
assert.equal(releaseOperation.expectedEvents[0].document.aggregate.id, releaseCreate.releaseId);
assert.equal(releaseOperation.expectedEvents[0].document.payload.previousStatus, null);
assert.equal(releaseOperation.expectedEvents[0].document.payload.nextStatus, "DRAFT");
assert.equal(releaseOperation.expectedEvents[0].document.payload.changeSetHash, releaseCreateChangeSet.hash);
assert.equal(runReleaseStatus({ planningRoot, reference: releaseCreate.releaseId }).status, "FOUND");
assert.equal(runReleaseStatus({ planningRoot, reference: releaseCreate.displayId }).release.id, releaseCreate.releaseId);
assert.equal(runReleaseStatus({ planningRoot, reference: "ignored-for-identity" }).status, "NOT_FOUND", "slug must not resolve");
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

console.log("commands: all tests passed");
