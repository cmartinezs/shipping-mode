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
const distFile = path.join(root, "runtime", "dist", "shipping-mode.mjs");
const testDistFile = path.join(root, "runtime", "dist", "shipping-mode.test-bundle.mjs");
const manifestPath = path.join(root, ".claude-plugin", "plugin.json");

const args = process.argv.slice(2);
const schemasOnly = args.includes("--schemas-only");
const testBundle = args.includes("--test-bundle");
const outFlagIndex = args.indexOf("--out");
const generatedDir = outFlagIndex >= 0 ? args[outFlagIndex + 1] : path.join(root, "runtime", "src", "generated");

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
  const moduleCode = standaloneCode(ajv, exportNames);
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

async function bundleRuntime({ testBuild }) {
  const outfile = testBuild ? testDistFile : distFile;
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [entryFile],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    define: { "globalThis.__SHIPPING_MODE_TEST_BUILD__": testBuild ? "true" : "false" }
  });
}

const exportNames = buildValidators();
buildMeta();
if (schemasOnly) {
  process.stdout.write(`${JSON.stringify({ status: "OK", exportNames })}\n`);
} else {
  await bundleRuntime({ testBuild: testBundle });
  process.stdout.write(`${JSON.stringify({ status: "OK", exportNames, bundle: path.relative(root, testBundle ? testDistFile : distFile) })}\n`);
}
