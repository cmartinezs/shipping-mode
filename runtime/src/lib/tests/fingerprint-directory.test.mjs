import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeDirectoryFingerprint, FingerprintError } from "../fingerprint.mjs";

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fp-dir-"));
}

// 1. Basic directory: 2 files, deterministic across re-runs
{
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, "a.txt"), "AAA");
  fs.mkdirSync(path.join(dir, "sub"));
  fs.writeFileSync(path.join(dir, "sub", "b.txt"), "BBB");
  const r1 = computeDirectoryFingerprint(dir, { maxBytes: 1024 });
  const r2 = computeDirectoryFingerprint(dir, { maxBytes: 1024 });
  assert.equal(r1.fingerprint, r2.fingerprint);
  assert.equal(r1.contentHash, r2.contentHash);
  assert.notEqual(r1.fingerprint, r1.contentHash, "fingerprint is path-sensitive, contentHash is not, so a 2-file mixed tree should differ");
}

// 2. contentHash preserves multiplicity: 2 identical files vs 1
{
  const dirOne = freshDir();
  fs.writeFileSync(path.join(dirOne, "x.txt"), "same");
  const dirTwo = freshDir();
  fs.writeFileSync(path.join(dirTwo, "x.txt"), "same");
  fs.writeFileSync(path.join(dirTwo, "y.txt"), "same");
  const one = computeDirectoryFingerprint(dirOne, { maxBytes: 1024 });
  const two = computeDirectoryFingerprint(dirTwo, { maxBytes: 1024 });
  assert.notEqual(one.contentHash, two.contentHash, "one copy vs two identical copies must produce different contentHash");
}

// 3. Symlink: changing the target TEXT changes fingerprint; changing the pointed-to
//    object's CONTENT does not (because it's never read); target is never followed
//    even when it points outside the workspace.
{
  const dir = freshDir();
  const outside = freshDir();
  const outsideFile = path.join(outside, "secret.txt");
  fs.writeFileSync(outsideFile, "outside-content-v1");
  fs.symlinkSync(outsideFile, path.join(dir, "link"));
  const before = computeDirectoryFingerprint(dir, { maxBytes: 1024 });

  fs.writeFileSync(outsideFile, "outside-content-v2-totally-different");
  const afterContentChange = computeDirectoryFingerprint(dir, { maxBytes: 1024 });
  assert.equal(before.fingerprint, afterContentChange.fingerprint, "changing only the pointed-to content must not change the fingerprint");

  fs.rmSync(path.join(dir, "link"));
  const outsideFile2 = path.join(outside, "secret2.txt");
  fs.writeFileSync(outsideFile2, "outside-content-v2-totally-different");
  fs.symlinkSync(outsideFile2, path.join(dir, "link"));
  const afterTargetTextChange = computeDirectoryFingerprint(dir, { maxBytes: 1024 });
  assert.notEqual(before.fingerprint, afterTargetTextChange.fingerprint, "changing the target TEXT must change the fingerprint");
}

// 4. Normalized path collision (POSIX+NFC) between two distinct originals -> hard diagnostic.
//    Use EXPLICIT \u escapes for two genuinely different code point sequences that both
//    normalize to the same NFC string -- precomposed e-acute (single codepoint é) vs.
//    decomposed "e" + combining acute accent (é). Do not type the two filenames
//    as visually-identical literal text: depending on how the editor or file encoding
//    normalizes source text, that can silently collapse into the SAME byte sequence, which
//    would create (and just overwrite) one file instead of two, and the test would pass
//    without ever exercising the collision path at all.
{
  const dir = freshDir();
  const precomposed = "café.txt";
  const decomposed = "café.txt";
  assert.notEqual(precomposed, decomposed, "the two source strings must be genuinely different code point sequences");
  assert.equal(precomposed.normalize("NFC"), decomposed.normalize("NFC"), "...but must collide after NFC normalization");
  fs.writeFileSync(path.join(dir, precomposed), "a");
  fs.writeFileSync(path.join(dir, decomposed), "b");
  assert.throws(
    () => computeDirectoryFingerprint(dir, { maxBytes: 1024 }),
    (error) => error instanceof FingerprintError && error.code === "normalized_path_collision"
  );
}

