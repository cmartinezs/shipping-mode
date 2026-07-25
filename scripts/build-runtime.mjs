#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const schemasDir = path.join(root, "runtime", "src", "schemas");
const entryFile = path.join(root, "runtime", "src", "index.mjs");
const defaultDistFile = path.join(root, "runtime", "dist", "shipping-mode.mjs");
const defaultTestDistFile = path.join(root, "runtime", "dist", "shipping-mode.test-bundle.mjs");
const manifestPath = path.join(root, ".claude-plugin", "plugin.json");

const args = process.argv.slice(2);
const schemasOnly = args.includes("--schemas-only");
const testBundle = args.includes("--test-bundle");

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
  return path.resolve(value);
}

const generatedDir = valueAfter("--out") || path.join(root, "runtime", "src", "generated");
const bundleOut = valueAfter("--bundle-out") || (testBundle ? defaultTestDistFile : defaultDistFile);

function exportNameFor(schemaName) {
  return `validate_${schemaName.replaceAll("-", "_")}`;
}

function buildValidators() {
  const files = fs.readdirSync(schemasDir).filter((file) => file.endsWith(".schema.json")).sort();
  const ajv = new Ajv({ strict: true, allErrors: true, code: { source: true, esm: true } });
  const exportNames = {};
  for (const file of files) {
    const schemaName = file.replace(/\.schema\.json$/, "");
    const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, file), "utf8"));
    ajv.addSchema(schema, schemaName);
    exportNames[exportNameFor(schemaName)] = schemaName;
  }
  let moduleCode = standaloneCode(ajv, exportNames);

  if (moduleCode.includes('require("ajv/dist/runtime/ucs2length")')) {
    moduleCode = moduleCode.replace(
      /const\s+(\w+)\s*=\s*require\("ajv\/dist\/runtime\/ucs2length"\)\.default/g,
      "const $1 = __ucs2length"
    );

    const ucs2lengthInline = "function __ucs2length(str) {\n"
      + "  const len = str.length;\n"
      + "  let length = 0;\n"
      + "  let pos = 0;\n"
      + "  let value;\n"
      + "  while (pos < len) {\n"
      + "    length++;\n"
      + "    value = str.charCodeAt(pos++);\n"
      + "    if (value >= 0xd800 && value <= 0xdbff && pos < len) {\n"
      + "      value = str.charCodeAt(pos);\n"
      + "      if ((value & 0xfc00) === 0xdc00) pos++;\n"
      + "    }\n"
      + "  }\n"
      + "  return length;\n"
      + "}\n";

    const useStrictMatch = moduleCode.match(/^"use strict";/);
    if (useStrictMatch) {
      moduleCode = `"use strict";${ucs2lengthInline}${moduleCode.slice(13)}`;
    } else {
      moduleCode = ucs2lengthInline + moduleCode;
    }
  }

  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "validators.mjs"), moduleCode);
  return exportNames;
}

function buildMeta() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`cannot build: plugin manifest not found at ${manifestPath}`);
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (!manifest.version) {
    throw new Error("cannot build: .claude-plugin/plugin.json is missing a version field");
  }
  const fingerprint = `sha256:${crypto.createHash("sha256").update(manifestBytes).digest("hex")}`;
  const content = `export const PLUGIN_VERSION = ${JSON.stringify(manifest.version)};\nexport const TEMPLATE_PACK_FINGERPRINT = ${JSON.stringify(fingerprint)};\n`;
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "build-meta.mjs"), content);
}

async function bundleRuntime({ testBuild, outfile }) {
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [entryFile],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    minifySyntax: true,
    define: { "globalThis.__SHIPPING_MODE_TEST_BUILD__": testBuild ? "true" : "false" },
    banner: { js: "import { createRequire as __shipping_mode_createRequire } from \"node:module\";\nconst require = __shipping_mode_createRequire(import.meta.url);" }
  });
}

const exportNames = buildValidators();
buildMeta();
if (schemasOnly) {
  process.stdout.write(`${JSON.stringify({ status: "OK", exportNames })}\n`);
} else {
  await bundleRuntime({ testBuild: testBundle, outfile: bundleOut });
  process.stdout.write(`${JSON.stringify({ status: "OK", exportNames, bundle: path.relative(root, bundleOut) })}\n`);
}
