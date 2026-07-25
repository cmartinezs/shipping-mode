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

  // Ajv's standalone codegen emits require("ajv/dist/runtime/<helper>").default for a
  // handful of keyword implementations (ucs2length for unicode-aware maxLength/minLength,
  // equal for uniqueItems/const/enum deep-equality, ...). None of those helpers exist in an
  // ESM bundle with no `require`, so each one actually exercised by a schema keyword must be
  // inlined here -- this list grows only when a new schema starts using a keyword that
  // triggers a runtime helper Ajv hasn't needed before (uniqueItems, first used by
  // scope.schema.json's commands.sourceRefs, is what first required the `equal` entry).
  const runtimeHelperInlines = [
    {
      requireName: "ucs2length",
      localName: "__ucs2length",
      source: "function __ucs2length(str) {\n"
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
        + "}\n"
    },
    {
      // Inlines fast-deep-equal (the actual implementation ajv/dist/runtime/equal re-exports)
      // so uniqueItems/const/enum deep-equality works with no `require` at runtime.
      requireName: "equal",
      localName: "__deepEqual",
      source: "function __deepEqual(a, b) {\n"
        + "  if (a === b) return true;\n"
        + "  if (a && b && typeof a == \"object\" && typeof b == \"object\") {\n"
        + "    if (a.constructor !== b.constructor) return false;\n"
        + "    let length, i, keys;\n"
        + "    if (Array.isArray(a)) {\n"
        + "      length = a.length;\n"
        + "      if (length != b.length) return false;\n"
        + "      for (i = length; i-- !== 0; ) if (!__deepEqual(a[i], b[i])) return false;\n"
        + "      return true;\n"
        + "    }\n"
        + "    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;\n"
        + "    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();\n"
        + "    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();\n"
        + "    keys = Object.keys(a);\n"
        + "    length = keys.length;\n"
        + "    if (length !== Object.keys(b).length) return false;\n"
        + "    for (i = length; i-- !== 0; ) if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;\n"
        + "    for (i = length; i-- !== 0; ) { const key = keys[i]; if (!__deepEqual(a[key], b[key])) return false; }\n"
        + "    return true;\n"
        + "  }\n"
        + "  return a !== a && b !== b;\n"
        + "}\n"
    }
  ];

  let prefix = "";
  for (const helper of runtimeHelperInlines) {
    const requirePattern = new RegExp(`const\\s+(\\w+)\\s*=\\s*require\\("ajv/dist/runtime/${helper.requireName}"\\)\\.default`, "g");
    if (!requirePattern.test(moduleCode)) continue;
    moduleCode = moduleCode.replace(requirePattern, `const $1 = ${helper.localName}`);
    prefix += helper.source;
  }

  if (prefix) {
    const useStrictMatch = moduleCode.match(/^"use strict";/);
    moduleCode = useStrictMatch ? `"use strict";${prefix}${moduleCode.slice(13)}` : prefix + moduleCode;
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
