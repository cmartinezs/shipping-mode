import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { computeFileFingerprint, FingerprintError } from "../fingerprint.mjs";

assert.equal(new FingerprintError("unreadable", "x").name, "FingerprintError");
assert.equal(new FingerprintError("unreadable", "x").code, "unreadable");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-file-"));
const filePath = path.join(dir, "note.txt");
fs.writeFileSync(filePath, "hello world");

const expected = crypto.createHash("sha256").update("hello world").digest("hex");
const result = computeFileFingerprint(filePath, { maxBytes: 1024 });
assert.equal(result.fingerprint, expected);
assert.equal(result.contentHash, expected);
assert.equal(result.fingerprint, result.contentHash);

// size cap: exceeded before any content read
let threw = false;
try {
  computeFileFingerprint(filePath, { maxBytes: 5 });
} catch (error) {
  threw = true;
  assert.ok(error instanceof FingerprintError);
  assert.equal(error.code, "source_too_large");
  assert.equal(error.details.limitBytes, 5);
  assert.equal(error.details.observedBytes, 11);
}
assert.ok(threw, "expected source_too_large");

// unreadable: injected EACCES via readFn, independent of real OS permissions/root
let threwUnreadable = false;
try {
  computeFileFingerprint(filePath, {
    maxBytes: 1024,
    readFn: () => { const e = new Error("denied"); e.code = "EACCES"; throw e; }
  });
} catch (error) {
  threwUnreadable = true;
  assert.ok(error instanceof FingerprintError);
  assert.equal(error.code, "unreadable");
}
assert.ok(threwUnreadable, "expected unreadable");

console.log("fingerprint-file: single-file fingerprint===contentHash, size cap, injected EACCES all pass");
