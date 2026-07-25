# Discovery Scan Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only foundation of the discovery iteration — the directory/file fingerprint algorithm, the `sources` catalog schema, the `scope.commands` schema extension, and `shipping-mode discover scan` — with zero changes to the ChangeSet engine, zero new mutation kinds, zero autonomy logic.

**Architecture:** A new `runtime/src/lib/fingerprint.mjs` implements the dual-hash (fingerprint + contentHash) algorithm for files and directories, reusing the existing `contentHash()` sha256 helper from `canonical.mjs`. A new `runtime/src/lib/discoverScan.mjs` orchestrates git detection, scope/source candidate enumeration, drift computation against the confirmed catalog, and `workspaceHash` assembly into a `ScanResult`. `discover scan` is wired into `runtime/src/index.mjs` as a read-only command (no lock, no ChangeSet, mirroring how `check schema` already works) that reads `.planning/sources/*/source.yml` and `.planning/scopes/*/scope.yml` directly via `confineWritePath`, the same way `check.mjs` does today.

**Tech Stack:** Plain Node.js (`node:fs`, `node:path`, `node:crypto`, `node:child_process`), no new dependencies. Tests are plain `node:assert/strict` scripts matching the existing `runtime/src/lib/tests/*.test.mjs` style, collected by `scripts/run-tests.mjs`.

## Global Constraints

- Node >= 20 (`package.json` `engines`). No new npm dependencies.
- All hashes are bare lowercase hex sha256 (`^[0-9a-f]{64}$`), **no `sha256:` prefix** — this matches the existing convention in `runtime/src/lib/canonical.mjs`'s `contentHash()`/`revisionHash()` and the `^([0-9a-f]{64}|ABSENT)$` pattern already used in `change-set.schema.json`/`operation.schema.json`. (The design doc used `sha256:...` in prose examples; this plan corrects that to match the real codebase convention.)
- Schemas are plain JSON Schema files auto-discovered from `runtime/src/schemas/*.schema.json` by `scripts/build-runtime.mjs` (alphabetical, no manual registration needed there) but **must** be added to the `exportNameByPublicName` map in `runtime/src/lib/schema.mjs` to be callable via `validate(name, data)`.
- Existing schemas do not use `$ref`/`$defs` (they duplicate the UUID pattern inline). This plan deliberately introduces `$defs` **within** `scope.schema.json` for the `commands` discriminated union because duplicating that ~40-line union across `properties.build/test/smoke/lint/verify` inline would be far worse than one local `$defs` block reused five times in the same file. Do not introduce cross-file `$ref` — each schema file that needs the shape defines its own local copy.
- `discover scan` never writes to `.planning/` and never acquires the workspace lock — it reads via `confineWritePath` exactly like `runtime/src/commands/check.mjs` does today, and returns a plain JS object; the CLI layer is responsible for JSON-printing it.
- No source enumeration/classification data is ever written by this plan — `.planning/sources/**` and `scope.yml`'s `commands` field can only ever be populated by Plan 2 (`discover propose`) or manual scope-command flows, neither of which exist yet. This plan's job is to define what those files look like when they DO exist, and to read them correctly if they do.
- Directory traversal never follows symlinks. Size cap default is `536870912` (512 MiB), CLI-overridable via `--max-source-bytes` in the closed range `[1048576, 2147483648]` (1 MiB – 2 GiB) — enforced in `runDiscoverScan`, not just the CLI parser.

---

### Task 1: File fingerprint primitive

**Files:**
- Create: `runtime/src/lib/fingerprint.mjs`
- Test: `runtime/src/lib/tests/fingerprint-file.test.mjs`

**Interfaces:**
- Produces: `FingerprintError` (class, `.name === "FingerprintError"`, `.code` one of `"unreadable"|"source_too_large"|"normalized_path_collision"|"invalid_utf8"`, `.details` object), `computeFileFingerprint(absolutePath, { maxBytes, statFn, readFn })` → `{ fingerprint: string, contentHash: string }` (both equal, 64-char hex).

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/fingerprint-file.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/fingerprint-file.test.mjs`
Expected: FAIL with `Cannot find module '../fingerprint.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/fingerprint.mjs
import fs from "node:fs";
import { contentHash as sha256Hex } from "./canonical.mjs";

export class FingerprintError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FingerprintError";
    this.code = code;
    this.details = details;
  }
}

export function computeFileFingerprint(absolutePath, { maxBytes, statFn = fs.statSync, readFn = fs.readFileSync } = {}) {
  let stat;
  try {
    stat = statFn(absolutePath);
  } catch (error) {
    if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${absolutePath}`, { path: absolutePath });
    throw error;
  }
  if (stat.size > maxBytes) {
    throw new FingerprintError("source_too_large", `source exceeds size limit: ${absolutePath}`, {
      path: absolutePath,
      limitBytes: maxBytes,
      observedBytes: stat.size
    });
  }
  let bytes;
  try {
    bytes = readFn(absolutePath);
  } catch (error) {
    if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${absolutePath}`, { path: absolutePath });
    throw error;
  }
  const hash = sha256Hex(bytes);
  return { fingerprint: hash, contentHash: hash };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/fingerprint-file.test.mjs`
Expected: PASS, prints the success line.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/fingerprint.mjs runtime/src/lib/tests/fingerprint-file.test.mjs
git commit -m "feat(discovery): add single-file fingerprint primitive"
```

---

### Task 2: Directory fingerprint — traversal, manifest encoding, symlink and collision rules

**Files:**
- Modify: `runtime/src/lib/fingerprint.mjs`
- Test: `runtime/src/lib/tests/fingerprint-directory.test.mjs`

**Interfaces:**
- Consumes: `FingerprintError` (Task 1).
- Produces: `computeDirectoryFingerprint(absolutePath, { maxBytes, readdirFn, lstatFn, readFileFn, readlinkFn })` → `{ fingerprint, contentHash }`.

