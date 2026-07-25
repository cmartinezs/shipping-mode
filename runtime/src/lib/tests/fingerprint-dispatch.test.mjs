import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeSourceFingerprint, detectMoved } from "../fingerprint.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-dispatch-"));

const filePath = path.join(dir, "file.txt");
fs.writeFileSync(filePath, "hi");
const fileResult = computeSourceFingerprint(filePath, { maxBytes: 1024 });
assert.equal(fileResult.fingerprint, fileResult.contentHash);

const subdirPath = path.join(dir, "sub");
fs.mkdirSync(subdirPath);
fs.writeFileSync(path.join(subdirPath, "a.txt"), "a");
fs.writeFileSync(path.join(subdirPath, "b.txt"), "b");
const dirResult = computeSourceFingerprint(subdirPath, { maxBytes: 1024 });
assert.equal(typeof dirResult.fingerprint, "string");
assert.equal(dirResult.fingerprint.length, 64);

// moved: unique contentHash match -> moved; ambiguous match -> missing, never moved
{
  const missing = [{ sourceId: "src-a", confirmedContentHash: "hashA" }, { sourceId: "src-b", confirmedContentHash: "hashB" }];
  const uniqueCandidates = [{ path: "docs/new-a/", observedContentHash: "hashA" }, { path: "docs/unrelated/", observedContentHash: "zzz" }];
  const results = detectMoved(missing, uniqueCandidates);
  assert.deepEqual(results.find((r) => r.sourceId === "src-a"), { sourceId: "src-a", driftState: "moved", observedAtPath: "docs/new-a/" });
  assert.deepEqual(results.find((r) => r.sourceId === "src-b"), { sourceId: "src-b", driftState: "missing", observedAtPath: null });

  const ambiguousCandidates = [{ path: "docs/new-a1/", observedContentHash: "hashA" }, { path: "docs/new-a2/", observedContentHash: "hashA" }];
  const ambiguousResults = detectMoved([{ sourceId: "src-a", confirmedContentHash: "hashA" }], ambiguousCandidates);
  assert.deepEqual(ambiguousResults, [{ sourceId: "src-a", driftState: "missing", observedAtPath: null }]);
}

console.log("fingerprint-dispatch: file/dir dispatch and moved-detection uniqueness rule both pass");
