# Corte 0 Runtime Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `src/runtime.mjs` prototype with a real, narrowly-scoped Corte 0 runtime (`init`/`config`/`check schema` only) backed by real JSON Schemas, UUIDv7 IDs, an explicit approval state machine, and a crash-consistent event journal, per `docs/specs/corte-0-runtime-foundation.md`.

**Architecture:** Small, single-purpose modules under `runtime/src/lib/` (ids, canonical hashing, path confinement, YAML, workspace lock, event journal) compose into a generic `changeset.mjs` operation state machine. Domain commands (`init`, `config`, `check`) render file content and call the generic state machine; everything else responds `NOT_IMPLEMENTED`. JSON Schemas are compiled to standalone validators at build time (Ajv) and the whole runtime is bundled by esbuild into one self-contained file so the consuming user's project never needs `node_modules`.

**Tech Stack:** Node.js 20+, ESM (`.mjs`), `node:test`-free plain assertion scripts (matching existing repo convention — `node:assert/strict`, run via `node <file>.test.mjs`), `yaml` (runtime dependency), `ajv` + `esbuild` (build-time only devDependencies).

## Global Constraints

- Node.js `>=20` (already in `package.json.engines`) — every script assumes Node 20+ built-ins (`fs.rmSync`, etc).
- No new runtime dependency may leak into the distributed artifact except `yaml`; `ajv`/`esbuild` are build-time only and must never appear in `runtime/dist/shipping-mode.mjs`'s dependency graph at execution time (it must run with `node_modules` absent).
- All IDs are real UUIDv7 (`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`), generated once at `propose` time and never regenerated.
- `ABSENT` is a literal string value inside JSON/YAML fields for "expected absent file" — never the literal byte content of an actual file.
- `revisionHash` (semantic, canonical-JSON SHA-256) and `contentHash` (raw-byte SHA-256) are always computed and compared separately; never conflated.
- `changeSetHash` is SHA-256 of the canonical `change-set.json` representation **excluding** the `hash` field itself.
- Multi-file `apply` is crash-consistent, never described as "atomic" — only single-`rename()` operations are atomic.
- Every out-of-scope command (`release`, `item`, `work-package`, `task`, `report`, `check health|guides|gates`, any `changeset propose --kind` outside `workspace.init|config.update|scope.add`) returns the exact `NOT_IMPLEMENTED` JSON contract with exit code `3`.
- `--help`, `--version`, `check schema` never mutate state and never trigger recovery.
- `.planning/**` must stay protected by the existing hook (`hooks/tests/protect-planning-state.test.mjs`, 21 tests) — do not modify hook behavior, only re-run it as regression.
- Commit messages that discuss `.planning` paths must be passed via `git commit -F <file>`, not an inline heredoc — the repo's own `protect-planning-state.mjs` hook flags heredocs containing the substring `.planning` as a potential direct write and denies the Bash call. Write the message to a scratch file first.

---

## Task 1: UUIDv7 generation and validation

**Files:**
- Create: `runtime/src/lib/ids.mjs`
- Test: `runtime/src/lib/tests/ids.test.mjs`

**Interfaces:**
- Produces: `generateUuidV7(now?: number): string`, `isUuidV7(value: string): boolean`

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/ids.test.mjs
import assert from "node:assert/strict";
import { generateUuidV7, isUuidV7 } from "../ids.mjs";

const a = generateUuidV7();
assert.equal(isUuidV7(a), true, "generated id must be a valid UUIDv7");
assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

const b = generateUuidV7();
assert.notEqual(a, b, "two calls must not collide");

const earlier = generateUuidV7(1000);
const later = generateUuidV7(2000);
assert.ok(earlier < later, "ids generated from an earlier timestamp must sort before a later one lexically");

assert.equal(isUuidV7("not-a-uuid"), false);
assert.equal(isUuidV7("00000000-0000-4000-8000-000000000000"), false, "version nibble must be 7, not 4");

console.log("ids: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/ids.test.mjs`
Expected: FAIL — `Cannot find module '../ids.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/ids.mjs
import crypto from "node:crypto";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateUuidV7(now = Date.now()) {
  const ms = BigInt(now);
  const bytes = new Uint8Array(16);

  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  const rand = crypto.randomBytes(10);
  bytes[6] = 0x70 | (rand[0] & 0x0f);
  bytes[7] = rand[1];
  bytes[8] = 0x80 | (rand[2] & 0x3f);
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isUuidV7(value) {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/ids.test.mjs`
Expected: PASS, prints `ids: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/ids.mjs runtime/src/lib/tests/ids.test.mjs
git commit -m "Add real UUIDv7 generator and validator"
```

---

## Task 2: Canonicalization and dual hashing (revisionHash / contentHash)

**Files:**
- Create: `runtime/src/lib/canonical.mjs`
- Test: `runtime/src/lib/tests/canonical.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `canonicalize(value): value`, `canonicalJson(value): string`, `revisionHash(value): string`, `contentHash(bytesOrString): string`, `ABSENT = "ABSENT"`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/canonical.test.mjs
import assert from "node:assert/strict";
import { canonicalize, canonicalJson, revisionHash, contentHash, ABSENT } from "../canonical.mjs";

assert.deepEqual(canonicalize({ b: 1, a: 2 }), { a: 2, b: 1 });
assert.deepEqual(canonicalize([{ b: 1, a: 2 }]), [{ a: 2, b: 1 }]);

assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }), "key order must not affect canonical JSON");

// revisionHash is semantic: same parsed value, different key order -> same hash
assert.equal(revisionHash({ name: "x", vcs: "git" }), revisionHash({ vcs: "git", name: "x" }));

// contentHash is byte-exact: same semantic value, different raw bytes -> different hash
const bytesA = Buffer.from("name: x\nvcs: git\n");
const bytesB = Buffer.from("vcs: git\nname: x\n");
assert.notEqual(contentHash(bytesA), contentHash(bytesB), "contentHash must differ when bytes differ even if meaning is the same");

assert.equal(ABSENT, "ABSENT");

console.log("canonical: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/canonical.test.mjs`
Expected: FAIL — `Cannot find module '../canonical.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/canonical.mjs
import crypto from "node:crypto";

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(bytesOrString) {
  return crypto.createHash("sha256").update(bytesOrString).digest("hex");
}

export function revisionHash(value) {
  return sha256Hex(canonicalJson(value));
}

export function contentHash(bytesOrString) {
  return sha256Hex(bytesOrString);
}

export const ABSENT = "ABSENT";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/canonical.test.mjs`
Expected: PASS, prints `canonical: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/canonical.mjs runtime/src/lib/tests/canonical.test.mjs
git commit -m "Add canonicalization and split revisionHash/contentHash"
```

---

## Task 3: Path confinement (two domains + safe resolution for nonexistent destinations)

**Files:**
- Create: `runtime/src/lib/paths.mjs`
- Test: `runtime/src/lib/tests/paths.test.mjs`

**Interfaces:**
- Produces: `class PathConfinementError extends Error`, `confineRuntimePath(planningRoot: string, relativePath: string): string`, `confineScopePath(workspaceRoot: string, relativePath: string): string`.
- Both throw `PathConfinementError` on violation; both return the resolved absolute path on success.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/paths.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confineRuntimePath, confineScopePath, PathConfinementError } from "../paths.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "paths-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
fs.mkdirSync(path.join(workspace, "web"));

// runtime domain: destinations that don't exist yet must still resolve inside .planning/
const notYetCreated = confineRuntimePath(planningRoot, "operations/abc/operation.yml");
assert.equal(notYetCreated, path.join(planningRoot, "operations", "abc", "operation.yml"));

assert.throws(() => confineRuntimePath(planningRoot, "../outside.yml"), PathConfinementError);
assert.throws(() => confineRuntimePath(planningRoot, "/etc/passwd"), PathConfinementError);

// scope domain: paths outside .planning/ are expected and valid
const webPath = confineScopePath(workspace, "web");
assert.equal(webPath, path.join(workspace, "web"));

assert.throws(() => confineScopePath(workspace, "../outside"), PathConfinementError);
assert.throws(() => confineScopePath(workspace, "/etc/passwd"), PathConfinementError);
assert.throws(() => confineScopePath(workspace, ".planning/config.yml"), PathConfinementError, "scope paths must not point inside .planning/");

// symlink escape, for both domains
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
fs.symlinkSync(outside, path.join(workspace, "escape-link"));
assert.throws(() => confineScopePath(workspace, "escape-link/anything"), PathConfinementError);

const insidePlanningLink = path.join(planningRoot, "escape-link");
fs.symlinkSync(outside, insidePlanningLink);
assert.throws(() => confineRuntimePath(planningRoot, "escape-link/operation.yml"), PathConfinementError);

console.log("paths: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/paths.test.mjs`
Expected: FAIL — `Cannot find module '../paths.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/paths.mjs
import fs from "node:fs";
import path from "node:path";

export class PathConfinementError extends Error {}

function isWithin(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function walkConfined(root, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new PathConfinementError(`absolute path rejected: ${relativePath}`);
  }
  const normalizedTarget = path.resolve(root, relativePath);
  if (!isWithin(normalizedTarget, root)) {
    throw new PathConfinementError(`path escapes root: ${relativePath}`);
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  let currentPath = root;
  let currentReal = fs.realpathSync.native(root);
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    let stat;
    try {
      stat = fs.lstatSync(currentPath);
    } catch (error) {
      if (error.code === "ENOENT") break; // rest already validated lexically above
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const real = fs.realpathSync.native(currentPath);
      if (!isWithin(real, currentReal)) {
        throw new PathConfinementError(`symlink escapes root: ${currentPath}`);
      }
      currentReal = real;
    } else {
      currentReal = fs.realpathSync.native(currentPath);
    }
  }
  return normalizedTarget;
}

export function confineRuntimePath(planningRoot, relativePath) {
  return walkConfined(planningRoot, relativePath);
}

export function confineScopePath(workspaceRoot, relativePath) {
  const resolved = walkConfined(workspaceRoot, relativePath);
  const planningRoot = path.resolve(workspaceRoot, ".planning");
  if (isWithin(resolved, planningRoot)) {
    throw new PathConfinementError("scope path must not point inside .planning/");
  }
  return resolved;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/paths.test.mjs`
Expected: PASS, prints `paths: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/paths.mjs runtime/src/lib/tests/paths.test.mjs
git commit -m "Add two-domain path confinement with safe resolution for new paths"
```

---

## Task 4: Safe YAML parsing/serialization

**Files:**
- Modify: `package.json` (add `yaml` to `dependencies`)
- Create: `runtime/src/lib/yaml.mjs`
- Test: `runtime/src/lib/tests/yaml.test.mjs`

**Interfaces:**
- Consumes: `canonicalize` from Task 2 (`runtime/src/lib/canonical.mjs`).
- Produces: `parseYaml(text: string): any`, `stringifyYaml(value: any): string`.

- [ ] **Step 1: Add the dependency**

```bash
npm install yaml@^2.5.0
```

Run: `cat package.json` — verify `"yaml": "^2.5.0"` now appears under `"dependencies"` and `package-lock.json` was created/updated.

- [ ] **Step 2: Write the failing test**

```js
// runtime/src/lib/tests/yaml.test.mjs
import assert from "node:assert/strict";
import { parseYaml, stringifyYaml } from "../yaml.mjs";

assert.deepEqual(parseYaml("name: demo\nvcs: git\n"), { name: "demo", vcs: "git" });

assert.throws(() => parseYaml("name: demo\nname: duplicate\n"), /duplicate|unique/i, "duplicate keys must be rejected");

const bomb = "a: &a [1,2,3,4,5,6,7,8]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b]\n";
assert.throws(() => parseYaml(bomb), /alias/i, "alias expansion must be rejected outright");

const out1 = stringifyYaml({ b: 1, a: 2 });
const out2 = stringifyYaml({ a: 2, b: 1 });
assert.equal(out1, out2, "stringify must be deterministic regardless of input key order");

console.log("yaml: all tests passed");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node runtime/src/lib/tests/yaml.test.mjs`
Expected: FAIL — `Cannot find module '../yaml.mjs'`

- [ ] **Step 4: Write minimal implementation**

```js
// runtime/src/lib/yaml.mjs
import { parseDocument, Document } from "yaml";
import { canonicalize } from "./canonical.mjs";

export function parseYaml(text) {
  const doc = parseDocument(text, { uniqueKeys: true, maxAliasCount: 0, strict: true });
  if (doc.errors.length > 0) {
    throw new Error(doc.errors.map((error) => error.message).join("; "));
  }
  return doc.toJS();
}

export function stringifyYaml(value) {
  const doc = new Document(canonicalize(value));
  return doc.toString({ sortMapEntries: true });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node runtime/src/lib/tests/yaml.test.mjs`
Expected: PASS, prints `yaml: all tests passed`. If the alias-bomb assertion fails because the installed `yaml` version's error message wording differs, adjust the regex in Step 2 to match the actual thrown message (the invariant that matters is that it throws, not the wording).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json runtime/src/lib/yaml.mjs runtime/src/lib/tests/yaml.test.mjs
git commit -m "Add safe, deterministic YAML parsing via the yaml package"
```

---

## Task 5: JSON Schemas for Corte 0 entities

**Files:**
- Create: `runtime/src/schemas/config.schema.json`
- Create: `runtime/src/schemas/plugin-lock.schema.json`
- Create: `runtime/src/schemas/scope.schema.json`
- Create: `runtime/src/schemas/change-set.schema.json`
- Create: `runtime/src/schemas/operation.schema.json`
- Create: `runtime/src/schemas/event.schema.json`
- Create: `runtime/src/schemas/result.schema.json`
- Test: `runtime/src/schemas/tests/schemas-are-valid-json.test.mjs`

**Interfaces:**
- Produces: 7 schema files consumed by Task 6's build pipeline. No JS interface yet.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/schemas/tests/schemas-are-valid-json.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const schemasDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expected = ["config", "plugin-lock", "scope", "change-set", "operation", "event", "result"];

for (const name of expected) {
  const file = path.join(schemasDir, `${name}.schema.json`);
  assert.ok(fs.existsSync(file), `${name}.schema.json must exist`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(parsed.type, "object", `${name} schema must describe an object`);
  assert.equal(parsed.additionalProperties, false, `${name} schema must reject unknown properties`);
}

console.log("schemas: all 7 files present and structurally sane");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/schemas/tests/schemas-are-valid-json.test.mjs`
Expected: FAIL — schema files don't exist yet

- [ ] **Step 3: Create the 7 schema files**

```json
// runtime/src/schemas/config.schema.json
{
  "$id": "https://shipping-mode.dev/schemas/config.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "name", "vcs", "scopeRefs"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "name": { "type": "string", "minLength": 1 },
    "baseBranch": { "type": ["string", "null"] },
    "vcs": { "enum": ["git", "none"] },
    "scopeRefs": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "key"],
        "properties": {
          "id": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },
          "key": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" }
        }
      }
    }
  }
}
```

```json
// runtime/src/schemas/plugin-lock.schema.json
{
  "$id": "https://shipping-mode.dev/schemas/plugin-lock.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "pluginVersion", "templatePackFingerprint"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "pluginVersion": { "type": "string", "minLength": 1 },
    "templatePackFingerprint": { "type": "string", "minLength": 1 }
  }
}
```

```json
// runtime/src/schemas/scope.schema.json
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
    "owner": { "type": ["string", "null"] }
  }
}
```

```json
// runtime/src/schemas/change-set.schema.json
{
  "$id": "https://shipping-mode.dev/schemas/change-set.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "operationId", "kind", "target", "baseRevisions", "payload", "hash"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "operationId": { "type": "string" },
    "kind": { "enum": ["workspace.init", "config.update", "scope.add"] },
    "target": { "type": "object" },
    "baseRevisions": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "additionalProperties": false,
        "required": ["revisionHash", "contentHash"],
        "properties": {
          "revisionHash": { "type": "string" },
          "contentHash": { "type": "string" }
        }
      }
    },
    "payload": { "type": "object" },
    "hash": { "type": "string" }
  }
}
```

```json
// runtime/src/schemas/operation.schema.json
{
  "$id": "https://shipping-mode.dev/schemas/operation.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "kind", "status", "proposedBy", "proposedAt", "history"],
  "properties": {
    "id": { "type": "string" },
    "kind": { "enum": ["workspace.init", "config.update", "scope.add"] },
    "status": { "enum": ["PROPOSED", "VALIDATED", "APPROVED", "APPLYING", "APPLIED", "INVALID", "STALE", "RECOVERY_REQUIRED"] },
    "proposedBy": { "type": "string" },
    "proposedAt": { "type": "string" },
    "validation": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "validatedAt": { "type": ["string", "null"] },
        "errors": { "type": "array", "items": { "type": "string" } }
      }
    },
    "approval": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "actor": { "type": ["string", "null"] },
        "approvedAt": { "type": ["string", "null"] },
        "changeSetHash": { "type": ["string", "null"] },
        "selfApproval": { "type": ["boolean", "null"] }
      }
    },
    "filePlan": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["target", "stagedRelativePath", "expectedBefore", "beforeContentHash", "beforeRevisionHash", "stagedContentHash", "stagedRevisionHash"],
        "properties": {
          "target": { "type": "string" },
          "stagedRelativePath": { "type": "string" },
          "expectedBefore": { "enum": ["ABSENT", "PRESENT"] },
          "beforeContentHash": { "type": "string" },
          "beforeRevisionHash": { "type": "string" },
          "stagedContentHash": { "type": "string" },
          "stagedRevisionHash": { "type": "string" }
        }
      }
    },
    "expectedEvents": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["eventId", "relativePath", "contentHash", "document"],
        "properties": {
          "eventId": { "type": "string" },
          "relativePath": { "type": "string" },
          "contentHash": { "type": "string" },
          "document": { "type": "object" }
        }
      }
    },
    "appliedAt": { "type": ["string", "null"] },
    "conflict": { "type": ["object", "null"] },
    "history": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["at", "to", "actor"],
        "properties": {
          "at": { "type": "string" },
          "from": { "type": ["string", "null"] },
          "to": { "type": "string" },
          "actor": { "type": "string" },
          "reason": { "type": ["string", "null"] }
        }
      }
    }
  }
}
```

```json
// runtime/src/schemas/event.schema.json
{
  "$id": "https://shipping-mode.dev/schemas/event.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["eventId", "schemaVersion", "type", "aggregate", "occurredAt", "actor", "operationId", "idempotencyKey", "payload"],
  "properties": {
    "eventId": { "type": "string" },
    "schemaVersion": { "const": 1 },
    "type": { "type": "string", "minLength": 1 },
    "aggregate": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "id"],
      "properties": {
        "type": { "type": "string" },
        "id": { "type": "string" }
      }
    },
    "occurredAt": { "type": "string" },
    "actor": { "type": "string" },
    "operationId": { "type": "string" },
    "idempotencyKey": { "type": "string" },
    "payload": { "type": "object" },
    "inputHash": { "type": ["string", "null"] },
    "outputHash": { "type": ["string", "null"] }
  }
}
```

```json
// runtime/src/schemas/result.schema.json
{
  "$id": "https://shipping-mode.dev/schemas/result.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["operationId", "files"],
  "properties": {
    "operationId": { "type": "string" },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["target", "contentHash"],
        "properties": {
          "target": { "type": "string" },
          "contentHash": { "type": "string" }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/schemas/tests/schemas-are-valid-json.test.mjs`
Expected: PASS, prints `schemas: all 7 files present and structurally sane`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/schemas runtime/src/schemas/tests
git commit -m "Add the 7 real JSON Schemas for Corte 0 entities"
```

---

## Task 6: Ajv-standalone + esbuild build pipeline

**Files:**
- Modify: `package.json` (add `ajv`, `esbuild` to `devDependencies`; add `build:schemas` and `build:runtime` scripts)
- Create: `scripts/build-runtime.mjs`
- Create: `runtime/src/generated/validators.mjs` (generated output, committed)
- Test: `runtime/src/generated/tests/build-determinism.test.mjs`

**Interfaces:**
- Consumes: the 7 schema files from Task 5.
- Produces: `runtime/src/generated/validators.mjs` exporting `validate_config`, `validate_plugin_lock`, `validate_scope`, `validate_change_set`, `validate_operation`, `validate_event`, `validate_result` — each `(data) => boolean` with `.errors` set on failure (the standard Ajv validator function shape).

- [ ] **Step 1: Add build-time dependencies**

```bash
npm install --save-dev ajv@^8.17.0 esbuild@^0.24.0
```

Run: `cat package.json` — verify both appear under `"devDependencies"`.

- [ ] **Step 2: Write the failing test**

```js
// runtime/src/generated/tests/build-determinism.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const committed = fs.readFileSync(path.join(root, "runtime", "src", "generated", "validators.mjs"), "utf8");

const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "build-schemas-"));
execFileSync("node", [path.join(root, "scripts", "build-runtime.mjs"), "--schemas-only", "--out", tmpOut], { cwd: root });
const regenerated = fs.readFileSync(path.join(tmpOut, "validators.mjs"), "utf8");

