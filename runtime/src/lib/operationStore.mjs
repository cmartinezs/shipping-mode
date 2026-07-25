import fs from "node:fs";
import path from "node:path";
import { parseYaml, stringifyYaml } from "./yaml.mjs";
import { isUuidV7 } from "./ids.mjs";
import { UsageError } from "./errors.mjs";
import { confineUnder } from "./paths.mjs";

export function operationDir(operationsRoot, id) {
  if (!isUuidV7(id)) throw new UsageError(`invalid operation id: ${id}`);
  fs.mkdirSync(operationsRoot, { recursive: true }); // may be this workspace's first operation ever
  return confineUnder(operationsRoot, id);
}

function writeAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, contents);
  fs.renameSync(tmpPath, filePath);
}

export function writeOperation(operationsRoot, id, operation) {
  writeAtomic(path.join(operationDir(operationsRoot, id), "operation.yml"), stringifyYaml(operation));
}

export function readOperation(operationsRoot, id) {
  return parseYaml(fs.readFileSync(path.join(operationDir(operationsRoot, id), "operation.yml"), "utf8"));
}

export function writeChangeSet(operationsRoot, id, changeSet) {
  writeAtomic(path.join(operationDir(operationsRoot, id), "change-set.json"), `${JSON.stringify(changeSet, null, 2)}\n`);
}

export function readChangeSet(operationsRoot, id) {
  return JSON.parse(fs.readFileSync(path.join(operationDir(operationsRoot, id), "change-set.json"), "utf8"));
}

export function writeResult(operationsRoot, id, result) {
  writeAtomic(path.join(operationDir(operationsRoot, id), "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

export function readResult(operationsRoot, id) {
  return JSON.parse(fs.readFileSync(path.join(operationDir(operationsRoot, id), "result.json"), "utf8"));
}
