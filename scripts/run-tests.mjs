#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function collectTestFiles(root) {
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...collectTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".test.mjs")) results.push(full);
  }
  return results;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node scripts/run-tests.mjs <dir> [<dir> ...]");
  process.exit(1);
}

const files = roots
  .filter((root) => fs.existsSync(root))
  .flatMap((root) => collectTestFiles(path.resolve(root)))
  .sort();

let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [file], { stdio: "inherit" });
  if (result.status !== 0) {
    failures += 1;
    console.error(`FAIL: ${file}`);
  }
}

if (failures > 0) {
  console.error(`${failures} of ${files.length} test file(s) failed`);
  process.exit(1);
}
console.log(`${files.length} test file(s) passed`);
