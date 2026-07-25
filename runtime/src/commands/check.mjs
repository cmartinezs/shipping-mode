import fs from "node:fs";
import path from "node:path";
import { validate } from "../lib/schema.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { readOperation } from "../lib/operationStore.mjs";
import { isUuidV7 } from "../lib/ids.mjs";
import { assertTrustedRoots, confineWritePath } from "../lib/paths.mjs";

function checkRequiredFile(planningRoot, relativePath, schemaName, findings) {
  let filePath;
  try {
    filePath = confineWritePath(planningRoot, relativePath);
  } catch (error) {
    findings.push(`${relativePath}: untrusted path (${error.message})`);
    return;
  }
  if (!fs.existsSync(filePath)) {
    findings.push(`${relativePath}: required file is missing`);
    return;
  }
  let value;
  try {
    value = parseYaml(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    findings.push(`${relativePath}: failed to parse (${error.message})`);
    return;
  }
  const result = validate(schemaName, value);
  if (!result.valid) {
    for (const error of result.errors) findings.push(`${relativePath}${error.path}: ${error.message}`);
  }
}

export function checkSchema({ planningRoot }) {
  if (!fs.existsSync(planningRoot)) {
    return { status: "NOT_INITIALIZED", findings: ["workspace is not initialized: .planning/ does not exist"], pendingOperations: [] };
  }

  const findings = [];
  try {
    assertTrustedRoots(planningRoot);
  } catch (error) {
    return { status: "FAIL", findings: [`trusted roots: ${error.message}`], pendingOperations: [] };
  }

  checkRequiredFile(planningRoot, "config.yml", "config", findings);
  checkRequiredFile(planningRoot, "plugin.lock.yml", "plugin-lock", findings);

  const scopesRoot = path.join(planningRoot, "scopes");
  if (fs.existsSync(scopesRoot)) {
    for (const scopeId of fs.readdirSync(scopesRoot)) {
      if (!isUuidV7(scopeId)) {
        findings.push(`scopes/${scopeId}: not a valid scope id`);
        continue;
      }
      const scopeEntryPath = path.join(scopesRoot, scopeId);
      const scopeStat = fs.lstatSync(scopeEntryPath);
      if (scopeStat.isSymbolicLink()) {
        findings.push(`scopes/${scopeId}: symlink entries are not permitted`);
        continue;
      }
      if (!scopeStat.isDirectory()) {
        findings.push(`scopes/${scopeId}: entry must be a directory`);
        continue;
      }
      checkRequiredFile(planningRoot, path.join("scopes", scopeId, "scope.yml"), "scope", findings);
    }
  }

  const pendingOperations = [];
  const operationsRoot = path.join(planningRoot, "operations");
  if (fs.existsSync(operationsRoot)) {
    for (const operationId of fs.readdirSync(operationsRoot)) {
      if (!isUuidV7(operationId)) {
        findings.push(`operations/${operationId}: not a valid operation id`);
        continue;
      }
      const operationEntryPath = path.join(operationsRoot, operationId);
      const operationStat = fs.lstatSync(operationEntryPath);
      if (operationStat.isSymbolicLink()) {
        findings.push(`operations/${operationId}: symlink entries are not permitted`);
        continue;
      }
      if (!operationStat.isDirectory()) {
        findings.push(`operations/${operationId}: entry must be a directory`);
        continue;
      }
      let operation;
      try {
        operation = readOperation(operationsRoot, operationId);
      } catch (error) {
        findings.push(`operations/${operationId}/operation.yml: failed to read or parse (${error.message})`);
        continue;
      }
      const operationSchemaCheck = validate("operation", operation);
      if (!operationSchemaCheck.valid) {
        for (const error of operationSchemaCheck.errors) findings.push(`operations/${operationId}/operation.yml${error.path}: ${error.message}`);
        continue;
      }
      if (operation.id !== operationId) {
        findings.push(`operations/${operationId}/operation.yml: operation.id ${operation.id} does not match its directory`);
        continue;
      }
      if (operation.status === "APPLYING" || operation.status === "RECOVERY_REQUIRED") {
        pendingOperations.push({ operationId, status: operation.status });
      }
    }
  }

  return { status: findings.length === 0 ? "PASS" : "FAIL", findings, pendingOperations };
}
