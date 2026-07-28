import { parentPort, workerData } from "node:worker_threads";

try {
  const expression = new RegExp(workerData.pattern, "u");
  parentPort.postMessage({ ok: true, matched: expression.test(workerData.input) });
} catch (cause) {
  parentPort.postMessage({ ok: false, message: cause.message });
}
