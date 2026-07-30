import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseYaml, stringifyYaml } from "../src/lib/yaml.mjs";
import { isUuidV7 } from "../src/lib/ids.mjs";
import { updateReleaseRevision } from "../src/lib/releaseMutations.mjs";
import { renderReleaseReadme } from "../src/lib/releaseProjection.mjs";
import { PLUGIN_VERSION, TEMPLATE_PACK_FINGERPRINT } from "../src/generated/build-meta.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "bin", "shipping-mode.mjs");
const testBundle = path.join(root, "runtime", "dist", "shipping-mode.test-bundle.mjs");

function run(args, cwd, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", ...options });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.status, json: JSON.parse(error.stdout) };
  }
}

async function runAsync(args, cwd) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.code, json: JSON.parse(error.stdout) };
  }
}

function freshWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cli-e2e-"));
}

function fullyInit(cwd) {
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  run(["changeset", "validate", init.json.operationId], cwd);
  run(["changeset", "approve", init.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  run(["changeset", "apply", init.json.operationId, "--actor", "carlos"], cwd);
  return init.json.operationId;
}

// happy path: init -> validate -> approve -> apply -> check schema
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--project-type", "software", "--vcs", "git", "--actor", "carlos"], cwd);
  assert.equal(init.code, 0);
  const operationId = init.json.operationId;
  assert.equal(run(["changeset", "validate", operationId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  const applied = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 0);
  assert.equal(applied.json.status, "APPLIED");
  const check = run(["check", "schema"], cwd);
  assert.equal(check.code, 0);
  assert.equal(check.json.status, "PASS");
  for (const requiredDirectory of [
    "events",
    "operations",
    ".runtime",
    "scopes",
    "sources",
    "concerns",
    "gates",
    "gate-profiles",
    "execution-contexts",
    "environments",
    "decisions",
    "releases",
    "vendor/template-packs"
  ]) {
    assert.equal(fs.lstatSync(path.join(cwd, ".planning", requiredDirectory)).isDirectory(), true, `${requiredDirectory} must exist after workspace.init apply`);
  }

  // the real bundle must produce the exact build-time version/fingerprint,
  // never a runtime-derived or placeholder value (Revision 3 note 5)
  const pluginLock = parseYaml(fs.readFileSync(path.join(cwd, ".planning", "plugin.lock.yml"), "utf8"));
  assert.equal(pluginLock.pluginVersion, PLUGIN_VERSION);
  assert.equal(pluginLock.templatePackFingerprint, TEMPLATE_PACK_FINGERPRINT);
  assert.equal(pluginLock.plugin.version, PLUGIN_VERSION);
  assert.equal(pluginLock.plugin.schemaVersion, 1);
  assert.equal(pluginLock.plugin.templatePack.fingerprint, TEMPLATE_PACK_FINGERPRINT);
  assert.equal(pluginLock.plugin.templatePack.vendorSnapshot, `.planning/vendor/template-packs/${TEMPLATE_PACK_FINGERPRINT.replace(":", "-")}`);
  const config = parseYaml(fs.readFileSync(path.join(cwd, ".planning", "config.yml"), "utf8"));
  assert.deepEqual(config.project, { name: "demo", type: "software" });
  assert.equal(config.plugin.launcher, "shipping-mode");
  assert.equal(config.runtime.operationStore, ".planning/operations");
  assert.equal(config.policies.paths.workspaceBoundary, "current_directory");
}

// invalid project type is rejected before an operation is proposed.
{
  const cwd = freshWorkspace();
  const result = run(["init", "--name", "demo", "--project-type", "invalid", "--actor", "carlos"], cwd);
  assert.equal(result.code, 1);
  assert.match(result.json.error, /--project-type/);
}

// config set
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const set = run(["config", "set", "--name", "renamed", "--actor", "carlos"], cwd);
  assert.equal(set.code, 0);
  run(["changeset", "validate", set.json.operationId], cwd);
  run(["changeset", "approve", set.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  const applied = run(["changeset", "apply", set.json.operationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 0);
}

// config autonomy set: public CLI creates a ChangeSet and never auto-approves itself
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const payloadFile = path.join(cwd, "autonomy.json");
  fs.writeFileSync(payloadFile, JSON.stringify({
    discovery: {
      default: "pause",
      scopeCommandConfidenceFloor: "high",
      sourceOverrides: [{
        family: "project-module-manifests",
        mode: "auto-approve",
        authorityCeiling: { standing: "supporting", force: "advisory" }
      }],
      scopeCommand: { mode: "auto-approve" }
    }
  }));
  const set = run(["config", "autonomy", "set", "--file", payloadFile, "--actor", "carlos"], cwd);
  assert.equal(set.code, 0);
  assert.equal(run(["changeset", "validate", set.json.operationId], cwd).code, 0);
  const autonomous = run(["changeset", "approve", set.json.operationId, "--actor", "discovery-skill", "--mode", "autonomous"], cwd);
  assert.equal(autonomous.code, 1, "autonomy policy changes must never be autonomously approved");
  assert.equal(run(["changeset", "approve", set.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  assert.equal(run(["changeset", "apply", set.json.operationId, "--actor", "carlos"], cwd).code, 0);
  const config = parseYaml(fs.readFileSync(path.join(cwd, ".planning", "config.yml"), "utf8"));
  assert.equal(config.autonomy.discovery.scopeCommand.mode, "auto-approve");
}

// config scope add, successful end to end
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  fs.mkdirSync(path.join(cwd, "api"), { recursive: true });
  const scope = run(["config", "scope", "add", "--key", "backend", "--label", "Backend", "--kind", "code", "--path", "api/", "--actor", "carlos"], cwd);
  assert.equal(scope.code, 0);
  run(["changeset", "validate", scope.json.operationId], cwd);
  run(["changeset", "approve", scope.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  const applied = run(["changeset", "apply", scope.json.operationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 0);
}

// release new/status: creates a ChangeSet only, then publishes release.yml and README.md atomically through apply
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const release = run(["release", "new", "--title", "Release Core", "--objective", "Create release aggregate core", "--slug", "release-core", "--idempotency-key", "cli-release-core", "--actor", "carlos"], cwd);
  assert.equal(release.code, 0);
  assert.ok(isUuidV7(release.json.releaseId));
  assert.match(release.json.displayId, /^REL-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(fs.existsSync(path.join(cwd, ".planning", "releases", release.json.releaseId, "release.yml")), false, "release new must not write canonical state");
  run(["changeset", "validate", release.json.operationId], cwd);
  run(["changeset", "approve", release.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  const applied = run(["changeset", "apply", release.json.operationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 0);
  assert.equal(fs.existsSync(path.join(cwd, ".planning", "releases", release.json.releaseId, "release.yml")), true);
  assert.equal(fs.existsSync(path.join(cwd, ".planning", "releases", release.json.releaseId, "README.md")), true);
  const byId = run(["release", "status", release.json.releaseId], cwd);
  assert.equal(byId.code, 0);
  assert.equal(byId.json.status, "FOUND");
  assert.equal(byId.json.release.lifecycle, "DRAFT");
  assert.equal(byId.json.completion.status, "unavailable");
  assert.equal(byId.json.readiness.status, "blocked");
  const checkRelease = run(["check", "release", release.json.displayId], cwd);
  assert.equal(checkRelease.code, 1);
  assert.equal(checkRelease.json.scope, "single");
  assert.equal(checkRelease.json.releases[0].release.id, release.json.releaseId);
  const checkCatalog = run(["check", "release"], cwd);
  assert.equal(checkCatalog.code, 1);
  assert.equal(checkCatalog.json.scope, "catalog");
  const checkCatalogJson = run(["check", "release", "--format", "json"], cwd);
  assert.equal(checkCatalogJson.code, 1);
  assert.equal(checkCatalogJson.json.scope, "catalog", "--format json must not be parsed as a Release reference");
  const checkSingleJson = run(["check", "release", release.json.displayId, "--format", "json"], cwd);
  assert.equal(checkSingleJson.code, 1);
  assert.equal(checkSingleJson.json.scope, "single");
  const unsupportedFormat = run(["check", "release", "--format", "yaml"], cwd);
  assert.equal(unsupportedFormat.code, 1);
  assert.match(unsupportedFormat.json.error, /--format must be json/);
  const byDisplay = run(["release", "status", release.json.displayId], cwd);
  assert.equal(byDisplay.code, 0);
  assert.equal(byDisplay.json.release.id, release.json.releaseId);
  const item = run([
    "item", "create", release.json.displayId,
    "--kind", "user_story",
    "--title", "CLI Release Item",
    "--item-actor", "teacher",
    "--need", "query item status",
    "--value", "confidence",
    "--acceptance-criteria", "item status works",
    "--idempotency-key", "cli-release-item",
    "--actor", "carlos"
  ], cwd);
  assert.equal(item.code, 0);
  assert.match(item.json.displayId, /^RI-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(fs.existsSync(path.join(cwd, ".planning", "releases", release.json.releaseId, "items", item.json.itemId, "release-item.yml")), false, "item create must not write canonical state");
  run(["changeset", "validate", item.json.operationId], cwd);
  run(["changeset", "approve", item.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  assert.equal(run(["changeset", "apply", item.json.operationId, "--actor", "carlos"], cwd).code, 0);
  const itemStatus = run(["item", "status", release.json.releaseId, item.json.displayId], cwd);
  assert.equal(itemStatus.code, 0);
  assert.equal(itemStatus.json.status, "FOUND");
  assert.equal(itemStatus.json.item.id, item.json.itemId);
  const checkItem = run(["check", "item", release.json.displayId, item.json.itemId, "--format", "json"], cwd);
  assert.equal(checkItem.code, 0);
  assert.equal(checkItem.json.status, "PASS");
  const itemReadmePath = path.join(cwd, ".planning", "releases", release.json.releaseId, "items", item.json.itemId, "README.md");
  const itemReadme = fs.readFileSync(itemReadmePath, "utf8");
  fs.appendFileSync(itemReadmePath, "drift\n");
  const failedItemCheck = run(["check", "item", release.json.displayId, item.json.itemId, "--format", "json"], cwd);
  assert.equal(failedItemCheck.code, 1);
  assert.equal(failedItemCheck.json.status, "FAIL");
  fs.writeFileSync(itemReadmePath, itemReadme);
  const releaseWithItems = run(["release", "status", release.json.releaseId], cwd);
  assert.deepEqual(releaseWithItems.json.refs.canonicalItemIds, [item.json.itemId]);
  const bySlug = run(["release", "status", "release-core"], cwd);
  assert.equal(bySlug.code, 1);
  assert.equal(bySlug.json.status, "NOT_FOUND");
  const sameKey = run(["release", "new", "--title", "Release Core", "--objective", "Create release aggregate core", "--slug", "release-core", "--idempotency-key", "cli-release-core", "--actor", "carlos"], cwd);
  assert.equal(sameKey.code, 0);
  assert.equal(sameKey.json.operationId, release.json.operationId, "same idempotency key and request must not mint a second Release");
  assert.equal(sameKey.json.releaseId, release.json.releaseId);
  assert.equal(sameKey.json.displayId, release.json.displayId);
  assert.equal(sameKey.json.idempotent, true);
  const conflictingKeyReuse = run(["release", "new", "--title", "Release Core", "--objective", "Different request", "--slug", "release-core", "--idempotency-key", "cli-release-core", "--actor", "carlos"], cwd);
  assert.equal(conflictingKeyReuse.code, 1, "same idempotency key with a different request must fail closed");
  assert.match(conflictingKeyReuse.json.error, /idempotency key .* different release\.create request/);
  assert.equal(fs.readdirSync(path.join(cwd, ".planning", "releases")).length, 1);
  const operationsBeforeStatus = fs.readdirSync(path.join(cwd, ".planning", "operations")).length;
  run(["release", "status", release.json.displayId], cwd);
  assert.equal(fs.readdirSync(path.join(cwd, ".planning", "operations")).length, operationsBeforeStatus, "release status must be query-only");
}

// release status unknown ID is structured
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const unknown = run(["release", "status", "018f0000-0000-7000-8000-000000000999"], cwd);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.json.status, "NOT_FOUND");
}

// release Plan 2: policy configure, operational refs and deployment record stay ChangeSet-bound and query-only status reports them
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const release = run(["release", "new", "--title", "Release Ops", "--objective", "Record operational refs", "--idempotency-key", "cli-plan2-release", "--actor", "carlos"], cwd);
  run(["changeset", "validate", release.json.operationId], cwd);
  run(["changeset", "approve", release.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  run(["changeset", "apply", release.json.operationId, "--actor", "carlos"], cwd);

  const configPath = path.join(cwd, ".planning", "config.yml");
  const config = parseYaml(fs.readFileSync(configPath, "utf8"));
  config.policies.release.lanes.push({ id: "hotfix", label: "Hotfix" });
  fs.writeFileSync(configPath, stringifyYaml(config));

  const policy = run(["release", "policy", "configure", release.json.displayId, "--lane-id", "hotfix", "--policy-mode", "dependency_graph", "--dependency-refs", "", "--idempotency-key", "cli-plan2-policy", "--actor", "carlos"], cwd);
  assert.equal(policy.code, 0);
  run(["changeset", "validate", policy.json.operationId], cwd);
  run(["changeset", "approve", policy.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  run(["changeset", "apply", policy.json.operationId, "--actor", "carlos"], cwd);

  const executionContextId = "018f0000-0000-7000-8000-00000000c101";
  const environmentId = "018f0000-0000-7000-8000-00000000e101";
  fs.mkdirSync(path.join(cwd, ".planning", "execution-contexts", executionContextId), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".planning", "execution-contexts", executionContextId, "execution-context.yml"), stringifyYaml({ schemaVersion: 1, id: executionContextId, kind: "ci", label: "CI" }));
  fs.mkdirSync(path.join(cwd, ".planning", "environments", environmentId), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".planning", "environments", environmentId, "environment.yml"), stringifyYaml({ schemaVersion: 1, id: environmentId, kind: "staging", label: "Staging", laneRefs: ["hotfix"] }));

  const refs = run(["release", "refs", "set", release.json.releaseId, "--execution-context-refs", executionContextId, "--environment-refs", environmentId, "--idempotency-key", "cli-plan2-refs", "--actor", "carlos"], cwd);
  assert.equal(refs.code, 0);
  run(["changeset", "validate", refs.json.operationId], cwd);
  run(["changeset", "approve", refs.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  run(["changeset", "apply", refs.json.operationId, "--actor", "carlos"], cwd);

  const deployment = run(["release", "deployment", "record", release.json.releaseId, "--environment-ref", environmentId, "--execution-context-ref", executionContextId, "--status", "succeeded", "--evidence-refs", "evidence://cli/deploy", "--idempotency-key", "cli-plan2-deployment", "--actor", "carlos"], cwd);
  assert.equal(deployment.code, 0);
  run(["changeset", "validate", deployment.json.operationId], cwd);
  run(["changeset", "approve", deployment.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  run(["changeset", "apply", deployment.json.operationId, "--actor", "carlos"], cwd);

  const status = run(["release", "status", release.json.releaseId], cwd);
  assert.equal(status.code, 0);
  assert.equal(status.json.release.lifecycle, "DRAFT", "deployment record must not auto-transition lifecycle");
  assert.equal(status.json.release.policyMode, "dependency_graph");
  assert.deepEqual(status.json.refs.executionContextRefs, [executionContextId]);
  assert.deepEqual(status.json.refs.environmentRefs, [environmentId]);
  assert.equal(status.json.deployment.count, 1);
  const releasePath = path.join(cwd, ".planning", "releases", release.json.releaseId, "release.yml");
  const readmePath = path.join(cwd, ".planning", "releases", release.json.releaseId, "README.md");
  let releaseDocument = parseYaml(fs.readFileSync(releasePath, "utf8"));
  releaseDocument = updateReleaseRevision({ ...releaseDocument, status: "RELEASED" });
  fs.writeFileSync(releasePath, stringifyYaml(releaseDocument));
  fs.writeFileSync(readmePath, renderReleaseReadme(releaseDocument));
  const finalizeBlocked = run(["release", "finalize", release.json.releaseId, "--idempotency-key", "cli-finalize-blocked", "--actor", "carlos"], cwd);
  assert.equal(finalizeBlocked.code, 1, "scope readiness is still an evaluable guard and must block finalization");
  const invalidLane = run(["release", "policy", "configure", release.json.releaseId, "--lane-id", "missing", "--idempotency-key", "cli-plan2-invalid-lane", "--actor", "carlos"], cwd);
  assert.equal(invalidLane.code, 1);
  assert.match(invalidLane.json.error, /LANE_INVALID/);
}

// changeset propose --payload-file <file>
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const payloadFile = path.join(cwd, "payload.json");
  fs.writeFileSync(payloadFile, JSON.stringify({ name: "from-file" }));
  const propose = run(["changeset", "propose", "--kind", "config.update", "--payload-file", payloadFile, "--actor", "carlos"], cwd);
  assert.equal(propose.code, 0);
}

// changeset propose --payload-file - (stdin)
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const stdout = execFileSync(process.execPath, [bin, "changeset", "propose", "--kind", "config.update", "--payload-file", "-", "--actor", "carlos"], {
    cwd, encoding: "utf8", input: JSON.stringify({ name: "from-stdin" })
  });
  assert.ok(JSON.parse(stdout).operationId);
}

// invalid payload -> exit 1, not a crash
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const payloadFile = path.join(cwd, "bad-payload.json");
  fs.writeFileSync(payloadFile, "{not valid json");
  const propose = run(["changeset", "propose", "--kind", "config.update", "--payload-file", payloadFile, "--actor", "carlos"], cwd);
  assert.equal(propose.code, 1);
}

// missing required flags -> exit 1
{
  const cwd = freshWorkspace();
  const init = run(["init", "--vcs", "git", "--actor", "carlos"], cwd); // missing --name
  assert.equal(init.code, 1);
}

// self-approval without the flag -> exit 1; with the flag -> succeeds
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  run(["changeset", "validate", init.json.operationId], cwd);
  const withoutFlag = run(["changeset", "approve", init.json.operationId, "--actor", "carlos"], cwd);
  assert.equal(withoutFlag.code, 1);
  const withFlag = run(["changeset", "approve", init.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  assert.equal(withFlag.code, 0);
}

// apply without approval -> exit 1 (StateError), not exit 2
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  const applyWithoutApproval = run(["changeset", "apply", init.json.operationId, "--actor", "carlos"], cwd);
  assert.equal(applyWithoutApproval.code, 1);
}

// INVALID: change-set schema rejects a payload missing required fields for its kind
{
  const cwd = freshWorkspace();
  const payloadFile = path.join(cwd, "incomplete.json");
  fs.writeFileSync(payloadFile, JSON.stringify({ name: "demo", vcs: "git" })); // missing pluginVersion/templatePackFingerprint
  const propose = run(["changeset", "propose", "--kind", "workspace.init", "--payload-file", payloadFile, "--actor", "carlos"], cwd);
  const validated = run(["changeset", "validate", propose.json.operationId], cwd);
  assert.equal(validated.code, 1);
  assert.equal(validated.json.status, "INVALID");
}

// STALE if a file changes between validate/approve and apply
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  const operationId = init.json.operationId;
  run(["changeset", "validate", operationId], cwd);
  run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  fs.mkdirSync(path.join(cwd, ".planning"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".planning", "config.yml"), "name: tampered\n");
  const applied = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 1);
}

// active lock (held by this test's own live process) -> LockHeldError -> exit 1
{
  const cwd = freshWorkspace();
  const lockDir = path.join(cwd, ".planning", ".runtime", "workspace.lock");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "lock.json"), JSON.stringify({
    token: "held-by-test", pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId: null
  }));
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  assert.equal(init.code, 1);
}

// check schema never mutates
{
  const cwd = freshWorkspace();
  fs.mkdirSync(path.join(cwd, ".planning"), { recursive: true });
  const before = fs.existsSync(path.join(cwd, ".planning", "config.yml"));
  run(["check", "schema"], cwd);
  const after = fs.existsSync(path.join(cwd, ".planning", "config.yml"));
  assert.equal(before, after, "check schema must never create config.yml");
}

// check schema on an uninitialized workspace
{
  const cwd = freshWorkspace();
  const check = run(["check", "schema"], cwd);
  assert.equal(check.json.status, "NOT_INITIALIZED");
}

// NOT_IMPLEMENTED matrix -- compare the exact contract field by field, not
// just status/exit code (Revision 3 note 9)
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const cases = [
    { args: ["release", "plan"], command: "release plan" },
    { args: ["item", "--name", "I1"], command: "item --name" },
    { args: ["work-package", "--name", "W1"], command: "work-package" },
    { args: ["task", "--name", "T1"], command: "task" },
    { args: ["report"], command: "report" },
    { args: ["check", "health"], command: "check health" },
    { args: ["check", "gates"], command: "check gates" },
    { args: ["changeset", "propose", "--kind", "task.create", "--payload-file", "-", "--actor", "carlos"], command: "changeset propose --kind task.create" }
  ];
  for (const { args, command } of cases) {
    const result = run(args, cwd);
    assert.equal(result.code, 3, `${args.join(" ")} must exit 3`);
    assert.deepEqual(result.json, {
      product: "shipping-mode",
      command,
      status: "NOT_IMPLEMENTED",
      corte: "0",
      message: "deferred to Corte N, see docs/plugin-redesign-release-flow/03-plan-incremental.md"
    }, `${args.join(" ")} must match the NOT_IMPLEMENTED contract exactly, field for field`);
  }
}

// check guides is a real query-only command after Corte 1 Plan 3.
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const result = run(["check", "guides"], cwd);
  assert.equal(result.code, 0);
  assert.equal(result.json.product, "shipping-mode");
  assert.equal(result.json.status, "PASS");
  assert.deepEqual(result.json.scopes, []);
}

// scope path confinement: absolute path, traversal, .planning-internal path, and a symlink escaping the workspace
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
  fs.symlinkSync(outside, path.join(cwd, "escape-link"));

  for (const badPath of ["/etc/passwd", "../outside", ".planning/config.yml", "escape-link/anything"]) {
    const scope = run(["config", "scope", "add", "--key", "backend", "--label", "Backend", "--kind", "code", "--path", badPath, "--actor", "carlos"], cwd);
    if (scope.code === 0) {
      run(["changeset", "validate", scope.json.operationId], cwd);
      run(["changeset", "approve", scope.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
      const applied = run(["changeset", "apply", scope.json.operationId, "--actor", "carlos"], cwd);
      assert.notEqual(applied.code, 0, `scope path ${badPath} must never apply successfully`);
    }
  }
}

// two processes applying the same already-approved operation concurrently --
// exactly one may succeed, the other must fail with a typed error (lock-held
// or stale), never both succeeding (Revision 3 note 8, application level)
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  const operationId = init.json.operationId;
  run(["changeset", "validate", operationId], cwd);
  run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd);

  const [a, b] = await Promise.all([
    runAsync(["changeset", "apply", operationId, "--actor", "carlos"], cwd),
    runAsync(["changeset", "apply", operationId, "--actor", "carlos"], cwd)
  ]);
  const successes = [a, b].filter((r) => r.code === 0);
  const failures = [a, b].filter((r) => r.code !== 0);
  assert.equal(successes.length, 1, "exactly one concurrent apply may succeed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 1, "the loser must fail with a typed error, never a raw crash");
}

// two scope.add operations proposing the same key against the same base,
// approved independently, then applied concurrently -- only one may commit
{
  const cwd = freshWorkspace();
  fullyInit(cwd);

  function proposeApprovedScope(label) {
    const propose = run(["config", "scope", "add", "--key", "backend", "--label", `Backend ${label}`, "--kind", "code", "--path", `api-${label}/`, "--actor", "carlos"], cwd);
    run(["changeset", "validate", propose.json.operationId], cwd);
    run(["changeset", "approve", propose.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
    return propose.json.operationId;
  }
  const operationIdA = proposeApprovedScope("a");
  const operationIdB = proposeApprovedScope("b");

  const [a, b] = await Promise.all([
    runAsync(["changeset", "apply", operationIdA, "--actor", "carlos"], cwd),
    runAsync(["changeset", "apply", operationIdB, "--actor", "carlos"], cwd)
  ]);
  const successes = [a, b].filter((r) => r.code === 0);
  assert.equal(successes.length, 1, "only one of two same-key scope.add operations may apply successfully");
}

// full crash-and-recover cycle: arm a checkpoint via env var against the
// separate test bundle (never bin/shipping-mode.mjs, which always points at
// the production bundle with fault injection compiled out), watch it crash
// mid-apply, confirm check schema reports it via the real production binary,
// then let a normal retry (again via the real production binary) trigger recovery
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  const operationId = init.json.operationId;
  run(["changeset", "validate", operationId], cwd);
  run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd);

  const crashScript = `
    import { dispatch } from ${JSON.stringify(testBundle)};
    try {
      dispatch("changeset", ["apply", ${JSON.stringify(operationId)}, "--actor", "carlos"], ${JSON.stringify(cwd)});
      process.stdout.write(JSON.stringify({ crashed: false }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ crashed: true, message: error.message }));
    }
  `;
  const crashOutput = execFileSync(process.execPath, ["--input-type=module", "-e", crashScript], {
    cwd, encoding: "utf8", env: { ...process.env, SHIPPING_MODE_FAULT_CHECKPOINT: "AFTER_APPLYING" }
  });
  assert.equal(JSON.parse(crashOutput).crashed, true, "the test bundle must actually crash mid-apply when armed");

  const checkWhilePending = run(["check", "schema"], cwd);
  assert.ok(checkWhilePending.json.pendingOperations.some((o) => o.operationId === operationId && o.status === "APPLYING"));

  const retry = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
  // withWorkspaceMutation's recovery pass (run before retry's own callback body)
  // already finished the operation; the retry itself then sees APPLIED and
  // reports a StateError -- that's the expected, harmless outcome
  assert.equal(retry.code, 1);

  const checkAfterRecovery = run(["check", "schema"], cwd);
  assert.equal(checkAfterRecovery.json.status, "PASS");
  assert.equal(checkAfterRecovery.json.pendingOperations.length, 0);
}

// discover validate: exercised through the actual built binary, not just the lib/command layer
// -- this is the layer where a rejected result silently exiting 0 would otherwise slip through
{
  const cwd = freshWorkspace();
  fs.mkdirSync(path.join(cwd, ".planning"), { recursive: true });

  // missing --file/--stdin -> the command-specific usage message, exit 1 (not changeset propose's)
  const missing = run(["discover", "validate"], cwd);
  assert.equal(missing.code, 1);
  assert.equal(missing.json.error, "discover validate requires --file <path> or --stdin");

  // malformed JSON -> UsageError, exit 1
  const badJsonFile = path.join(cwd, "bad.json");
  fs.writeFileSync(badJsonFile, "{ not valid json");
  const malformed = run(["discover", "validate", "--file", badJsonFile], cwd);
  assert.equal(malformed.code, 1);

  // structurally-invalid proposal -> {ok:false, status:"INVALID"}, exit 1 -- a rejected proposal
  // must never look like success at the process-exit-code level
  const invalidFile = path.join(cwd, "invalid.json");
  fs.writeFileSync(invalidFile, JSON.stringify({ schemaVersion: 1 }));
  const invalid = run(["discover", "validate", "--file", invalidFile], cwd);
  assert.equal(invalid.code, 1);
  assert.equal(invalid.json.ok, false);
  assert.equal(invalid.json.status, "INVALID");

  // --stdin reads the same way --file does
  const viaStdin = run(["discover", "validate", "--stdin"], cwd, { input: JSON.stringify({ schemaVersion: 1 }) });
  assert.equal(viaStdin.code, 1);
  assert.equal(viaStdin.json.status, "INVALID");
}

// discover propose: validated proposal -> real ChangeSet lifecycle through the public binary
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  fs.mkdirSync(path.join(cwd, "api"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "api", "package.json"), "{}\n");

  const scan = run(["discover", "scan", "--max-source-bytes", "1048576"], cwd).json;
  const candidate = scan.sourceCandidates.find((entry) => entry.path === "api/package.json");
  assert.ok(candidate);
  const proposal = {
    schemaVersion: 1,
    scanId: scan.scanId,
    baseRevision: scan.baseRevision,
    scanParameters: scan.scanParameters,
    scopes: [{ key: "api", label: "API", kind: "code", path: "api/", owner: null }],
    sources: [{
      action: "add",
      path: candidate.path,
      family: "project-module-manifests",
      kind: "repository-map",
      role: "evidence",
      authority: { standing: "supporting", force: "informational" },
      availability: "implemented",
      observedFingerprint: candidate.observedFingerprint,
      observedContentHash: candidate.observedContentHash
    }],
    scopeCommands: [],
    diagnostics: []
  };
  const proposalFile = path.join(cwd, "discovery-proposal.json");
  fs.writeFileSync(proposalFile, JSON.stringify(proposal));
  const proposed = run(["discover", "propose", "--file", proposalFile, "--actor", "carlos"], cwd);
  assert.equal(proposed.code, 0);
  assert.ok(isUuidV7(proposed.json.operationId));
  run(["changeset", "validate", proposed.json.operationId], cwd);
  run(["changeset", "approve", proposed.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  const applied = run(["changeset", "apply", proposed.json.operationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 0);
  assert.equal(applied.json.status, "APPLIED");
  const config = parseYaml(fs.readFileSync(path.join(cwd, ".planning", "config.yml"), "utf8"));
  const scopeRef = config.scopeRefs.find((entry) => entry.key === "api");
  assert.ok(scopeRef);
  assert.equal(fs.existsSync(path.join(cwd, ".planning", "scopes", scopeRef.id, "scope.yml")), true);
  const sourcesRoot = path.join(cwd, ".planning", "sources");
  const sourceIds = fs.readdirSync(sourcesRoot).filter(isUuidV7);
  assert.equal(sourceIds.length, 1);
  assert.equal(fs.existsSync(path.join(sourcesRoot, sourceIds[0], "source.yml")), true);
}

// config scope set-command: public declared-command API backed by the internal ChangeSet kind
{
  const cwd = freshWorkspace();
  fullyInit(cwd);
  fs.mkdirSync(path.join(cwd, "api"), { recursive: true });
  const scope = run(["config", "scope", "add", "--key", "backend", "--label", "Backend", "--kind", "code", "--path", "api/", "--actor", "carlos"], cwd);
  run(["changeset", "validate", scope.json.operationId], cwd);
  run(["changeset", "approve", scope.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  run(["changeset", "apply", scope.json.operationId, "--actor", "carlos"], cwd);

  const missingBoolean = run(["config", "scope", "set-command", "--scope-id", scope.json.scopeId, "--role", "test", "--command", "npm test", "--requires-environment", "false", "--actor", "carlos"], cwd);
  assert.equal(missingBoolean.code, 1, "both descriptive booleans must be explicit");
  const invalidBoolean = run(["config", "scope", "set-command", "--scope-id", scope.json.scopeId, "--role", "test", "--command", "npm test", "--requires-environment", "maybe", "--requires-secrets", "false", "--actor", "carlos"], cwd);
  assert.equal(invalidBoolean.code, 1, "boolean options accept only literal true|false");

  const proposed = run(["config", "scope", "set-command", "--scope-id", scope.json.scopeId, "--role", "test", "--command", "npm test", "--requires-environment", "false", "--requires-secrets", "false", "--actor", "carlos"], cwd);
  assert.equal(proposed.code, 0);
  run(["changeset", "validate", proposed.json.operationId], cwd);
  run(["changeset", "approve", proposed.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  run(["changeset", "apply", proposed.json.operationId, "--actor", "carlos"], cwd);

  const scopeDoc = parseYaml(fs.readFileSync(path.join(cwd, ".planning", "scopes", scope.json.scopeId, "scope.yml"), "utf8"));
  assert.equal(scopeDoc.commands.test.method, "declared");
  assert.equal(scopeDoc.commands.test.declaredBy, "carlos");
  assert.equal(scopeDoc.commands.test.declaredOperationId, proposed.json.operationId);
  assert.deepEqual(scopeDoc.commands.test.alternatives, []);
}

console.log("cli-e2e: all tests passed");
