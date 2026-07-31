import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "../../..");
const skillPath = path.join(root, "skills/spike-host-mcp-bridge/SKILL.md");
const hooksPath = path.join(root, "hooks/hooks.json");

function frontmatter(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  assert.ok(match, "skill frontmatter must exist");
  return match[1];
}

function bridgeHandler(hooks, eventName) {
  const handler = hooks.hooks?.[eventName]?.find((entry) => entry.matcher === "mcp__.*");
  assert.ok(handler, `${eventName} must have the MCP bridge matcher`);
  assert.equal(handler.hooks?.length, 1, `${eventName} must have one bridge command`);
  return handler.hooks[0];
}

test("bridge capture handlers are plugin-level because skill hooks cannot use plugin data", () => {
  const skill = fs.readFileSync(skillPath, "utf8");
  assert.doesNotMatch(frontmatter(skill), /^hooks:/m, "bridge hooks must not be skill-scoped");

  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  const success = bridgeHandler(hooks, "PostToolUse");
  const failure = bridgeHandler(hooks, "PostToolUseFailure");

  for (const [name, handler, script] of [
    ["PostToolUse", success, "capture-post-tool-use.mjs"],
    ["PostToolUseFailure", failure, "capture-post-tool-failure.mjs"]
  ]) {
    assert.equal(handler.type, "command", `${name} type`);
    assert.equal(handler.command, "node", `${name} executable`);
    assert.deepEqual(handler.args, [
      `${"${CLAUDE_PLUGIN_ROOT}"}/spikes/host-mcp-bridge/${script}`,
      "--plugin-data-dir",
      "${CLAUDE_PLUGIN_DATA}"
    ], `${name} explicit plugin data binding`);
    assert.equal(handler.timeout, 10, `${name} timeout`);
  }
});
