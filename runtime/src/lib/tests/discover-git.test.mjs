import assert from "node:assert/strict";
import { detectGit } from "../discoverScan.mjs";

// non-git workspace: injected execFileFn always fails as git would outside a repo
const notGitResult = detectGit("/anywhere", {
  execFileFn: () => { const e = new Error("not a git repository"); e.status = 128; throw e; }
});
assert.deepEqual(notGitResult, { enabled: false, revision: null, branch: null, remote: null, vcs: "none" });

// git workspace: injected execFileFn simulates real git plumbing output
const gitResult = detectGit("/anywhere", {
  execFileFn: (cmd, args) => {
    if (args.includes("HEAD") && !args.includes("--abbrev-ref")) return "a".repeat(40) + "\n";
    if (args.includes("--abbrev-ref")) return "main\n";
    if (args.includes("--get")) return "origin\n";
    throw new Error(`unexpected git invocation: ${args.join(" ")}`);
  }
});
assert.deepEqual(gitResult, { enabled: true, revision: "a".repeat(40), branch: "main", remote: "origin", vcs: "git" });

// git workspace with no configured remote: remote is null, still enabled
const gitNoRemote = detectGit("/anywhere", {
  execFileFn: (cmd, args) => {
    if (args.includes("HEAD") && !args.includes("--abbrev-ref")) return "b".repeat(40) + "\n";
    if (args.includes("--abbrev-ref")) return "main\n";
    if (args.includes("--get")) { const e = new Error("no such remote"); e.status = 1; throw e; }
    throw new Error(`unexpected git invocation: ${args.join(" ")}`);
  }
});
assert.deepEqual(gitNoRemote, { enabled: true, revision: "b".repeat(40), branch: "main", remote: null, vcs: "git" });

console.log("discover-git: not-a-repo, repo-with-remote, repo-without-remote all pass, and revision is the commit SHA, not the branch name");
