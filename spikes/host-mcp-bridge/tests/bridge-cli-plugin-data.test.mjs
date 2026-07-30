import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(testDir, "../bridge-cli.mjs");

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipping-mode-bridge-cli-"));
  const projectRoot = path.join(root, "project");
  const pluginDataDir = path.join(root, "plugin-data");
  const inputFile = path.join(root, "input.json");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(inputFile, JSON.stringify({ path: "/tmp/read-only.txt" }), "utf8");
  return { root, projectRoot, pluginDataDir, inputFile };
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ID: "session-cli-test",
      ...env
    }
  });
}

test("installed skill can pass substituted plugin data path explicitly to prepare", () => {
  const { projectRoot, pluginDataDir, inputFile } = workspace();
  const result = run([
    "prepare",
    "--plugin-data-dir", pluginDataDir,
    "--operation", "get",
    "--server", "p4fs",
    "--tool", "mcp__p4fs__read_text_file",
    "--project-root", projectRoot,
    "--expected-input-file", inputFile
  ], { CLAUDE_PLUGIN_DATA: "" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "BRIDGE_PREPARED");
  assert.equal(output.bridgeDataDirectory, path.join(path.resolve(pluginDataDir), "work-source-bridge"));
  assert.equal(fs.existsSync(path.join(pluginDataDir, "work-source-bridge", "requests", `${output.requestId}.json`)), true);
});

test("test-only data root remains blocked without its explicit test gate", () => {
  const { projectRoot, pluginDataDir, inputFile } = workspace();
  const result = run([
    "prepare",
    "--data-root", pluginDataDir,
    "--operation", "get",
    "--server", "p4fs",
    "--tool", "mcp__p4fs__read_text_file",
    "--project-root", projectRoot,
    "--expected-input-file", inputFile
  ], { BRIDGE_SPIKE_ALLOW_DATA_ROOT: "" });

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "BRIDGE_INVALID");
  assert.match(output.error, /test-only/);
});
