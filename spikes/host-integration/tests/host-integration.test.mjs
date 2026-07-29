import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin/plugin.json"), "utf8"));
// Corte 2 Plan 2 extends the Release surface. Item, task,
// report, decision, and update remain deferred.
const skillNames = ["init", "config", "release", "check"];

assert.equal(manifest.name, "shipping-mode", "manifest-name");
assert.equal(manifest.version, "1.0.0", "manifest-version");
assert.equal(manifest.skills, "./skills/", "skills-root");
assert.equal(manifest.hooks, "./hooks/hooks.json", "hooks-root");

for (const skill of skillNames) {
  const skillPath = path.join(root, "skills", skill, "SKILL.md");
  assert.equal(fs.existsSync(skillPath), true, `skill-discovery:${skill}`);
  assert.match(fs.readFileSync(skillPath, "utf8"), /disable-model-invocation: true/);
}

const hooks = JSON.parse(fs.readFileSync(path.join(root, "hooks/hooks.json"), "utf8"));
const hookCommand = hooks.hooks.PreToolUse[0].hooks[0].command;
assert.match(hookCommand, /CLAUDE_PLUGIN_ROOT/);
assert.match(hookCommand, /protect-planning-state-hook\.sh/);

const launcher = path.join(root, "bin/shipping-mode.mjs");
const help = JSON.parse(execFileSync(process.execPath, [launcher, "--help"], { encoding: "utf8" }));
// Real Corte 0 command surface (Task 24) -- the old "check architecture
// --contract corte-1.2" placeholder no longer exists.
assert.deepEqual(help.commands, [
  "init --name <name> [--project-type software|non_software|mixed|unknown] [--base-branch <b>] [--vcs git|none] --actor <actor>",
  "config set --name <name> --actor <actor>",
  "config scope add --key <slug> --label <label> --kind code|non_code --path <path> [--owner <o>] --actor <actor>",
  "changeset propose --kind <workspace.init|config.update|scope.add|scope.generator.set|guide.update|release.create|release.policy.configure|release.scopeRefs.set|release.operationalRefs.set|release.deployment.record> --payload-file <file|-> --actor <actor>",
  "changeset validate <operation-id>",
  "changeset approve <operation-id> --actor <actor> [--allow-self-approval]",
  "changeset apply <operation-id> --actor <actor>",
  "release new --title <title> --objective <objective> [--lane-id <id>] [--policy-mode strict_sequence|dependency_graph] [--slug <slug>] [--idempotency-key <key>] --actor <actor>",
  "release status <id-or-display-id>",
  "release policy configure <id-or-display-id> [--lane-id <id>] [--policy-mode strict_sequence|dependency_graph] [--previous-release-refs <uuid,...>] [--dependency-refs <uuid,...>] [--idempotency-key <key>] --actor <actor>",
  "release scope set <id-or-display-id> --scope-ids <uuid,...> [--policy-mode strict|advisory] [--idempotency-key <key>] --actor <actor>",
  "release refs set <id-or-display-id> [--execution-context-refs <uuid,...>] [--environment-refs <uuid,...>] [--idempotency-key <key>] --actor <actor>",
  "release deployment record <id-or-display-id> --environment-ref <uuid> [--execution-context-ref <uuid>] --status planned|started|succeeded|failed|cancelled [--artifact-refs <ref,...>] [--evidence-refs <ref,...>] [--idempotency-key <key>] --actor <actor>",
  "check schema",
  "check guides [--scope-id <uuid>] [--mode strict|advisory]",
  "--help", "--version"
]);
const version = JSON.parse(execFileSync(process.execPath, [launcher, "--version"], { encoding: "utf8" }));
assert.deepEqual(version, { product: "shipping-mode", version: "1.0.0" });

// prove the launcher actually executes a real subcommand end to end and
// returns real JSON, against a fresh workspace with no .planning/ yet --
// deeper CLI behavior (happy/negative paths, concurrency, crash-recovery)
// is covered by runtime/tests/cli-e2e.test.mjs, not duplicated here
const checkCwd = fs.mkdtempSync(path.join(os.tmpdir(), "host-integration-"));
let check;
try {
  check = JSON.parse(execFileSync(process.execPath, [launcher, "check", "schema"], { encoding: "utf8", cwd: checkCwd }));
} catch (error) {
  check = JSON.parse(error.stdout);
}
assert.equal(check.status, "NOT_INITIALIZED", "launcher-access");

const autocomplete = JSON.parse(fs.readFileSync(path.join(root, "spikes/host-integration/fixtures/autocomplete.json"), "utf8"));
assert.deepEqual(autocomplete.commands, skillNames.map((skill) => `/shipping-mode:${skill}`));
const reloadUpdate = JSON.parse(fs.readFileSync(path.join(root, "spikes/host-integration/fixtures/reload-update.json"), "utf8"));
assert.match(reloadUpdate.reload, /^claude plugin reload shipping-mode$/);
assert.match(reloadUpdate.update, /^claude plugin update shipping-mode@cmartinezs$/);
assert.equal(fs.existsSync(path.join(root, reloadUpdate.version_source)), true, "reload-update-version-source");

console.log("host-integration tests: manifest, namespace, discovery, help, autocomplete, hooks, launcher, reload and update passed");
