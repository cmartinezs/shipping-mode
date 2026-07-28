import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { confineUnder } from "./paths.mjs";
import { contentHash, revisionHash } from "./canonical.mjs";

function confinedExisting(root, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) throw new Error(`${label} must be a relative workspace path`);
  const absolute = confineUnder(root, relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`${label} must resolve to a file`);
  return absolute;
}

function rejectForbiddenOutput(output) {
  const forbidden = ["id", "scopeId", "kind", "revision", "contentHash", "status", "approval", "provenance", "path", "projection"];
  for (const key of forbidden) if (Object.prototype.hasOwnProperty.call(output, key)) throw new Error(`generator output controls server-owned field: ${key}`);
}

export function runConfiguredGuideGenerator({ workspaceRoot, generator, input, timeoutMs = 1000, maxOutputBytes = 256 * 1024 }) {
  const executable = confinedExisting(workspaceRoot, generator.executable, "generator executable");
  const cwd = generator.cwd ? confineUnder(workspaceRoot, generator.cwd) : workspaceRoot;
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("generator cwd must be a directory");
  if (!Array.isArray(generator.args) || generator.args.some((arg) => typeof arg !== "string")) throw new Error("generator args must be an array of strings");
  const inputJson = JSON.stringify(input);
  const child = spawnSync(executable, generator.args, {
    cwd,
    shell: false,
    env: { PATH: process.env.PATH || "" },
    input: inputJson,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes
  });
  if (child.error?.code === "ENOBUFS") throw new Error("generator output exceeds limit");
  if (child.error?.code === "ETIMEDOUT" || child.signal === "SIGTERM" || child.signal === "SIGKILL") throw new Error("generator timeout");
  if (child.error) throw new Error(`generator execution failed: ${child.error.code || child.error.name}`);
  if (Buffer.byteLength(child.stdout || "") > maxOutputBytes || Buffer.byteLength(child.stderr || "") > maxOutputBytes) throw new Error("generator output exceeds limit");
  if (child.status !== 0) throw new Error(`generator exited with code ${child.status}`);
  let output;
  try { output = JSON.parse(child.stdout); } catch { throw new Error("generator output is not valid JSON"); }
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new Error("generator output must be an object");
  rejectForbiddenOutput(output);
  return {
    output,
    inputHash: revisionHash(input),
    outputHash: revisionHash(output),
    generatorFingerprint: contentHash(fs.readFileSync(executable))
  };
}