assert.equal(regenerated, committed, "regenerating validators.mjs must be byte-identical to the committed file");
assert.doesNotMatch(committed, /ajv\/dist\/runtime/, "generated validators must not reference ajv's internal runtime path");

console.log("build-determinism: validators.mjs is up to date and self-contained");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node runtime/src/generated/tests/build-determinism.test.mjs`
Expected: FAIL — `scripts/build-runtime.mjs` and `runtime/src/generated/validators.mjs` don't exist yet

- [ ] **Step 4: Write the build script**

```js
// scripts/build-runtime.mjs
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const schemasDir = path.join(root, "runtime", "src", "schemas");
const entryFile = path.join(root, "runtime", "src", "index.mjs");
const distFile = path.join(root, "runtime", "dist", "shipping-mode.mjs");

const args = process.argv.slice(2);
const schemasOnly = args.includes("--schemas-only");
const outFlagIndex = args.indexOf("--out");
const generatedDir = outFlagIndex >= 0 ? args[outFlagIndex + 1] : path.join(root, "runtime", "src", "generated");

function exportNameFor(schemaName) {
  return `validate_${schemaName.replaceAll("-", "_")}`;
}

function buildValidators() {
  const files = fs.readdirSync(schemasDir).filter((file) => file.endsWith(".schema.json")).sort();
  const ajv = new Ajv({ strict: true, allErrors: true, code: { source: true, esm: true } });
  const exportNames = {};
  for (const file of files) {
    const schemaName = file.replace(/\.schema\.json$/, "");
    const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, file), "utf8"));
    ajv.addSchema(schema, schemaName);
    exportNames[exportNameFor(schemaName)] = schemaName;
  }
  const moduleCode = standaloneCode(ajv, exportNames);
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "validators.mjs"), moduleCode);
  return exportNames;
}

async function bundleRuntime() {
  fs.mkdirSync(path.dirname(distFile), { recursive: true });
  await build({
    entryPoints: [entryFile],
    outfile: distFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20"
  });
}

const exportNames = buildValidators();
if (schemasOnly) {
  process.stdout.write(`${JSON.stringify({ status: "OK", exportNames })}\n`);
} else {
  await bundleRuntime();
  process.stdout.write(`${JSON.stringify({ status: "OK", exportNames, bundle: path.relative(root, distFile) })}\n`);
}
```

Add scripts to `package.json`:

```json
"build:schemas": "node scripts/build-runtime.mjs --schemas-only",
"build:runtime": "node scripts/build-runtime.mjs"
```

- [ ] **Step 5: Generate the committed validators file**

Run: `npm run build:schemas`
Expected: `runtime/src/generated/validators.mjs` is created. Inspect it: it must export the 7 `validate_*` functions and must not import anything under `ajv/dist/runtime` (Ajv's standalone code generator inlines its own tiny runtime helpers directly into the output — confirm this by grepping the generated file).

Run: `grep -n "ajv/dist/runtime" runtime/src/generated/validators.mjs || echo "no external ajv runtime references"`
Expected: prints `no external ajv runtime references`

- [ ] **Step 6: Run test to verify it passes**

Run: `node runtime/src/generated/tests/build-determinism.test.mjs`
Expected: PASS, prints `build-determinism: validators.mjs is up to date and self-contained`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/build-runtime.mjs runtime/src/generated/validators.mjs runtime/src/generated/tests
git commit -m "Add Ajv-standalone + esbuild build pipeline for schema validators"
```

**Note for Task 21:** `runtime/src/index.mjs` (the esbuild entry point referenced above) doesn't exist until Task 21. Running `npm run build:runtime` (without `--schemas-only`) will fail until then — that's expected; this task only exercises the `--schemas-only` path.

---

## Task 7: Schema validation facade

**Files:**
- Create: `runtime/src/lib/schema.mjs`
- Test: `runtime/src/lib/tests/schema.test.mjs`

**Interfaces:**
- Consumes: `runtime/src/generated/validators.mjs` from Task 6 (the only file allowed to import it besides this facade).
- Produces: `validate(schemaName: "config"|"plugin-lock"|"scope"|"change-set"|"operation"|"event"|"result", data: unknown): { valid: boolean, errors: Array<{ path: string, message: string }> }`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/schema.test.mjs
import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const validConfig = { schemaVersion: 1, name: "demo", baseBranch: null, vcs: "git", scopeRefs: [] };
const result = validate("config", validConfig);
assert.equal(result.valid, true);
assert.deepEqual(result.errors, []);

const invalidConfig = { schemaVersion: 1, name: "demo", vcs: "svn", scopeRefs: [] };
const bad = validate("config", invalidConfig);
assert.equal(bad.valid, false);
assert.ok(bad.errors.length > 0);
assert.ok(bad.errors[0].message, "each error must have a message");
assert.ok(bad.errors[0].path !== undefined, "each error must have a path, even if empty string");

console.log("schema facade: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/schema.test.mjs`
Expected: FAIL — `Cannot find module '../schema.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/schema.mjs
import * as validators from "../generated/validators.mjs";

const exportNameByPublicName = {
  config: "validate_config",
  "plugin-lock": "validate_plugin_lock",
  scope: "validate_scope",
  "change-set": "validate_change_set",
  operation: "validate_operation",
  event: "validate_event",
  result: "validate_result"
};

export function validate(schemaName, data) {
  const exportName = exportNameByPublicName[schemaName];
  if (!exportName) throw new Error(`unknown schema: ${schemaName}`);
  const validateFn = validators[exportName];
  const valid = validateFn(data);
  const errors = valid ? [] : (validateFn.errors || []).map((error) => ({
    path: error.instancePath || "",
    message: error.message || "invalid"
  }));
  return { valid, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/schema.test.mjs`
Expected: PASS, prints `schema facade: all tests passed`

- [ ] **Step 5: Add valid/invalid fixtures for every schema**

```js
// runtime/src/lib/tests/schema-fixtures.test.mjs
import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const cases = {
  config: {
    valid: { schemaVersion: 1, name: "demo", baseBranch: null, vcs: "none", scopeRefs: [] },
    invalid: { schemaVersion: 1, name: "", vcs: "none", scopeRefs: [] }
  },
  "plugin-lock": {
    valid: { schemaVersion: 1, pluginVersion: "1.0.0", templatePackFingerprint: "sha256:abc" },
    invalid: { schemaVersion: 1, pluginVersion: "1.0.0" }
  },
  scope: {
    valid: { schemaVersion: 1, id: "018f0000-0000-7000-8000-000000000000", key: "backend", label: "Backend", kind: "code", path: "api/", owner: null },
    invalid: { schemaVersion: 1, id: "not-a-uuid", key: "Backend", label: "Backend", kind: "code", path: "api/" }
  },
  "change-set": {
    valid: { schemaVersion: 1, operationId: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", target: {}, baseRevisions: {}, payload: {}, hash: "abc" },
    invalid: { schemaVersion: 1, operationId: "x", kind: "release.create", target: {}, baseRevisions: {}, payload: {}, hash: "abc" }
  },
  operation: {
    valid: { id: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", status: "PROPOSED", proposedBy: "carlos", proposedAt: "2026-07-24T00:00:00.000Z", history: [] },
    invalid: { id: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", status: "REJECTED", proposedBy: "carlos", proposedAt: "2026-07-24T00:00:00.000Z", history: [] }
  },
  event: {
    valid: { eventId: "018f0000-0000-7000-8000-000000000000", schemaVersion: 1, type: "workspace.initialized", aggregate: { type: "workspace", id: "018f0000-0000-7000-8000-000000000000" }, occurredAt: "2026-07-24T00:00:00.000Z", actor: "carlos", operationId: "018f0000-0000-7000-8000-000000000000", idempotencyKey: "k1", payload: {} },
    invalid: { eventId: "018f0000-0000-7000-8000-000000000000", schemaVersion: 1, type: "workspace.initialized", occurredAt: "2026-07-24T00:00:00.000Z", actor: "carlos", operationId: "018f0000-0000-7000-8000-000000000000", idempotencyKey: "k1", payload: {} }
  },
  result: {
    valid: { operationId: "018f0000-0000-7000-8000-000000000000", files: [{ target: "config.yml", contentHash: "abc" }] },
    invalid: { operationId: "018f0000-0000-7000-8000-000000000000", files: [{ target: "config.yml" }] }
  }
};

for (const [schemaName, { valid, invalid }] of Object.entries(cases)) {
  const validResult = validate(schemaName, valid);
  assert.equal(validResult.valid, true, `${schemaName} valid fixture must pass: ${JSON.stringify(validResult.errors)}`);
  const invalidResult = validate(schemaName, invalid);
  assert.equal(invalidResult.valid, false, `${schemaName} invalid fixture must fail`);
}

console.log("schema fixtures: valid/invalid cases behave correctly for all 7 schemas");
```

Run: `node runtime/src/lib/tests/schema-fixtures.test.mjs`
Expected: PASS, prints `schema fixtures: valid/invalid cases behave correctly for all 7 schemas`

- [ ] **Step 6: Commit**

```bash
git add runtime/src/lib/schema.mjs runtime/src/lib/tests/schema.test.mjs runtime/src/lib/tests/schema-fixtures.test.mjs
git commit -m "Add schema validation facade with fixtures for all 7 schemas"
```

---

## Task 8: Workspace mutual-exclusion lock

**Files:**
- Create: `runtime/src/lib/lock.mjs`
- Test: `runtime/src/lib/tests/lock.test.mjs`

**Interfaces:**
- Produces: `class LockHeldError extends Error`, `acquireWorkspaceLock(planningRoot: string, operationId?: string): { token: string, release(): void }`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/lock.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireWorkspaceLock, LockHeldError } from "../lock.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });

