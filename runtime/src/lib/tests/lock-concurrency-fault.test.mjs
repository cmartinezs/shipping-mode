// Deterministic (non-concurrent) regression coverage for two races found in
// review of lock.mjs's reclaim/write logic. Both took two rounds of review
// to surface, and neither is reliably reproduced by organic concurrency --
// the windows are microseconds wide (0 organic hits in 300 targeted
// concurrent attempts during verification). This file forces the exact
// interleaving at the exact syscall boundary via `fs`-method monkey-patching,
// so a future simplification of writeMetadataExclusive() or
// restoreCapturedLock() back to plain, non-exclusive writes fails loudly
// here instead of silently reintroducing either bug with the rest of the
// suite staying green.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireWorkspaceLock, LockHeldError } from "../lock.mjs";

function freshWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lock-det-"));
  const planningRoot = path.join(workspace, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  const lockDir = path.join(planningRoot, ".runtime", "workspace.lock");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "lock.json"), JSON.stringify({
    token: "dead-token", pid: 999999, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId: null
  }));
  return { planningRoot, lockDir };
}

// --- Scenario A: the mismatch/restore branch restores cleanly when nothing
// else interferes. The pre-check reads dead-token metadata; by the time
// renameSync actually fires, the directory has been swapped for different,
// "live" content -- forced by patching fs.renameSync to swap it in
// immediately before delegating to the real rename. This is the base case
// restoreCapturedLock() must get right before Scenario B's harder case matters.
{
  const { planningRoot, lockDir } = freshWorkspace();
  const originalRenameSync = fs.renameSync;
  fs.renameSync = function (...args) {
    fs.renameSync = originalRenameSync; // one-shot
    fs.rmSync(lockDir, { recursive: true, force: true });
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, "lock.json"), JSON.stringify({
      token: "live-token", pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId: null
    }));
    return originalRenameSync.apply(fs, args);
  };

  let threw = null;
  try {
    acquireWorkspaceLock(planningRoot, "op");
  } catch (e) {
    threw = e;
  }
  assert.ok(threw instanceof LockHeldError, "must throw LockHeldError, never silently succeed with a live lock's identity");
  assert.match(threw.message, /changed ownership during reclaim; retry/, "must report the restore-succeeded variant");
  const finalContent = JSON.parse(fs.readFileSync(path.join(lockDir, "lock.json"), "utf8"));
  assert.equal(finalContent.token, "live-token", "the live lock's content must be restored byte-for-byte, not lost");
}