This is the most detail-sensitive task in the plan. Follow the manifest encoding exactly — every field is a fixed-length hex digest, never a raw string, so no path or symlink target containing `\0`/`\n` can create ambiguity.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/fingerprint-directory.test.mjs
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
//    decomposed "e" + combining acute accent (é). Do not type the two filenames
//    as visually-identical literal text: depending on how the editor or file encoding
//    normalizes source text, that can silently collapse into the SAME byte sequence, which
//    would create (and just overwrite) one file instead of two, and the test would pass
//    without ever exercising the collision path at all.
{
  const dir = freshDir();
  const precomposed = "caf\u00e9.txt";
  const decomposed = "cafe\u0301.txt";
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

console.log("fingerprint-directory: determinism, multiplicity, symlink text-vs-content, collisions, unreadable, size preflight all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/fingerprint-directory.test.mjs`
Expected: FAIL with `computeDirectoryFingerprint is not a function` (or similar export error).

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/fingerprint.mjs`:

```js
import path from "node:path";

function isValidUtf8Buffer(buf) {
  return Buffer.from(buf.toString("utf8"), "utf8").equals(buf);
}

function collectEntries(absoluteRoot, { readdirFn, lstatFn }) {
  const entries = [];
  function walk(currentAbs, currentRelSegments) {
    const names = readdirFn(currentAbs, { encoding: "buffer" });
    for (const nameBuf of names) {
      if (!isValidUtf8Buffer(nameBuf)) {
        throw new FingerprintError("invalid_utf8", `path is not valid UTF-8 under ${currentAbs}`, { path: currentAbs });
      }
      const name = nameBuf.toString("utf8");
      const absChild = path.join(currentAbs, name);
      const relSegments = [...currentRelSegments, name];
      const stat = lstatFn(absChild);
      if (stat.isSymbolicLink()) {
        entries.push({ relSegments, absPath: absChild, isSymlink: true });
      } else if (stat.isDirectory()) {
        walk(absChild, relSegments);
      } else if (stat.isFile()) {
        entries.push({ relSegments, absPath: absChild, isSymlink: false });
      }
      // sockets/fifos/devices are neither files, directories, nor symlinks: skipped, not content.
    }
  }
  walk(absoluteRoot, []);
  return entries;
}

export function computeDirectoryFingerprint(absoluteRoot, {
  maxBytes,
  readdirFn = fs.readdirSync,
  lstatFn = fs.lstatSync,
  readFileFn = fs.readFileSync,
  readlinkFn = fs.readlinkSync
} = {}) {
  const entries = collectEntries(absoluteRoot, { readdirFn, lstatFn });

  const byNormalized = new Map();
  for (const entry of entries) {
    const rawRelPath = entry.relSegments.join("/");
    const normalizedRelPath = entry.relSegments.map((segment) => segment.normalize("NFC")).join("/");
    entry.relPath = normalizedRelPath;
    const existing = byNormalized.get(normalizedRelPath);
    if (existing !== undefined && existing !== rawRelPath) {
      throw new FingerprintError("normalized_path_collision", `normalized path collision under ${absoluteRoot}: ${normalizedRelPath}`, {
        normalizedPath: normalizedRelPath,
        originalPaths: [existing, rawRelPath]
      });
    }
    byNormalized.set(normalizedRelPath, rawRelPath);
  }

  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.isSymlink) continue;
    totalBytes += lstatFn(entry.absPath).size;
  }
  if (totalBytes > maxBytes) {
    throw new FingerprintError("source_too_large", `source exceeds size limit: ${absoluteRoot}`, {
      path: absoluteRoot,
      limitBytes: maxBytes,
      observedBytes: totalBytes
    });
  }

  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

  const fingerprintLines = [];
  const contentLines = [];
  for (const entry of entries) {
    if (entry.isSymlink) {
      let targetBuf;
      try {
        targetBuf = readlinkFn(entry.absPath, "buffer");
      } catch (error) {
        if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${entry.absPath}`, { path: entry.absPath });
        throw error;
      }
      if (!isValidUtf8Buffer(targetBuf)) {
        throw new FingerprintError("invalid_utf8", `symlink target is not valid UTF-8: ${entry.absPath}`, { path: entry.absPath });
      }
      const target = targetBuf.toString("utf8").normalize("NFC");
      const relHash = sha256Hex(Buffer.from(entry.relPath, "utf8"));
      const targetHash = sha256Hex(Buffer.from(target, "utf8"));
      fingerprintLines.push(`symlink\0${relHash}\0${targetHash}\n`);
      contentLines.push(`symlink\0${targetHash}\n`);
    } else {
      let bytes;
      try {
        bytes = readFileFn(entry.absPath);
      } catch (error) {
        if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${entry.absPath}`, { path: entry.absPath });
        throw error;
      }
      const fileHash = sha256Hex(bytes);
      const relHash = sha256Hex(Buffer.from(entry.relPath, "utf8"));
      fingerprintLines.push(`file\0${relHash}\0${fileHash}\n`);
      contentLines.push(`file\0${fileHash}\n`);
    }
  }
  contentLines.sort();

  return {
    fingerprint: sha256Hex(Buffer.from(fingerprintLines.join(""), "utf8")),
    contentHash: sha256Hex(Buffer.from(contentLines.join(""), "utf8"))
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/fingerprint-directory.test.mjs`
Expected: PASS, prints the success line.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/fingerprint.mjs runtime/src/lib/tests/fingerprint-directory.test.mjs
git commit -m "feat(discovery): add directory fingerprint with symlink, collision, and size-cap handling"
```

---

### Task 3: Source fingerprint dispatcher and moved-detection helper

**Files:**
- Modify: `runtime/src/lib/fingerprint.mjs`
- Test: `runtime/src/lib/tests/fingerprint-dispatch.test.mjs`

**Interfaces:**
- Consumes: `computeFileFingerprint`, `computeDirectoryFingerprint`, `FingerprintError` (Tasks 1-2).
- Produces: `computeSourceFingerprint(absolutePath, options)` → `{ fingerprint, contentHash }`; `detectMoved(missingSources, newCandidates)` → `Array<{ sourceId, driftState: "moved"|"missing", observedAtPath: string|null }>` where `missingSources: Array<{sourceId, confirmedContentHash}>` and `newCandidates: Array<{path, observedContentHash}>`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/fingerprint-dispatch.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/fingerprint-dispatch.test.mjs`
Expected: FAIL with `computeSourceFingerprint is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/fingerprint.mjs`:

```js
export function computeSourceFingerprint(absolutePath, options = {}) {
  const { lstatFn = fs.lstatSync } = options;
  let stat;
  try {
    stat = lstatFn(absolutePath);
  } catch (error) {
    if (error.code === "EACCES") throw new FingerprintError("unreadable", `unreadable: ${absolutePath}`, { path: absolutePath });
    throw error;
  }
  if (stat.isDirectory()) return computeDirectoryFingerprint(absolutePath, options);
  if (stat.isFile()) return computeFileFingerprint(absolutePath, options);
  throw new FingerprintError("unreadable", `not a regular file or directory: ${absolutePath}`, { path: absolutePath });
}

export function detectMoved(missingSources, newCandidates) {
  return missingSources.map((missing) => {
    const matches = newCandidates.filter((candidate) => candidate.observedContentHash === missing.confirmedContentHash);
    return matches.length === 1
      ? { sourceId: missing.sourceId, driftState: "moved", observedAtPath: matches[0].path }
      : { sourceId: missing.sourceId, driftState: "missing", observedAtPath: null };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/fingerprint-dispatch.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/fingerprint.mjs runtime/src/lib/tests/fingerprint-dispatch.test.mjs
git commit -m "feat(discovery): add source fingerprint dispatcher and moved-detection helper"
```

---

### Task 4: `source.schema.json` and trusted-roots registration

**Files:**
- Create: `runtime/src/schemas/source.schema.json`
- Modify: `runtime/src/lib/schema.mjs`
- Modify: `runtime/src/lib/paths.mjs:158-179` (`assertTrustedRoots`)
- Test: `runtime/src/lib/tests/source-schema.test.mjs`

**Interfaces:**
- Produces: schema name `"source"` callable via `validate("source", data)` from `runtime/src/lib/schema.mjs`. `assertTrustedRoots(planningRoot)` now also checks a `sources` directory the same way it already checks `scopes`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/source-schema.test.mjs
import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const validSource = {
  schemaVersion: 1,
  id: "018f4d1e-0000-7000-8000-000000000001",
  path: "docs/04-architecture/",
  family: "technical-sources",
  kind: "architecture",
  role: "canonical",
  authority: { standing: "authoritative", force: "normative" },
  availability: "mixed",
  confirmedFingerprint: "a".repeat(64),
  confirmedContentHash: "b".repeat(64),
  provenance: {
    discoveredBy: "discover-scan",
    confirmedBy: "carlos",
    confirmedAt: "2026-07-25T10:00:00Z",
    confirmedOperationId: "018f4d1e-0000-7000-8000-000000000002"
  }
};

assert.equal(validate("source", validSource).valid, true);

const missingRequired = { ...validSource };
delete missingRequired.family;
assert.equal(validate("source", missingRequired).valid, false);

const badFamily = { ...validSource, family: "not-a-real-family" };
assert.equal(validate("source", badFamily).valid, false);

const badAuthorityStanding = { ...validSource, authority: { standing: "unknown", force: "normative" } };
assert.equal(validate("source", badAuthorityStanding).valid, false, "standing must be contextual|supporting|authoritative, not unknown");

const extraStatusField = { ...validSource, status: "confirmed" };
assert.equal(validate("source", extraStatusField).valid, false, "no status/freshness/driftState field is ever persisted on a confirmed source");

const extraFreshnessField = { ...validSource, freshness: "current" };
assert.equal(validate("source", extraFreshnessField).valid, false);

console.log("source-schema: valid source passes, missing/invalid enum/forbidden-extra fields all rejected");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/source-schema.test.mjs`
Expected: FAIL with `unknown schema: source`.

- [ ] **Step 3: Write minimal implementation**

```json
// runtime/src/schemas/source.schema.json
{
  "$id": "https://shipping-mode.dev/schemas/source.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "id", "path", "family", "kind", "role", "authority", "availability", "confirmedFingerprint", "confirmedContentHash", "provenance"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "id": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },
    "path": { "type": "string", "minLength": 1 },
    "family": {
      "enum": [
        "product-sources", "functional-sources", "technical-sources", "agent-repository-instructions",
        "project-module-manifests", "execution-commands", "quality-definitions", "local-runtime-environment",
        "public-data-contracts", "delivery-ci-deployment", "ownership", "decision-sources", "developer-guides",
        "engineering-standards", "repository-map", "evidence-contracts", "design-system", "prompt-sources",
        "custom-automation"
      ]
    },
    "kind": {
      "enum": [
        "product", "requirements", "architecture", "decision", "developer-guide", "engineering-standard",
        "agent-instructions", "repository-map", "api-contract", "data-contract", "database", "testing",
        "quality", "security", "observability", "design-system", "i18n", "runtime", "environment",
        "deployment", "ci", "ownership", "prompt", "generator", "evidence", "planning"
      ]
    },
    "role": { "enum": ["canonical", "decision", "derived", "operational", "evidence", "generated", "historical", "reference"] },
    "authority": {
      "type": "object",
      "additionalProperties": false,
      "required": ["standing", "force"],
      "properties": {
        "standing": { "enum": ["contextual", "supporting", "authoritative"] },
        "force": { "enum": ["unknown", "informational", "advisory", "normative"] }
      }
    },
    "availability": { "enum": ["implemented", "partial", "planned", "deprecated", "historical", "mixed", "unknown"] },
    "confirmedFingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "confirmedContentHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "provenance": {
      "type": "object",
      "additionalProperties": false,
      "required": ["discoveredBy", "confirmedBy", "confirmedAt", "confirmedOperationId"],
      "properties": {
        "discoveredBy": { "type": "string", "minLength": 1 },
        "confirmedBy": { "type": "string", "minLength": 1 },
        "confirmedAt": { "type": "string", "minLength": 1 },
        "confirmedOperationId": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }
      }
    }
  }
}
```

In `runtime/src/lib/schema.mjs`, add `source: "validate_source"` to `exportNameByPublicName`:

```js
const exportNameByPublicName = {
  config: "validate_config",
  "plugin-lock": "validate_plugin_lock",
  scope: "validate_scope",
  source: "validate_source",
  "change-set": "validate_change_set",
  operation: "validate_operation",
  event: "validate_event",
  result: "validate_result"
};
```

In `runtime/src/lib/paths.mjs`, extend the loop in `assertTrustedRoots` (currently `for (const name of ["operations", "events", ".runtime", "scopes"])` around line 167):

```js
  for (const name of ["operations", "events", ".runtime", "scopes", "sources"]) {
    assertTrustedRoot(planningRoot, name);
  }
```

Run `npm run build:schemas` once locally so `runtime/src/generated/validators.mjs` picks up the new schema before running the test (the build step is what compiles `runtime/src/schemas/*.schema.json` into the validators the test imports transitively via `schema.mjs`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:schemas && node runtime/src/lib/tests/source-schema.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/schemas/source.schema.json runtime/src/lib/schema.mjs runtime/src/lib/paths.mjs runtime/src/lib/tests/source-schema.test.mjs runtime/src/generated/validators.mjs
git commit -m "feat(discovery): add sources catalog schema and trust it as a runtime root"
```

---

### Task 5: `scope.schema.json` — `commands` discriminated union

**Files:**
- Modify: `runtime/src/schemas/scope.schema.json`
- Test: `runtime/src/lib/tests/scope-commands-schema.test.mjs`

**Interfaces:**
- Produces: `scope.yml` documents may now include an optional `commands` object with well-known keys `build|test|smoke|lint|verify` plus an open `custom.<role>` map, each entry shaped per the `declared` vs `inferred|reviewed` discriminated union.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/scope-commands-schema.test.mjs
import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const baseScope = {
  schemaVersion: 1,
  id: "018f4d1e-0000-7000-8000-000000000001",
  key: "api",
  label: "API",
  kind: "code",
  path: "api/",
  owner: null
};

const declaredCommand = {
  command: "./mvnw test",
  method: "declared",
  declaredBy: "carlos",
  declaredAt: "2026-07-25T10:00:00Z",
  declaredOperationId: "018f4d1e-0000-7000-8000-000000000002",
  requiresEnvironment: false,
  requiresSecrets: false,
  alternatives: []
};
assert.equal(validate("scope", { ...baseScope, commands: { test: declaredCommand } }).valid, true);

// declared forbids sourceRefs/confidence
const declaredWithSourceRefs = { ...declaredCommand, sourceRefs: ["018f4d1e-0000-7000-8000-000000000003"] };
assert.equal(validate("scope", { ...baseScope, commands: { test: declaredWithSourceRefs } }).valid, false);

// declared must have empty alternatives
assert.equal(validate("scope", { ...baseScope, commands: { test: { ...declaredCommand, alternatives: [{ command: "x" }] } } }).valid, false);

const reviewedCommand = {
  command: "./mvnw package",
  method: "reviewed",
  confidence: "high",
  sourceRefs: ["018f4d1e-0000-7000-8000-000000000004"],
  sourceFingerprintAtSelection: { "018f4d1e-0000-7000-8000-000000000004": "c".repeat(64) },
  requiresEnvironment: false,
  requiresSecrets: false,
  alternatives: [
    {
      command: "npm run build",
      sourceRefs: ["018f4d1e-0000-7000-8000-000000000005"],
      sourceFingerprintAtSelection: { "018f4d1e-0000-7000-8000-000000000005": "d".repeat(64) },
      confidence: "medium",
      requiresEnvironment: false,
      requiresSecrets: false
    }
  ]
};
assert.equal(validate("scope", { ...baseScope, commands: { build: reviewedCommand } }).valid, true);

// duplicate sourceRefs rejected
const dupRefs = { ...reviewedCommand, sourceRefs: ["018f4d1e-0000-7000-8000-000000000004", "018f4d1e-0000-7000-8000-000000000004"] };
assert.equal(validate("scope", { ...baseScope, commands: { build: dupRefs } }).valid, false);

// sourceFingerprintAtSelection keys must exactly match sourceRefs -- extra key rejected
const extraFingerprintKey = {
  ...reviewedCommand,
  sourceFingerprintAtSelection: { "018f4d1e-0000-7000-8000-000000000004": "c".repeat(64), "018f4d1e-0000-7000-8000-000000000099": "e".repeat(64) }
};
assert.equal(validate("scope", { ...baseScope, commands: { build: extraFingerprintKey } }).valid, false);

// custom role must not reuse a well-known name
assert.equal(validate("scope", { ...baseScope, commands: { custom: { test: reviewedCommand } } }).valid, false);

// custom role name pattern
assert.equal(validate("scope", { ...baseScope, commands: { custom: { e2e: reviewedCommand } } }).valid, true);
assert.equal(validate("scope", { ...baseScope, commands: { custom: { "Not_Valid!": reviewedCommand } } }).valid, false);

console.log("scope-commands-schema: declared/inferred|reviewed union, sourceRefs set rules, custom role rules all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/scope-commands-schema.test.mjs`
Expected: FAIL — `commands` is not yet a recognized property (rejected by `additionalProperties: false` on the base scope schema), so the very first `assert.equal(..., true)` fails.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `runtime/src/schemas/scope.schema.json`:

```json
{
  "$id": "https://shipping-mode.dev/schemas/scope.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "id", "key", "label", "kind", "path"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "id": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },
    "key": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
    "label": { "type": "string", "minLength": 1 },
    "kind": { "enum": ["code", "non_code"] },
    "path": { "type": "string", "minLength": 1 },
    "owner": { "type": ["string", "null"] },
    "commands": { "$ref": "#/$defs/commands" }
  },
  "$defs": {
    "uuid": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },
    "sourceRefs": {
      "type": "array",
      "items": { "$ref": "#/$defs/uuid" },
      "minItems": 1,
      "uniqueItems": true
    },
    "confidence": { "enum": ["low", "medium", "high"] },
    "alternative": {
      "type": "object",
      "additionalProperties": false,
      "required": ["command", "sourceRefs", "sourceFingerprintAtSelection", "confidence", "requiresEnvironment", "requiresSecrets"],
      "properties": {
        "command": { "type": "string", "minLength": 1 },
        "sourceRefs": { "$ref": "#/$defs/sourceRefs" },
        "sourceFingerprintAtSelection": {
          "type": "object",
          "additionalProperties": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
        },
        "confidence": { "$ref": "#/$defs/confidence" },
        "requiresEnvironment": { "type": "boolean" },
        "requiresSecrets": { "type": "boolean" }
      }
    },
    "commandEntry": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["command", "method", "declaredBy", "declaredAt", "declaredOperationId", "requiresEnvironment", "requiresSecrets", "alternatives"],
          "properties": {
            "command": { "type": "string", "minLength": 1 },
            "method": { "const": "declared" },
            "declaredBy": { "type": "string", "minLength": 1 },
            "declaredAt": { "type": "string", "minLength": 1 },
            "declaredOperationId": { "$ref": "#/$defs/uuid" },
            "requiresEnvironment": { "type": "boolean" },
            "requiresSecrets": { "type": "boolean" },
            "alternatives": { "type": "array", "maxItems": 0 }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["command", "method", "confidence", "sourceRefs", "sourceFingerprintAtSelection", "requiresEnvironment", "requiresSecrets", "alternatives"],
          "properties": {
            "command": { "type": "string", "minLength": 1 },
            "method": { "enum": ["inferred", "reviewed"] },
            "confidence": { "$ref": "#/$defs/confidence" },
            "sourceRefs": { "$ref": "#/$defs/sourceRefs" },
            "sourceFingerprintAtSelection": {
              "type": "object",
              "additionalProperties": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
            },
            "requiresEnvironment": { "type": "boolean" },
            "requiresSecrets": { "type": "boolean" },
            "alternatives": { "type": "array", "items": { "$ref": "#/$defs/alternative" } }
          }
        }
      ]
    },
    "commands": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "build": { "$ref": "#/$defs/commandEntry" },
        "test": { "$ref": "#/$defs/commandEntry" },
        "smoke": { "$ref": "#/$defs/commandEntry" },
        "lint": { "$ref": "#/$defs/commandEntry" },
        "verify": { "$ref": "#/$defs/commandEntry" },
        "custom": {
          "type": "object",
          "additionalProperties": { "$ref": "#/$defs/commandEntry" },
          "propertyNames": {
            "pattern": "^[a-z][a-z0-9-]{0,63}$",
            "not": { "enum": ["build", "test", "smoke", "lint", "verify"] }
          }
        }
      }
    }
  }
}
```

Note: this schema does not yet enforce "`sourceFingerprintAtSelection` keys exactly match `sourceRefs`" as a cross-field structural constraint (plain JSON Schema draft used here has no clean way to express "these two objects have identical key sets" without `propertyNames`/`dependentSchemas` gymnastics that would hurt readability for little benefit at this layer). The test above only exercises the "extra key" direction. Enforcing the full bidirectional match is deferred to the semantic validation pipeline in Plan 2 (`discover propose`'s structural validation step), which has direct access to both arrays/objects in application code and can express set-equality directly and clearly. Leave a one-line comment to this effect above the `sourceFingerprintAtSelection` properties in both `alternative` and `commandEntry`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:schemas && node runtime/src/lib/tests/scope-commands-schema.test.mjs`
Expected: PASS. Also re-run the pre-existing scope test to confirm no regression: `node runtime/src/lib/tests/schema.test.mjs` (or wherever the current scope schema is exercised — check with `grep -rl '"scope"' runtime/src/lib/tests runtime/src/commands/tests` first) and `npm run test:unit`.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/schemas/scope.schema.json runtime/src/lib/tests/scope-commands-schema.test.mjs runtime/src/generated/validators.mjs
git commit -m "feat(discovery): extend scope schema with declared/inferred/reviewed commands union"
```

---

### Task 6: Git detection

**Files:**
- Create: `runtime/src/lib/discoverScan.mjs`
- Test: `runtime/src/lib/tests/discover-git.test.mjs`

**Interfaces:**
- Produces: `detectGit(workspaceRoot, { execFileFn })` → `{ enabled: boolean, branch: string|null, remote: string|null, vcs: "git"|"none" }`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discover-git.test.mjs
import assert from "node:assert/strict";
import { detectGit } from "../discoverScan.mjs";

// non-git workspace: injected execFileFn always fails as git would outside a repo
const notGitResult = detectGit("/anywhere", {
  execFileFn: () => { const e = new Error("not a git repository"); e.status = 128; throw e; }
});
assert.deepEqual(notGitResult, { enabled: false, branch: null, remote: null, vcs: "none" });

// git workspace: injected execFileFn simulates real git plumbing output
const gitResult = detectGit("/anywhere", {
  execFileFn: (cmd, args) => {
    if (args.includes("--abbrev-ref")) return "main\n";
    if (args.includes("--get")) return "origin\n";
    throw new Error(`unexpected git invocation: ${args.join(" ")}`);
  }
});
assert.deepEqual(gitResult, { enabled: true, branch: "main", remote: "origin", vcs: "git" });

// git workspace with no configured remote: remote is null, still enabled
const gitNoRemote = detectGit("/anywhere", {
  execFileFn: (cmd, args) => {
    if (args.includes("--abbrev-ref")) return "main\n";
    if (args.includes("--get")) { const e = new Error("no such remote"); e.status = 1; throw e; }
    throw new Error(`unexpected git invocation: ${args.join(" ")}`);
  }
});
assert.deepEqual(gitNoRemote, { enabled: true, branch: "main", remote: null, vcs: "git" });

console.log("discover-git: not-a-repo, repo-with-remote, repo-without-remote all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discover-git.test.mjs`
Expected: FAIL with `Cannot find module '../discoverScan.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/discoverScan.mjs
import { execFileSync } from "node:child_process";

function defaultExecFile(command, args, options) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

export function detectGit(workspaceRoot, { execFileFn = defaultExecFile } = {}) {
  let branch;
  try {
    branch = execFileFn("git", ["-C", workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {
    return { enabled: false, branch: null, remote: null, vcs: "none" };
  }
  let remote = null;
  try {
    remote = execFileFn("git", ["-C", workspaceRoot, "config", "--get", "remote.origin.url"]).trim() || null;
    if (remote) remote = "origin";
  } catch {
    remote = null;
  }
  return { enabled: true, branch, remote, vcs: "git" };
}
```

Note: `remote` is reported as the remote **name** (`"origin"`), not the URL, matching the design's `git.remote` field (a remote name, consumed only as a signal that a remote exists — the URL itself is host-specific and out of scope here). The injected test's `--get` branch returning `"origin\n"` represents `git config --get remote.origin.url` succeeding (meaning the `origin` remote exists); the actual URL value is discarded in favor of the fixed literal `"origin"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discover-git.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoverScan.mjs runtime/src/lib/tests/discover-git.test.mjs
git commit -m "feat(discovery): add git detection for discover scan"
```

---

### Task 7: Scope and source candidate enumeration rules

**Files:**
- Modify: `runtime/src/lib/discoverScan.mjs`
- Test: `runtime/src/lib/tests/discover-candidates.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `enumerateCandidates(workspaceRoot, { readdirFn, lstatFn })` → `{ scopeCandidates: Array<{path, signals, suggestions:{kind, ruleIds}}>, sourceCandidates: Array<{path, candidateFamilies, ruleIds}> }` (no fingerprints yet — those are computed by the orchestrator in Task 10, which has access to `--max-source-bytes`).

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discover-candidates.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { enumerateCandidates } from "../discoverScan.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "discover-candidates-"));
fs.mkdirSync(path.join(root, "api"));
fs.writeFileSync(path.join(root, "api", "pom.xml"), "<project/>");
fs.mkdirSync(path.join(root, "web"));
fs.writeFileSync(path.join(root, "web", "package.json"), "{}");
fs.mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
fs.writeFileSync(path.join(root, "CODEOWNERS"), "* @carlos");
fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
fs.writeFileSync(path.join(root, "AGENTS.md"), "# agent instructions");

const result = enumerateCandidates(root);

const apiScope = result.scopeCandidates.find((c) => c.path === "api/");
assert.ok(apiScope, "api/ with pom.xml should be a scope candidate");
assert.deepEqual(apiScope.signals, ["pom.xml"]);
assert.equal(apiScope.suggestions.kind, "code");
assert.ok(apiScope.suggestions.ruleIds.includes("scope.maven-project"));

const webScope = result.scopeCandidates.find((c) => c.path === "web/");
assert.ok(webScope, "web/ with package.json should be a scope candidate");
assert.ok(webScope.suggestions.ruleIds.includes("scope.node-package"));

const adrSource = result.sourceCandidates.find((c) => c.path === "docs/adr/");
assert.ok(adrSource, "docs/adr/ should be a decision-sources candidate");
assert.ok(adrSource.candidateFamilies.includes("decision-sources"));
assert.ok(adrSource.ruleIds.includes("source.adr-directory"));

const ownershipSource = result.sourceCandidates.find((c) => c.path === "CODEOWNERS");
assert.ok(ownershipSource, "CODEOWNERS should be an ownership candidate");
assert.ok(ownershipSource.candidateFamilies.includes("ownership"));

const ciSource = result.sourceCandidates.find((c) => c.path === ".github/workflows/");
assert.ok(ciSource, ".github/workflows/ should be a delivery-ci-deployment candidate");

const agentSource = result.sourceCandidates.find((c) => c.path === "AGENTS.md");
assert.ok(agentSource, "AGENTS.md should be an agent-repository-instructions candidate");

// package.json is both a scope signal AND a project-module-manifests source candidate
const webManifestSource = result.sourceCandidates.find((c) => c.path === "web/package.json");
assert.ok(webManifestSource, "package.json should also be registered as its own source candidate");
assert.ok(webManifestSource.candidateFamilies.includes("project-module-manifests"));

console.log("discover-candidates: scope and source candidate rule table produces expected signals/families/ruleIds");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discover-candidates.test.mjs`
Expected: FAIL with `enumerateCandidates is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoverScan.mjs`:

```js
import fs from "node:fs";
import path from "node:path";

const SCOPE_MANIFEST_RULES = [
  { fileName: "package.json", ruleId: "scope.node-package", kind: "code" },
  { fileName: "pom.xml", ruleId: "scope.maven-project", kind: "code" },
  { fileName: "pyproject.toml", ruleId: "scope.python-project", kind: "code" },
  { fileName: "go.mod", ruleId: "scope.go-module", kind: "code" }
];

const SOURCE_FILE_RULES = [
  { fileName: "package.json", ruleId: "source.package-manifest", family: "project-module-manifests" },
  { fileName: "pom.xml", ruleId: "source.package-manifest", family: "project-module-manifests" },
  { fileName: "pyproject.toml", ruleId: "source.package-manifest", family: "project-module-manifests" },
  { fileName: "go.mod", ruleId: "source.package-manifest", family: "project-module-manifests" },
  { fileName: "Cargo.toml", ruleId: "source.package-manifest", family: "project-module-manifests" },
  { fileName: "CODEOWNERS", ruleId: "source.ownership", family: "ownership" },
  { fileName: "AGENTS.md", ruleId: "source.agent-instructions", family: "agent-repository-instructions" },
  { fileName: "CLAUDE.md", ruleId: "source.agent-instructions", family: "agent-repository-instructions" },
  { fileName: "README.md", ruleId: "source.agent-instructions", family: "agent-repository-instructions" },
  { fileName: "CONTRIBUTING.md", ruleId: "source.agent-instructions", family: "agent-repository-instructions" },
  { fileName: "Dockerfile", ruleId: "source.env-runtime", family: "local-runtime-environment" },
  { fileName: "docker-compose.yml", ruleId: "source.env-runtime", family: "local-runtime-environment" },
  { fileName: ".env.example", ruleId: "source.env-runtime", family: "local-runtime-environment" }
];

const SOURCE_DIRECTORY_RULES = [
  { dirName: "adr", underDocs: true, ruleId: "source.adr-directory", family: "decision-sources" },
  { dirName: "decisions", underDocs: true, ruleId: "source.adr-directory", family: "decision-sources" },
  { relativePath: ".github/workflows", ruleId: "source.ci-workflows", family: "delivery-ci-deployment" }
];

function listTopLevel(currentDir, { readdirFn = fs.readdirSync, lstatFn = fs.lstatSync } = {}) {
  return readdirFn(currentDir).map((name) => ({
    name,
    absPath: path.join(currentDir, name),
    stat: lstatFn(path.join(currentDir, name))
  }));
}

export function enumerateCandidates(workspaceRoot, { readdirFn = fs.readdirSync, lstatFn = fs.lstatSync } = {}) {
  const scopeCandidates = [];
  const sourceCandidates = [];

  function walk(currentDir, relativeDir) {
    let children;
    try {
      children = listTopLevel(currentDir, { readdirFn, lstatFn });
    } catch {
      return;
    }
    const fileNames = new Set(children.filter((c) => c.stat.isFile()).map((c) => c.name));

    for (const scopeRule of SCOPE_MANIFEST_RULES) {
      if (fileNames.has(scopeRule.fileName) && relativeDir !== "") {
        const existing = scopeCandidates.find((c) => c.path === `${relativeDir}/`);
        if (existing) {
          existing.signals.push(scopeRule.fileName);
          existing.suggestions.ruleIds.push(scopeRule.ruleId);
        } else {
          scopeCandidates.push({ path: `${relativeDir}/`, signals: [scopeRule.fileName], suggestions: { kind: scopeRule.kind, ruleIds: [scopeRule.ruleId] } });
        }
      }
    }

    for (const child of children) {
      if (child.stat.isSymbolicLink()) continue;
      const childRelative = relativeDir ? `${relativeDir}/${child.name}` : child.name;

      if (child.stat.isFile()) {
        const fileRule = SOURCE_FILE_RULES.find((r) => r.fileName === child.name);
        if (fileRule) sourceCandidates.push({ path: childRelative, candidateFamilies: [fileRule.family], ruleIds: [fileRule.ruleId] });
      }

      if (child.stat.isDirectory()) {
        if (child.name === "node_modules" || child.name === ".git") continue;
        const dirRule = SOURCE_DIRECTORY_RULES.find((r) =>
          r.relativePath ? childRelative === r.relativePath : (r.dirName === child.name && (!r.underDocs || relativeDir === "docs"))
        );
        if (dirRule) sourceCandidates.push({ path: `${childRelative}/`, candidateFamilies: [dirRule.family], ruleIds: [dirRule.ruleId] });
        walk(child.absPath, childRelative);
      }
    }
  }

  walk(workspaceRoot, "");
  return { scopeCandidates, sourceCandidates };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discover-candidates.test.mjs`
Expected: PASS.

Note for future work (do not implement now — out of scope for this task): the rule tables above cover a representative subset of the 19 families documented in `docs/plugin-redesign-release-flow/04-release-init-configuracion.md:165-187`, not all of them. Adding more families later is purely additive — new table entries, no algorithm changes.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoverScan.mjs runtime/src/lib/tests/discover-candidates.test.mjs
git commit -m "feat(discovery): add scope and source candidate enumeration rules"
```

---

### Task 8: Known-source drift computation

**Files:**
- Modify: `runtime/src/lib/discoverScan.mjs`
- Test: `runtime/src/lib/tests/discover-drift.test.mjs`

**Interfaces:**
- Consumes: `computeSourceFingerprint`, `detectMoved`, `FingerprintError` (Task 3); reads `sources/*/source.yml` via `confineWritePath`/`parseYaml` (same pattern as `check.mjs:46-67`).
- Produces: `computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates, maxSourceBytes })` → `{ results: Array<{ sourceId, path, observedFingerprint, observedContentHash, driftState, freshness, observedAtPath }>, diagnostics: Array<{code, path, sourceId?, message}> }`. A `FingerprintError` while re-fingerprinting any single confirmed source or move-detection candidate becomes one `diagnostics` entry and that item is skipped — it must never abort the rest of the scan.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discover-drift.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { computeSourceFingerprint } from "../fingerprint.mjs";
import { computeKnownSourceDrift } from "../discoverScan.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "discover-drift-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "sources"), { recursive: true });
  return { workspaceRoot, planningRoot };
}

function writeSource(planningRoot, id, overrides) {
  const dir = path.join(planningRoot, "sources", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "source.yml"), stringifyYaml({
    schemaVersion: 1, id, path: "docs/adr/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "0".repeat(64), confirmedContentHash: "0".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000009" },
    ...overrides
  }));
}

// unchanged
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const id = "018f4d1e-0000-7000-8000-000000000001";
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision");
  // compute the real fingerprint so the fixture is internally consistent
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "adr"), { maxBytes: 1024 });
  writeSource(planningRoot, id, { confirmedFingerprint: real.fingerprint, confirmedContentHash: real.contentHash });

  const { results, diagnostics } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: 1024 });
  const entry = results.find((d) => d.sourceId === id);
  assert.equal(entry.driftState, "unchanged");
  assert.equal(entry.freshness, "current");
  assert.deepEqual(diagnostics, []);
}

// changed
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const id = "018f4d1e-0000-7000-8000-000000000002";
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision v2");
  writeSource(planningRoot, id); // confirmedFingerprint stays as the all-zero placeholder, guaranteed to differ

  const { results } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: 1024 });
  const entry = results.find((d) => d.sourceId === id);
  assert.equal(entry.driftState, "changed");
  assert.equal(entry.freshness, "stale");
}

// missing (no moved candidate available)
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const id = "018f4d1e-0000-7000-8000-000000000003";
  writeSource(planningRoot, id); // docs/adr/ never created in workspaceRoot

  const { results } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: 1024 });
  const entry = results.find((d) => d.sourceId === id);
  assert.equal(entry.driftState, "missing");
  assert.equal(entry.freshness, "unknown");
  assert.equal(entry.observedAtPath, null);
}

// moved: source path gone, but a source candidate elsewhere has the exact same contentHash
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const id = "018f4d1e-0000-7000-8000-000000000004";
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new-adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new-adr", "0001.md"), "decision");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "new-adr"), { maxBytes: 1024 });
  writeSource(planningRoot, id, { confirmedContentHash: real.contentHash }); // path still "docs/adr/", which does not exist

  const { results } = computeKnownSourceDrift({
    planningRoot, workspaceRoot,
    sourceCandidates: [{ path: "docs/new-adr/", candidateFamilies: ["decision-sources"], ruleIds: [] }],
    maxSourceBytes: 1024
  });
  const entry = results.find((d) => d.sourceId === id);
  assert.equal(entry.driftState, "moved");
  assert.equal(entry.observedAtPath, "docs/new-adr/");
}

// a confirmed source that has become unreadable/oversized produces a diagnostic and does
// NOT crash the whole call -- the rest of the confirmed sources still get processed
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const okId = "018f4d1e-0000-7000-8000-000000000005";
  const brokenId = "018f4d1e-0000-7000-8000-000000000006";
  fs.mkdirSync(path.join(workspaceRoot, "docs", "ok"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "ok", "0001.md"), "fine");
  const okReal = computeSourceFingerprint(path.join(workspaceRoot, "docs", "ok"), { maxBytes: 1024 });
  writeSource(planningRoot, okId, { path: "docs/ok/", confirmedFingerprint: okReal.fingerprint, confirmedContentHash: okReal.contentHash });

  fs.mkdirSync(path.join(workspaceRoot, "docs", "broken"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "broken", "huge.md"), "0123456789"); // 10 bytes
  writeSource(planningRoot, brokenId, { path: "docs/broken/" });

  const { results, diagnostics } = computeKnownSourceDrift({
    planningRoot, workspaceRoot, sourceCandidates: [], maxSourceBytes: 5 // smaller than the 10-byte broken source
  });
  assert.ok(results.find((r) => r.sourceId === okId && r.driftState === "unchanged"), "the healthy source must still be processed normally");
  assert.equal(results.find((r) => r.sourceId === brokenId), undefined, "the broken source must not appear in results");
  assert.ok(diagnostics.some((d) => d.code === "source_too_large" && d.sourceId === brokenId), "the broken source must produce a diagnostic instead of crashing the call");
}

console.log("discover-drift: unchanged, changed, missing, moved, and per-item diagnostic-not-crash all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discover-drift.test.mjs`
Expected: FAIL with `computeKnownSourceDrift is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoverScan.mjs` (add `import { computeSourceFingerprint, detectMoved, FingerprintError } from "./fingerprint.mjs";`, `import { confineWritePath } from "./paths.mjs";`, `import { parseYaml } from "./yaml.mjs";`, `import { isUuidV7 } from "./ids.mjs";` at the top):

```js
function readConfirmedSources(planningRoot) {
  const sourcesRoot = path.join(planningRoot, "sources");
  if (!fs.existsSync(sourcesRoot)) return [];
  const sources = [];
  for (const id of fs.readdirSync(sourcesRoot)) {
    if (!isUuidV7(id)) continue;
    const sourceFile = confineWritePath(planningRoot, path.join("sources", id, "source.yml"));
    if (!fs.existsSync(sourceFile)) continue;
    sources.push(parseYaml(fs.readFileSync(sourceFile, "utf8")));
  }
  return sources;
}

export function computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates, maxSourceBytes }) {
  const confirmedSources = readConfirmedSources(planningRoot);
  const results = [];
  const diagnostics = [];
  const missingForMoveDetection = [];

  for (const source of confirmedSources) {
    const absolutePath = path.join(workspaceRoot, source.path);
    if (!fs.existsSync(absolutePath)) {
      missingForMoveDetection.push({ sourceId: source.id, confirmedContentHash: source.confirmedContentHash, path: source.path });
      continue;
    }
    let observed;
    try {
      observed = computeSourceFingerprint(absolutePath, { maxBytes: maxSourceBytes });
    } catch (error) {
      if (!(error instanceof FingerprintError)) throw error;
      diagnostics.push({ code: error.code, path: source.path, sourceId: source.id, message: error.message });
      continue; // a fingerprint failure on one confirmed source must never abort the rest of the scan
    }
    const driftState = observed.fingerprint === source.confirmedFingerprint ? "unchanged" : "changed";
    results.push({
      sourceId: source.id,
      path: source.path,
      observedFingerprint: observed.fingerprint,
      observedContentHash: observed.contentHash,
      driftState,
      freshness: driftState === "unchanged" ? "current" : "stale",
      observedAtPath: null
    });
  }

  if (missingForMoveDetection.length > 0) {
    const newCandidatesWithHashes = [];
    for (const candidate of sourceCandidates) {
      const absolutePath = path.join(workspaceRoot, candidate.path);
      try {
        const observed = computeSourceFingerprint(absolutePath, { maxBytes: maxSourceBytes });
        newCandidatesWithHashes.push({ path: candidate.path, observedContentHash: observed.contentHash, observedFingerprint: observed.fingerprint });
      } catch (error) {
        if (!(error instanceof FingerprintError)) throw error;
        diagnostics.push({ code: error.code, path: candidate.path, message: error.message });
      }
    }
    const movedResults = detectMoved(missingForMoveDetection, newCandidatesWithHashes);
    for (const missing of missingForMoveDetection) {
      const moveResult = movedResults.find((r) => r.sourceId === missing.sourceId);
      results.push({
        sourceId: missing.sourceId,
        path: missing.path,
        observedFingerprint: null,
        observedContentHash: null,
        driftState: moveResult.driftState,
        freshness: "unknown",
        observedAtPath: moveResult.observedAtPath
      });
    }
  }

  return { results, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discover-drift.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoverScan.mjs runtime/src/lib/tests/discover-drift.test.mjs
git commit -m "feat(discovery): compute known-source drift including moved detection"
```

---

### Task 9: Known-commands evidence computation

**Files:**
- Modify: `runtime/src/lib/discoverScan.mjs`
- Test: `runtime/src/lib/tests/discover-command-evidence.test.mjs`

**Interfaces:**
- Consumes: drift results from Task 8 (`{sourceId, driftState}` per source, keyed by id); reads `scopes/*/scope.yml` via the same `confineWritePath` pattern as `check.mjs:49-68`.
- Produces: `computeCommandEvidence({ planningRoot, knownSourceDrift })` → `Array<{ scopeId, role, evidenceState, reasons }>`, implementing the precedence algorithm from the design spec exactly: `not-evidence-backed → evidence-missing → unknown → evidence-drifted → evidence-updated → current`, with `evidence-drifted` outranking `evidence-updated` and both reasons reported together when both apply.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discover-command-evidence.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { computeCommandEvidence } from "../discoverScan.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "discover-evidence-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "scopes"), { recursive: true });
  return { planningRoot };
}

function writeScope(planningRoot, scopeId, commands) {
  const dir = path.join(planningRoot, "scopes", scopeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "scope.yml"), stringifyYaml({
    schemaVersion: 1, id: scopeId, key: "api", label: "API", kind: "code", path: "api/", owner: null, commands
  }));
}

const srcA = "018f4d1e-0000-7000-8000-0000000000a1";
const srcB = "018f4d1e-0000-7000-8000-0000000000a2";

// declared command -> not-evidence-backed, regardless of any drift data
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b1";
  writeScope(planningRoot, scopeId, {
    test: { command: "./x", method: "declared", declaredBy: "carlos", declaredAt: "2026-07-25T10:00:00Z", declaredOperationId: "018f4d1e-0000-7000-8000-0000000000c1", requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  const result = computeCommandEvidence({ planningRoot, knownSourceDrift: [] });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "test");
  assert.equal(entry.evidenceState, "not-evidence-backed");
  assert.deepEqual(entry.reasons, []);
}

// current: no drift on the referenced source
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b2";
  writeScope(planningRoot, scopeId, {
    build: { command: "./y", method: "reviewed", confidence: "high", sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "a".repeat(64) }, requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  const result = computeCommandEvidence({ planningRoot, knownSourceDrift: [{ sourceId: srcA, driftState: "unchanged", observedFingerprint: "a".repeat(64) }] });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "build");
  assert.equal(entry.evidenceState, "current");
}

// evidence-missing: referenced source has no drift entry at all (never existed / path unresolvable)
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b3";
  writeScope(planningRoot, scopeId, {
    build: { command: "./y", method: "reviewed", confidence: "high", sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "a".repeat(64) }, requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  const result = computeCommandEvidence({ planningRoot, knownSourceDrift: [] });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "build");
  assert.equal(entry.evidenceState, "evidence-missing");
}

// evidence-updated: catalog's confirmed fingerprint moved past the command's selection snapshot,
// but live workspace still matches the catalog (no live drift)
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b4";
  writeScope(planningRoot, scopeId, {
    build: { command: "./y", method: "reviewed", confidence: "high", sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "old".padEnd(64, "0") }, requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  // driftState "unchanged" means catalog.confirmedFingerprint === live observed; the value itself differs from the selection snapshot
  const result = computeCommandEvidence({
    planningRoot,
    knownSourceDrift: [{ sourceId: srcA, driftState: "unchanged", observedFingerprint: "new".padEnd(64, "0"), confirmedFingerprint: "new".padEnd(64, "0") }]
  });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "build");
  assert.equal(entry.evidenceState, "evidence-updated");
  assert.deepEqual(entry.reasons, ["catalog-advanced-since-selection"]);
}

// evidence-drifted outranks evidence-updated when both apply
{
  const { planningRoot } = makeWorkspace();
  const scopeId = "018f4d1e-0000-7000-8000-0000000000b5";
  writeScope(planningRoot, scopeId, {
    build: { command: "./y", method: "reviewed", confidence: "high", sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "old".padEnd(64, "0") }, requiresEnvironment: false, requiresSecrets: false, alternatives: [] }
  });
  const result = computeCommandEvidence({
    planningRoot,
    knownSourceDrift: [{ sourceId: srcA, driftState: "changed", observedFingerprint: "live".padEnd(64, "0"), confirmedFingerprint: "new".padEnd(64, "0") }]
  });
  const entry = result.find((r) => r.scopeId === scopeId && r.role === "build");
  assert.equal(entry.evidenceState, "evidence-drifted");
  assert.deepEqual(entry.reasons.sort(), ["catalog-advanced-since-selection", "live-source-differs-from-catalog"].sort());
}

console.log("discover-command-evidence: not-evidence-backed, current, evidence-missing, evidence-updated, evidence-drifted precedence all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discover-command-evidence.test.mjs`
Expected: FAIL with `computeCommandEvidence is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoverScan.mjs`:

```js
function readConfirmedScopes(planningRoot) {
  const scopesRoot = path.join(planningRoot, "scopes");
  if (!fs.existsSync(scopesRoot)) return [];
  const scopes = [];
  for (const id of fs.readdirSync(scopesRoot)) {
    if (!isUuidV7(id)) continue;
    const scopeFile = confineWritePath(planningRoot, path.join("scopes", id, "scope.yml"));
    if (!fs.existsSync(scopeFile)) continue;
    scopes.push(parseYaml(fs.readFileSync(scopeFile, "utf8")));
  }
  return scopes;
}

function allCommandEntries(scope) {
  if (!scope.commands) return [];
  const entries = [];
  for (const role of ["build", "test", "smoke", "lint", "verify"]) {
    if (scope.commands[role]) entries.push({ role, entry: scope.commands[role] });
  }
  for (const [role, entry] of Object.entries(scope.commands.custom || {})) {
    entries.push({ role: `custom.${role}`, entry });
  }
  return entries;
}

function evaluateCommandEvidence(commandEntry, knownSourceDrift) {
  if (!commandEntry.sourceRefs || commandEntry.sourceRefs.length === 0) {
    return { evidenceState: "not-evidence-backed", reasons: [] };
  }

  const driftById = new Map(knownSourceDrift.map((d) => [d.sourceId, d]));
  const refDrifts = commandEntry.sourceRefs.map((ref) => driftById.get(ref));

  if (refDrifts.some((d) => d === undefined || d.driftState === "missing")) {
    return { evidenceState: "evidence-missing", reasons: [] };
  }
  if (refDrifts.some((d) => d.observedFingerprint === undefined || d.observedFingerprint === null)) {
    return { evidenceState: "unknown", reasons: [] };
  }

  const reasons = new Set();
  let anyDrifted = false;
  let anyUpdated = false;
  for (const ref of commandEntry.sourceRefs) {
    const drift = driftById.get(ref);
    const catalogFingerprint = drift.confirmedFingerprint ?? drift.observedFingerprint;
    if (drift.driftState === "changed") {
      anyDrifted = true;
      reasons.add("live-source-differs-from-catalog");
    }
    if (commandEntry.sourceFingerprintAtSelection[ref] !== catalogFingerprint) {
      anyUpdated = true;
      reasons.add("catalog-advanced-since-selection");
    }
  }

  if (anyDrifted) return { evidenceState: "evidence-drifted", reasons: [...reasons] };
  if (anyUpdated) return { evidenceState: "evidence-updated", reasons: [...reasons] };
  return { evidenceState: "current", reasons: [] };
}

export function computeCommandEvidence({ planningRoot, knownSourceDrift }) {
  const scopes = readConfirmedScopes(planningRoot);
  const results = [];
  for (const scope of scopes) {
    for (const { role, entry } of allCommandEntries(scope)) {
      const { evidenceState, reasons } = evaluateCommandEvidence(entry, knownSourceDrift);
      results.push({ scopeId: scope.id, role, evidenceState, reasons });
    }
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discover-command-evidence.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoverScan.mjs runtime/src/lib/tests/discover-command-evidence.test.mjs
git commit -m "feat(discovery): compute scope-command evidence state with drift/update precedence"
```

---

### Task 10: `workspaceHash` computation

**Files:**
- Modify: `runtime/src/lib/discoverScan.mjs`
- Test: `runtime/src/lib/tests/discover-workspace-hash.test.mjs`

**Interfaces:**
- Produces: `stringSetHash(strings)` → 64-char hex; `computeWorkspaceHash({ scopeCandidates, sourceCandidates, knownSources, knownCommandsEvidence })` → 64-char hex, deterministic and order-independent with respect to input array ordering (sorted internally), sensitive to every field the design specifies.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discover-workspace-hash.test.mjs
import assert from "node:assert/strict";
import { stringSetHash, computeWorkspaceHash } from "../discoverScan.mjs";

// stringSetHash: order-independent, multiplicity-preserving
assert.equal(stringSetHash(["a", "b"]), stringSetHash(["b", "a"]));
assert.notEqual(stringSetHash(["a"]), stringSetHash(["a", "a"]), "multiplicity must be preserved, not deduplicated");

const baseInput = {
  scopeCandidates: [{ path: "api/", signals: ["pom.xml"], suggestions: { kind: "code", ruleIds: ["scope.maven-project"] } }],
  sourceCandidates: [{ path: "docs/adr/", candidateFamilies: ["decision-sources"], ruleIds: ["source.adr-directory"], observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }],
  knownSources: [{ sourceId: "s1", path: "docs/x/", driftState: "unchanged", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64), observedAtPath: null }],
  knownCommandsEvidence: [{ scopeId: "sc1", role: "test", evidenceState: "current", reasons: [] }]
};

const h1 = computeWorkspaceHash(baseInput);
const h2 = computeWorkspaceHash({
  ...baseInput,
  scopeCandidates: [...baseInput.scopeCandidates], // reordered/re-cloned, same logical content
  knownSources: [...baseInput.knownSources]
});
assert.equal(h1, h2, "identical logical content must hash identically regardless of array identity/order");
assert.equal(h1.length, 64);

// changing a reasons list changes the hash even if evidenceState stays the same
const h3 = computeWorkspaceHash({
  ...baseInput,
  knownCommandsEvidence: [{ scopeId: "sc1", role: "test", evidenceState: "current", reasons: ["something-changed"] }]
});
assert.notEqual(h1, h3, "reasons changing must change the hash even when evidenceState label is identical");

// changing scanParameters-independent content (a candidate's ruleIds) changes the hash
const h4 = computeWorkspaceHash({ ...baseInput, sourceCandidates: [{ ...baseInput.sourceCandidates[0], ruleIds: ["source.other-rule"] }] });
assert.notEqual(h1, h4);

console.log("discover-workspace-hash: order-independence, multiplicity, and sensitivity to every field all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discover-workspace-hash.test.mjs`
Expected: FAIL with `stringSetHash is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoverScan.mjs` (add `import { contentHash as sha256Hex } from "./canonical.mjs";` at the top):

```js
export function stringSetHash(strings) {
  const lines = strings.map((s) => `${sha256Hex(Buffer.from(s, "utf8"))}\n`).sort();
  return sha256Hex(Buffer.from(lines.join(""), "utf8"));
}

function hashOrEmpty(value) {
  return sha256Hex(Buffer.from(value ?? "", "utf8"));
}

export function computeWorkspaceHash({ scopeCandidates, sourceCandidates, knownSources, knownCommandsEvidence }) {
  const lines = [];

  for (const c of scopeCandidates) {
    lines.push(`scope\0${hashOrEmpty(c.path)}\0${stringSetHash(c.signals)}\0${hashOrEmpty(c.suggestions?.kind)}\0${stringSetHash(c.suggestions?.ruleIds || [])}\n`);
  }
  for (const c of sourceCandidates) {
    lines.push(`sourceCandidate\0${hashOrEmpty(c.path)}\0${stringSetHash(c.candidateFamilies)}\0${c.observedFingerprint}\0${c.observedContentHash}\0${stringSetHash(c.ruleIds)}\n`);
  }
  for (const s of knownSources) {
    const fp = s.observedFingerprint ?? hashOrEmpty("missing");
    const ch = s.observedContentHash ?? hashOrEmpty("missing");
    lines.push(`knownSource\0${s.sourceId}\0${s.driftState}\0${hashOrEmpty(s.path)}\0${fp}\0${ch}\0${hashOrEmpty(s.observedAtPath)}\n`);
  }
  for (const e of knownCommandsEvidence) {
    lines.push(`commandEvidence\0${e.scopeId}\0${e.role}\0${e.evidenceState}\0${stringSetHash(e.reasons)}\n`);
  }

  lines.sort();
  return sha256Hex(Buffer.from(lines.join(""), "utf8"));
}
```

Note: `s.observedFingerprint ?? hashOrEmpty("missing")` handles the case (from Task 8) where a `missing`/`moved` known source has `observedFingerprint: null` — this hashes the literal string `"missing"` as the placeholder, matching the design's requirement that even placeholder fields stay fixed-length hex, never raw text.

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discover-workspace-hash.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoverScan.mjs runtime/src/lib/tests/discover-workspace-hash.test.mjs
git commit -m "feat(discovery): compute canonical workspaceHash for scan output"
```

---

### Task 11: Assemble `ScanResult` and the `runDiscoverScan` orchestrator

**Files:**
- Create: `runtime/src/commands/discover.mjs`
- Modify: `runtime/src/lib/discoverScan.mjs` (only if a small export is needed for reuse — see below)
- Test: `runtime/src/commands/tests/discover.test.mjs`

**Interfaces:**
- Consumes: `detectGit`, `enumerateCandidates`, `computeKnownSourceDrift`, `computeCommandEvidence`, `computeWorkspaceHash` (Tasks 6-10).
- Produces: `runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes })` → full `ScanResult` object (see design doc D.1); throws `UsageError` if `maxSourceBytes` is outside `[1048576, 2147483648]`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/commands/tests/discover.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDiscoverScan } from "../discover.mjs";
import { UsageError } from "../../lib/errors.mjs";

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "discover-run-"));
const planningRoot = path.join(workspaceRoot, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
fs.mkdirSync(path.join(workspaceRoot, "web"));
fs.writeFileSync(path.join(workspaceRoot, "web", "package.json"), "{}");

const result = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });

assert.equal(result.schemaVersion, 1);
assert.equal(typeof result.scanId, "string");
assert.equal(typeof result.generatedAt, "string");
assert.equal(result.baseRevision.workspaceHash.length, 64);
assert.equal(result.scanParameters.maxSourceBytes, 1024 * 1024);
assert.equal(result.git.vcs, "none"); // no real .git in this temp dir
assert.ok(result.scopeCandidates.some((c) => c.path === "web/"));
assert.deepEqual(result.knownSources, []);
assert.deepEqual(result.knownCommandsEvidence, []);
assert.deepEqual(result.diagnostics, []);

// range validation
assert.throws(() => runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 100 }), UsageError);
assert.throws(() => runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 3 * 1024 * 1024 * 1024 }), UsageError);

// default applies when maxSourceBytes is omitted
const withDefault = runDiscoverScan({ planningRoot, workspaceRoot });
assert.equal(withDefault.scanParameters.maxSourceBytes, 536870912);

console.log("discover command: full ScanResult assembly, range validation, and default all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/commands/tests/discover.test.mjs`
Expected: FAIL with `Cannot find module '../discover.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/commands/discover.mjs
import { generateUuidV7 } from "../lib/ids.mjs";
import { UsageError } from "../lib/errors.mjs";
import { detectGit, enumerateCandidates, computeKnownSourceDrift, computeCommandEvidence, computeWorkspaceHash } from "../lib/discoverScan.mjs";

const DEFAULT_MAX_SOURCE_BYTES = 536870912; // 512 MiB
const MIN_MAX_SOURCE_BYTES = 1048576; // 1 MiB
const MAX_MAX_SOURCE_BYTES = 2147483648; // 2 GiB

export function runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES }) {
  if (maxSourceBytes < MIN_MAX_SOURCE_BYTES || maxSourceBytes > MAX_MAX_SOURCE_BYTES) {
    throw new UsageError(`--max-source-bytes must be between ${MIN_MAX_SOURCE_BYTES} and ${MAX_MAX_SOURCE_BYTES}, got ${maxSourceBytes}`);
  }

  const git = detectGit(workspaceRoot);
  const { scopeCandidates, sourceCandidates } = enumerateCandidates(workspaceRoot);
  const { results: knownSources, diagnostics: driftDiagnostics } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates, maxSourceBytes });
  const knownCommandsEvidence = computeCommandEvidence({ planningRoot, knownSourceDrift: knownSources });

  // Candidate fingerprints are not eagerly computed here (see note below); only
  // known/confirmed-source and moved-detection fingerprinting (inside
  // computeKnownSourceDrift, Task 8) happens in Plan 1, and any failure there
  // already became a `driftDiagnostics` entry instead of throwing.
  const sourceCandidatesWithFingerprints = sourceCandidates.map((candidate) => {
    return { ...candidate, observedFingerprint: null, observedContentHash: null };
  });

  const diagnostics = [...driftDiagnostics];
  const workspaceHash = computeWorkspaceHash({
    scopeCandidates,
    sourceCandidates: sourceCandidatesWithFingerprints,
    knownSources,
    knownCommandsEvidence
  });

  return {
    schemaVersion: 1,
    scanId: generateUuidV7(),
    generatedAt: new Date().toISOString(),
    baseRevision: { vcsRevision: git.enabled ? `git:${git.branch}` : "none", workspaceHash },
    scanParameters: { maxSourceBytes },
    git,
    scopeCandidates,
    sourceCandidates: sourceCandidatesWithFingerprints,
    knownSources,
    knownCommandsEvidence,
    diagnostics
  };
}
```

Note: this task deliberately leaves `sourceCandidates[].observedFingerprint/observedContentHash` as `null` placeholders rather than eagerly fingerprinting every candidate on every scan — fingerprinting every candidate in a large repo on every `discover scan` call could be slow, and Plan 1 has no consumer that needs candidate fingerprints yet (only `computeKnownSourceDrift`'s internal moved-detection step needs them, and it already computes them itself in Task 8). Wiring per-candidate fingerprinting into the top-level `ScanResult` output (with per-candidate diagnostics on failure) is Plan 2's job, once `discover propose` actually needs to consume and re-verify those values. Leave a comment saying so above the `sourceCandidatesWithFingerprints` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/commands/tests/discover.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/commands/discover.mjs runtime/src/commands/tests/discover.test.mjs
git commit -m "feat(discovery): assemble full ScanResult via runDiscoverScan orchestrator"
```

---

### Task 12: Wire `discover scan` into the CLI dispatcher

**Files:**
- Modify: `runtime/src/index.mjs`
- Test: `runtime/src/tests/dispatcher.test.mjs` (extend existing file — check its current contents first with Read before editing)

**Interfaces:**
- Consumes: `runDiscoverScan` (Task 11).
- Produces: `dispatch("discover", ["scan", "--max-source-bytes", "N"], cwd)` → the `ScanResult` object; `dispatch("discover", ["scan"], cwd)` uses the default.

- [ ] **Step 1: Write the failing test**

`runtime/src/tests/dispatcher.test.mjs` is a flat, non-block-scoped script (no test framework) that reuses one `cwd` temp dir for the whole file and already calls `dispatch("init", [...], cwd)` near the top (propose only, not applied) — appending more `dispatch(...)` calls against the same `cwd` afterward is exactly the file's existing style (see the `outOfScope`/`outOfScopeChangeset`/`checkResult` calls already there). Insert the following right before the final `console.log("dispatcher: all tests passed");` line:

```js
const discoverResult = dispatch("discover", ["scan"], cwd);
assert.equal(discoverResult.schemaVersion, 1);
assert.equal(discoverResult.scanParameters.maxSourceBytes, 536870912);

const discoverWithFlag = dispatch("discover", ["scan", "--max-source-bytes", "2097152"], cwd);
assert.equal(discoverWithFlag.scanParameters.maxSourceBytes, 2097152);

assert.throws(() => dispatch("discover", ["scan", "--max-source-bytes", "10"], cwd), UsageError, "below the 1 MiB floor must be rejected");

const discoverNotImplemented = dispatch("discover", ["nonsense"], cwd);
assert.equal(discoverNotImplemented.status, "NOT_IMPLEMENTED");
assert.equal(discoverNotImplemented.corte, "0");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/tests/dispatcher.test.mjs`
Expected: FAIL — `discover scan` currently falls through to `notImplemented("discover scan")`, so `assert.equal(discoverResult.schemaVersion, 1)` fails because `discoverResult` is the NOT_IMPLEMENTED shape instead (it has no `schemaVersion` field at all).

- [ ] **Step 3: Write minimal implementation**

In `runtime/src/index.mjs`, add the import and a new dispatch branch. Add near the top with the other command imports:

```js
import { runDiscoverScan } from "./commands/discover.mjs";
```

Add a new `if` block before the final `return notImplemented(command);` (after the existing `check` block, matching its style):

```js
  if (command === "discover") {
    const [stage, ...rest] = args;
    if (stage === "scan") {
      const options = argsToOptions(rest);
      const workspaceRoot = cwd;
      const args2 = { planningRoot, workspaceRoot };
      if (options.max_source_bytes !== undefined) {
        const parsed = Number(options.max_source_bytes);
        if (!Number.isInteger(parsed)) throw new UsageError(`--max-source-bytes must be an integer, got ${options.max_source_bytes}`);
        args2.maxSourceBytes = parsed;
      }
      return runDiscoverScan(args2);
    }
    return notImplemented(`discover ${stage || ""}`.trim());
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/tests/dispatcher.test.mjs`
Expected: PASS. Then run the full unit suite: `npm run test:unit`.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/index.mjs runtime/src/tests/dispatcher.test.mjs
git commit -m "feat(discovery): wire discover scan into the CLI dispatcher"
```

---

### Task 13: Extend `check schema` to validate confirmed sources

**Files:**
- Modify: `runtime/src/commands/check.mjs`
- Test: `runtime/src/commands/tests/check.test.mjs` (extend existing file — Read it first)

**Interfaces:**
- Modifies: `checkSchema({ planningRoot })` — adds a `sources/<id>/source.yml` validation block mirroring the existing `scopes/<id>/scope.yml` block at `check.mjs:49-68`, plus the relational check that `source.id` matches its directory name (mirroring the existing `operation.id`-matches-directory check at `check.mjs:100-103`).

- [ ] **Step 1: Write the failing test**

`runtime/src/commands/tests/check.test.mjs` has no shared setup helper — every block builds its own temp `planningRoot` inline, writing `config.yml`/`plugin.lock.yml` by hand (see the existing "fully valid workspace" block for the exact pattern). Add two more blocks in that same style, and add `import { stringifyYaml } from "../../lib/yaml.mjs";` to the file's existing import list, right before the final `console.log("check: all tests passed");`:

```js
// sources/<id>/source.yml is now validated the same way scopes/<id>/scope.yml already is
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-source-valid-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const sourcesRoot = path.join(planningRoot, "sources");
  const id = "018f4d1e-0000-7000-8000-000000000001";
  fs.mkdirSync(path.join(sourcesRoot, id), { recursive: true });
  fs.writeFileSync(path.join(sourcesRoot, id, "source.yml"), stringifyYaml({
    schemaVersion: 1, id, path: "docs/x/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "a".repeat(64), confirmedContentHash: "b".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000002" }
  }));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.findings, []);
}

// source.id not matching its own directory name must be a finding, not silently accepted
{
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-source-mismatch-"));
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
  fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), `schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:${"a".repeat(64)}\n`);
  const sourcesRoot = path.join(planningRoot, "sources");
  const id = "018f4d1e-0000-7000-8000-000000000003";
  fs.mkdirSync(path.join(sourcesRoot, id), { recursive: true });
  fs.writeFileSync(path.join(sourcesRoot, id, "source.yml"), stringifyYaml({
    schemaVersion: 1, id: "018f4d1e-0000-7000-8000-000000000099", path: "docs/x/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "a".repeat(64), confirmedContentHash: "b".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000002" }
  }));
  const result = checkSchema({ planningRoot });
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((f) => f.includes("does not match its directory")));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/commands/tests/check.test.mjs`
Expected: FAIL — the first case fails because `sources/` isn't checked at all yet, so it's not actually exercised (no assertion failure) but the second case's expected `FAIL`/finding won't appear since nothing inspects `sources/` yet, so `result.status` stays `"PASS"` and the `assert.equal(result.status, "FAIL")` fails.

- [ ] **Step 3: Write minimal implementation**

In `runtime/src/commands/check.mjs`, add a `sources/` block mirroring the existing `scopes/` block, right after it (after the closing brace of the `if (fs.existsSync(scopesRoot))` block, currently ending around line 68):

```js
  const sourcesRoot = path.join(planningRoot, "sources");
  if (fs.existsSync(sourcesRoot)) {
    for (const sourceId of fs.readdirSync(sourcesRoot)) {
      if (!isUuidV7(sourceId)) {
        findings.push(`sources/${sourceId}: not a valid source id`);
        continue;
      }
      const sourceEntryPath = path.join(sourcesRoot, sourceId);
      const sourceStat = fs.lstatSync(sourceEntryPath);
      if (sourceStat.isSymbolicLink()) {
        findings.push(`sources/${sourceId}: symlink entries are not permitted`);
        continue;
      }
      if (!sourceStat.isDirectory()) {
        findings.push(`sources/${sourceId}: entry must be a directory`);
        continue;
      }
      const beforeCount = findings.length;
      checkRequiredFile(planningRoot, path.join("sources", sourceId, "source.yml"), "source", findings);
      if (findings.length === beforeCount) {
        const sourceFile = confineWritePath(planningRoot, path.join("sources", sourceId, "source.yml"));
        const source = parseYaml(fs.readFileSync(sourceFile, "utf8"));
        if (source.id !== sourceId) {
          findings.push(`sources/${sourceId}/source.yml: source.id ${source.id} does not match its directory`);
        }
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/commands/tests/check.test.mjs`
Expected: PASS. Then run `npm run test:unit` for full regression.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/commands/check.mjs runtime/src/commands/tests/check.test.mjs
git commit -m "feat(discovery): validate sources/<id>/source.yml in check schema"
```

---

### Task 14: `discover` skill doc

**Files:**
- Create: `skills/discover/SKILL.md`

- [ ] **Step 1: Write the file**

```markdown
---
description: Read-only discovery scan of the host repository (git, scope candidates, source candidates, drift).
argument-hint: scan [--max-source-bytes <bytes>]
disable-model-invocation: true
allowed-tools: Bash(shipping-mode discover:*)
---

Use `shipping-mode discover scan [--max-source-bytes <bytes>]` to get a
read-only, deterministic report of the host repository: git branch/remote
detection, candidate scopes (folders with manifest signals), candidate
sources (by family, with mechanical rule provenance only — never a
confirmed classification), and drift for already-confirmed sources/scope
commands against the live workspace.

This command never writes to `.planning/` and never requires the workspace
lock. It produces a `ScanResult` JSON object on stdout for you to interpret;
turning any of it into confirmed `.planning` state is a separate, later
capability (`discover propose`, not yet implemented) that goes through the
same ChangeSet `propose → validate → approve → apply` cycle as every other
mutation in this plugin. Do not write `sources/**` or a scope's `commands`
field directly — there is no supported way to do that yet, and there never
will be one that bypasses ChangeSet.
```

- [ ] **Step 2: Commit**

```bash
git add skills/discover/SKILL.md
git commit -m "docs(discovery): add discover skill doc for the read-only scan command"
```

---

### Task 15: Full regression and Plan 1 Definition of Done

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `npm run build:schemas && npm run test:unit`
Expected: all test files pass, including every new file added in Tasks 1-13.

- [ ] **Step 2: Run the full runtime build and bundle checks**

Run: `npm run build:runtime && npm run test:bundle`
Expected: bundle builds successfully and stays self-contained (no new accidental dependency — `fingerprint.mjs`/`discoverScan.mjs` only use `node:*` builtins and existing internal modules).

- [ ] **Step 3: Run the existing e2e and next-generation verification**

Run: `npm run test:cli-e2e && npm run verify:next-generation`
Expected: both pass unchanged — this plan added a new CLI command and two new schemas but did not touch the ChangeSet engine, lock, journal, or recovery machinery, so no existing e2e/crash behavior should change.

- [ ] **Step 4: Confirm repo hygiene**

Run: `git status --short` and `git diff --stat develop...HEAD` (or `feat/discovery-iteration...HEAD` if that's the merge-base branch)
Expected: no stray temp files; the diff only touches the files listed in Tasks 1-14 plus generated artifacts (`runtime/src/generated/validators.mjs`).

- [ ] **Step 5: Definition of Done checklist**

- [ ] `computeFileFingerprint`/`computeDirectoryFingerprint`/`computeSourceFingerprint` pass every case in H.1 of the design doc that applies to this plan (single-file identity, multiplicity, symlink text-vs-content, path collision, invalid UTF-8 is exercised implicitly by the collision/manifest code path — add one more explicit test now if Task 2 didn't already cover an isolated invalid-UTF-8 symlink-target case; if it's missing, add it before checking this box).
- [ ] `discover scan` never writes to `.planning/` under any code path (confirm by grepping `runtime/src/lib/discoverScan.mjs` and `runtime/src/commands/discover.mjs` for any `writeFileSync`/`writeFileAtomic`/`ensureDirectoryTree` call — there should be none).
- [ ] `source.schema.json` and the `scope.schema.json` `commands` extension both compile cleanly via `npm run build:schemas`.
- [ ] `check schema` covers `sources/**` the same way it covers `scopes/**`.
- [ ] No new npm dependency was added (`git diff develop...HEAD -- package.json package-lock.json` is empty, or only reflects an unrelated lockfile refresh if one was already pending).
- [ ] This plan does not introduce any new ChangeSet `kind`, does not modify `changeset.mjs`, `mutation.mjs`, `lock.mjs`, `journal.mjs`, or `recovery.mjs` — confirm with `git diff --stat` against the base branch.
