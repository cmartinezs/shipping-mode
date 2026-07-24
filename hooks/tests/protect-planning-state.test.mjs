import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluate } from "../../scripts/protect-planning-state.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "planning-hook-test-"));
const wrapper = path.resolve("scripts/protect-planning-state-hook.sh");
const hookScript = path.resolve("scripts/protect-planning-state.mjs");
const context = { workspaceRoot: root, approvedLauncher: "product-cli" };
const denied = (result) => result?.hookSpecificOutput?.permissionDecision === "deny";
const run = (toolName, toolInput) => evaluate({ tool_name: toolName, tool_input: toolInput }, context);

assert.equal(denied(run("Write", { file_path: "src/app.js" })), false, "write-outside-before-planning");
assert.equal(denied(run("Edit", { file_path: "README.md" })), false, "edit-outside-before-planning");
assert.equal(denied(run("Write", { file_path: ".planning/config.yml" })), true, "write-inside-before-planning");
assert.equal(denied(run("Write", { file_path: path.join(root, ".planning", "config.yml") })), true, "absolute-planning-path");
assert.equal(denied(run("Write", { file_path: path.join(root, "src", "..", ".planning", "x.yml") })), true, "dotdot-planning-path");

await mkdir(path.join(root, ".planning"));
await symlink(path.join(root, ".planning"), path.join(root, "planning-link"));
assert.equal(denied(run("Write", { file_path: "planning-link/config.yml" })), true, "symlink-planning-path");
assert.equal(denied(run("Bash", { command: "product-cli check health" })), false, "launcher-standalone-query");
assert.equal(denied(run("Bash", { command: "product-cli changeset apply OP-123 .planning/x.yml" })), false, "launcher-standalone-apply");
assert.equal(denied(run("Bash", { command: "product-cli check; rm -rf .planning" })), true, "launcher-chained-rm");
assert.equal(denied(run("Bash", { command: "echo product-cli && rm -rf .planning" })), true, "launcher-token-not-first");
assert.equal(denied(run("Bash", { command: "product-cli apply > .planning/result" })), true, "launcher-with-redirect");
assert.equal(denied(run("Bash", { command: "product-cli apply | tee .planning/result" })), true, "launcher-with-pipe");
assert.equal(denied(run("Bash", { command: "product-cli $(cat command.txt)" })), true, "launcher-with-command-substitution");
assert.equal(denied(run("Bash", { command: "echo x>.planning/config.yml" })), true, "bash-redirect-no-space");
assert.equal(denied(run("Bash", { command: "echo x>>.planning/config.yml" })), true, "bash-append-redirect-no-space");
assert.equal(denied(run("Bash", { command: "printf x|tee .planning/config.yml" })), true, "bash-pipe-tee-no-space");

const expectExit2 = (command, args, options) => {
  assert.throws(() => execFileSync(command, args, { ...options, stdio: "pipe" }), (error) => error.status === 2);
};
expectExit2("/bin/bash", [wrapper], { env: { ...process.env, PATH: "", CLAUDE_PLUGIN_ROOT: path.dirname(path.dirname(wrapper)) } });

const fakeNodeDir = await mkdtemp(path.join(os.tmpdir(), "fake-node-"));
const fakeNode = path.join(fakeNodeDir, "node");
await writeFile(fakeNode, "#!/bin/sh\nprintf '18\\n'\n");
await chmod(fakeNode, 0o755);
expectExit2("/bin/bash", [wrapper], { env: { ...process.env, PATH: fakeNodeDir, CLAUDE_PLUGIN_ROOT: path.dirname(path.dirname(wrapper)) } });

const validPluginRoot = path.dirname(path.dirname(wrapper));
const envWithoutPluginRoot = { ...process.env };
delete envWithoutPluginRoot.CLAUDE_PLUGIN_ROOT;
expectExit2("/bin/bash", [wrapper], { env: envWithoutPluginRoot });

const missingHookRoot = await mkdtemp(path.join(os.tmpdir(), "missing-planning-hook-"));
expectExit2("/bin/bash", [wrapper], { env: { ...process.env, CLAUDE_PLUGIN_ROOT: missingHookRoot } });

expectExit2("node", [hookScript], { input: "not-json", env: process.env });

console.log("planning-state protection hook tests: 21 passed");
