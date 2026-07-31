import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { queryWorkSourceTraceability } from "../workSourceTraceability.mjs";

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "work-source-traceability-"));
const result = queryWorkSourceTraceability({ planningRoot });
assert.equal(result.status, "PASS");
assert.deepEqual(result.items, []);
assert.deepEqual(result.findings, []);
console.log("work-source-traceability: deterministic query pass");
