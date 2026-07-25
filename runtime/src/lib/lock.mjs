import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export class LockHeldError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockHeldError"; // required for CLI exit code mapping
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function readMetadata(metadataPath) {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch {
    return null;
  }
}

// Write metadata into a directory we believe we exclusively own, without
// ever silently clobbering someone else's write. `{ flag: "wx" }` (O_EXCL)
// makes the create atomic-and-conditional: it only succeeds if no file is
// currently there. A stale writer that thinks it still owns this directory
// generation -- but was preempted while someone else recycled the same
// path in the meantime -- gets a loud EEXIST instead of silently
// overwriting a different, already-committed claim (or being silently
// overwritten itself). Returns true on success, false on EEXIST; anything
// else propagates.
function writeMetadataExclusive(metadataPath, content) {
  try {
    fs.writeFileSync(metadataPath, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

// Restore a captured lock's content back to lockDir after discovering it
// doesn't match what we evaluated as abandoned (see the call site). Never
// destroys `capturedContent` unless it can positively confirm the data is
// no longer needed: either this call itself wrote it back, or an
// equivalent copy (same token) is already there because someone else
// restored/wrote it first. Returns true if restored/already-present,
// false if a real, different, unrestorable claim occupies the path.
function restoreCapturedLock(lockDir, metadataPath, capturedMetadata) {
  try {
    fs.mkdirSync(lockDir);
  } catch (mkdirError) {
    if (mkdirError.code !== "EEXIST") throw mkdirError;
    // Something already occupies lockDir. Fall through to the check below
    // to determine whether that's our own data (already restored by
    // someone else) or an unrelated, real claim -- mkdir failing here is
    // not by itself proof of either.
  }

  const currentlyThere = readMetadata(metadataPath);
  if (currentlyThere && currentlyThere.token === capturedMetadata.token) {
    return true; // already restored, by us or by a concurrent restorer
  }
  if (currentlyThere) {
    return false; // occupied by a different, real claim -- cannot write here
  }

  // lockDir exists (just created above, or pre-existing-but-empty) and has
  // no metadata yet. Write our captured content exclusively, so a stale
  // straggler's write (from the main acquisition path, or another
  // restorer) can never silently clobber it after the fact.
  return writeMetadataExclusive(metadataPath, JSON.stringify(capturedMetadata, null, 2));
}

export function acquireWorkspaceLock(planningRoot, operationId = null) {
  const runtimeDir = path.join(planningRoot, ".runtime");
  const lockDir = path.join(runtimeDir, "workspace.lock");
  const metadataPath = path.join(lockDir, "lock.json");

  for (;;) {
    fs.mkdirSync(runtimeDir, { recursive: true });
    try {
      fs.mkdirSync(lockDir);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      const metadata = readMetadata(metadataPath);
      if (!metadata) {
        throw new LockHeldError("workspace lock present without readable metadata; manual resolution required");
      }
      if (metadata.hostname !== os.hostname()) {
        throw new LockHeldError(`workspace lock held by host ${metadata.hostname}`);
      }
      if (isProcessAlive(metadata.pid)) {
        throw new LockHeldError(`workspace lock held by running process ${metadata.pid}`);
      }

      // Abandoned (dead pid, same host) as of the read above. Reclaim
      // atomically via rename-to-quarantine. rename() is a single atomic
      // syscall, so if two processes race to rename this same directory,
      // exactly one succeeds; the other gets ENOENT (the directory it tried
      // to rename no longer exists) and loops back to re-observe the lock's
      // current state.
      //
      // That alone isn't sufficient, though: the metadata read above can go
      // stale before this rename fires. Another contender can win its own
      // reclaim of this exact path, delete the old directory, and create a
      // brand-new *live* lock at the same path -- all in the gap between our
      // read and our rename call. Renaming that would silently steal a live
      // lock without anyone ever seeing an error, which is exactly the
      // "auto-broken live lock" failure this function must never produce.
      // So once we've captured a directory, we re-verify token identity
      // against what we just read: a match proves nothing changed
      // underneath us and it's safe to discard; a mismatch means we
      // captured someone else's lock, which must be put back untouched.
      const quarantineDir = path.join(runtimeDir, `workspace.lock.quarantine-${crypto.randomUUID()}`);
      try {
        fs.renameSync(lockDir, quarantineDir);
      } catch (renameError) {
        if (renameError.code === "ENOENT") continue;
        throw renameError;
      }

      const capturedMetadata = readMetadata(path.join(quarantineDir, "lock.json"));
      if (capturedMetadata && capturedMetadata.token === metadata.token) {
        // Confirmed: this is the same abandoned lock we evaluated above.
        fs.rmSync(quarantineDir, { recursive: true, force: true });
        continue; // loop back and retry mkdir
      }

      if (!capturedMetadata) {
        // We caught another contender's freshly mkdir'd-but-not-yet-written
        // directory: nobody has committed a token here, so no caller has
        // (or ever could have) observed themselves as the owner of *this*
        // directory instance yet. It's safe to just discard our empty
        // capture and retry -- ordinary mkdir-race contention, no different
        // from losing an EEXIST race outright. The original creator's own
        // write is exclusive (see writeMetadataExclusive) and will hit
        // ENOENT or EEXIST against the now-different directory and
        // self-heal via the write-side retry below, exactly like this path.
        // (Restoring an empty placeholder here instead would risk leaving a
        // permanently orphaned, metadata-less directory behind if that
        // creator's own retry loop also ends up elsewhere -- and an empty,
        // metadata-less lock directory can never be auto-reclaimed by this
        // function's own rules, requiring manual cleanup forever after.)
        fs.rmSync(quarantineDir, { recursive: true, force: true });
        continue;
      }

      // We captured a fully-formed lock (real token/pid) that no longer
      // matches what we evaluated above -- someone else's committed claim,
      // possibly still live. restoreCapturedLock() writes it back
      // exclusively so a stale straggler can never clobber it, and never
      // reports success unless the data is verifiably preserved somewhere.
      //
      // Even so, restoring can lose to a third, wholly unrelated acquirer:
      // if that acquirer's own ordinary mkdirSync(lockDir) wins the now-
      // vacant path before restoreCapturedLock's mkdir/write does, this
      // call reports failure (see below) rather than silently overwriting
      // that acquirer's legitimate new lock. This is a known, narrow
      // residual gap -- see the report for why it can't be closed further
      // with mkdir/rename alone -- but it is now impossible for this
      // function to silently destroy the captured data either way: on
      // failure we keep the quarantine copy on disk instead of rm -rf'ing
      // it, so the captured lock's record is never lost, only ever either
      // successfully restored or preserved for manual recovery.
      if (restoreCapturedLock(lockDir, metadataPath, capturedMetadata)) {
        fs.rmSync(quarantineDir, { recursive: true, force: true });
        throw new LockHeldError("workspace lock changed ownership during reclaim; retry");
      }
      throw new LockHeldError(
        `workspace lock changed ownership during reclaim and could not be restored (path now held by an unrelated lock); ` +
        `the captured lock's original record is preserved at ${quarantineDir} for manual recovery`
      );
    }

    // We won the mkdir race for a directory that did not exist a moment
    // ago. Claim it by writing metadata into it, exclusively (see
    // writeMetadataExclusive): a plain unconditional write here would let
    // a stale straggler -- preempted between its own mkdir and write after
    // someone else recycled this exact path in between -- silently
    // overwrite whatever the *current* rightful owner just wrote, handing
    // out two valid-looking tokens for what's really one lock. An
    // exclusive write instead fails loudly for whichever writer loses, and
    // that failure (like the ENOENT case below, where another contender's
    // reclaim discarded this still-empty directory entirely before we
    // could write into it) is just ordinary lost-the-race contention: undo
    // nothing, retry the whole acquisition from scratch.
    const token = crypto.randomUUID();
    let written;
    try {
      written = writeMetadataExclusive(metadataPath, JSON.stringify({
        token, pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId
      }, null, 2));
    } catch (writeError) {
      if (writeError.code === "ENOENT") continue;
      throw writeError;
    }
    if (!written) continue;

    return {
      token,
      release() {
        const currentMetadata = readMetadata(metadataPath);
        if (!currentMetadata || currentMetadata.token !== token) return;
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    };
  }
}
