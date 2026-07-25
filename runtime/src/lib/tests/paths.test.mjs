import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confineUnder, confineRuntimePath, confineScopePath, confineWritePath, ensureDirectoryTree, PathConfinementError } from "../paths.mjs";

assert.equal(new PathConfinementError("x").name, "PathConfinementError");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "paths-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
fs.mkdirSync(path.join(workspace, "web"));

const notYetCreated = confineRuntimePath(planningRoot, "operations/abc/operation.yml");
assert.equal(notYetCreated, path.join(planningRoot, "operations", "abc", "operation.yml"));
assert.throws(() => confineRuntimePath(planningRoot, "../outside.yml"), PathConfinementError);
assert.throws(() => confineRuntimePath(planningRoot, "/etc/passwd"), PathConfinementError);

const webPath = confineScopePath(workspace, "web");
assert.equal(webPath, path.join(workspace, "web"));
assert.throws(() => confineScopePath(workspace, "../outside"), PathConfinementError);
assert.throws(() => confineScopePath(workspace, "/etc/passwd"), PathConfinementError);
assert.throws(() => confineScopePath(workspace, ".planning/config.yml"), PathConfinementError);

const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
fs.symlinkSync(outside, path.join(workspace, "escape-link"));
assert.throws(() => confineScopePath(workspace, "escape-link/anything"), PathConfinementError);

const insidePlanningLink = path.join(planningRoot, "escape-link");
fs.symlinkSync(outside, insidePlanningLink);
assert.throws(() => confineRuntimePath(planningRoot, "escape-link/operation.yml"), PathConfinementError);

const decoyLink = path.join(workspace, "decoy");
fs.symlinkSync(planningRoot, decoyLink);
assert.throws(() => confineScopePath(workspace, "decoy/config.yml"), PathConfinementError);

const eventsRoot = path.join(planningRoot, "events");
fs.mkdirSync(eventsRoot, { recursive: true });
assert.equal(confineUnder(eventsRoot, "2026/07/abc.json"), path.join(eventsRoot, "2026", "07", "abc.json"));
assert.throws(() => confineUnder(eventsRoot, "../../../etc/passwd"), PathConfinementError);

const realInternal = path.join(planningRoot, "real-internal");
fs.mkdirSync(realInternal);
const internalAlias = path.join(planningRoot, "internal-alias");
fs.symlinkSync(realInternal, internalAlias);
assert.equal(confineUnder(planningRoot, "internal-alias/file.txt"), path.join(realInternal, "file.txt"));
assert.throws(() => confineWritePath(planningRoot, "internal-alias/file.txt"), PathConfinementError);

ensureDirectoryTree(planningRoot, ".runtime/operations/abc/staged");
assert.equal(fs.lstatSync(path.join(planningRoot, ".runtime", "operations", "abc", "staged")).isDirectory(), true);
fs.rmSync(path.join(planningRoot, ".runtime", "operations"), { recursive: true, force: true });
fs.symlinkSync(outside, path.join(planningRoot, ".runtime", "operations"));
assert.throws(() => ensureDirectoryTree(planningRoot, ".runtime/operations/abc/staged"), PathConfinementError);

console.log("paths: read confinement and stricter mutation confinement both pass adversarial symlink cases");
