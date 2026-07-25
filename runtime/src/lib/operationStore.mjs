import fs from "node:fs";
import path from "node:path";
import { parseYaml, stringifyYaml } from "./yaml.mjs";
import { isUuidV7 } from "./ids.mjs";
import { UsageError } from "./errors.mjs";
import { confineWritePath, ensureDirectoryTree } from "./paths.mjs";
import { writeFileAtomic } from "./safeFs.mjs";

function ensureOperationsRoot(operationsRoot) {
  const parent = path.dirname(operationsRoot);
  ensureDirectoryTree(parent, path.basename(operationsRoot));
}

export function operationDir(operationsRoot, id, { create = false } = {}) {
  if (!isUuidV7(id)) throw new UsageError(`invalid operation id: ${id}`);
  if (create) ensureOperationsRoot(operationsRoot);
  if (!fs.existsSync(operationsRoot)) {
    const error = new Error(`operations root does not exist: ${operationsRoot}`);
    error.code = "ENOENT";
    throw error;
  }
  const relative = id;
  if (create) ensureDirectoryTree(operationsRoot, relative);
  return confineWritePath(operationsRoot, relative);
}

function relativeFile(id, name) {
  return path.join(id, name);
}

export function writeOperation(operationsRoot, id, operation) {
  operationDir(operationsRoot, id, { create: true });
  writeFileAtomic(operationsRoot, relativeFile(id, "operation.yml"), stringifyYaml(operation));
}

export function readOperation(operationsRoot, id) {
  operationDir(operationsRoot, id);
  const filePath = confineWritePath(operationsRoot, relativeFile(id, "operation.yml"));
  return parseYaml(fs.readFileSync(filePath, "utf8"));
}

export function writeChangeSet(operationsRoot, id, changeSet) {
  operationDir(operationsRoot, id, { create: true });
  writeFileAtomic(operationsRoot, relativeFile(id, "change-set.json"), `${JSON.stringify(changeSet, null, 2)}\n`);
}

export function readChangeSet(operationsRoot, id) {
  operationDir(operationsRoot, id);
  const filePath = confineWritePath(operationsRoot, relativeFile(id, "change-set.json"));
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeResult(operationsRoot, id, result) {
  operationDir(operationsRoot, id, { create: true });
  writeFileAtomic(operationsRoot, relativeFile(id, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

export function readResult(operationsRoot, id) {
  operationDir(operationsRoot, id);
  const filePath = confineWritePath(operationsRoot, relativeFile(id, "result.json"));
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