// 5. Unreadable file (injected EACCES, independent of real OS permissions/root) -> hard diagnostic
{
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, "locked.txt"), "content");
  assert.throws(
    () => computeDirectoryFingerprint(dir, {
      maxBytes: 1024,
      readFileFn: () => { const e = new Error("denied"); e.code = "EACCES"; throw e; }
    }),
    (error) => error instanceof FingerprintError && error.code === "unreadable"
  );
}

// 6. Size preflight happens before any content read: stat-sum exceeds cap -> hard diagnostic,
//    readFileFn is never called
{
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, "big.txt"), "0123456789"); // 10 bytes
  let readWasCalled = false;
  assert.throws(
    () => computeDirectoryFingerprint(dir, {
      maxBytes: 5,
      readFileFn: (...args) => { readWasCalled = true; return fs.readFileSync(...args); }
    }),
    (error) => error instanceof FingerprintError && error.code === "source_too_large"
      && error.details.limitBytes === 5 && error.details.observedBytes === 10
  );
  assert.equal(readWasCalled, false, "content must never be read once the stat-sum preflight already exceeds the cap");
}

// 7. Invalid UTF-8 in a directory ENTRY NAME (distinct from the NFC-collision case above --
//    this is a raw filename that isn't valid UTF-8 at all, not two valid-but-equivalent ones).
//    Built via a Buffer path so the raw bytes reach the filesystem unmodified -- a JS string
//    literal cannot represent unpaired/invalid UTF-8 bytes on disk.
{
  const dir = freshDir();
  const invalidNamePath = Buffer.concat([Buffer.from(dir + path.sep, "utf8"), Buffer.from([0xff, 0xfe, 0x2e, 0x74, 0x78, 0x74])]);
  fs.writeFileSync(invalidNamePath, "content");
  assert.throws(
    () => computeDirectoryFingerprint(dir, { maxBytes: 1024 }),
    (error) => error instanceof FingerprintError && error.code === "invalid_utf8"
  );
}

// 8. .git/ is always excluded from the manifest, even if it contains content that would
//    otherwise change the fingerprint
{
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, "real.txt"), "content");
  const before = computeDirectoryFingerprint(dir, { maxBytes: 1024 * 1024 });
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  const after = computeDirectoryFingerprint(dir, { maxBytes: 1024 * 1024 });
  assert.equal(before.fingerprint, after.fingerprint, ".git/ must never affect the fingerprint");
  assert.equal(before.contentHash, after.contentHash);
}

// 9. Symlink target is hashed as raw validated UTF-8 bytes, NOT NFC-normalized -- two
//    textually-different-but-NFC-equivalent targets must produce DIFFERENT fingerprints
//    (normalizing here without a collision check would silently collapse them). Uses the
//    same explicit \u escape technique as the path-collision test above, for the same reason.
{
  const dirA = freshDir();
  fs.symlinkSync("café", path.join(dirA, "link"));
  const dirB = freshDir();
  fs.symlinkSync("café", path.join(dirB, "link"));
  const resultA = computeDirectoryFingerprint(dirA, { maxBytes: 1024 });
  const resultB = computeDirectoryFingerprint(dirB, { maxBytes: 1024 });
  assert.notEqual(resultA.fingerprint, resultB.fingerprint, "symlink targets must be compared as raw bytes, never NFC-normalized");
}

console.log("fingerprint-directory: determinism, multiplicity, symlink text-vs-content, collisions, unreadable, size preflight, invalid UTF-8, .git exclusion, and raw symlink-target hashing all pass");