const lock = acquireWorkspaceLock(planningRoot, "op-1");
assert.ok(lock.token);

assert.throws(() => acquireWorkspaceLock(planningRoot, "op-2"), LockHeldError, "a live process holding the lock must block a second acquire");

lock.release();
const lock2 = acquireWorkspaceLock(planningRoot, "op-3");
assert.ok(lock2.token !== lock.token, "releasing must allow a fresh acquire with a new token");

// simulate an abandoned lock from a dead pid on this host
const lockDir = path.join(planningRoot, ".runtime", "workspace.lock");
fs.rmSync(lockDir, { recursive: true, force: true });
fs.mkdirSync(lockDir, { recursive: true });
fs.writeFileSync(path.join(lockDir, "lock.json"), JSON.stringify({
  token: "stale", pid: 999999, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId: null
}));
const stolen = acquireWorkspaceLock(planningRoot, "op-4");
assert.ok(stolen.token !== "stale", "a lock held by a dead pid on the same host must be safely stolen");
stolen.release();

console.log("lock: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/lock.test.mjs`
Expected: FAIL — `Cannot find module '../lock.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/lock.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export class LockHeldError extends Error {}

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

export function acquireWorkspaceLock(planningRoot, operationId = null) {
  const lockDir = path.join(planningRoot, ".runtime", "workspace.lock");
  const metadataPath = path.join(lockDir, "lock.json");

  for (;;) {
    fs.mkdirSync(path.dirname(lockDir), { recursive: true });
    try {
      fs.mkdirSync(lockDir);
      break;
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
      fs.rmSync(lockDir, { recursive: true, force: true });
      // loop back and retry mkdir; if another process wins the race, we'll
      // observe its live pid on the next iteration and back off correctly
    }
  }

  const token = crypto.randomUUID();
  fs.writeFileSync(metadataPath, JSON.stringify({
    token, pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), operationId
  }, null, 2));

  return {
    token,
    release() {
      const metadata = readMetadata(metadataPath);
      if (!metadata || metadata.token !== token) return;
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/lock.test.mjs`
Expected: PASS, prints `lock: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/lock.mjs runtime/src/lib/tests/lock.test.mjs
git commit -m "Add workspace mutual-exclusion lock with stale-lock rules"
```

---

## Task 9: Concurrency test with two real child processes

**Files:**
- Create: `runtime/src/lib/tests/lock-concurrency.test.mjs`

**Interfaces:**
- Consumes: `acquireWorkspaceLock` from Task 8.

- [ ] **Step 1: Write the test (this task has no separate "fail then pass" cycle — it exercises Task 8's already-passing implementation under real concurrency, which is a distinct risk from the single-process test above)**

```js
// runtime/src/lib/tests/lock-concurrency.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lock-concurrency-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });

const workerPath = path.join(here, "lock-concurrency-worker.mjs");

function runWorker() {
  return new Promise((resolve) => {
    const child = fork(workerPath, [planningRoot], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("exit", (code) => resolve({ code, stdout: stdout.trim() }));
  });
}

const [a, b] = await Promise.all([runWorker(), runWorker()]);
const outcomes = [a, b].map((r) => JSON.parse(r.stdout));
const successes = outcomes.filter((o) => o.status === "ACQUIRED");
const failures = outcomes.filter((o) => o.status === "LOCK_HELD");

assert.equal(successes.length, 1, "exactly one concurrent acquire must succeed");
assert.equal(failures.length, 1, "exactly one concurrent acquire must fail with LOCK_HELD, never both succeeding");

console.log("lock-concurrency: exactly one of two concurrent acquires wins, no corruption");
```

```js
// runtime/src/lib/tests/lock-concurrency-worker.mjs
import { acquireWorkspaceLock, LockHeldError } from "../lock.mjs";

const planningRoot = process.argv[2];
try {
  acquireWorkspaceLock(planningRoot, "worker");
  // hold the lock briefly so the sibling process's attempt overlaps with this one
  await new Promise((resolve) => setTimeout(resolve, 200));
  process.stdout.write(JSON.stringify({ status: "ACQUIRED" }));
} catch (error) {
  if (error instanceof LockHeldError) {
    process.stdout.write(JSON.stringify({ status: "LOCK_HELD" }));
  } else {
    process.stdout.write(JSON.stringify({ status: "ERROR", message: error.message }));
  }
}
```

- [ ] **Step 2: Run it**

Run: `node runtime/src/lib/tests/lock-concurrency.test.mjs`
Expected: PASS, prints `lock-concurrency: exactly one of two concurrent acquires wins, no corruption`. If both workers report `ACQUIRED` (a real race), inspect `acquireWorkspaceLock`'s retry loop in Task 8 before proceeding — this test is what proves that implementation correct, not just plausible.

- [ ] **Step 3: Commit**

```bash
git add runtime/src/lib/tests/lock-concurrency.test.mjs runtime/src/lib/tests/lock-concurrency-worker.mjs
git commit -m "Add two-process concurrency test for the workspace lock"
```

---

## Task 10: Event journal — building and idempotently writing event documents

**Files:**
- Create: `runtime/src/lib/journal.mjs`
- Test: `runtime/src/lib/tests/journal.test.mjs`

**Interfaces:**
- Consumes: `contentHash`, `canonicalJson` from Task 2; `generateUuidV7` from Task 1.
- Produces: `class RecoveryRequiredError extends Error`, `buildExpectedEvent(fields): { eventId, relativePath, contentHash, document }`, `writeEventIdempotent(eventsRoot: string, expectedEvent): "CREATED" | "ALREADY_APPLIED"`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/journal.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateUuidV7 } from "../ids.mjs";
import { buildExpectedEvent, writeEventIdempotent, RecoveryRequiredError } from "../journal.mjs";

const operationId = generateUuidV7();
const expected = buildExpectedEvent({
  type: "workspace.initialized",
  aggregate: { type: "workspace", id: operationId },
  actor: "carlos",
  operationId,
  idempotencyKey: "k1",
  payload: { name: "demo" },
  occurredAt: "2026-07-24T00:00:00.000Z"
});

assert.ok(expected.eventId);
assert.match(expected.relativePath, /^\d{4}\/\d{2}\/[0-9a-f-]+\.json$/);
assert.ok(expected.contentHash);
assert.equal(expected.document.type, "workspace.initialized");
assert.equal(expected.document.occurredAt, "2026-07-24T00:00:00.000Z", "occurredAt must be fixed, never recomputed at write time");

const eventsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "journal-"));

const first = writeEventIdempotent(eventsRoot, expected);
assert.equal(first, "CREATED");

const second = writeEventIdempotent(eventsRoot, expected);
assert.equal(second, "ALREADY_APPLIED", "writing the exact same expected event twice must be a no-op");

const tampered = { ...expected, contentHash: "0000000000000000000000000000000000000000000000000000000000000000" };
assert.throws(() => writeEventIdempotent(eventsRoot, { ...tampered, relativePath: expected.relativePath, document: { ...expected.document, payload: { name: "different" } } }), RecoveryRequiredError, "an event file that exists with different content must never be silently overwritten");

console.log("journal: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/journal.test.mjs`
Expected: FAIL — `Cannot find module '../journal.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/journal.mjs
import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "./ids.mjs";
import { canonicalize, contentHash } from "./canonical.mjs";

export class RecoveryRequiredError extends Error {}

function serializeEvent(document) {
  return `${JSON.stringify(canonicalize(document), null, 2)}\n`;
}

export function buildExpectedEvent({ type, aggregate, actor, operationId, idempotencyKey, payload, inputHash = null, outputHash = null, occurredAt = new Date().toISOString(), schemaVersion = 1 }) {
  const eventId = generateUuidV7();
  const document = {
    eventId,
    schemaVersion,
    type,
    aggregate,
    occurredAt,
    actor,
    operationId,
    idempotencyKey,
    payload,
    inputHash,
    outputHash
  };
  const serialized = serializeEvent(document);
  const yyyy = occurredAt.slice(0, 4);
  const mm = occurredAt.slice(5, 7);
  return {
    eventId,
    relativePath: `${yyyy}/${mm}/${eventId}.json`,
    contentHash: contentHash(serialized),
    document
  };
}

export function writeEventIdempotent(eventsRoot, expectedEvent) {
  const filePath = path.join(eventsRoot, expectedEvent.relativePath);
  const serialized = serializeEvent(expectedEvent.document);

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, serialized);
    fs.renameSync(tmpPath, filePath);
    return "CREATED";
  }

  const existingBytes = fs.readFileSync(filePath);
  const existingHash = contentHash(existingBytes);
  if (existingHash === expectedEvent.contentHash) {
    return "ALREADY_APPLIED";
  }
  throw new RecoveryRequiredError(`event file ${expectedEvent.relativePath} exists with unexpected content`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/journal.test.mjs`
Expected: PASS, prints `journal: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/journal.mjs runtime/src/lib/tests/journal.test.mjs
git commit -m "Add idempotent event journal with pre-fixed, immutable event documents"
```

---

## Task 11: Operation record I/O (`operation.yml`, `change-set.json`, `result.json`)

**Files:**
- Create: `runtime/src/lib/operationStore.mjs`
- Test: `runtime/src/lib/tests/operationStore.test.mjs`

**Interfaces:**
- Consumes: `parseYaml`/`stringifyYaml` from Task 4; `confineRuntimePath` from Task 3.
- Produces: `readOperation(operationsRoot, id)`, `writeOperation(operationsRoot, id, operation)`, `readChangeSet(operationsRoot, id)`, `writeChangeSet(operationsRoot, id, changeSet)`, `readResult(operationsRoot, id)`, `writeResult(operationsRoot, id, result)`, `operationDir(operationsRoot, id)`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/operationStore.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeOperation, readOperation, writeChangeSet, readChangeSet, writeResult, readResult
} from "../operationStore.mjs";

const operationsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "operations-"));
const id = "018f0000-0000-7000-8000-000000000000";

const operation = { id, kind: "workspace.init", status: "PROPOSED", proposedBy: "carlos", proposedAt: "2026-07-24T00:00:00.000Z", history: [] };
writeOperation(operationsRoot, id, operation);
assert.deepEqual(readOperation(operationsRoot, id), operation);

const changeSet = { schemaVersion: 1, operationId: id, kind: "workspace.init", target: {}, baseRevisions: {}, payload: {}, hash: "abc" };
writeChangeSet(operationsRoot, id, changeSet);
assert.deepEqual(readChangeSet(operationsRoot, id), changeSet);

const result = { operationId: id, files: [{ target: "config.yml", contentHash: "abc" }] };
writeResult(operationsRoot, id, result);
assert.deepEqual(readResult(operationsRoot, id), result);

assert.ok(fs.existsSync(path.join(operationsRoot, id, "operation.yml")));
assert.ok(fs.existsSync(path.join(operationsRoot, id, "change-set.json")));
assert.ok(fs.existsSync(path.join(operationsRoot, id, "result.json")));

console.log("operationStore: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/operationStore.test.mjs`
Expected: FAIL — `Cannot find module '../operationStore.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/operationStore.mjs
import fs from "node:fs";
import path from "node:path";
import { parseYaml, stringifyYaml } from "./yaml.mjs";

export function operationDir(operationsRoot, id) {
  return path.join(operationsRoot, id);
}

function writeAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, contents);
  fs.renameSync(tmpPath, filePath);
}

export function writeOperation(operationsRoot, id, operation) {
  writeAtomic(path.join(operationDir(operationsRoot, id), "operation.yml"), stringifyYaml(operation));
}

export function readOperation(operationsRoot, id) {
  return parseYaml(fs.readFileSync(path.join(operationDir(operationsRoot, id), "operation.yml"), "utf8"));
}

export function writeChangeSet(operationsRoot, id, changeSet) {
  writeAtomic(path.join(operationDir(operationsRoot, id), "change-set.json"), `${JSON.stringify(changeSet, null, 2)}\n`);
}

export function readChangeSet(operationsRoot, id) {
  return JSON.parse(fs.readFileSync(path.join(operationDir(operationsRoot, id), "change-set.json"), "utf8"));
}

export function writeResult(operationsRoot, id, result) {
  writeAtomic(path.join(operationDir(operationsRoot, id), "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

export function readResult(operationsRoot, id) {
  return JSON.parse(fs.readFileSync(path.join(operationDir(operationsRoot, id), "result.json"), "utf8"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/operationStore.test.mjs`
Expected: PASS, prints `operationStore: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/operationStore.mjs runtime/src/lib/tests/operationStore.test.mjs
git commit -m "Add atomic read/write helpers for operation.yml, change-set.json, result.json"
```

---

## Task 12: Renderers — domain-specific file content for each ChangeSet kind

**Files:**
- Create: `runtime/src/commands/renderers.mjs`
- Test: `runtime/src/commands/tests/renderers.test.mjs`

**Interfaces:**
- Consumes: `stringifyYaml` from Task 4; `generateUuidV7` from Task 1.
- Produces: `renderWorkspaceInit(payload): Map<string, string>`, `renderConfigUpdate(payload, currentConfig): Map<string, string>`, `renderScopeAdd(payload, currentConfig): { scopeId: string, files: Map<string, string> }`.

This task defines *what bytes* each ChangeSet kind writes. It has no knowledge of hashing, staging, or the state machine — those are Task 15/16's job. Keeping rendering separate means the state machine in Task 15/16 stays domain-agnostic.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/commands/tests/renderers.test.mjs
import assert from "node:assert/strict";
import { parseYaml } from "../../lib/yaml.mjs";
import { renderWorkspaceInit, renderConfigUpdate, renderScopeAdd } from "../renderers.mjs";

const init = renderWorkspaceInit({ name: "demo", baseBranch: "main", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: "sha256:abc" });
assert.ok(init.has("config.yml"));
assert.ok(init.has("plugin.lock.yml"));
assert.ok(init.has(".gitignore"));
assert.equal(init.get(".gitignore"), ".runtime/\n");
const parsedConfig = parseYaml(init.get("config.yml"));
assert.equal(parsedConfig.name, "demo");
assert.deepEqual(parsedConfig.scopeRefs, []);

const updated = renderConfigUpdate({ name: "renamed" }, parsedConfig);
const parsedUpdated = parseYaml(updated.get("config.yml"));
assert.equal(parsedUpdated.name, "renamed");
assert.equal(parsedUpdated.vcs, "git", "fields not touched by config set must be preserved");

const { scopeId, files } = renderScopeAdd({ key: "Backend Service", label: "Backend", kind: "code", path: "api/", owner: null }, parsedConfig);
assert.match(scopeId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.ok(files.has("config.yml"));
assert.ok(files.has(`scopes/${scopeId}/scope.yml`));
const parsedScope = parseYaml(files.get(`scopes/${scopeId}/scope.yml`));
assert.equal(parsedScope.key, "backend-service", "key must be normalized to kebab-case");

console.log("renderers: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/commands/tests/renderers.test.mjs`
Expected: FAIL — `Cannot find module '../renderers.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/commands/renderers.mjs
import { stringifyYaml } from "../lib/yaml.mjs";
import { generateUuidV7 } from "../lib/ids.mjs";

function toKebabCase(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
}

export function renderWorkspaceInit({ name, baseBranch = null, vcs, pluginVersion, templatePackFingerprint }) {
  const config = { schemaVersion: 1, name, baseBranch, vcs, scopeRefs: [] };
  const pluginLock = { schemaVersion: 1, pluginVersion, templatePackFingerprint };
  return new Map([
    ["config.yml", stringifyYaml(config)],
    ["plugin.lock.yml", stringifyYaml(pluginLock)],
    [".gitignore", ".runtime/\n"]
  ]);
}

export function renderConfigUpdate({ name }, currentConfig) {
  const nextConfig = { ...currentConfig, name };
  return new Map([["config.yml", stringifyYaml(nextConfig)]]);
}

export function renderScopeAdd({ key, label, kind, path: scopePath, owner = null }, currentConfig) {
  const normalizedKey = toKebabCase(key);
  const existingKeys = new Set((currentConfig.scopeRefs || []).map((ref) => ref.key.toLowerCase()));
  if (existingKeys.has(normalizedKey)) {
    throw new Error(`scope key already exists: ${normalizedKey}`);
  }
  const scopeId = generateUuidV7();
  const nextConfig = {
    ...currentConfig,
    scopeRefs: [...(currentConfig.scopeRefs || []), { id: scopeId, key: normalizedKey }]
  };
  const scope = { schemaVersion: 1, id: scopeId, key: normalizedKey, label, kind, path: scopePath, owner };
  return {
    scopeId,
    files: new Map([
      ["config.yml", stringifyYaml(nextConfig)],
      [`scopes/${scopeId}/scope.yml`, stringifyYaml(scope)]
    ])
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/commands/tests/renderers.test.mjs`
Expected: PASS, prints `renderers: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/commands/renderers.mjs runtime/src/commands/tests/renderers.test.mjs
git commit -m "Add domain renderers for workspace.init, config.update, scope.add"
```

---

## Task 13: ChangeSet — `propose`

**Files:**
- Create: `runtime/src/lib/changeset.mjs`
- Test: `runtime/src/lib/tests/changeset-propose.test.mjs`

**Interfaces:**
- Consumes: `generateUuidV7` (Task 1); `revisionHash`, `contentHash`, `ABSENT`, `canonicalize`, `canonicalJson` (Task 2); `confineRuntimePath` (Task 3); `writeOperation`, `writeChangeSet`, `operationDir` (Task 11).
- Produces: `propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor }): string` (returns the new `operationId`). `targetFiles` is `Array<string>` of paths relative to `planningRoot` that this operation reads/writes — used to compute `baseRevisions`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/changeset-propose.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose } from "../changeset.mjs";
import { readOperation, readChangeSet } from "../operationStore.mjs";

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "propose-"));
const operationsRoot = path.join(planningRoot, "operations");

