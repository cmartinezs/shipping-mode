import { acquireWorkspaceLock, LockHeldError } from "../lock.mjs";

const planningRoot = process.argv[2];
try {
  acquireWorkspaceLock(planningRoot, "worker");
  await new Promise((resolve) => setTimeout(resolve, 200));
  process.stdout.write(JSON.stringify({ status: "ACQUIRED" }));
} catch (error) {
  if (error instanceof LockHeldError) {
    process.stdout.write(JSON.stringify({ status: "LOCK_HELD" }));
  } else {
    process.stdout.write(JSON.stringify({ status: "ERROR", message: error.message }));
  }
}
