import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin/plugin.json"), "utf8"));
const skillNames = ["init", "config", "release", "item", "task", "check", "report", "decision", "update"];

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
assert.deepEqual(help.commands, ["check architecture --contract corte-1.2", "--help", "--version"]);
const version = JSON.parse(execFileSync(process.execPath, [launcher, "--version"], { encoding: "utf8" }));
assert.deepEqual(version, { product: "shipping-mode", version: "1.0.0" });
const check = JSON.parse(execFileSync(process.execPath, [launcher, "check", "architecture", "--contract", "corte-1.2"], { encoding: "utf8" }));
assert.equal(check.status, "PASS", "launcher-access");

const autocomplete = JSON.parse(fs.readFileSync(path.join(root, "spikes/host-integration/fixtures/autocomplete.json"), "utf8"));
assert.deepEqual(autocomplete.commands, skillNames.map((skill) => `/shipping-mode:${skill}`));
const reloadUpdate = JSON.parse(fs.readFileSync(path.join(root, "spikes/host-integration/fixtures/reload-update.json"), "utf8"));
assert.match(reloadUpdate.reload, /^claude plugin reload shipping-mode$/);
assert.match(reloadUpdate.update, /^claude plugin update shipping-mode@cmartinezs$/);
assert.equal(fs.existsSync(path.join(root, reloadUpdate.version_source)), true, "reload-update-version-source");

console.log("host-integration tests: manifest, namespace, discovery, help, autocomplete, hooks, launcher, reload and update passed");
