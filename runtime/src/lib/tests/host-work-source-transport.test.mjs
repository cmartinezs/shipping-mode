import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HostWorkSourceTransport } from "../hostWorkSourceTransport.mjs";
import { buildWorkSourceTransportRequest } from "../workSourceTransportPort.mjs";

const request = buildWorkSourceTransportRequest({
  provider: "jira",
  transport: "mcp",
  connectionRef: "atlassian",
  sourceId: "jira-gradeops",
  operation: "get",
  capability: "get",
  mappingVersion: 1,
  configHash: `sha256:${"a".repeat(64)}`,
  params: { itemRef: "GRADE-142", limit: 1 }
});

assert.throws(() => new HostWorkSourceTransport({ projectRoot: process.cwd() }).execute(request), /CLAUDE_PLUGIN_DATA/);
assert.throws(() => new HostWorkSourceTransport({ projectRoot: process.cwd(), pluginDataDir: path.join(process.cwd(), ".planning", "bridge") }), /must not point inside .planning/);

const hookFile = JSON.parse(fs.readFileSync(path.resolve("hooks/hooks.json"), "utf8"));
assert.equal(hookFile.hooks.PostToolUse[0].matcher, "mcp__.*");
assert.equal(hookFile.hooks.PostToolUseFailure[0].matcher, "mcp__.*");
assert.match(JSON.stringify(hookFile.hooks.PostToolUse), /CLAUDE_PLUGIN_DATA/);
assert.match(JSON.stringify(hookFile.hooks.PostToolUseFailure), /CLAUDE_PLUGIN_DATA/);
const skillText = fs.readFileSync(path.resolve("skills/spike-host-mcp-bridge/SKILL.md"), "utf8");
const frontmatter = skillText.startsWith("---") ? skillText.slice(0, skillText.indexOf("---", 3) + 3) : "";
assert.equal(frontmatter.includes("PostToolUse"), false, "capture hooks must not move into skill frontmatter");

for (const skill of ["item", "check"]) {
  const text = fs.readFileSync(path.resolve("skills", skill, "SKILL.md"), "utf8");
  const skillFrontmatter = text.startsWith("---") ? text.slice(0, text.indexOf("---", 3) + 3) : "";
  assert.equal(skillFrontmatter.includes("PostToolUse"), false, `${skill} must not define capture hooks`);
  assert.equal(/mcp__\.\*|mcp__\*/.test(skillFrontmatter), false, `${skill} must not pre-approve wildcard MCP tools`);
  assert.match(skillFrontmatter, /mcp__atlassian__getJiraIssue/, `${skill} must allowlist the current read-only get tool`);
  assert.match(skillFrontmatter, /mcp__atlassian__searchJiraIssuesUsingJql/, `${skill} must allowlist the current read-only search tool`);
  assert.doesNotMatch(skillFrontmatter, /mcp__atlassian__jira_(get_issue|search)/, `${skill} must not allow legacy/nonexistent Jira tool names`);
  assert.match(text, /work-source-host-runner\.mjs" prepare/, `${skill} must document host PREPARE`);
  assert.match(text, /work-source-host-runner\.mjs" resume/, `${skill} must document host RESUME`);
  assert.doesNotMatch(text, /capture-post-tool-(use|failure)\.mjs/, `${skill} must not tell the user to run capture scripts manually`);
  assert.doesNotMatch(text, /raw-response|envelope-file|transport-response|trust-json/, `${skill} must not expose raw transport bypass flags`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "host-work-source-transport-"));
assert.throws(() => new HostWorkSourceTransport({ projectRoot: process.cwd(), pluginDataDir: tmp, requestId: request.requestId }).execute(request), /BRIDGE_|bridge/i);

console.log("host-work-source-transport: fail-closed bridge integration and current Rovo tool allowlist pass");