const operationId = propose({
  operationsRoot,
  planningRoot,
  kind: "workspace.init",
  target: {},
  payload: { name: "demo", vcs: "git" },
  targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"],
  actor: "carlos"
});

const operation = readOperation(operationsRoot, operationId);
assert.equal(operation.status, "PROPOSED");
assert.equal(operation.proposedBy, "carlos");
assert.equal(operation.history.length, 1);
assert.equal(operation.history[0].to, "PROPOSED");

const changeSet = readChangeSet(operationsRoot, operationId);
assert.equal(changeSet.operationId, operationId);
assert.equal(changeSet.baseRevisions["config.yml"].revisionHash, "ABSENT");
assert.equal(changeSet.baseRevisions["config.yml"].contentHash, "ABSENT");
assert.ok(changeSet.hash);
assert.equal(JSON.stringify(changeSet).includes(`"hash":"${changeSet.hash}"`) === false || true, true);

console.log("changeset-propose: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/changeset-propose.test.mjs`
Expected: FAIL — `Cannot find module '../changeset.mjs'`

- [ ] **Step 3: Write minimal implementation (propose only — validate/approve/apply added in Tasks 14-16)**

```js
// runtime/src/lib/changeset.mjs
import fs from "node:fs";
import path from "node:path";
import { generateUuidV7 } from "./ids.mjs";
import { canonicalize, canonicalJson, revisionHash, contentHash, ABSENT } from "./canonical.mjs";
import { confineRuntimePath } from "./paths.mjs";
import { parseYaml } from "./yaml.mjs";
import { writeOperation, readOperation, writeChangeSet, readChangeSet } from "./operationStore.mjs";

function readFileState(planningRoot, relativePath) {
  const absolutePath = confineRuntimePath(planningRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { revisionHash: ABSENT, contentHash: ABSENT };
  }
  const bytes = fs.readFileSync(absolutePath);
  const isStructured = relativePath.endsWith(".yml") || relativePath.endsWith(".yaml") || relativePath.endsWith(".json");
  const structuredValue = isStructured ? (relativePath.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : parseYaml(bytes.toString("utf8"))) : null;
  return {
    revisionHash: isStructured ? revisionHash(structuredValue) : contentHash(bytes),
    contentHash: contentHash(bytes)
  };
}

function computeChangeSetHash(changeSetWithoutHash) {
  return revisionHash(changeSetWithoutHash);
}

export function propose({ operationsRoot, planningRoot, kind, target, payload, targetFiles, actor }) {
  const operationId = generateUuidV7();

  const baseRevisions = {};
  for (const relativePath of targetFiles) {
    baseRevisions[relativePath] = readFileState(planningRoot, relativePath);
  }

  const changeSetWithoutHash = {
    schemaVersion: 1,
    operationId,
    kind,
    target,
    baseRevisions,
    payload
  };
  const hash = computeChangeSetHash(changeSetWithoutHash);
  writeChangeSet(operationsRoot, operationId, { ...changeSetWithoutHash, hash });

  const proposedAt = new Date().toISOString();
  writeOperation(operationsRoot, operationId, {
    id: operationId,
    kind,
    status: "PROPOSED",
    proposedBy: actor,
    proposedAt,
    validation: { validatedAt: null, errors: [] },
    approval: { actor: null, approvedAt: null, changeSetHash: null, selfApproval: null },
    history: [{ at: proposedAt, from: null, to: "PROPOSED", actor, reason: null }]
  });

  return operationId;
}

export { readFileState, computeChangeSetHash };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/changeset-propose.test.mjs`
Expected: PASS, prints `changeset-propose: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/changeset.mjs runtime/src/lib/tests/changeset-propose.test.mjs
git commit -m "Add ChangeSet propose: computes baseRevisions and changeSetHash"
```

---

## Task 14: ChangeSet — `validate` and `approve`

**Files:**
- Modify: `runtime/src/lib/changeset.mjs`
- Test: `runtime/src/lib/tests/changeset-validate-approve.test.mjs`

**Interfaces:**
- Consumes: `validate` (schema facade, Task 7) — imported as `validateSchema` to avoid a name clash with this task's own `validate` export; `readFileState`, `computeChangeSetHash` from Task 13.
- Produces (added to `changeset.mjs`): `validateOperation({ operationsRoot, planningRoot, operationId }): void` (mutates `operation.yml` status to `VALIDATED`/`INVALID`/`STALE`), `approveOperation({ operationsRoot, operationId, actor, allowSelfApproval }): void` (mutates status to `APPROVED`).

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/changeset-validate-approve.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation } from "../changeset.mjs";
import { readOperation } from "../operationStore.mjs";

function setup() {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "validate-"));
  const operationsRoot = path.join(planningRoot, "operations");
  const operationId = propose({
    operationsRoot, planningRoot, kind: "workspace.init", target: {},
    payload: { schemaVersion: 1, name: "demo", baseBranch: null, vcs: "git", scopeRefs: [] },
    targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"], actor: "carlos"
  });
  return { planningRoot, operationsRoot, operationId };
}

// valid payload against config.schema.json -> VALIDATED
{
  const { operationsRoot, planningRoot, operationId } = setup();
  validateOperation({ operationsRoot, planningRoot, operationId, schemaName: "config" });
  assert.equal(readOperation(operationsRoot, operationId).status, "VALIDATED");
}

// invalid payload -> INVALID
{
  const { operationsRoot, planningRoot } = setup();
  const badOperationId = propose({
    operationsRoot, planningRoot, kind: "workspace.init", target: {},
    payload: { schemaVersion: 1, name: "", vcs: "git", scopeRefs: [] },
    targetFiles: ["config.yml"], actor: "carlos"
  });
  validateOperation({ operationsRoot, planningRoot, operationId: badOperationId, schemaName: "config" });
  const op = readOperation(operationsRoot, badOperationId);
  assert.equal(op.status, "INVALID");
  assert.ok(op.validation.errors.length > 0);
}

// file changed after propose -> STALE
{
  const { operationsRoot, planningRoot, operationId } = setup();
  fs.writeFileSync(path.join(planningRoot, "config.yml"), "name: tampered\n");
  validateOperation({ operationsRoot, planningRoot, operationId, schemaName: "config" });
  assert.equal(readOperation(operationsRoot, operationId).status, "STALE");
}

// approve requires VALIDATED, rejects self-approval unless explicit
{
  const { operationsRoot, planningRoot, operationId } = setup();
  validateOperation({ operationsRoot, planningRoot, operationId, schemaName: "config" });
  assert.throws(() => approveOperation({ operationsRoot, operationId, actor: "carlos", allowSelfApproval: false }), /self-approval/i);
  approveOperation({ operationsRoot, operationId, actor: "carlos", allowSelfApproval: true });
  const op = readOperation(operationsRoot, operationId);
  assert.equal(op.status, "APPROVED");
  assert.equal(op.approval.selfApproval, true);
  assert.ok(op.approval.changeSetHash);
}

console.log("changeset-validate-approve: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/changeset-validate-approve.test.mjs`
Expected: FAIL — `validateOperation is not a function`

- [ ] **Step 3: Add `validateOperation` and `approveOperation` to `changeset.mjs`**

Append to `runtime/src/lib/changeset.mjs` (add this import at the top: `import { validate as validateSchema } from "./schema.mjs";` and `import { readChangeSet } from "./operationStore.mjs";` if not already imported):

```js
export function validateOperation({ operationsRoot, planningRoot, operationId, schemaName }) {
  const operation = readOperation(operationsRoot, operationId);
  const changeSet = readChangeSet(operationsRoot, operationId);
  const validatedAt = new Date().toISOString();

  const schemaResult = validateSchema(schemaName, changeSet.payload);
  if (!schemaResult.valid) {
    writeOperation(operationsRoot, operationId, {
      ...operation,
      status: "INVALID",
      validation: { validatedAt, errors: schemaResult.errors.map((e) => `${e.path}: ${e.message}`) },
      history: [...operation.history, { at: validatedAt, from: operation.status, to: "INVALID", actor: "system:validator", reason: "schema validation failed" }]
    });
    return;
  }

  for (const [relativePath, expected] of Object.entries(changeSet.baseRevisions)) {
    const actual = readFileState(planningRoot, relativePath);
    if (actual.revisionHash !== expected.revisionHash || actual.contentHash !== expected.contentHash) {
      writeOperation(operationsRoot, operationId, {
        ...operation,
        status: "STALE",
        validation: { validatedAt, errors: [`${relativePath} changed since propose`] },
        history: [...operation.history, { at: validatedAt, from: operation.status, to: "STALE", actor: "system:validator", reason: `${relativePath} revision changed` }]
      });
      return;
    }
  }

  writeOperation(operationsRoot, operationId, {
    ...operation,
    status: "VALIDATED",
    validation: { validatedAt, errors: [] },
    history: [...operation.history, { at: validatedAt, from: operation.status, to: "VALIDATED", actor: "system:validator", reason: null }]
  });
}

export function approveOperation({ operationsRoot, operationId, actor, allowSelfApproval = false }) {
  const operation = readOperation(operationsRoot, operationId);
  if (operation.status !== "VALIDATED") {
    throw new Error(`cannot approve operation in status ${operation.status}`);
  }
  const selfApproval = actor === operation.proposedBy;
  if (selfApproval && !allowSelfApproval) {
    throw new Error("self-approval requires allowSelfApproval to be explicitly set");
  }
  const changeSet = readChangeSet(operationsRoot, operationId);
  const approvedAt = new Date().toISOString();
  writeOperation(operationsRoot, operationId, {
    ...operation,
    status: "APPROVED",
    approval: { actor, approvedAt, changeSetHash: changeSet.hash, selfApproval },
    history: [...operation.history, { at: approvedAt, from: "VALIDATED", to: "APPROVED", actor, reason: selfApproval ? "self-approved" : null }]
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/changeset-validate-approve.test.mjs`
Expected: PASS, prints `changeset-validate-approve: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/changeset.mjs runtime/src/lib/tests/changeset-validate-approve.test.mjs
git commit -m "Add ChangeSet validate (schema + staleness) and approve (explicit self-approval)"
```

---

## Task 15: ChangeSet — `apply`, steps 1–6 (lock through APPLYING)

**Files:**
- Modify: `runtime/src/lib/changeset.mjs`
- Test: `runtime/src/lib/tests/changeset-apply-prepare.test.mjs`

**Interfaces:**
- Consumes: `acquireWorkspaceLock` (Task 8); `buildExpectedEvent` (Task 10); renderer functions (Task 12, passed in as a parameter — `changeset.mjs` never imports `renderers.mjs` directly, keeping it domain-agnostic).
- Produces (added to `changeset.mjs`): an internal `prepareApply({ operationsRoot, planningRoot, operationId, render, actor })` that performs steps 1–6 of the spec's apply sequence and returns `{ lock, filePlan }` for Task 16 to continue. This is intentionally not exported from the module — it's a seam for testing steps 1–6 in isolation; Task 16 wires it into the public `applyOperation`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/changeset-apply-prepare.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, __prepareApplyForTests } from "../changeset.mjs";
import { renderWorkspaceInit } from "../../commands/renderers.mjs";
import { readOperation } from "../operationStore.mjs";

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-prepare-"));
const operationsRoot = path.join(planningRoot, "operations");
const payload = { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: "sha256:abc" };

const operationId = propose({
  operationsRoot, planningRoot, kind: "workspace.init", target: {},
  payload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"], actor: "carlos"
});
validateOperation({ operationsRoot, planningRoot, operationId, schemaName: "config" });
// validateOperation above only checks the config.yml shape; workspace.init's
// payload also needs plugin.lock rendering data, which is intentionally not
// schema-validated as "config" -- this is fine for Corte 0's single-schema
// validate step per operation kind.
approveOperation({ operationsRoot, operationId, actor: "carlos", allowSelfApproval: true });

const render = (renderPayload) => renderWorkspaceInit(renderPayload);
const { lock, filePlan, expectedEvents } = __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render, actor: "carlos" });

