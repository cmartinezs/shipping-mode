import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertTrustedRoots, PathConfinementError } from "../paths.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-"));
const planningRoot = path.join(workspace, ".planning");
assert.doesNotThrow(() => assertTrustedRoots(planningRoot));

fs.mkdirSync(planningRoot);
assert.doesNotThrow(() => assertTrustedRoots(planningRoot));

for (const name of ["operations", "events", ".runtime", "scopes"]) {
  const outsideTarget = fs.mkdtempSync(path.join(os.tmpdir(), `trusted-outside-${name.replace(".", "")}-`));
  const linkPath = path.join(planningRoot, name);
  fs.symlinkSync(outsideTarget, linkPath);
  assert.throws(() => assertTrustedRoots(planningRoot), PathConfinementError);
  fs.rmSync(linkPath, { force: true });
  assert.doesNotThrow(() => assertTrustedRoots(planningRoot));
}

const runtimeRoot = path.join(planningRoot, ".runtime");
fs.mkdirSync(runtimeRoot);
const outsideRuntimeOperations = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-runtime-operations-"));
fs.symlinkSync(outsideRuntimeOperations, path.join(runtimeRoot, "operations"));
assert.throws(() => assertTrustedRoots(planningRoot), PathConfinementError, ".runtime/operations must be a real directory");
fs.rmSync(path.join(runtimeRoot, "operations"), { force: true });

const danglingLinkPath = path.join(planningRoot, "operations");
fs.symlinkSync(path.join(workspace, "does-not-exist-target"), danglingLinkPath);
assert.throws(() => assertTrustedRoots(planningRoot), PathConfinementError);
fs.rmSync(danglingLinkPath, { force: true });

fs.rmSync(planningRoot, { recursive: true, force: true });
const outsidePlanning = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-outside-planning-"));
fs.symlinkSync(outsidePlanning, planningRoot);
assert.throws(() => assertTrustedRoots(planningRoot), PathConfinementError);
fs.rmSync(planningRoot, { force: true });

fs.symlinkSync(path.join(workspace, "does-not-exist-planning-target"), planningRoot);
assert.throws(() => assertTrustedRoots(planningRoot), PathConfinementError);

console.log("trustedRoots: control-plane roots including .runtime/operations reject symlinks and dangling aliases");
