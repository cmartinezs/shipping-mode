import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withWorkspaceMutation, recoverWorkspace } from "../mutation.mjs";
import { runRecovery } from "../recovery.mjs";
import { acquireWorkspaceLock } from "../lock.mjs";
import { PathConfinementError } from "../paths.mjs";

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-"));
const operationsRoot = path.join(planningRoot, "operations");
fs.mkdirSync(operationsRoot, { recursive: true });

const result = withWorkspaceMutation({ planningRoot, operationsRoot, operationId: null }, () => "callback ran");
assert.equal(result, "callback ran", "withWorkspaceMutation must return whatever the callback returns");

// the lock must be released even if the callback throws
assert.throws(() => withWorkspaceMutation({ planningRoot, operationsRoot, operationId: null }, () => { throw new Error("boom"); }), /boom/);
const afterThrow = withWorkspaceMutation({ planningRoot, operationsRoot, operationId: null }, () => "still works");
assert.equal(afterThrow, "still works", "a prior callback throwing must not leave the lock held");

// recoverWorkspace acquires its own lock and returns recovery outcomes (empty when there's nothing to recover)
const outcomes = recoverWorkspace({ planningRoot, operationsRoot });
assert.deepEqual(outcomes, []);

// runRecovery must refuse to run without a held lock -- this is the guard
// that makes "recovery always runs under mutual exclusion" enforceable
// rather than just a convention
assert.throws(() => runRecovery({ operationsRoot, planningRoot, lock: null }), /lock/i);
const lock = acquireWorkspaceLock(planningRoot, null);
assert.deepEqual(runRecovery({ operationsRoot, planningRoot, lock }), []);
lock.release();

// a .planning that's a symlink must block withWorkspaceMutation/recoverWorkspace
// before the lock is even attempted (Revision 4 note 7)
const untrustedWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-untrusted-"));
const untrustedPlanningRoot = path.join(untrustedWorkspace, ".planning");
const outsideTarget = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-untrusted-outside-"));
fs.symlinkSync(outsideTarget, untrustedPlanningRoot);
assert.throws(() => withWorkspaceMutation({ planningRoot: untrustedPlanningRoot, operationsRoot: path.join(untrustedPlanningRoot, "operations"), operationId: null }, () => "should never run"), PathConfinementError);
assert.throws(() => recoverWorkspace({ planningRoot: untrustedPlanningRoot, operationsRoot: path.join(untrustedPlanningRoot, "operations") }), PathConfinementError);

console.log("mutation: all tests passed");