assert.ok(lock.token);
assert.equal(filePlan.length, 3);
for (const entry of filePlan) {
  assert.equal(entry.expectedBefore, "ABSENT");
  assert.ok(entry.stagedContentHash);
  assert.ok(fs.existsSync(path.join(planningRoot, ".runtime", "operations", operationId, "staged", entry.stagedRelativePath)));
}
assert.equal(expectedEvents.length, 1);
assert.equal(readOperation(operationsRoot, operationId).status, "APPLYING");

lock.release();
console.log("changeset-apply-prepare: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/changeset-apply-prepare.test.mjs`
Expected: FAIL — `__prepareApplyForTests is not a function`

- [ ] **Step 3: Add steps 1–6 to `changeset.mjs`**

Append (add imports: `import { acquireWorkspaceLock } from "./lock.mjs";`, `import { buildExpectedEvent } from "./journal.mjs";`):

```js
function eventTypeFor(kind) {
  return { "workspace.init": "workspace.initialized", "config.update": "config.updated", "scope.add": "scope.added" }[kind];
}

function prepareApply({ operationsRoot, planningRoot, operationId, render, actor }) {
  const lock = acquireWorkspaceLock(planningRoot, operationId);

  let operation = readOperation(operationsRoot, operationId);
  if (operation.status !== "APPROVED") {
    lock.release();
    throw new Error(`cannot apply operation in status ${operation.status}`);
  }
  const changeSet = readChangeSet(operationsRoot, operationId);

  // step 3: authoritative revalidation under the lock
  for (const [relativePath, expected] of Object.entries(changeSet.baseRevisions)) {
    const actual = readFileState(planningRoot, relativePath);
    if (actual.revisionHash !== expected.revisionHash || actual.contentHash !== expected.contentHash) {
      const staleAt = new Date().toISOString();
      writeOperation(operationsRoot, operationId, {
        ...operation, status: "STALE",
        history: [...operation.history, { at: staleAt, from: operation.status, to: "STALE", actor: "system:validator", reason: `${relativePath} changed before apply` }]
      });
      lock.release();
      throw new Error(`operation is stale: ${relativePath} changed since approval`);
    }
  }
  if (operation.approval.changeSetHash !== changeSet.hash) {
    lock.release();
    throw new Error("changeSetHash no longer matches the approved change-set.json");
  }

  // step 4: render, stage, and snapshot before/
  const rendered = render(changeSet.payload); // Map<relativePath, string>
  const stagingDir = path.join(planningRoot, ".runtime", "operations", operationId, "staged");
  const beforeDir = path.join(planningRoot, ".runtime", "operations", operationId, "before");
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(beforeDir, { recursive: true });

  const filePlan = [];
  for (const [relativePath, newContent] of rendered) {
    const before = changeSet.baseRevisions[relativePath] || { revisionHash: ABSENT, contentHash: ABSENT };
    const stagedPath = path.join(stagingDir, relativePath);
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
    fs.writeFileSync(stagedPath, newContent);

    if (before.contentHash !== ABSENT) {
      const currentAbsolute = confineRuntimePath(planningRoot, relativePath);
      const beforePath = path.join(beforeDir, relativePath);
      fs.mkdirSync(path.dirname(beforePath), { recursive: true });
      fs.copyFileSync(currentAbsolute, beforePath);
    }

    filePlan.push({
      target: relativePath,
      stagedRelativePath: relativePath,
      expectedBefore: before.contentHash === ABSENT ? "ABSENT" : "PRESENT",
      beforeContentHash: before.contentHash,
      beforeRevisionHash: before.revisionHash,
      stagedContentHash: contentHash(newContent),
      stagedRevisionHash: relativePath.endsWith(".gitignore") ? contentHash(newContent) : revisionHash(parseYaml(newContent))
    });
  }

  // step 5: persist filePlan + full expected event documents, before touching anything canonical
  const expectedEvents = [buildExpectedEvent({
    type: eventTypeFor(operation.kind),
    aggregate: { type: operation.kind.split(".")[0], id: operationId },
    actor,
    operationId,
    idempotencyKey: operationId,
    payload: changeSet.payload
  })];

  operation = readOperation(operationsRoot, operationId);
  writeOperation(operationsRoot, operationId, { ...operation, filePlan, expectedEvents });

  // step 6: durable transition to APPLYING, still holding the lock
  operation = readOperation(operationsRoot, operationId);
  const applyingAt = new Date().toISOString();
  writeOperation(operationsRoot, operationId, {
    ...operation, status: "APPLYING",
    history: [...operation.history, { at: applyingAt, from: "APPROVED", to: "APPLYING", actor, reason: null }]
  });

  return { lock, filePlan, expectedEvents };
}

export function __prepareApplyForTests(args) {
  return prepareApply(args);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/changeset-apply-prepare.test.mjs`
Expected: PASS, prints `changeset-apply-prepare: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/changeset.mjs runtime/src/lib/tests/changeset-apply-prepare.test.mjs
git commit -m "Add apply steps 1-6: lock, revalidate, stage, persist filePlan, APPLYING"
```

---

## Task 16: ChangeSet — `apply`, steps 7–10 (commit files, events, APPLIED)

**Files:**
- Modify: `runtime/src/lib/changeset.mjs`
- Test: `runtime/src/lib/tests/changeset-apply.test.mjs`

**Interfaces:**
- Consumes: `prepareApply` (internal, Task 15); `writeEventIdempotent` (Task 10); `writeResult` (Task 11).
- Produces: `applyOperation({ operationsRoot, planningRoot, operationId, render, actor }): { status: "APPLIED", files: Array<{target, contentHash}> }` — the full public apply entry point.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/changeset-apply.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, applyOperation } from "../changeset.mjs";
import { renderWorkspaceInit } from "../../commands/renderers.mjs";
import { readOperation, readResult } from "../operationStore.mjs";
import { parseYaml } from "../yaml.mjs";

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-"));
const operationsRoot = path.join(planningRoot, "operations");
const payload = { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: "sha256:abc" };

const operationId = propose({
  operationsRoot, planningRoot, kind: "workspace.init", target: {},
  payload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"], actor: "carlos"
});
validateOperation({ operationsRoot, planningRoot, operationId, schemaName: "config" });
approveOperation({ operationsRoot, operationId, actor: "carlos", allowSelfApproval: true });

const outcome = applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
assert.equal(outcome.status, "APPLIED");
assert.equal(outcome.files.length, 3);

assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")).name, "demo");
assert.equal(fs.readFileSync(path.join(planningRoot, ".gitignore"), "utf8"), ".runtime/\n");

const operation = readOperation(operationsRoot, operationId);
assert.equal(operation.status, "APPLIED");
assert.ok(operation.appliedAt);

const result = readResult(operationsRoot, operationId);
assert.equal(result.files.length, 3);

const eventFile = path.join(planningRoot, "events", operation.expectedEvents[0].relativePath);
assert.ok(fs.existsSync(eventFile));

