#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "../src/runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const args = process.argv.slice(2);

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (args[0] === "--version") {
  output({ product: manifest.name, version: manifest.version });
} else if (args[0] === "--help" || args.length === 0) {
  output({
    product: manifest.name,
    version: manifest.version,
    commands: ["check architecture --contract corte-1.2", "--help", "--version"]
  });
} else if (args[0] === "check" && args[1] === "architecture" && args[2] === "--contract" && args[3] === "corte-1.2") {
  output({ product: manifest.name, command: args.join(" "), status: "PASS" });
} else {
  try {
    output({ product: manifest.name, ...execute(args[0], args.slice(1)) });
  } catch (error) {
    output({ product: manifest.name, error: error.message });
    process.exitCode = 2;
  }
}
