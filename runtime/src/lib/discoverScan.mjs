import { execFileSync } from "node:child_process";

function defaultExecFile(command, args, options) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

export function detectGit(workspaceRoot, { execFileFn = defaultExecFile } = {}) {
  let revision;
  try {
    revision = execFileFn("git", ["-C", workspaceRoot, "rev-parse", "HEAD"]).trim();
  } catch {
    return { enabled: false, revision: null, branch: null, remote: null, vcs: "none" };
  }
  const branch = execFileFn("git", ["-C", workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
  let remote = null;
  try {
    remote = execFileFn("git", ["-C", workspaceRoot, "config", "--get", "remote.origin.url"]).trim() || null;
    if (remote) remote = "origin";
  } catch {
    remote = null;
  }
  return { enabled: true, revision, branch, remote, vcs: "git" };
}