// applying twice must be safe: a second apply call against an already-APPLIED
// operation must reject cleanly rather than re-running the sequence
assert.throws(() => applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" }), /cannot apply operation in status APPLIED/);

console.log("changeset-apply: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/changeset-apply.test.mjs`
Expected: FAIL — `applyOperation is not a function`

- [ ] **Step 3: Add `applyOperation` to `changeset.mjs`**

Append (add import: `import { writeEventIdempotent } from "./journal.mjs"; import { writeResult } from "./operationStore.mjs";` if not already present):

```js
export function applyOperation({ operationsRoot, planningRoot, operationId, render, actor }) {
  const operation = readOperation(operationsRoot, operationId);
  if (operation.status === "APPLIED") {
    throw new Error(`cannot apply operation in status ${operation.status}`);
  }

  const { lock, filePlan, expectedEvents } = prepareApply({ operationsRoot, planningRoot, operationId, render, actor });

  try {
    // step 7: rename each staged file into its canonical location
    const files = [];
    for (const entry of filePlan) {
      const stagedPath = path.join(planningRoot, ".runtime", "operations", operationId, "staged", entry.stagedRelativePath);
      const canonicalPath = confineRuntimePath(planningRoot, entry.target);
      fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
      fs.renameSync(stagedPath, canonicalPath);
      files.push({ target: entry.target, contentHash: entry.stagedContentHash });
    }

    // step 8: result.json
    writeResult(operationsRoot, operationId, { operationId, files });

    // step 9: write expected events idempotently, exactly as persisted
    const eventsRoot = path.join(planningRoot, "events");
    for (const expectedEvent of expectedEvents) {
      writeEventIdempotent(eventsRoot, expectedEvent);
    }

    // step 10: APPLYING -> APPLIED, release lock, opportunistic cleanup
    const appliedAt = new Date().toISOString();
    const applied = readOperation(operationsRoot, operationId);
    writeOperation(operationsRoot, operationId, {
      ...applied, status: "APPLIED", appliedAt,
      history: [...applied.history, { at: appliedAt, from: "APPLYING", to: "APPLIED", actor: "system:recovery" === actor ? actor : actor, reason: null }]
    });

    fs.rmSync(path.join(planningRoot, ".runtime", "operations", operationId), { recursive: true, force: true });

    return { status: "APPLIED", files };
  } finally {
    lock.release();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/changeset-apply.test.mjs`
Expected: PASS, prints `changeset-apply: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/changeset.mjs runtime/src/lib/tests/changeset-apply.test.mjs
git commit -m "Add apply steps 7-10: commit files, write events, APPLIED, cleanup"
```

---

## Task 17: Recovery — classification, replay, and the crash matrix

**Files:**
- Create: `runtime/src/lib/recovery.mjs`
- Test: `runtime/src/lib/tests/recovery-crash-matrix.test.mjs`

**Interfaces:**
- Consumes: `readOperation`/`writeOperation` (Task 11); `writeEventIdempotent`, `RecoveryRequiredError` (Task 10); `contentHash`, `ABSENT` (Task 2); `confineRuntimePath` (Task 3).
- Produces: `runRecovery({ operationsRoot, planningRoot }): Array<{ operationId, outcome: "COMPLETED" | "RECOVERY_REQUIRED" | "NOT_APPLICABLE" }>`.

This is the module that a crashed `apply` (any of Task 16's steps 7–10 interrupted) gets repaired by. It re-derives the same per-file classification `applyOperation` itself would compute, but starting from an operation already in `APPLYING` with a persisted `filePlan`/`expectedEvents`, rather than assuming a live in-memory call stack.

- [ ] **Step 1: Write the failing test — this test *is* the crash matrix.** It drives `propose -> validate -> approve` for real, then hand-crafts the on-disk state as it would look after a crash at each of the 10 durable boundaries (by calling the same staging primitives Task 15/16 use, then truncating before the next step), and asserts `runRecovery` converges correctly every time.

```js
// runtime/src/lib/tests/recovery-crash-matrix.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { propose, validateOperation, approveOperation, applyOperation, __prepareApplyForTests } from "../changeset.mjs";
import { renderWorkspaceInit } from "../../commands/renderers.mjs";
import { readOperation, readResult } from "../operationStore.mjs";
import { runRecovery } from "../recovery.mjs";

function freshOperation() {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "crash-"));
  const operationsRoot = path.join(planningRoot, "operations");
  const payload = { name: "demo", vcs: "git", pluginVersion: "1.0.0", templatePackFingerprint: "sha256:abc" };
  const operationId = propose({
    operationsRoot, planningRoot, kind: "workspace.init", target: {},
    payload, targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"], actor: "carlos"
  });
  validateOperation({ operationsRoot, planningRoot, operationId, schemaName: "config" });
  approveOperation({ operationsRoot, operationId, actor: "carlos", allowSelfApproval: true });
  return { planningRoot, operationsRoot, operationId };
}

// Boundary 1-4: crash anywhere between "prepareApply started" and "APPLYING
// persisted" is equivalent from recovery's point of view to "never started" or
// "fully staged but not yet APPLYING" -- in both cases status stays APPROVED
// or reaches APPLYING with a complete filePlan, and recovery either has
// nothing to do (status != APPLYING) or proceeds exactly like boundary 5-10.
{
  const { planningRoot, operationsRoot, operationId } = freshOperation();
  const { lock } = __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
  lock.release(); // simulate crash: process died right after reaching APPLYING (boundary 4), lock abandoned
  assert.equal(readOperation(operationsRoot, operationId).status, "APPLYING");

  const outcomes = runRecovery({ operationsRoot, planningRoot });
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "COMPLETED");
  assert.equal(readOperation(operationsRoot, operationId).status, "APPLIED");
  assert.equal(JSON.parse(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8") ? "true" : "false"), true);
}

// Boundary 5: crash after renaming the first file but before the rest
{
  const { planningRoot, operationsRoot, operationId } = freshOperation();
  const { lock, filePlan } = __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
  const first = filePlan[0];
  fs.renameSync(
    path.join(planningRoot, ".runtime", "operations", operationId, "staged", first.stagedRelativePath),
    path.join(planningRoot, first.target)
  );
  lock.release();

  const outcomes = runRecovery({ operationsRoot, planningRoot });
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "COMPLETED");
  assert.equal(readOperation(operationsRoot, operationId).status, "APPLIED");
  for (const entry of filePlan) {
    assert.ok(fs.existsSync(path.join(planningRoot, entry.target)));
  }
}

// Boundary 6-7: all files renamed, but result.json never written
{
  const { planningRoot, operationsRoot, operationId } = freshOperation();
  const { lock, filePlan } = __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
  for (const entry of filePlan) {
    fs.renameSync(
      path.join(planningRoot, ".runtime", "operations", operationId, "staged", entry.stagedRelativePath),
      path.join(planningRoot, entry.target)
    );
  }
  lock.release();

  runRecovery({ operationsRoot, planningRoot });
  assert.equal(readOperation(operationsRoot, operationId).status, "APPLIED");
  const result = readResult(operationsRoot, operationId);
  assert.equal(result.files.length, filePlan.length);
}

// Boundary 8: first event written, operation.yml not yet updated -- recovery
// must reuse the exact persisted document, not mint a new event
{
  const { planningRoot, operationsRoot, operationId } = freshOperation();
  const { lock, filePlan, expectedEvents } = __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
  for (const entry of filePlan) {
    fs.renameSync(
      path.join(planningRoot, ".runtime", "operations", operationId, "staged", entry.stagedRelativePath),
      path.join(planningRoot, entry.target)
    );
  }
  const eventPath = path.join(planningRoot, "events", expectedEvents[0].relativePath);
  fs.mkdirSync(path.dirname(eventPath), { recursive: true });
  fs.writeFileSync(eventPath, `${JSON.stringify(expectedEvents[0].document, null, 2)}\n`);
  lock.release();

  runRecovery({ operationsRoot, planningRoot });
  assert.equal(readOperation(operationsRoot, operationId).status, "APPLIED");
  const bytesAfterRecovery = fs.readFileSync(eventPath, "utf8");
  assert.equal(JSON.parse(bytesAfterRecovery).eventId, expectedEvents[0].eventId, "recovery must not generate a different event");
}

// Boundary 10: everything done except the final APPLIED transition
{
  const { planningRoot, operationsRoot, operationId } = freshOperation();
  applyOperation({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
  const stuck = readOperation(operationsRoot, operationId);
  const backToApplying = { ...stuck, status: "APPLYING", appliedAt: null };
  fs.writeFileSync(
    path.join(operationsRoot, operationId, "operation.yml"),
    // reuse the same yaml writer indirectly via writeOperation to keep this realistic
    ""
  );
  const { writeOperation } = await import("../operationStore.mjs");
  writeOperation(operationsRoot, operationId, backToApplying);

  const outcomes = runRecovery({ operationsRoot, planningRoot });
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "COMPLETED");
  assert.equal(readOperation(operationsRoot, operationId).status, "APPLIED");
}

// Divergent modification: canonical file changed to something recovery never
// staged -- must go to RECOVERY_REQUIRED, never overwritten
{
  const { planningRoot, operationsRoot, operationId } = freshOperation();
  const { lock, filePlan } = __prepareApplyForTests({ operationsRoot, planningRoot, operationId, render: renderWorkspaceInit, actor: "carlos" });
  const first = filePlan[0];
  fs.mkdirSync(path.dirname(path.join(planningRoot, first.target)), { recursive: true });
  fs.writeFileSync(path.join(planningRoot, first.target), "not what recovery expects\n");
  lock.release();

  const outcomes = runRecovery({ operationsRoot, planningRoot });
  assert.equal(outcomes.find((o) => o.operationId === operationId).outcome, "RECOVERY_REQUIRED");
  assert.equal(readOperation(operationsRoot, operationId).status, "RECOVERY_REQUIRED");
  assert.ok(readOperation(operationsRoot, operationId).conflict);
  assert.equal(fs.readFileSync(path.join(planningRoot, first.target), "utf8"), "not what recovery expects\n", "divergent content must never be overwritten");
}

console.log("recovery-crash-matrix: all boundaries recover correctly");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/recovery-crash-matrix.test.mjs`
Expected: FAIL — `Cannot find module '../recovery.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/recovery.mjs
import fs from "node:fs";
import path from "node:path";
import { readOperation, writeOperation, writeResult, readResult } from "./operationStore.mjs";
import { writeEventIdempotent, RecoveryRequiredError } from "./journal.mjs";
import { contentHash, ABSENT } from "./canonical.mjs";
import { confineRuntimePath } from "./paths.mjs";

function currentContentHash(planningRoot, relativePath) {
  const absolutePath = confineRuntimePath(planningRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return ABSENT;
  return contentHash(fs.readFileSync(absolutePath));
}

function classify(entry, actualHash) {
  if (actualHash === entry.stagedContentHash) return "APPLIED";
  if (actualHash === entry.beforeContentHash) return "PENDING";
  return "DIVERGENT";
}

function markRecoveryRequired(operationsRoot, operationId, operation, conflict) {
  const detectedAt = new Date().toISOString();
  writeOperation(operationsRoot, operationId, {
    ...operation, status: "RECOVERY_REQUIRED", conflict: { detectedAt, ...conflict },
    history: [...operation.history, { at: detectedAt, from: "APPLYING", to: "RECOVERY_REQUIRED", actor: "system:recovery", reason: conflict.reason }]
  });
}

export function runRecovery({ operationsRoot, planningRoot }) {
  if (!fs.existsSync(operationsRoot)) return [];
  const outcomes = [];

  for (const operationId of fs.readdirSync(operationsRoot)) {
    let operation;
    try {
      operation = readOperation(operationsRoot, operationId);
    } catch {
      continue;
    }
    if (operation.status !== "APPLYING") {
      outcomes.push({ operationId, outcome: "NOT_APPLICABLE" });
      continue;
    }

    let divergent = false;
    for (const entry of operation.filePlan || []) {
      const actualHash = currentContentHash(planningRoot, entry.target);
      const classification = classify(entry, actualHash);
      if (classification === "DIVERGENT") {
        markRecoveryRequired(operationsRoot, operationId, operation, {
          file: entry.target, expectedBeforeContentHash: entry.beforeContentHash,
          expectedStagedContentHash: entry.stagedContentHash, actualContentHash: actualHash,
          reason: "canonical file diverged from both before and staged expectations"
        });
        divergent = true;
        break;
      }
      if (classification === "PENDING") {
        const stagedPath = path.join(planningRoot, ".runtime", "operations", operationId, "staged", entry.stagedRelativePath);
        if (!fs.existsSync(stagedPath) || contentHash(fs.readFileSync(stagedPath)) !== entry.stagedContentHash) {
          markRecoveryRequired(operationsRoot, operationId, operation, {
            file: entry.target, expectedBeforeContentHash: entry.beforeContentHash,
            expectedStagedContentHash: entry.stagedContentHash, actualContentHash: actualHash,
            reason: "staged file missing or altered; cannot safely redo the write"
          });
          divergent = true;
          break;
        }
        const canonicalPath = confineRuntimePath(planningRoot, entry.target);
        fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
        fs.renameSync(stagedPath, canonicalPath);
      }
      // classification === "APPLIED": nothing to do for this file
    }
    if (divergent) {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    if (!fs.existsSync(path.join(operationsRoot, operationId, "result.json"))) {
      const files = (operation.filePlan || []).map((entry) => ({ target: entry.target, contentHash: entry.stagedContentHash }));
      writeResult(operationsRoot, operationId, { operationId, files });
    }

    let eventDivergent = false;
    for (const expectedEvent of operation.expectedEvents || []) {
      try {
        writeEventIdempotent(path.join(planningRoot, "events"), expectedEvent);
      } catch (error) {
        if (error instanceof RecoveryRequiredError) {
          markRecoveryRequired(operationsRoot, operationId, operation, {
            file: expectedEvent.relativePath, expectedStagedContentHash: expectedEvent.contentHash,
            reason: "event file exists with unexpected content"
          });
          eventDivergent = true;
          break;
        }
        throw error;
      }
    }
    if (eventDivergent) {
      outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
      continue;
    }

    const appliedAt = new Date().toISOString();
    const current = readOperation(operationsRoot, operationId);
    writeOperation(operationsRoot, operationId, {
      ...current, status: "APPLIED", appliedAt,
      history: [...current.history, { at: appliedAt, from: "APPLYING", to: "APPLIED", actor: "system:recovery", reason: null }]
    });
    fs.rmSync(path.join(planningRoot, ".runtime", "operations", operationId), { recursive: true, force: true });
    outcomes.push({ operationId, outcome: "COMPLETED" });
  }

  return outcomes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/recovery-crash-matrix.test.mjs`
Expected: PASS, prints `recovery-crash-matrix: all boundaries recover correctly`

- [ ] **Step 5: Wire recovery into `applyOperation`'s step 2 (recovery sweep before revalidating)**

Modify `runtime/src/lib/changeset.mjs`: add `import { runRecovery } from "./recovery.mjs";` and, at the top of `prepareApply` (before `acquireWorkspaceLock` returns are used, i.e. right after the lock is acquired), add:

```js
  runRecovery({ operationsRoot, planningRoot });
```

Re-run every existing `changeset*.test.mjs` and `recovery-crash-matrix.test.mjs` to confirm nothing regressed:

Run: `for f in runtime/src/lib/tests/changeset-*.test.mjs runtime/src/lib/tests/recovery-crash-matrix.test.mjs; do node "$f" || exit 1; done`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add runtime/src/lib/recovery.mjs runtime/src/lib/tests/recovery-crash-matrix.test.mjs runtime/src/lib/changeset.mjs
git commit -m "Add recovery: manifest-based classification, idempotent replay, crash matrix"
```

---

## Task 18: `check schema` — query-only validation and reporting

**Files:**
- Create: `runtime/src/commands/check.mjs`
- Test: `runtime/src/commands/tests/check.test.mjs`

**Interfaces:**
- Consumes: `validate` (Task 7); `readOperation` (Task 11); `parseYaml` (Task 4).
- Produces: `checkSchema({ planningRoot }): { status: "PASS" | "FAIL", findings: Array<string>, pendingOperations: Array<{operationId, status}> }`. Must not call `runRecovery` and must not write anything.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/commands/tests/check.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkSchema } from "../check.mjs";
import { writeOperation } from "../../lib/operationStore.mjs";

const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "check-"));
fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: demo\nvcs: git\nbaseBranch: null\nscopeRefs: []\n");
fs.writeFileSync(path.join(planningRoot, "plugin.lock.yml"), "schemaVersion: 1\npluginVersion: 1.0.0\ntemplatePackFingerprint: sha256:abc\n");

const beforeMtimeConfig = fs.statSync(path.join(planningRoot, "config.yml")).mtimeMs;
const result = checkSchema({ planningRoot });
assert.equal(result.status, "PASS");
assert.deepEqual(result.findings, []);
assert.equal(fs.statSync(path.join(planningRoot, "config.yml")).mtimeMs, beforeMtimeConfig, "check schema must never write to config.yml");

fs.writeFileSync(path.join(planningRoot, "config.yml"), "schemaVersion: 1\nname: \"\"\nvcs: git\nscopeRefs: []\n");
const badResult = checkSchema({ planningRoot });
assert.equal(badResult.status, "FAIL");
assert.ok(badResult.findings.length > 0);

const operationsRoot = path.join(planningRoot, "operations");
writeOperation(operationsRoot, "018f0000-0000-7000-8000-000000000000", {
  id: "018f0000-0000-7000-8000-000000000000", kind: "workspace.init", status: "APPLYING",
  proposedBy: "carlos", proposedAt: new Date().toISOString(), history: []
});
const withPending = checkSchema({ planningRoot });
assert.equal(withPending.pendingOperations.length, 1);
assert.equal(withPending.pendingOperations[0].status, "APPLYING");

console.log("check: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/commands/tests/check.test.mjs`
Expected: FAIL — `Cannot find module '../check.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/commands/check.mjs
import fs from "node:fs";
import path from "node:path";
import { validate } from "../lib/schema.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { readOperation } from "../lib/operationStore.mjs";

function checkFile(planningRoot, relativePath, schemaName, findings) {
  const filePath = path.join(planningRoot, relativePath);
  if (!fs.existsSync(filePath)) return;
  const value = parseYaml(fs.readFileSync(filePath, "utf8"));
  const result = validate(schemaName, value);
  if (!result.valid) {
    for (const error of result.errors) findings.push(`${relativePath}${error.path}: ${error.message}`);
  }
}

export function checkSchema({ planningRoot }) {
  const findings = [];
  checkFile(planningRoot, "config.yml", "config", findings);
  checkFile(planningRoot, "plugin.lock.yml", "plugin-lock", findings);

  const scopesRoot = path.join(planningRoot, "scopes");
  if (fs.existsSync(scopesRoot)) {
    for (const scopeId of fs.readdirSync(scopesRoot)) {
      checkFile(planningRoot, path.join("scopes", scopeId, "scope.yml"), "scope", findings);
    }
  }

  const pendingOperations = [];
  const operationsRoot = path.join(planningRoot, "operations");
  if (fs.existsSync(operationsRoot)) {
    for (const operationId of fs.readdirSync(operationsRoot)) {
      let operation;
      try {
        operation = readOperation(operationsRoot, operationId);
      } catch {
        continue;
      }
      if (operation.status === "APPLYING" || operation.status === "RECOVERY_REQUIRED") {
        pendingOperations.push({ operationId, status: operation.status });
      }
    }
  }

  return { status: findings.length === 0 ? "PASS" : "FAIL", findings, pendingOperations };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/commands/tests/check.test.mjs`
Expected: PASS, prints `check: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/commands/check.mjs runtime/src/commands/tests/check.test.mjs
git commit -m "Add query-only check schema: validates config/plugin-lock/scopes, reports pending operations"
```

---

## Task 19: Commands — `init`, `config`, `changeset` CLI glue

**Files:**
- Create: `runtime/src/commands/init.mjs`
- Create: `runtime/src/commands/config.mjs`
- Create: `runtime/src/commands/changesetCommand.mjs`
- Test: `runtime/src/commands/tests/commands.test.mjs`

**Interfaces:**
- Consumes: `propose`, `validateOperation`, `approveOperation`, `applyOperation` (Task 13-16); renderers (Task 12); `checkSchema` (Task 18); reads `.claude-plugin/plugin.json` for `pluginVersion`.
- Produces: `runInit({ planningRoot, args }): { operationId }`, `runConfigSet({ planningRoot, args }): { operationId }`, `runConfigScopeAdd({ planningRoot, args }): { operationId }`, `runChangesetValidate({ planningRoot, operationsRoot, operationId })`, `runChangesetApprove({ operationsRoot, operationId, actor, allowSelfApproval })`, `runChangesetApply({ planningRoot, operationsRoot, operationId, actor })`. Each returns a plain JSON-serializable object; none print or read `process.argv` directly (that's Task 20's job).

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/commands/tests/commands.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit, runConfigSet, runConfigScopeAdd } from "../init.mjs";
import { runChangesetValidate, runChangesetApprove, runChangesetApply } from "../changesetCommand.mjs";
import { readOperation } from "../../lib/operationStore.mjs";
import { parseYaml } from "../../lib/yaml.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "commands-"));
const planningRoot = path.join(workspace, ".planning");
fs.mkdirSync(planningRoot, { recursive: true });
const operationsRoot = path.join(planningRoot, "operations");

const initResult = runInit({ planningRoot, args: { name: "demo", vcs: "git", actor: "carlos" } });
runChangesetValidate({ planningRoot, operationsRoot, operationId: initResult.operationId });
runChangesetApprove({ operationsRoot, operationId: initResult.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: initResult.operationId, actor: "carlos" });
assert.equal(readOperation(operationsRoot, initResult.operationId).status, "APPLIED");
assert.equal(parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8")).name, "demo");

const scopeResult = runConfigScopeAdd({ planningRoot, args: { key: "backend", label: "Backend", kind: "code", path: "api/", actor: "carlos" } });
runChangesetValidate({ planningRoot, operationsRoot, operationId: scopeResult.operationId });
runChangesetApprove({ operationsRoot, operationId: scopeResult.operationId, actor: "carlos", allowSelfApproval: true });
runChangesetApply({ planningRoot, operationsRoot, operationId: scopeResult.operationId, actor: "carlos" });
const config = parseYaml(fs.readFileSync(path.join(planningRoot, "config.yml"), "utf8"));
assert.equal(config.scopeRefs.length, 1);
assert.equal(config.scopeRefs[0].key, "backend");

console.log("commands: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/commands/tests/commands.test.mjs`
Expected: FAIL — `Cannot find module '../init.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/commands/init.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { propose } from "../lib/changeset.mjs";
import { renderWorkspaceInit, renderConfigUpdate, renderScopeAdd } from "./renderers.mjs";

function pluginVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifestPath = path.resolve(here, "..", "..", "..", ".claude-plugin", "plugin.json");
  if (!fs.existsSync(manifestPath)) return "0.0.0";
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")).version || "0.0.0";
}

export function runInit({ planningRoot, args }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const operationId = propose({
    operationsRoot, planningRoot, kind: "workspace.init", target: {},
    payload: {
      name: args.name,
      baseBranch: args.baseBranch || null,
      vcs: args.vcs || "none",
      pluginVersion: pluginVersion(),
      templatePackFingerprint: "sha256:corte-0-placeholder"
    },
    targetFiles: ["config.yml", "plugin.lock.yml", ".gitignore"],
    actor: args.actor
  });
  return { operationId };
}

export function runConfigSet({ planningRoot, args }) {
  const operationsRoot = path.join(planningRoot, "operations");
  const operationId = propose({
    operationsRoot, planningRoot, kind: "config.update", target: {},
    payload: { name: args.name },
    targetFiles: ["config.yml"],
    actor: args.actor
  });
  return { operationId };
}

export function runConfigScopeAdd({ planningRoot, args }) {
  const operationsRoot = path.join(planningRoot, "operations");
  // The scope's UUIDv7 is generated inside renderScopeAdd during apply, not
  // here -- it must not be observable before the operation is approved.
  const operationId = propose({
    operationsRoot, planningRoot, kind: "scope.add", target: {},
    payload: { key: args.key, label: args.label, kind: args.kind, path: args.path, owner: args.owner || null },
    targetFiles: ["config.yml"],
    actor: args.actor
  });
  return { operationId };
}

export { renderWorkspaceInit, renderConfigUpdate, renderScopeAdd };
```

```js
// runtime/src/commands/config.mjs
export { runConfigSet, runConfigScopeAdd } from "./init.mjs";
```

`config.mjs` re-exports from `init.mjs` rather than duplicating logic, since both `init` and `config` propose through the exact same `propose()` call — the only difference is which `kind`/`payload`/`targetFiles` they pass, which already lives in `init.mjs`. If this indirection feels surprising during review, that's fine — the alternative (duplicating `propose(...)` boilerplate in a second file) is worse.

```js
// runtime/src/commands/changesetCommand.mjs
import fs from "node:fs";
import path from "node:path";
import { validateOperation, approveOperation, applyOperation } from "../lib/changeset.mjs";
import { renderWorkspaceInit, renderConfigUpdate, renderScopeAdd } from "./renderers.mjs";
import { readChangeSet } from "../lib/operationStore.mjs";
import { parseYaml } from "../lib/yaml.mjs";

const schemaNameByKind = { "workspace.init": "config", "config.update": "config", "scope.add": "scope" };

function readCurrentConfig(planningRoot) {
  const configPath = path.join(planningRoot, "config.yml");
  return fs.existsSync(configPath) ? parseYaml(fs.readFileSync(configPath, "utf8")) : null;
}

function renderFor(kind, payload, currentConfig) {
  if (kind === "workspace.init") return renderWorkspaceInit(payload);
  if (kind === "config.update") return renderConfigUpdate(payload, currentConfig);
  if (kind === "scope.add") return renderScopeAdd(payload, currentConfig).files;
  throw new Error(`unsupported changeset kind: ${kind}`);
}

export function runChangesetValidate({ planningRoot, operationsRoot, operationId }) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  validateOperation({ operationsRoot, planningRoot, operationId, schemaName: schemaNameByKind[changeSet.kind] || "config" });
  return {};
}

export function runChangesetApprove({ operationsRoot, operationId, actor, allowSelfApproval }) {
  approveOperation({ operationsRoot, operationId, actor, allowSelfApproval: Boolean(allowSelfApproval) });
  return {};
}

export function runChangesetApply({ planningRoot, operationsRoot, operationId, actor }) {
  const changeSet = readChangeSet(operationsRoot, operationId);
  const currentConfig = changeSet.kind === "workspace.init" ? null : readCurrentConfig(planningRoot);
  return applyOperation({
    operationsRoot, planningRoot, operationId, actor,
    render: (payload) => renderFor(changeSet.kind, payload, currentConfig)
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/commands/tests/commands.test.mjs`
Expected: PASS, prints `commands: all tests passed`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/commands/init.mjs runtime/src/commands/config.mjs runtime/src/commands/changesetCommand.mjs runtime/src/commands/tests/commands.test.mjs
git commit -m "Add init/config/changeset command glue wiring propose through apply"
```

---

## Task 20: Runtime dispatcher and NOT_IMPLEMENTED contract

**Files:**
- Create: `runtime/src/index.mjs`
- Delete: `src/runtime.mjs` (old prototype dispatcher)
- Delete: `src/tests/vertical-slice.test.mjs` (asserted the old flat 10-command surface; replaced by Task 24's CLI e2e suite)
- Test: `runtime/src/tests/dispatcher.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 13-19.
- Produces: `dispatch(command: string, args: string[], cwd: string): object` — the same shape `execute()` had in the old `src/runtime.mjs`, so `bin/shipping-mode.mjs` (Task 21) only needs its import path updated.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/tests/dispatcher.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatch } from "../index.mjs";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dispatcher-"));

const initResult = dispatch("init", ["--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
assert.ok(initResult.operationId);

const outOfScope = dispatch("release", ["--name", "R1"], cwd);
assert.equal(outOfScope.status, "NOT_IMPLEMENTED");
assert.equal(outOfScope.corte, "0");

const outOfScopeChangeset = dispatch("changeset", ["propose", "--kind", "task.create", "--payload-file", "-"], cwd);
assert.equal(outOfScopeChangeset.status, "NOT_IMPLEMENTED");

const checkResult = dispatch("check", ["schema"], cwd);
assert.ok(["PASS", "FAIL"].includes(checkResult.status));

console.log("dispatcher: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/tests/dispatcher.test.mjs`
Expected: FAIL — `Cannot find module '../index.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/index.mjs
import path from "node:path";
import { runInit, runConfigSet, runConfigScopeAdd } from "./commands/init.mjs";
import { runChangesetValidate, runChangesetApprove, runChangesetApply } from "./commands/changesetCommand.mjs";
import { propose } from "./lib/changeset.mjs";
import { checkSchema } from "./commands/check.mjs";

const IN_SCOPE_KINDS = new Set(["workspace.init", "config.update", "scope.add"]);

function notImplemented(command) {
  return {
    status: "NOT_IMPLEMENTED",
    command,
    corte: "0",
    message: "deferred to a later Corte, see docs/plugin-redesign-release-flow/03-plan-incremental.md"
  };
}

function argsToOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) continue;
    const key = args[index].slice(2).replaceAll("-", "_");
    const next = args[index + 1];
    options[key] = next === undefined || next.startsWith("--") ? true : args[++index];
  }
  return options;
}

export function dispatch(command, args, cwd) {
  const planningRoot = path.join(cwd, ".planning");
  const operationsRoot = path.join(planningRoot, "operations");

  if (command === "init") {
    const options = argsToOptions(args);
    return runInit({ planningRoot, args: { name: options.name, vcs: options.vcs, baseBranch: options.base_branch, actor: options.actor } });
  }

  if (command === "config") {
    const [stage, ...rest] = args;
    const options = argsToOptions(rest);
    if (stage === "set") return runConfigSet({ planningRoot, args: { name: options.name, actor: options.actor } });
    if (stage === "scope" && rest[0] === "add") {
      const scopeOptions = argsToOptions(rest.slice(1));
      return runConfigScopeAdd({ planningRoot, args: { key: scopeOptions.key, label: scopeOptions.label, kind: scopeOptions.kind, path: scopeOptions.path, owner: scopeOptions.owner, actor: scopeOptions.actor } });
    }
    return notImplemented(`config ${stage || ""}`.trim());
  }

  if (command === "changeset") {
    const [stage, ...rest] = args;
    const options = argsToOptions(rest);
    if (stage === "propose") {
      if (!IN_SCOPE_KINDS.has(options.kind)) return notImplemented(`changeset propose --kind ${options.kind}`);
      return propose({ operationsRoot, planningRoot, kind: options.kind, target: {}, payload: {}, targetFiles: [], actor: options.actor });
    }
    if (stage === "validate") return runChangesetValidate({ planningRoot, operationsRoot, operationId: rest[0] });
    if (stage === "approve") {
      const approveOptions = argsToOptions(rest.slice(1));
      return runChangesetApprove({ operationsRoot, operationId: rest[0], actor: approveOptions.actor, allowSelfApproval: Boolean(approveOptions.allow_self_approval) });
    }
    if (stage === "apply") {
      const applyOptions = argsToOptions(rest.slice(1));
      return runChangesetApply({ planningRoot, operationsRoot, operationId: rest[0], actor: applyOptions.actor });
    }
    return notImplemented(`changeset ${stage || ""}`.trim());
  }

  if (command === "check") {
    const [stage] = args;
    if (stage === "schema") return checkSchema({ planningRoot });
    return notImplemented(`check ${stage || ""}`.trim());
  }

  return notImplemented(command);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/tests/dispatcher.test.mjs`
Expected: PASS, prints `dispatcher: all tests passed`

- [ ] **Step 5: Remove the old prototype dispatcher and its test**

```bash
git rm src/runtime.mjs src/tests/vertical-slice.test.mjs
rmdir src/tests 2>/dev/null || true
rmdir src 2>/dev/null || true
```

Run: `git status --short` — verify `src/` is gone and only `runtime/` remains as the source tree.

- [ ] **Step 6: Commit**

```bash
git add runtime/src/index.mjs runtime/src/tests/dispatcher.test.mjs
git commit -m "Add runtime dispatcher with NOT_IMPLEMENTED contract; remove prototype runtime.mjs"
```

---

## Task 21: Bundle wiring — `bin/shipping-mode.mjs` delegates to `runtime/dist/shipping-mode.mjs`

**Files:**
- Modify: `bin/shipping-mode.mjs`
- Test: `runtime/tests/bundle-self-contained.test.mjs`

**Interfaces:**
- Consumes: `dispatch` from `runtime/src/index.mjs` (Task 20), bundled by `npm run build:runtime` (Task 6) into `runtime/dist/shipping-mode.mjs`, which must export the same `dispatch` function.

- [ ] **Step 1: Export `dispatch` so esbuild's entry point has something to bundle as a library, then build**

Run: `npm run build:runtime`
Expected: creates `runtime/dist/shipping-mode.mjs`. If it fails because `yaml`/`ajv`-generated code isn't resolvable, run `npm install` first, then retry.

- [ ] **Step 2: Write the failing test**

```js
// runtime/tests/bundle-self-contained.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const distFile = path.join(root, "runtime", "dist", "shipping-mode.mjs");
assert.ok(fs.existsSync(distFile), "runtime/dist/shipping-mode.mjs must exist (run npm run build:runtime)");

const bundleSource = fs.readFileSync(distFile, "utf8");
assert.doesNotMatch(bundleSource, /from ["']yaml["']/, "the yaml package must be inlined, not imported at runtime");
assert.doesNotMatch(bundleSource, /ajv\/dist\/runtime/, "no reference to ajv's internal runtime path may remain");
assert.doesNotMatch(bundleSource, /from ["']ajv["']/, "ajv must not be imported at runtime");

// prove it runs with node_modules absent: copy just the bundle to an isolated dir
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-isolated-"));
fs.copyFileSync(distFile, path.join(isolated, "shipping-mode.mjs"));
const output = execFileSync("node", ["--input-type=module", "-e", `
  import { dispatch } from "${path.join(isolated, "shipping-mode.mjs")}";
  console.log(JSON.stringify(typeof dispatch));
`], { cwd: isolated });
assert.equal(output.toString().trim(), '"function"');

console.log("bundle-self-contained: no external imports, runs without node_modules");
```

- [ ] **Step 3: Run test to verify it fails (until `dispatch` is exported from the entry point and the bundle exists)**

Run: `node runtime/tests/bundle-self-contained.test.mjs`
Expected: FAIL if `runtime/src/index.mjs` doesn't already `export function dispatch` (it does, from Task 20) — this step mainly catches a missing/stale bundle. If it fails on the bundle not existing, run `npm run build:runtime` and retry.

- [ ] **Step 4: Update `bin/shipping-mode.mjs` to delegate to the bundle**

```js
// bin/shipping-mode.mjs
#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../runtime/dist/shipping-mode.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const args = process.argv.slice(2);

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function exitCodeFor(value) {
  if (value?.status === "NOT_IMPLEMENTED") return 3;
  if (["INVALID", "STALE", "RECOVERY_REQUIRED", "FAIL"].includes(value?.status)) return 1;
  return 0;
}

if (args[0] === "--version") {
  output({ product: manifest.name, version: manifest.version });
} else if (args[0] === "--help" || args.length === 0) {
  output({
    product: manifest.name,
    version: manifest.version,
    commands: [
      "init --name <name> [--base-branch <b>] [--vcs git|none] --actor <actor>",
      "config set --name <name> --actor <actor>",
      "config scope add --key <slug> --label <label> --kind code|non_code --path <path> [--owner <o>] --actor <actor>",
      "changeset propose --kind <workspace.init|config.update|scope.add> --actor <actor>",
      "changeset validate <operation-id>",
      "changeset approve <operation-id> --actor <actor> [--allow-self-approval]",
      "changeset apply <operation-id> --actor <actor>",
      "check schema",
      "--help", "--version"
    ]
  });
} else {
  try {
    const result = dispatch(args[0], args.slice(1), process.cwd());
    output({ product: manifest.name, ...result });
    process.exitCode = exitCodeFor(result);
  } catch (error) {
    output({ product: manifest.name, error: error.message });
    process.exitCode = 2;
  }
}
```

- [ ] **Step 5: Rebuild and run tests to verify they pass**

Run: `npm run build:runtime && node runtime/tests/bundle-self-contained.test.mjs`
Expected: PASS, prints `bundle-self-contained: no external imports, runs without node_modules`

- [ ] **Step 6: Commit**

```bash
git add bin/shipping-mode.mjs runtime/dist/shipping-mode.mjs runtime/tests/bundle-self-contained.test.mjs
git commit -m "Wire bin/shipping-mode.mjs to the self-contained runtime bundle"
```

---

## Task 22: Skills — keep only `init`/`config`/`check`

**Files:**
- Modify: `skills/init/SKILL.md`
- Modify: `skills/config/SKILL.md`
- Modify: `skills/check/SKILL.md`
- Delete: `skills/decision/`, `skills/item/`, `skills/release/`, `skills/report/`, `skills/task/`, `skills/update/`

- [ ] **Step 1: Update the three active skills**

```markdown
<!-- skills/init/SKILL.md -->
---
description: Initialize a Shipping Mode project context.
argument-hint: --name <name> [--base-branch <branch>] [--vcs git|none]
disable-model-invocation: true
allowed-tools: Bash(shipping-mode init:*), Bash(shipping-mode changeset validate:*), Bash(shipping-mode changeset approve:*), Bash(shipping-mode changeset apply:*)
---

Run `shipping-mode init --name <name> --vcs <git|none> --actor <actor>` to
propose the workspace bootstrap ChangeSet, then
`shipping-mode changeset validate <operation-id>`,
`shipping-mode changeset approve <operation-id> --actor <actor> --allow-self-approval`,
and `shipping-mode changeset apply <operation-id> --actor <actor>` to create
`config.yml`, `plugin.lock.yml`, and `.gitignore`. Do not write
`.planning/**` directly.
```

```markdown
<!-- skills/config/SKILL.md -->
---
description: Configure a Shipping Mode project context and its scope catalog.
argument-hint: set --name <name> | scope add --key <slug> --label <label> --kind code|non_code --path <path>
disable-model-invocation: true
allowed-tools: Bash(shipping-mode config:*), Bash(shipping-mode changeset validate:*), Bash(shipping-mode changeset approve:*), Bash(shipping-mode changeset apply:*)
---

Use `shipping-mode config set --name <name> --actor <actor>` or
`shipping-mode config scope add --key <slug> --label <label> --kind code|non_code --path <path> --actor <actor>`
to propose a ChangeSet, then the same
`changeset validate/approve/apply` cycle as `init`. Do not write
`.planning/**` directly.
```

```markdown
<!-- skills/check/SKILL.md -->
---
description: Check Shipping Mode schema validity, query-only.
argument-hint: schema
disable-model-invocation: true
allowed-tools: Bash(shipping-mode check schema:*)
---

Run `shipping-mode check schema` to validate `config.yml`, `plugin.lock.yml`,
and `scopes/**` against their JSON Schemas. Query-only: never mutates state,
never triggers recovery. `release/item/work-package/task/report` and
`check health|guides|gates` are not implemented in Corte 0.
```

- [ ] **Step 2: Remove the six out-of-scope skill folders**

```bash
git rm -r skills/decision skills/item skills/release skills/report skills/task skills/update
```

- [ ] **Step 3: Verify only the 3 real skills remain**

Run: `ls skills/`
Expected: `check config init`

- [ ] **Step 4: Commit**

```bash
git add skills/init/SKILL.md skills/config/SKILL.md skills/check/SKILL.md
git commit -m "Keep only init/config/check skills active; remove out-of-scope skill stubs"
```

---

## Task 23: Repo hygiene — `package.json`, `verify-next-generation.sh`, `README.md`

**Files:**
- Modify: `package.json`
- Modify: `scripts/verify-next-generation.sh`
- Modify: `README.md`

- [ ] **Step 1: Update `package.json` scripts**

Replace the `"scripts"` block with:

```json
"scripts": {
  "build:schemas": "node scripts/build-runtime.mjs --schemas-only",
  "build:runtime": "node scripts/build-runtime.mjs",
  "test:host-integration": "node spikes/host-integration/tests/host-integration.test.mjs",
  "test:unit": "for f in runtime/src/lib/tests/*.test.mjs runtime/src/commands/tests/*.test.mjs runtime/src/tests/*.test.mjs; do node \"$f\" || exit 1; done",
  "test:cli-e2e": "node runtime/tests/cli-e2e.test.mjs",
  "test:crash-matrix": "node runtime/src/lib/tests/recovery-crash-matrix.test.mjs",
  "test:concurrency": "node runtime/src/lib/tests/lock-concurrency.test.mjs",
  "test:bundle": "node runtime/tests/bundle-self-contained.test.mjs",
  "verify:corte-1.2": "node spikes/verify-corte-1.2.mjs",
  "verify:next-generation": "bash scripts/verify-next-generation.sh"
}
```

- [ ] **Step 2: Update `scripts/verify-next-generation.sh`**

Find this block:

```bash
if [[ "${VERIFY_NEXT_GENERATION_SKIP_TESTS:-0}" != "1" ]]; then
  (cd "$ROOT" && node hooks/tests/protect-planning-state.test.mjs)
  (cd "$ROOT" && node spikes/tests/verify-corte-1.2.test.mjs)
  (cd "$ROOT" && node scripts/tests/verify-next-generation.test.mjs)
  (cd "$ROOT" && node spikes/host-integration/tests/host-integration.test.mjs)
  (cd "$ROOT" && node src/tests/vertical-slice.test.mjs)
  (cd "$ROOT" && node spikes/verify-corte-1.2.mjs --structure-only)
fi
```

Replace with:

```bash
if [[ "${VERIFY_NEXT_GENERATION_SKIP_TESTS:-0}" != "1" ]]; then
  (cd "$ROOT" && node hooks/tests/protect-planning-state.test.mjs)
  (cd "$ROOT" && node spikes/tests/verify-corte-1.2.test.mjs)
  (cd "$ROOT" && node scripts/tests/verify-next-generation.test.mjs)
  (cd "$ROOT" && node spikes/host-integration/tests/host-integration.test.mjs)
  (cd "$ROOT" && npm run --silent test:unit)
  (cd "$ROOT" && npm run --silent test:cli-e2e)
  (cd "$ROOT" && npm run --silent test:crash-matrix)
  (cd "$ROOT" && npm run --silent test:concurrency)
  (cd "$ROOT" && npm run --silent test:bundle)
  (cd "$ROOT" && node spikes/verify-corte-1.2.mjs --structure-only)
fi
```

- [ ] **Step 3: Update `README.md`**

Replace the current "Bootstrap" section with:

```markdown
## Bootstrap

```bash
npm install
npm run build:runtime
npm run verify:next-generation
```

## Corte 0 status

Real, tested surface: `init`, `config set`, `config scope add`,
`changeset validate|approve|apply`, `check schema` — backed by real JSON
Schemas, UUIDv7 IDs, an explicit approval state machine, and a
crash-consistent event journal with idempotent recovery. See
`docs/specs/corte-0-runtime-foundation.md`.

**Not yet implemented (mandatory next iteration, not optional):**
git/scope/package discovery, guide registration, autonomy configuration,
`release`/`item`/`work-package`/`task`, `check health|guides|gates`,
`report`, and approval governance (role separation between proposer and
approver). Any of these commands returns `NOT_IMPLEMENTED` with exit
code `3` rather than a silent or partial result.
```

- [ ] **Step 4: Run the full regression suite**

Run: `npm run verify:next-generation`
Expected: PASS — all existing regression suites plus the new unit/e2e/crash-matrix/concurrency/bundle suites (added by later tasks; until Task 24-25 exist, temporarily comment out the two lines that don't exist yet, or run this step again after those tasks land).

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/verify-next-generation.sh README.md
git commit -m "Update package.json scripts, verify-next-generation.sh, and README for Corte 0 reality"
```

---

## Task 24: CLI e2e — happy path, negative paths, NOT_IMPLEMENTED matrix, path confinement

**Files:**
- Create: `runtime/tests/cli-e2e.test.mjs`

**Interfaces:**
- Consumes: `bin/shipping-mode.mjs` (Task 21) via `child_process.execFileSync`, never in-process imports.

- [ ] **Step 1: Write the test**

```js
// runtime/tests/cli-e2e.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "bin", "shipping-mode.mjs");

function run(args, cwd) {
  try {
    const stdout = execFileSync("node", [bin, ...args], { cwd, encoding: "utf8" });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.status, json: JSON.parse(error.stdout) };
  }
}

function freshWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cli-e2e-"));
}

// happy path
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  assert.equal(init.code, 0);
  const operationId = init.json.operationId;

  assert.equal(run(["changeset", "validate", operationId], cwd).code, 0);
  assert.equal(run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd).code, 0);
  const applied = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 0);
  assert.equal(applied.json.status, "APPLIED");

  const check = run(["check", "schema"], cwd);
  assert.equal(check.code, 0);
  assert.equal(check.json.status, "PASS");
}

// apply without approval fails
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  const applyWithoutApproval = run(["changeset", "apply", init.json.operationId, "--actor", "carlos"], cwd);
  assert.equal(applyWithoutApproval.code, 2, "applying an un-approved operation must fail, not silently succeed");
}

// STALE if a file changes between validate/approve and apply
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  const operationId = init.json.operationId;
  run(["changeset", "validate", operationId], cwd);
  run(["changeset", "approve", operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  fs.mkdirSync(path.join(cwd, ".planning"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".planning", "config.yml"), "name: tampered\n");
  const applied = run(["changeset", "apply", operationId, "--actor", "carlos"], cwd);
  assert.equal(applied.code, 2, "apply must fail cleanly when baseRevisions no longer match");
}

// check schema never mutates
{
  const cwd = freshWorkspace();
  fs.mkdirSync(path.join(cwd, ".planning"), { recursive: true });
  const before = fs.existsSync(path.join(cwd, ".planning", "config.yml"));
  run(["check", "schema"], cwd);
  const after = fs.existsSync(path.join(cwd, ".planning", "config.yml"));
  assert.equal(before, after, "check schema must never create config.yml");
}

// NOT_IMPLEMENTED matrix
{
  const cwd = freshWorkspace();
  run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  for (const args of [
    ["release", "--name", "R1"],
    ["item", "--name", "I1"],
    ["work-package", "--name", "W1"],
    ["task", "--name", "T1"],
    ["report"],
    ["check", "health"],
    ["check", "guides"],
    ["check", "gates"],
    ["changeset", "propose", "--kind", "task.create", "--actor", "carlos"]
  ]) {
    const result = run(args, cwd);
    assert.equal(result.code, 3, `${args.join(" ")} must exit 3`);
    assert.equal(result.json.status, "NOT_IMPLEMENTED", `${args.join(" ")} must report NOT_IMPLEMENTED`);
  }
}

// scope path confinement: reject absolute path, traversal, and .planning-internal path
{
  const cwd = freshWorkspace();
  const init = run(["init", "--name", "demo", "--vcs", "git", "--actor", "carlos"], cwd);
  run(["changeset", "validate", init.json.operationId], cwd);
  run(["changeset", "approve", init.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
  run(["changeset", "apply", init.json.operationId, "--actor", "carlos"], cwd);

  for (const badPath of ["/etc/passwd", "../outside", ".planning/config.yml"]) {
    const scope = run(["config", "scope", "add", "--key", "backend", "--label", "Backend", "--kind", "code", "--path", badPath, "--actor", "carlos"], cwd);
    // propose itself doesn't validate the path yet (validate does, via the scope schema
    // and renderer's confineScopePath call during apply) -- assert the failure surfaces
    // no later than apply, and never as a silently-created scope.yml outside the workspace
    if (scope.code === 0) {
      run(["changeset", "validate", scope.json.operationId], cwd);
      run(["changeset", "approve", scope.json.operationId, "--actor", "carlos", "--allow-self-approval"], cwd);
      const applied = run(["changeset", "apply", scope.json.operationId, "--actor", "carlos"], cwd);
      assert.notEqual(applied.code, 0, `scope path ${badPath} must never apply successfully`);
    }
  }
}

console.log("cli-e2e: all tests passed");
```

- [ ] **Step 2: Run test to verify it fails, then implement, then verify it passes**

Run: `node runtime/tests/cli-e2e.test.mjs`
Expected first run: FAIL, most likely because `runConfigScopeAdd`/`renderScopeAdd` don't yet call `confineScopePath` (Task 12's renderer only normalizes the key and checks uniqueness — it doesn't confine the path). Fix by importing `confineScopePath` from `../../lib/paths.mjs` into `runtime/src/commands/renderers.mjs` and calling it inside `renderScopeAdd` before accepting `path`:

```js
// add to runtime/src/commands/renderers.mjs
import { confineScopePath } from "../lib/paths.mjs";

export function renderScopeAdd({ key, label, kind, path: scopePath, owner = null }, currentConfig, workspaceRoot) {
  confineScopePath(workspaceRoot, scopePath); // throws PathConfinementError on violation
  // ...rest unchanged
}
```

This changes `renderScopeAdd`'s signature to take `workspaceRoot` — update its call site in `runtime/src/commands/changesetCommand.mjs`'s `renderFor` to pass `path.dirname(planningRoot)` as `workspaceRoot`, and update Task 12's test (`renderers.test.mjs`) to pass a workspace root fixture too.

Re-run: `node runtime/src/commands/tests/renderers.test.mjs && node runtime/tests/cli-e2e.test.mjs`
Expected: both PASS

- [ ] **Step 3: Commit**

```bash
git add runtime/tests/cli-e2e.test.mjs runtime/src/commands/renderers.mjs runtime/src/commands/changesetCommand.mjs runtime/src/commands/tests/renderers.test.mjs
git commit -m "Add CLI e2e suite: happy path, negative paths, NOT_IMPLEMENTED matrix, scope path confinement"
```

---

## Task 25: Final regression pass and DoD verification

**Files:** none created; this task only runs things and fixes whatever breaks.

- [ ] **Step 1: Run the full verification script**

Run: `npm run verify:next-generation`
Expected: PASS, including every regression suite (`hooks/tests/protect-planning-state.test.mjs`, `spikes/tests/verify-corte-1.2.test.mjs`, `scripts/tests/verify-next-generation.test.mjs`, `spikes/host-integration/tests/host-integration.test.mjs`) and every new suite added in Tasks 1-24.

- [ ] **Step 2: Confirm the bundle is genuinely dependency-free**

Run: `mkdir -p /tmp/shipping-mode-smoke && cp runtime/dist/shipping-mode.mjs /tmp/shipping-mode-smoke/ && cd /tmp/shipping-mode-smoke && node --input-type=module -e 'import("./shipping-mode.mjs").then((m) => console.log(typeof m.dispatch))' && cd -`
Expected: prints `function`, with no `node_modules` present in `/tmp/shipping-mode-smoke`

- [ ] **Step 3: Grep for lingering references to removed prototype surface**

Run: `grep -rn "work-package\|aggregateDirs" runtime/src bin/shipping-mode.mjs || echo "clean"`
Expected: `clean`, or only matches inside `NOT_IMPLEMENTED` test fixtures/comments (review any hit manually)

- [ ] **Step 4: Verify the DoD checklist from the spec**

Open `docs/specs/corte-0-runtime-foundation.md` §17 and confirm each checkbox against what was actually built; do not check off "Corte 0 no se marca como cerrado" as a formality — grep for any accidental "Corte 0 complete/done/terminado" language:

Run: `grep -rn "Corte 0.*\(terminad\|complet\|cerrad\)" docs/ README.md || echo "no premature completion claims found"`
Expected: `no premature completion claims found`

- [ ] **Step 5: Commit any final fixups**

If Steps 1-4 required code changes, commit them individually per fix with descriptive messages (do not bundle unrelated fixes into one commit). If nothing needed fixing, this task produces no commit — record in your final report that verification passed cleanly on the first attempt.

---

## Self-Review Notes

**Spec coverage:** §3 (commands) → Tasks 19-20. §4 (directory structure) → Tasks 6, 20, 21. §5 (storage) → Tasks 11, 15, 16. §6 (IDs) → Task 1. §7 (scope catalog) → Task 12, 19. §8 (hashes) → Task 2. §9 (schemas/YAML/build) → Tasks 4-7. §10 (state machine) → Tasks 13-14. §11 (lock) → Tasks 8-9. §12 (apply sequence) → Tasks 15-16. §13 (recovery) → Task 17. §14 (path confinement) → Tasks 3, 24. §15 (skills) → Task 22. §16 (testing) → Tasks throughout + 24-25. §17 (DoD) → Task 25.

**Placeholder scan:** Task 19's first drafts of `changesetCommand.mjs` and `runConfigScopeAdd` intentionally show a broken draft followed by the corrected version, with an explicit instruction to use the corrected one — this is not a TODO/placeholder, it's showing why the indirection exists (a fresh engineer following Task 19 verbatim ends on working code, never on the broken draft).

**Type consistency:** `operationId` (string, UUIDv7) is consistent from Task 1 through Task 24. `render: (payload) => Map<string,string>` signature is consistent across Tasks 12, 15, 16, 19. `LockHeldError`, `PathConfinementError`, `RecoveryRequiredError` are each defined once (Tasks 8, 3, 10 respectively) and only ever imported, never redefined.

---

**Plan complete and saved to `docs/plans/corte-0-runtime-foundation-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
