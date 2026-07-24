import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertTrustedRoots, PathConfinementError } from "../paths.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-"));
const planningRoot = path.join(workspace, ".planning");

// .planning doesn't exist yet: bootstrap must be allowed
assert.doesNotThrow(() => assertTrustedRoots(planningRoot));

fs.mkdirSync(planningRoot);
assert.doesNotThrow(() => assertTrustedRoots(planningRoot));

for (const name of ["operations", "events", ".runtime", "scopes"]) {
  const outsideTarget = fs.mkdtempSync(path.join(os.tmpdir(), `trusted-outside-${name.replace(".", "")}-`));
  const linkPath = path.join(planningRoot, name);
  fs.symlinkSync(outsideTarget, linkPath);
  assert.throws(() => assertTrustedRoots(planningRoot), PathConfinementError, `.planning/${name} as a symlink must be rejected`);
  fs.rmSync(linkPath, { force: true });
  assert.doesNotThrow(() => assertTrustedRoots(planningRoot), `.planning/${name} removed -- back to a trusted state`);
}

// a dangling symlink (target doesn't exist) at a known subdir must be rejected too --
// fs.existsSync follows symlinks and reports false for a dangling one, so this must not be
// mistaken for "doesn't exist yet, safe to create"
{
  const danglingLinkPath = path.join(planningRoot, "operations");
  const danglingTarget = path.join(workspace, "does-not-exist-target");
  fs.symlinkSync(danglingTarget, danglingLinkPath);
  assert.throws(() => assertTrustedRoots(planningRoot), PathConfinementError, ".planning/operations as a dangling symlink must be rejected");
  fs.rmSync(danglingLinkPath, { force: true });
  assert.doesNotThrow(() => assertTrustedRoots(planningRoot), ".planning/operations removed -- back to a trusted state");
}

// .planning itself as a symlink must be rejected
fs.rmSync(planningRoot, { recursive: true, force: true });
const outsidePlanning = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-outside-planning-"));
fs.symlinkSync(outsidePlanning, planningRoot);
assert.throws(() => assertTrustedRoots(planningRoot), PathConfinementError, ".planning itself as a symlink must be rejected");
fs.rmSync(planningRoot, { force: true });

// .planning itself as a dangling symlink must be rejected
const danglingPlanningTarget = path.join(workspace, "does-not-exist-planning-target");
fs.symlinkSync(danglingPlanningTarget, planningRoot);
assert.throws(() => assertTrustedRoots(planningRoot), PathConfinementError, ".planning itself as a dangling symlink must be rejected");

console.log("trustedRoots: all tests passed");
