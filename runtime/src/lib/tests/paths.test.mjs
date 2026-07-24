import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confineUnder, confineRuntimePath, confineScopePath, PathConfinementError } from "../paths.mjs";

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
assert.throws(() => confineScopePath(workspace, ".planning/config.yml"), PathConfinementError, "scope paths must not point inside .planning/");

const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
fs.symlinkSync(outside, path.join(workspace, "escape-link"));
assert.throws(() => confineScopePath(workspace, "escape-link/anything"), PathConfinementError);

const insidePlanningLink = path.join(planningRoot, "escape-link");
fs.symlinkSync(outside, insidePlanningLink);
assert.throws(() => confineRuntimePath(planningRoot, "escape-link/operation.yml"), PathConfinementError);

// the generic primitive works under an arbitrary root, e.g. an events root or a staging root
const eventsRoot = path.join(planningRoot, "events");
fs.mkdirSync(eventsRoot, { recursive: true });
assert.equal(confineUnder(eventsRoot, "2026/07/abc.json"), path.join(eventsRoot, "2026", "07", "abc.json"));
assert.throws(() => confineUnder(eventsRoot, "../../../etc/passwd"), PathConfinementError);

console.log("paths: all tests passed");