// --- Scenario B: Critical #1 -- restoring a captured live lock must never
// silently discard it just because mkdirSync says EEXIST. Forced by patching
// fs.mkdirSync so that the *second* call to mkdirSync(lockDir) (the restore
// attempt, after the first call already vacated it via rename) finds an
// unrelated third party has already recreated and fully populated it.
// EEXIST here has two possible causes -- "someone already restored the same
// data" and "someone unrelated claimed the path" -- and only the first is
// safe to treat as a redundant duplicate.
{
  const { planningRoot, lockDir } = freshWorkspace();
  const originalRenameSync = fs.renameSync;
  const originalMkdirSync = fs.mkdirSync;
  let mkdirCallsOnLockDir = 0;

  fs.renameSync = function (...args) {
    fs.renameSync = originalRenameSync; // one-shot
    // Swap in different, live content just before the real rename fires,
    // same as Scenario A -- forces the mismatch/restore branch. Use
    // originalMkdirSync here, not fs.mkdirSync -- the latter is patched
    // below and must only count calls made by lock.mjs itself.
    fs.rmSync(lockDir, { recursive: true, force: true });
    originalMkdirSync.call(fs, lockDir);
    fs.writeFileSync(path.join(lockDir, "lock.json"), JSON.stringify({
      token: "live-token", pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId: null
    }));
    return originalRenameSync.apply(fs, args);
  };

  fs.mkdirSync = function (...args) {
    if (args[0] === lockDir) {
      mkdirCallsOnLockDir++;
      if (mkdirCallsOnLockDir === 2) {
        // This is restoreCapturedLock's own mkdirSync attempt. Before it
        // runs, simulate an unrelated third-party acquirer C fully winning
        // the vacant path (mkdir + write) first.
        originalMkdirSync.call(fs, lockDir);
        fs.writeFileSync(path.join(lockDir, "lock.json"), JSON.stringify({
          token: "third-party-token", pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId: null
        }));
        const err = new Error("EEXIST: file already exists, mkdir");
        err.code = "EEXIST";
        throw err;
      }
    }
    return originalMkdirSync.apply(fs, args);
  };

  let threw = null;
  try {
    acquireWorkspaceLock(planningRoot, "op");
  } catch (e) {
    threw = e;
  } finally {
    fs.mkdirSync = originalMkdirSync;
  }

  assert.ok(threw instanceof LockHeldError, "must throw LockHeldError, never silently succeed");
  assert.match(threw.message, /could not be restored/, "must report the could-not-restore variant, distinct from the clean-restore one");
  assert.match(threw.message, /preserved at/, "must point to where the captured data was preserved");

  // The critical assertions: (1) the third party's own lock is untouched
  // (never overwritten by our captured live-token data), and (2) the
  // captured live-token data was NOT silently destroyed -- it must still
  // exist somewhere on disk (in a quarantine dir), recoverable.
  const currentContent = JSON.parse(fs.readFileSync(path.join(lockDir, "lock.json"), "utf8"));
  assert.equal(currentContent.token, "third-party-token", "the third party's legitimate lock must never be overwritten by a restore attempt");

  const runtimeDir = path.join(planningRoot, ".runtime");
  const entries = fs.readdirSync(runtimeDir);
  const quarantineDirs = entries.filter((e) => e.startsWith("workspace.lock.quarantine-"));
  assert.equal(quarantineDirs.length, 1, "the captured live-token data must be preserved in exactly one quarantine dir, not deleted");
  const preserved = JSON.parse(fs.readFileSync(path.join(runtimeDir, quarantineDirs[0], "lock.json"), "utf8"));
  assert.equal(preserved.token, "live-token", "the preserved quarantine copy must contain the original captured live lock's data, unmodified");
}

// --- Scenario C: Critical #2 -- a stale writer (preempted between its own
// mkdirSync and writeFileSync) must never silently clobber a competitor's
// already-committed write. Forced by patching fs.writeFileSync to inject a
// competitor's ("Q"'s) full write immediately before our own exclusive
// write attempts to land. This is the minimum-bar regression case: without
// the { flag: "wx" } exclusive write in writeMetadataExclusive(), this
// write would silently overwrite Q's metadata and this assertion would fail.
{
  const { planningRoot, lockDir } = freshWorkspace(); // dead-token lock present
  const metadataPath = path.join(lockDir, "lock.json");
  const originalWriteFileSync = fs.writeFileSync;
  let injected = false;

  fs.writeFileSync = function (targetPath, data, options) {
    if (!injected && targetPath === metadataPath && options && options.flag === "wx") {
      injected = true;
      // Simulate a concurrent "Q" fully completing its own acquisition of
      // this exact directory generation, landing its metadata just before
      // our ("R"'s) exclusive write attempts to land its own.
      originalWriteFileSync.call(fs, metadataPath, JSON.stringify({
        token: "q-token", pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId: null
      }, null, 2));
    }
    return originalWriteFileSync.call(fs, targetPath, data, options);
  };

  let threw = null;
  try {
    acquireWorkspaceLock(planningRoot, "op");
  } catch (e) {
    threw = e;
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }

  assert.ok(threw instanceof LockHeldError, "the stale writer must never silently believe it succeeded");
  assert.match(threw.message, /held by running process/, "must retry and correctly detect Q's already-committed, live lock");
  const finalContent = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.equal(finalContent.token, "q-token", "Q's metadata must survive completely untouched -- the stale writer's write must never have landed");
}

console.log("lock-concurrency-fault: all deterministic race scenarios passed (A: clean restore, B: Critical #1 residual never loses data, C: Critical #2 exclusive write never clobbers)");
