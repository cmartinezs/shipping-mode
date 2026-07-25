#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "docs/plugin-redesign-release-flow");
const rules = [
  {
    pattern: /decision_record|PARTIALLY_APPLIED|OP-01J|01J-|RI0004|\/<acronym>-init|\/arc-init/,
    message: "legacy identity, state or namespace drift detected"
  },
  {
    pattern: /item\s+move|change parent_id/,
    message: "mutable parent operation detected"
  },
  {
    pattern: /verify-plugin\.sh/,
    message: "next-generation documentation still references the v3 verifier"
  }
];

function filesUnder(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

for (const file of filesUnder(root)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        console.error(`${path.relative(root, file)}:${index + 1}: ${line}`);
        console.error(`FAIL: ${rule.message}`);
        process.exit(1);
      }
    }
  }
}

console.log("next-generation docs scan passed");
