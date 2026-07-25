import fs from "node:fs";
import path from "node:path";
import { acquireWorkspaceLock, LockHeldError } from "../lock.mjs";

const planningRoot = process.argv[2];
const label = process.argv[3];
const criticalSectionPath = path.join(planningRoot, "critical-section.lock");

// acquireWorkspaceLock throws LockHeldError, not blocks-and-waits, the
// instant it observes another holder -- including transiently, e.g. this
// process losing the initial reclaim race and then observing the winner's
// freshly-written live lock, or observing the winner's directory in the
// brief window between its mkdirSync and its metadata write. Both are
// ordinary, expected outcomes of two processes racing for the same
// abandoned lock, not a real failure -- a caller (this worker, standing in
// for any real caller) is responsible for retrying with backoff, the same
// way it would against any other contended resource.
function acquireWithRetry(root, actor) {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      return acquireWorkspaceLock(root, actor);
    } catch (error) {
      if (!(error instanceof LockHeldError) || Date.now() >= deadline) throw error;
      const waitUntil = Date.now() + 10;
      while (Date.now() < waitUntil) { /* brief busy-wait; no async sleep needed for a 10ms backoff */ }
    }
  }
}

const lock = acquireWithRetry(planningRoot, `worker-${label}`);

let status = "OK";
try {
  fs.writeFileSync(criticalSectionPath, String(process.pid), { flag: "wx" });
} catch (error) {
  if (error.code === "EEXIST") {
    // another process's marker is still there while *we* hold the real lock
    // -- a genuine double-hold, proven, not assumed
    status = "DOUBLE_HOLD_DETECTED";
  } else {
    throw error;
  }
}

await new Promise((resolve) => setTimeout(resolve, 150));
if (status === "OK") fs.rmSync(criticalSectionPath, { force: true });
lock.release();

process.stdout.write(JSON.stringify({ token: lock.token, status }));
