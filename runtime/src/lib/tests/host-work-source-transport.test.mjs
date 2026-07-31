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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "host-work-source-transport-"));
assert.throws(() => new HostWorkSourceTransport({ projectRoot: process.cwd(), pluginDataDir: tmp, requestId: request.requestId }).execute(request), /BRIDGE_|bridge/i);

console.log("host-work-source-transport: fail-closed bridge integration and hook placement pass");
