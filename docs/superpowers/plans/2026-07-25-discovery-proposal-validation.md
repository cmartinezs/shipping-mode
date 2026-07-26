# Discovery Proposal Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `DiscoveryProposal` validation pipeline (design spec Section D.2, D.3 steps 1–4) as a pure, framework-agnostic module that takes an untrusted proposal and a live workspace, and either returns a validated/normalized result or a full set of rejection diagnostics — with **zero** changes to the ChangeSet engine and **zero** new `.planning` mutation capability.

**Architecture:** A new `runtime/src/lib/discoveryProposal.mjs` implements the four-step pipeline (structural validation, live re-scan/workspaceHash comparison, fingerprint re-verification, reference/drift/removal integrity) as small composable functions, each independently testable, reusing `discover scan`'s existing machinery (`runDiscoverScan`, `computeSourceFingerprint`, `confineScopePath`) rather than duplicating it. A new CLI command, `discover validate --file <path> | --stdin`, exposes the full pipeline read-only — it never writes to `.planning`. Turning a validated proposal into an actual ChangeSet (`discovery.propose` kind, `preconditions.discoveryWorkspace`, autonomy evaluation) is Plan 3/4's job, not this plan's.

**Tech Stack:** Plain Node.js, no new dependencies. Tests are plain `node:assert/strict` scripts matching the existing `runtime/src/lib/tests/*.test.mjs` style.

## Global Constraints

- Node >= 20, no new npm dependencies (same as Plan 1).
- All hashes are bare lowercase hex sha256 (`^[0-9a-f]{64}$`), no `sha256:` prefix — matches the codebase convention already established in Plan 1, not the design doc's illustrative `sha256:...` prose.
- `scanId` in a real `ScanResult`/`DiscoveryProposal` is a bare UUIDv7 (`generateUuidV7()`'s output, e.g. `018f4d1e-...`) — **not** the `scan_01J...` placeholder text used in the design doc's prose examples. The doc was illustrative; Plan 1's actual `runDiscoverScan` implementation is the source of truth for the real format.
- **Trust boundary, restated for this plan specifically:** every `observedFingerprint`/`observedContentHash` value inside a `DiscoveryProposal` is a claim from untrusted input (the skill). This plan's entire job is to never accept one of those claims without independently recomputing it against the live workspace first. A step that "validates" a fingerprint by only checking its `^[0-9a-f]{64}$` shape, without recomputing and comparing, has not validated anything.
- Every host-repository path touched by this plan (a `sources[]` entry's `path`/`fromPath`, or a confirmed source's `path` looked up by `sourceId`) must be resolved through the existing `confineScopePath` before any filesystem access — reused unchanged from Plan 1, never a new confinement mechanism.
- **Scope decision, made explicitly in this plan because the design doc's `DiscoveryProposal` example never resolved it:** `scopeCommands[].sourceRefs` may reference only (a) already-confirmed catalog `sourceId`s, or (b) `sourceId`s of sources being `update`d or `move`d in the *same* proposal (both have a real, pre-existing ID). A `scopeCommands` entry may **not** reference a source being `add`ed in the same proposal, because an `add` entry has no `sourceId` yet — one is minted only at apply time (Plan 3). A skill that wants to add a source and immediately reference it must do so as two sequential `discover propose` calls. This avoids inventing a proposal-local temporary-ID sub-protocol that was never designed during brainstorming.
- `scopeCommands[]` entries in a `DiscoveryProposal` are always `method: inferred | reviewed` — never `declared`. A `declared` command has no evidence and doesn't belong in a discovery pipeline at all; it is exclusively the domain of the (separate, not-yet-built) `config scope set-command` path.
- This plan does not create, modify, or reference any ChangeSet, Operation, or `.planning` write path. `discover validate` is read-only, exactly like `discover scan` and `check schema`.

---

### Task 1: Export shared helpers from `discoverScan.mjs`; move `runDiscoverScan` into the lib layer

**Files:**
- Modify: `runtime/src/lib/discoverScan.mjs`
- Modify: `runtime/src/commands/discover.mjs`
- Modify: `runtime/src/commands/check.mjs`
- Test: `runtime/src/lib/tests/discover-git.test.mjs`, `runtime/src/lib/tests/discover-candidates.test.mjs`, `runtime/src/lib/tests/discover-drift.test.mjs`, `runtime/src/lib/tests/discover-command-evidence.test.mjs`, `runtime/src/lib/tests/discover-workspace-hash.test.mjs`, `runtime/src/commands/tests/discover.test.mjs`, `runtime/src/commands/tests/check.test.mjs`, `runtime/src/tests/dispatcher.test.mjs` (all pre-existing — this task is a pure refactor with zero intended behavior change, verified by re-running them unchanged)

**Interfaces:**
- Produces (all newly `export`ed from `runtime/src/lib/discoverScan.mjs`, all pre-existing logic, just made public): `readConfirmedSources(planningRoot)`, `readConfirmedScopes(planningRoot)`, `allCommandEntries(scope)`, `findCommandFingerprintKeyMismatches(scope)`, `runDiscoverScan({planningRoot, workspaceRoot, maxSourceBytes})`, `DEFAULT_MAX_SOURCE_BYTES`, `MIN_MAX_SOURCE_BYTES`, `MAX_MAX_SOURCE_BYTES`.

This task moves code, it does not write new logic. Rationale: `lib/discoveryProposal.mjs` (Tasks 3–9) needs to call `runDiscoverScan` internally (step 3 of the pipeline is a live re-scan) — but `runDiscoverScan` currently lives in `commands/discover.mjs`, and `commands/` files are the CLI-facing layer that depends on `lib/`, never the reverse. Leaving it there would force a `lib` → `commands` import, inverting the established layering. Moving it into `lib/discoverScan.mjs` (where the rest of the discovery engine already lives) fixes this before it happens, rather than working around it later. Task 13 of Plan 1's own `findCommandFingerprintKeyMismatches` had the same problem in miniature (it lived in `commands/check.mjs`, application-layer, but is genuinely reusable domain logic) — moving it now avoids two independent copies drifting apart.

- [ ] **Step 1: Add `export` to the three already-existing private functions**

In `runtime/src/lib/discoverScan.mjs`, change:
```js
function readConfirmedSources(planningRoot) {
```
to:
```js
export function readConfirmedSources(planningRoot) {
```

Change:
```js
function readConfirmedScopes(planningRoot) {
```
to:
```js
export function readConfirmedScopes(planningRoot) {
```

Change:
```js
function allCommandEntries(scope) {
```
to:
```js
export function allCommandEntries(scope) {
```

- [ ] **Step 2: Move `findCommandFingerprintKeyMismatches` and its two private helpers from `check.mjs` into `discoverScan.mjs`, exported**

In `runtime/src/commands/check.mjs`, delete these three functions entirely (they currently sit right before `checkRequiredFile`):
```js
function commandRoleEntries(scope) { ... }
function fingerprintKeyMismatch(label, entry) { ... }
function findCommandFingerprintKeyMismatches(scope) { ... }
```

Add this import to `check.mjs` (alongside the existing imports):
```js
import { findCommandFingerprintKeyMismatches } from "../lib/discoverScan.mjs";
```

In `runtime/src/lib/discoverScan.mjs`, append (near `allCommandEntries`, which `commandRoleEntries` duplicates — see Step 3, which removes the duplication):
```js
function fingerprintKeyMismatch(label, entry) {
  if (!entry.sourceRefs) return null; // declared entries carry no sourceRefs/sourceFingerprintAtSelection at all
  const refSet = new Set(entry.sourceRefs);
  const keySet = new Set(Object.keys(entry.sourceFingerprintAtSelection || {}));
  const missing = [...refSet].filter((r) => !keySet.has(r));
  const extra = [...keySet].filter((k) => !refSet.has(k));
  if (missing.length === 0 && extra.length === 0) return null;
  return { label, missing, extra };
}

export function findCommandFingerprintKeyMismatches(scope) {
  const mismatches = [];
  for (const { role, entry } of allCommandEntries(scope)) {
    const selfMismatch = fingerprintKeyMismatch(role, entry);
    if (selfMismatch) mismatches.push(selfMismatch);
    for (const [index, alternative] of (entry.alternatives || []).entries()) {
      const altMismatch = fingerprintKeyMismatch(`${role}.alternatives[${index}]`, alternative);
      if (altMismatch) mismatches.push(altMismatch);
    }
  }
  return mismatches;
}
```

- [ ] **Step 3: Remove the duplicate `commandRoleEntries`/`allCommandEntries` — `findCommandFingerprintKeyMismatches` now reuses the one already in `discoverScan.mjs`**

`check.mjs`'s old `commandRoleEntries` used `label` as the key name; `discoverScan.mjs`'s existing `allCommandEntries` uses `role` as the key name for the exact same `{ <key>, entry }` shape. The rewritten `findCommandFingerprintKeyMismatches` above already uses `allCommandEntries`'s `role` field (destructured as `{ role, entry }`) — no separate `commandRoleEntries` needed. Confirm `check.mjs`'s existing findings-message string (`commands.${mismatch.label} sourceFingerprintAtSelection keys...`) still reads `mismatch.label` — that field name is unchanged (`fingerprintKeyMismatch` still returns `{ label, missing, extra }`), only the *source* of the label text moved from `commandRoleEntries`'s `label` key to `allCommandEntries`'s `role` key at the call site. No other code in `check.mjs` needs to change.

- [ ] **Step 4: Move `runDiscoverScan` and its constants into `discoverScan.mjs`**

Add to the top of `runtime/src/lib/discoverScan.mjs` (alongside the other imports):
```js
import { generateUuidV7 } from "./ids.mjs";
```

Append to the end of `runtime/src/lib/discoverScan.mjs`:
```js
export const DEFAULT_MAX_SOURCE_BYTES = 536870912; // 512 MiB
export const MIN_MAX_SOURCE_BYTES = 1048576; // 1 MiB
export const MAX_MAX_SOURCE_BYTES = 2147483648; // 2 GiB

export function runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES }) {
  if (maxSourceBytes < MIN_MAX_SOURCE_BYTES || maxSourceBytes > MAX_MAX_SOURCE_BYTES) {
    throw new UsageError(`--max-source-bytes must be between ${MIN_MAX_SOURCE_BYTES} and ${MAX_MAX_SOURCE_BYTES}, got ${maxSourceBytes}`);
  }

  const git = detectGit(workspaceRoot);
  const { scopeCandidates, sourceCandidates: rawSourceCandidates, diagnostics: enumerationDiagnostics } = enumerateCandidates(workspaceRoot);
  const {
    results: knownSources,
    diagnostics: driftDiagnostics,
    fingerprintedSourceCandidates
  } = computeKnownSourceDrift({ planningRoot, workspaceRoot, sourceCandidates: rawSourceCandidates, maxSourceBytes });
  const knownCommandsEvidence = computeCommandEvidence({ planningRoot, knownSourceDrift: knownSources });

  const diagnostics = [...enumerationDiagnostics, ...driftDiagnostics];
  const workspaceHash = computeWorkspaceHash({
    scopeCandidates,
    sourceCandidates: fingerprintedSourceCandidates,
    knownSources,
    knownCommandsEvidence
  });

  return {
    schemaVersion: 1,
    scanId: generateUuidV7(),
    generatedAt: new Date().toISOString(),
    baseRevision: { vcsRevision: git.enabled ? `git:${git.revision}` : "none", workspaceHash },
    scanParameters: { maxSourceBytes },
    git,
    scopeCandidates,
    sourceCandidates: fingerprintedSourceCandidates,
    knownSources,
    knownCommandsEvidence,
    diagnostics
  };
}
```

This needs `UsageError` imported too — add to the top of `discoverScan.mjs`:
```js
import { UsageError } from "./errors.mjs";
```

Replace the **entire contents** of `runtime/src/commands/discover.mjs` with:
```js
export { runDiscoverScan, DEFAULT_MAX_SOURCE_BYTES, MIN_MAX_SOURCE_BYTES, MAX_MAX_SOURCE_BYTES } from "../lib/discoverScan.mjs";
```

`runtime/src/index.mjs`'s existing `import { runDiscoverScan } from "./commands/discover.mjs";` line does not need to change — the re-export keeps that import path working exactly as before.

- [ ] **Step 5: Run every pre-existing test file touched by this refactor to confirm zero behavior change**

Run:
```bash
node runtime/src/lib/tests/discover-git.test.mjs
node runtime/src/lib/tests/discover-candidates.test.mjs
node runtime/src/lib/tests/discover-drift.test.mjs
node runtime/src/lib/tests/discover-command-evidence.test.mjs
node runtime/src/lib/tests/discover-workspace-hash.test.mjs
node runtime/src/commands/tests/discover.test.mjs
node runtime/src/commands/tests/check.test.mjs
node runtime/src/tests/dispatcher.test.mjs
```
Expected: all pass, identical output to before this task (this is a pure move/export refactor — if any of these fail, something was moved incorrectly, not a legitimate new behavior).

- [ ] **Step 6: Commit**

```bash
git add runtime/src/lib/discoverScan.mjs runtime/src/commands/discover.mjs runtime/src/commands/check.mjs
git commit -m "refactor(discovery): move runDiscoverScan and shared helpers into the lib layer"
```

---

### Task 2: `discovery-proposal.schema.json` — the untrusted-input envelope schema

**Files:**
- Create: `runtime/src/schemas/discovery-proposal.schema.json`
- Modify: `runtime/src/lib/schema.mjs`
- Test: `runtime/src/lib/tests/discovery-proposal-schema.test.mjs`

**Interfaces:**
- Produces: schema name `"discovery-proposal"`, callable via `validate("discovery-proposal", data)`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discovery-proposal-schema.test.mjs
import assert from "node:assert/strict";
import { validate } from "../schema.mjs";

const scopeId = "018f4d1e-0000-7000-8000-000000000001";
const srcAdd = "018f4d1e-0000-7000-8000-000000000002"; // used only in comments; add entries never carry sourceId
const srcUpdate = "018f4d1e-0000-7000-8000-000000000003";
const srcMove = "018f4d1e-0000-7000-8000-000000000004";
const srcRemove = "018f4d1e-0000-7000-8000-000000000005";

function baseProposal(overrides = {}) {
  return {
    schemaVersion: 1,
    scanId: "018f4d1e-0000-7000-8000-000000000000",
    baseRevision: { vcsRevision: "git:" + "a".repeat(40), workspaceHash: "b".repeat(64) },
    scanParameters: { maxSourceBytes: 536870912 },
    scopes: [],
    sources: [],
    scopeCommands: [],
    diagnostics: [],
    ...overrides
  };
}

assert.equal(validate("discovery-proposal", baseProposal()).valid, true, "an empty-but-structurally-complete proposal must be valid");

// scopes[]
assert.equal(validate("discovery-proposal", baseProposal({
  scopes: [{ key: "api", label: "API", kind: "code", path: "api/", owner: null }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  scopes: [{ key: "api", label: "API", kind: "code" }] // missing required path
})).valid, false);

// sources[]: add
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{
    action: "add", path: "docs/adr/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64)
  }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "add", sourceId: srcAdd, path: "docs/adr/", family: "decision-sources", kind: "decision", role: "decision", authority: { standing: "authoritative", force: "normative" }, availability: "implemented", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, false, "add must never carry a sourceId -- one doesn't exist yet");

// sources[]: update -- classification fields optional, path forbidden entirely (move's job)
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "update", sourceId: srcUpdate, observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, true, "update with only a fingerprint refresh, no reclassification, must be valid");
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "update", sourceId: srcUpdate, family: "decision-sources", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, true, "update may optionally reclassify");
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "update", sourceId: srcUpdate, path: "docs/new/", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, false, "update must never carry path -- that is move's job exclusively");

// sources[]: move
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "move", sourceId: srcMove, fromPath: "docs/old/", path: "docs/new/", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "move", sourceId: srcMove, path: "docs/new/", observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }] // missing fromPath
})).valid, false);

// sources[]: remove
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "remove", sourceId: srcRemove }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  sources: [{ action: "remove", sourceId: srcRemove, path: "docs/x/" }] // remove carries nothing but sourceId
})).valid, false);

// scopeCommands[]: always inferred|reviewed, never declared
assert.equal(validate("discovery-proposal", baseProposal({
  scopeCommands: [{
    scopeId, role: "build", command: "./mvnw package", method: "reviewed", confidence: "high",
    sourceRefs: [srcUpdate], sourceFingerprintAtSelection: { [srcUpdate]: "c".repeat(64) },
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  }]
})).valid, true);
assert.equal(validate("discovery-proposal", baseProposal({
  scopeCommands: [{
    scopeId, role: "build", command: "./mvnw package", method: "declared",
    declaredBy: "carlos", declaredAt: "2026-07-25T10:00:00Z", declaredOperationId: srcUpdate,
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  }]
})).valid, false, "declared commands never belong in a DiscoveryProposal");
assert.equal(validate("discovery-proposal", baseProposal({
  scopeCommands: [{
    scopeId, role: "custom.e2e", command: "npm run e2e", method: "inferred", confidence: "medium",
    sourceRefs: [srcUpdate], sourceFingerprintAtSelection: { [srcUpdate]: "c".repeat(64) },
    requiresEnvironment: true, requiresSecrets: false, alternatives: []
  }]
})).valid, true, "custom.<name> roles are accepted");
assert.equal(validate("discovery-proposal", baseProposal({
  scopeCommands: [{
    scopeId, role: "not-a-real-role", command: "x", method: "inferred", confidence: "high",
    sourceRefs: [srcUpdate], sourceFingerprintAtSelection: { [srcUpdate]: "c".repeat(64) },
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  }]
})).valid, false);

console.log("discovery-proposal-schema: envelope, 4-way source action union, and inferred|reviewed-only scopeCommands all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discovery-proposal-schema.test.mjs`
Expected: FAIL with `unknown schema: discovery-proposal`.

- [ ] **Step 3: Write minimal implementation**

```json
// runtime/src/schemas/discovery-proposal.schema.json
{
  "$id": "https://shipping-mode.dev/schemas/discovery-proposal.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "scanId", "baseRevision", "scanParameters", "scopes", "sources", "scopeCommands", "diagnostics"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "scanId": { "$ref": "#/$defs/uuid" },
    "baseRevision": {
      "type": "object",
      "additionalProperties": false,
      "required": ["vcsRevision", "workspaceHash"],
      "properties": {
        "vcsRevision": { "type": "string", "minLength": 1 },
        "workspaceHash": { "$ref": "#/$defs/fingerprint" }
      }
    },
    "scanParameters": {
      "type": "object",
      "additionalProperties": false,
      "required": ["maxSourceBytes"],
      "properties": { "maxSourceBytes": { "type": "integer" } }
    },
    "scopes": { "type": "array", "items": { "$ref": "#/$defs/scopeProposal" } },
    "sources": { "type": "array", "items": { "$ref": "#/$defs/sourceAction" } },
    "scopeCommands": { "type": "array", "items": { "$ref": "#/$defs/scopeCommandEntry" } },
    "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/diagnosticEntry" } }
  },
  "$defs": {
    "uuid": { "type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },
    "fingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "confidence": { "enum": ["low", "medium", "high"] },
    "sourceRefs": { "type": "array", "items": { "$ref": "#/$defs/uuid" }, "minItems": 1, "uniqueItems": true },
    "diagnosticEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": ["code", "severity", "message"],
      "properties": {
        "code": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[a-z][a-z0-9_]*$" },
        "severity": { "enum": ["info", "warning", "error"] },
        "message": { "type": "string", "minLength": 1, "maxLength": 4096 },
        "itemRef": { "type": "string", "minLength": 1, "maxLength": 512 },
        "details": { "type": "object" }
      }
    },
    "sourceFamily": {
      "enum": [
        "product-sources", "functional-sources", "technical-sources", "agent-repository-instructions",
        "project-module-manifests", "execution-commands", "quality-definitions", "local-runtime-environment",
        "public-data-contracts", "delivery-ci-deployment", "ownership", "decision-sources", "developer-guides",
        "engineering-standards", "repository-map", "evidence-contracts", "design-system", "prompt-sources",
        "custom-automation"
      ]
    },
    "sourceKind": {
      "enum": [
        "product", "requirements", "architecture", "decision", "developer-guide", "engineering-standard",
        "agent-instructions", "repository-map", "api-contract", "data-contract", "database", "testing",
        "quality", "security", "observability", "design-system", "i18n", "runtime", "environment",
        "deployment", "ci", "ownership", "prompt", "generator", "evidence", "planning"
      ]
    },
    "sourceRole": { "enum": ["canonical", "decision", "derived", "operational", "evidence", "generated", "historical", "reference"] },
    "sourceAuthority": {
      "type": "object",
      "additionalProperties": false,
      "required": ["standing", "force"],
      "properties": {
        "standing": { "enum": ["contextual", "supporting", "authoritative"] },
        "force": { "enum": ["unknown", "informational", "advisory", "normative"] }
      }
    },
    "sourceAvailability": { "enum": ["implemented", "partial", "planned", "deprecated", "historical", "mixed", "unknown"] },
    "scopeProposal": {
      "type": "object",
      "additionalProperties": false,
      "required": ["key", "label", "kind", "path"],
      "properties": {
        "key": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
        "label": { "type": "string", "minLength": 1 },
        "kind": { "enum": ["code", "non_code"] },
        "path": { "type": "string", "minLength": 1 },
        "owner": { "type": ["string", "null"] }
      }
    },
    "sourceAction": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["action", "path", "family", "kind", "role", "authority", "availability", "observedFingerprint", "observedContentHash"],
          "properties": {
            "action": { "const": "add" },
            "path": { "type": "string", "minLength": 1 },
            "family": { "$ref": "#/$defs/sourceFamily" },
            "kind": { "$ref": "#/$defs/sourceKind" },
            "role": { "$ref": "#/$defs/sourceRole" },
            "authority": { "$ref": "#/$defs/sourceAuthority" },
            "availability": { "$ref": "#/$defs/sourceAvailability" },
            "observedFingerprint": { "$ref": "#/$defs/fingerprint" },
            "observedContentHash": { "$ref": "#/$defs/fingerprint" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["action", "sourceId", "observedFingerprint", "observedContentHash"],
          "properties": {
            "action": { "const": "update" },
            "sourceId": { "$ref": "#/$defs/uuid" },
            "family": { "$ref": "#/$defs/sourceFamily" },
            "kind": { "$ref": "#/$defs/sourceKind" },
            "role": { "$ref": "#/$defs/sourceRole" },
            "authority": { "$ref": "#/$defs/sourceAuthority" },
            "availability": { "$ref": "#/$defs/sourceAvailability" },
            "observedFingerprint": { "$ref": "#/$defs/fingerprint" },
            "observedContentHash": { "$ref": "#/$defs/fingerprint" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["action", "sourceId", "fromPath", "path", "observedFingerprint", "observedContentHash"],
          "properties": {
            "action": { "const": "move" },
            "sourceId": { "$ref": "#/$defs/uuid" },
            "fromPath": { "type": "string", "minLength": 1 },
            "path": { "type": "string", "minLength": 1 },
            "observedFingerprint": { "$ref": "#/$defs/fingerprint" },
            "observedContentHash": { "$ref": "#/$defs/fingerprint" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["action", "sourceId"],
          "properties": {
            "action": { "const": "remove" },
            "sourceId": { "$ref": "#/$defs/uuid" }
          }
        }
      ]
    },
    "alternative": {
      "type": "object",
      "additionalProperties": false,
      "required": ["command", "sourceRefs", "sourceFingerprintAtSelection", "confidence", "requiresEnvironment", "requiresSecrets"],
      "properties": {
        "command": { "type": "string", "minLength": 1 },
        "sourceRefs": { "$ref": "#/$defs/sourceRefs" },
        "sourceFingerprintAtSelection": { "type": "object", "additionalProperties": { "$ref": "#/$defs/fingerprint" } },
        "confidence": { "$ref": "#/$defs/confidence" },
        "requiresEnvironment": { "type": "boolean" },
        "requiresSecrets": { "type": "boolean" }
      }
    },
    "commandRole": {
      "anyOf": [
        { "enum": ["build", "test", "smoke", "lint", "verify"] },
        { "type": "string", "pattern": "^custom\\.[a-z][a-z0-9-]{0,63}$" }
      ]
    },
    "scopeCommandEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": ["scopeId", "role", "command", "method", "confidence", "sourceRefs", "sourceFingerprintAtSelection", "requiresEnvironment", "requiresSecrets", "alternatives"],
      "properties": {
        "scopeId": { "$ref": "#/$defs/uuid" },
        "role": { "$ref": "#/$defs/commandRole" },
        "command": { "type": "string", "minLength": 1 },
        "method": { "enum": ["inferred", "reviewed"] },
        "confidence": { "$ref": "#/$defs/confidence" },
        "sourceRefs": { "$ref": "#/$defs/sourceRefs" },
        "sourceFingerprintAtSelection": { "type": "object", "additionalProperties": { "$ref": "#/$defs/fingerprint" } },
        "requiresEnvironment": { "type": "boolean" },
        "requiresSecrets": { "type": "boolean" },
        "alternatives": { "type": "array", "items": { "$ref": "#/$defs/alternative" } }
      }
    }
  }
}
```

In `runtime/src/lib/schema.mjs`, add to `exportNameByPublicName`:
```js
  "discovery-proposal": "validate_discovery_proposal",
```

Run `npm run build:schemas` before running the test, exactly like Plan 1's Task 4/5 — the new schema must be compiled into `runtime/src/generated/validators.mjs` before `validate("discovery-proposal", ...)` can resolve.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:schemas && node runtime/src/lib/tests/discovery-proposal-schema.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/schemas/discovery-proposal.schema.json runtime/src/lib/schema.mjs runtime/src/lib/tests/discovery-proposal-schema.test.mjs runtime/src/generated/validators.mjs
git commit -m "feat(discovery): add DiscoveryProposal envelope schema"
```

---

### Task 3: `validateProposalStructure` — steps 1+2 (structural + relational checks + scanParameters range)

**Files:**
- Create: `runtime/src/lib/discoveryProposal.mjs`
- Test: `runtime/src/lib/tests/discovery-proposal-structure.test.mjs`

**Interfaces:**
- Consumes: `validate` (`../lib/schema.mjs`), `findCommandFingerprintKeyMismatches`, `MIN_MAX_SOURCE_BYTES`, `MAX_MAX_SOURCE_BYTES` (Task 1/2).
- Produces: `validateProposalStructure(proposal)` → `{ ok: true } | { ok: false, errors: Array<{code, message, ...context}> }`. Collects **every** applicable error before returning, never stops at the first one — a caller fixing a proposal should see the whole punch list in one round-trip.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discovery-proposal-structure.test.mjs
import assert from "node:assert/strict";
import { validateProposalStructure } from "../discoveryProposal.mjs";

const scopeId = "018f4d1e-0000-7000-8000-000000000001";
const srcA = "018f4d1e-0000-7000-8000-000000000002";
const srcB = "018f4d1e-0000-7000-8000-000000000003";

function baseProposal(overrides = {}) {
  return {
    schemaVersion: 1,
    scanId: "018f4d1e-0000-7000-8000-000000000000",
    baseRevision: { vcsRevision: "git:" + "a".repeat(40), workspaceHash: "b".repeat(64) },
    scanParameters: { maxSourceBytes: 536870912 },
    scopes: [],
    sources: [],
    scopeCommands: [],
    diagnostics: [],
    ...overrides
  };
}

// schema-invalid proposal -> rejected with a schema_invalid error
{
  const result = validateProposalStructure({ ...baseProposal(), extraField: "not allowed" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "schema_invalid"));
}

// scanParameters out of range -> rejected
{
  const result = validateProposalStructure(baseProposal({ scanParameters: { maxSourceBytes: 100 } }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "scan_parameters_out_of_range"));
}
{
  const result = validateProposalStructure(baseProposal({ scanParameters: { maxSourceBytes: 3 * 1024 * 1024 * 1024 } }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "scan_parameters_out_of_range"));
}

// duplicate sourceId across two sources[] entries -> rejected
{
  const result = validateProposalStructure(baseProposal({
    sources: [
      { action: "update", sourceId: srcA, observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) },
      { action: "remove", sourceId: srcA }
    ]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "duplicate_source_action" && e.sourceId === srcA));
}

// duplicate (scopeId, role) across two scopeCommands[] entries -> rejected
{
  const entry = {
    scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
    sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64) },
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  };
  const result = validateProposalStructure(baseProposal({ scopeCommands: [entry, { ...entry, command: "./y" }] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "duplicate_scope_command" && e.scopeId === scopeId && e.role === "build"));
}

// sourceFingerprintAtSelection/sourceRefs key mismatch (reuses findCommandFingerprintKeyMismatches) -> rejected
{
  const result = validateProposalStructure(baseProposal({
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64), [srcB]: "d".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "fingerprint_key_mismatch"));
}

// fully valid, structurally complete proposal -> ok
{
  const result = validateProposalStructure(baseProposal({
    sources: [{ action: "update", sourceId: srcA, observedFingerprint: "c".repeat(64), observedContentHash: "d".repeat(64) }],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "c".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  }));
  assert.deepEqual(result, { ok: true });
}

console.log("discovery-proposal-structure: schema errors, scanParameters range, duplicate detection, and fingerprint-key mismatch all pass, collecting every error rather than stopping at the first");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discovery-proposal-structure.test.mjs`
Expected: FAIL with `Cannot find module '../discoveryProposal.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/src/lib/discoveryProposal.mjs
import { validate } from "./schema.mjs";
import { findCommandFingerprintKeyMismatches, MIN_MAX_SOURCE_BYTES, MAX_MAX_SOURCE_BYTES } from "./discoverScan.mjs";

function checkScanParametersRange(proposal) {
  const bytes = proposal.scanParameters?.maxSourceBytes;
  if (typeof bytes !== "number" || bytes < MIN_MAX_SOURCE_BYTES || bytes > MAX_MAX_SOURCE_BYTES) {
    return [{ code: "scan_parameters_out_of_range", message: `scanParameters.maxSourceBytes must be between ${MIN_MAX_SOURCE_BYTES} and ${MAX_MAX_SOURCE_BYTES}, got ${bytes}` }];
  }
  return [];
}

function checkDuplicateSourceActions(proposal) {
  const errors = [];
  const seen = new Set();
  for (const entry of proposal.sources || []) {
    const key = entry.action === "add" ? `add:${entry.path}` : `id:${entry.sourceId}`;
    if (seen.has(key)) {
      errors.push({ code: "duplicate_source_action", sourceId: entry.sourceId ?? null, path: entry.action === "add" ? entry.path : null, message: `more than one sources[] entry targets the same ${entry.action === "add" ? "path" : "sourceId"}: ${entry.action === "add" ? entry.path : entry.sourceId}` });
    }
    seen.add(key);
  }
  return errors;
}

function checkDuplicateScopeCommands(proposal) {
  const errors = [];
  const seen = new Set();
  for (const entry of proposal.scopeCommands || []) {
    const key = `${entry.scopeId}:${entry.role}`;
    if (seen.has(key)) {
      errors.push({ code: "duplicate_scope_command", scopeId: entry.scopeId, role: entry.role, message: `more than one scopeCommands[] entry targets scope ${entry.scopeId} role ${entry.role}` });
    }
    seen.add(key);
  }
  return errors;
}

// Builds a throwaway { commands: { <role>: entry, custom: { <name>: entry } } } object shaped
// like a scope.yml document, specifically so this can reuse findCommandFingerprintKeyMismatches
// (which expects that shape, via allCommandEntries) without duplicating its traversal logic.
// A role like "custom.e2e" must land at fakeScope.commands.custom.e2e, not the literal key
// "custom.e2e" -- allCommandEntries only looks inside commands.custom for anything beyond the
// five well-known roles.
//
// One fake scope is built PER ENTRY, not grouped by scopeId: if two scopeCommands[] entries
// share the same (scopeId, role) -- already flagged separately by checkDuplicateScopeCommands --
// grouping by scopeId would let the later entry silently overwrite the earlier one in the fake
// scope's commands.<role> slot, so the earlier entry's own mismatch would never be checked. A
// caller fixing a proposal must see every applicable error in one round-trip, including on
// entries that are also duplicates of each other.
function checkFingerprintKeyMismatches(proposal) {
  const errors = [];
  for (const entry of proposal.scopeCommands || []) {
    const fakeScope = { commands: { custom: {} } };
    if (entry.role.startsWith("custom.")) {
      fakeScope.commands.custom[entry.role.slice("custom.".length)] = entry;
    } else {
      fakeScope.commands[entry.role] = entry;
    }
    for (const mismatch of findCommandFingerprintKeyMismatches(fakeScope)) {
      errors.push({ code: "fingerprint_key_mismatch", scopeId: entry.scopeId, role: mismatch.label, missing: mismatch.missing, extra: mismatch.extra, message: `scopeCommands entry for scope ${entry.scopeId} role ${mismatch.label}: sourceFingerprintAtSelection keys do not match sourceRefs` });
    }
  }
  return errors;
}

export function validateProposalStructure(proposal) {
  const schemaResult = validate("discovery-proposal", proposal);
  if (!schemaResult.valid) {
    return {
      ok: false,
      errors: schemaResult.errors.map((e) => ({ code: "schema_invalid", path: e.path, message: e.message }))
    };
  }

  const errors = [
    ...checkScanParametersRange(proposal),
    ...checkDuplicateSourceActions(proposal),
    ...checkDuplicateScopeCommands(proposal),
    ...checkFingerprintKeyMismatches(proposal)
  ];

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discovery-proposal-structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoveryProposal.mjs runtime/src/lib/tests/discovery-proposal-structure.test.mjs
git commit -m "feat(discovery): validate DiscoveryProposal structure, scanParameters range, and duplicate/fingerprint-key relational checks"
```

---

### Task 4: `verifyWorkspaceConsistency` — step 3 (live re-scan + `workspaceHash` comparison)

**Files:**
- Modify: `runtime/src/lib/discoveryProposal.mjs`
- Test: `runtime/src/lib/tests/discovery-proposal-consistency.test.mjs`

**Interfaces:**
- Consumes: `runDiscoverScan` (`../lib/discoverScan.mjs`, Task 1).
- Produces: `verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot })` → `{ ok: true, freshScan } | { ok: false, errors: [{code: "stale_proposal", message}] }`. Re-scans using **exactly** `proposal.scanParameters.maxSourceBytes` — never a different value, never the default — because re-observing with different parameters than the proposal claims would make the comparison meaningless.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discovery-proposal-consistency.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDiscoverScan } from "../discoverScan.mjs";
import { verifyWorkspaceConsistency } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-consistency-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "web"));
  fs.writeFileSync(path.join(workspaceRoot, "web", "package.json"), "{}");
  return { workspaceRoot, planningRoot };
}

// workspace unchanged since the scan that produced the proposal -> ok
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });
  const proposal = { baseRevision: scan.baseRevision, scanParameters: scan.scanParameters };

  const result = verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
  assert.equal(result.freshScan.baseRevision.workspaceHash, scan.baseRevision.workspaceHash);
}

// workspace changed after the scan -> stale_proposal
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });
  const proposal = { baseRevision: scan.baseRevision, scanParameters: scan.scanParameters };

  fs.writeFileSync(path.join(workspaceRoot, "web", "package.json"), '{"changed": true}');

  const result = verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "stale_proposal"));
}

// re-observation uses the proposal's OWN scanParameters, never a silently different default
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 2 * 1024 * 1024 }); // non-default
  const proposal = { baseRevision: scan.baseRevision, scanParameters: scan.scanParameters };

  const result = verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true, "re-observing with the proposal's own 2 MiB cap must reproduce the same workspaceHash");
}

console.log("discovery-proposal-consistency: unchanged workspace passes, changed workspace is rejected as stale, and re-observation always uses the proposal's own scanParameters");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discovery-proposal-consistency.test.mjs`
Expected: FAIL with `verifyWorkspaceConsistency is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoveryProposal.mjs` (add `import { runDiscoverScan } from "./discoverScan.mjs";` at the top):

```js
export function verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot }) {
  const freshScan = runDiscoverScan({
    planningRoot,
    workspaceRoot,
    maxSourceBytes: proposal.scanParameters.maxSourceBytes
  });
  if (freshScan.baseRevision.workspaceHash !== proposal.baseRevision.workspaceHash) {
    return {
      ok: false,
      errors: [{
        code: "stale_proposal",
        message: "the workspace has changed since this proposal was generated; rescan with discover scan and resubmit",
        claimedWorkspaceHash: proposal.baseRevision.workspaceHash,
        observedWorkspaceHash: freshScan.baseRevision.workspaceHash
      }]
    };
  }
  return { ok: true, freshScan };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discovery-proposal-consistency.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoveryProposal.mjs runtime/src/lib/tests/discovery-proposal-consistency.test.mjs
git commit -m "feat(discovery): verify DiscoveryProposal workspace consistency via live re-scan"
```

---

### Task 5: `verifySourceFingerprints` — step 4a (never trust a claimed fingerprint; verify `move` identity)

**Files:**
- Modify: `runtime/src/lib/discoveryProposal.mjs`
- Test: `runtime/src/lib/tests/discovery-proposal-fingerprints.test.mjs`

**Interfaces:**
- Consumes: `computeSourceFingerprint`, `FingerprintError` (`../lib/fingerprint.mjs`); `confineScopePath`, `PathConfinementError` (`../lib/paths.mjs`); `readConfirmedSources` (`../lib/discoverScan.mjs`, Task 1).
- Produces: `verifySourceFingerprints({ proposal, planningRoot, workspaceRoot })` → `{ ok: true } | { ok: false, errors: [...] }`. For **every** `sources[]` entry, recomputes the real fingerprint live and rejects if it doesn't match what the proposal claims — the claimed value is never trusted at face value, only used to cross-check. For `move`, additionally verifies: `fromPath` matches the confirmed source's actual registered path, the old path is genuinely gone from the live workspace, and the claimed `observedContentHash` matches the confirmed source's `confirmedContentHash` (a "move" that doesn't preserve content is not a move).

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discovery-proposal-fingerprints.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { computeSourceFingerprint } from "../fingerprint.mjs";
import { verifySourceFingerprints } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-fp-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "sources"), { recursive: true });
  return { workspaceRoot, planningRoot };
}

function writeConfirmedSource(planningRoot, id, overrides) {
  const dir = path.join(planningRoot, "sources", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "source.yml"), stringifyYaml({
    schemaVersion: 1, id, path: "docs/old/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "0".repeat(64), confirmedContentHash: "0".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000009" },
    ...overrides
  }));
}

const idAdd = "018f4d1e-0000-7000-8000-000000000001"; // unused for "add" (no sourceId), kept for readability
const idUpdate = "018f4d1e-0000-7000-8000-000000000002";
const idMove = "018f4d1e-0000-7000-8000-000000000003";

// add: claimed fingerprint matches live observation -> ok
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "adr"), { maxBytes: 1024 * 1024 });

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "add", path: "docs/adr/", observedFingerprint: real.fingerprint, observedContentHash: real.contentHash }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
}

// add: claimed fingerprint does NOT match live observation -> rejected (the skill cannot fabricate a value)
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision");

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "add", path: "docs/adr/", observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "fingerprint_mismatch"));
}

// add: path escapes the workspace -> rejected, never read
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "add", path: "../../etc", observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "untrusted_source_path"));
}

// update: resolves the path from the CONFIRMED catalog (update never carries path), fingerprint verified
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "old"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "old", "0001.md"), "updated content");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "old"), { maxBytes: 1024 * 1024 });
  writeConfirmedSource(planningRoot, idUpdate);

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "update", sourceId: idUpdate, observedFingerprint: real.fingerprint, observedContentHash: real.contentHash }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
}

// update: sourceId not in the confirmed catalog at all -> rejected
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "update", sourceId: idUpdate, observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unknown_source_id"));
}

// move: fromPath must match the confirmed source's ACTUAL registered path
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new", "0001.md"), "moved content");
  writeConfirmedSource(planningRoot, idMove); // registered path is "docs/old/"

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "move", sourceId: idMove, fromPath: "docs/somewhere-else/", path: "docs/new/", observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "move_frompath_mismatch"));
}

// move: the OLD path must actually be gone -- claiming a move while the old content is still there is rejected
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "old"), { recursive: true }); // still exists!
  fs.writeFileSync(path.join(workspaceRoot, "docs", "old", "0001.md"), "still here");
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new", "0001.md"), "moved content");
  writeConfirmedSource(planningRoot, idMove, { confirmedContentHash: "irrelevant-for-this-case".padEnd(64, "0") });

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "move", sourceId: idMove, fromPath: "docs/old/", path: "docs/new/", observedFingerprint: "f".repeat(64), observedContentHash: "f".repeat(64) }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "move_source_still_exists"));
}

// move: contentHash must match the CONFIRMED contentHash -- a "move" that changes content is not a move
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new", "0001.md"), "genuinely different content");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "new"), { maxBytes: 1024 * 1024 });
  writeConfirmedSource(planningRoot, idMove, { confirmedContentHash: "0".repeat(64) }); // does not equal real.contentHash

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "move", sourceId: idMove, fromPath: "docs/old/", path: "docs/new/", observedFingerprint: real.fingerprint, observedContentHash: real.contentHash }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "move_content_mismatch"));
}

// move: fully legitimate move -- fromPath matches, old path gone, content preserved, live fingerprint matches claim
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "new"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "new", "0001.md"), "preserved content");
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "new"), { maxBytes: 1024 * 1024 });
  writeConfirmedSource(planningRoot, idMove, { confirmedContentHash: real.contentHash });

  const proposal = {
    scanParameters: { maxSourceBytes: 1024 * 1024 },
    sources: [{ action: "move", sourceId: idMove, fromPath: "docs/old/", path: "docs/new/", observedFingerprint: real.fingerprint, observedContentHash: real.contentHash }]
  };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
}

// remove: no fingerprint claim to verify -- but the sourceId must still be a real, confirmed source
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  writeConfirmedSource(planningRoot, idMove);
  const proposal = { scanParameters: { maxSourceBytes: 1024 * 1024 }, sources: [{ action: "remove", sourceId: idMove }] };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
}

// remove: sourceId does not exist in the confirmed catalog at all -- rejected, not silently accepted
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const proposal = { scanParameters: { maxSourceBytes: 1024 * 1024 }, sources: [{ action: "remove", sourceId: idMove }] };
  const result = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unknown_source_id" && e.sourceId === idMove));
}

console.log("discovery-proposal-fingerprints: add/update/move/remove fingerprint re-verification, path confinement, move identity checks, and remove-target existence all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discovery-proposal-fingerprints.test.mjs`
Expected: FAIL with `verifySourceFingerprints is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoveryProposal.mjs` (add `import fs from "node:fs";`, `import { computeSourceFingerprint, FingerprintError } from "./fingerprint.mjs";`, `import { confineScopePath, PathConfinementError } from "./paths.mjs";`, `import { readConfirmedSources } from "./discoverScan.mjs";` at the top):

```js
function verifyOneSourceAction(entry, { confirmedById, workspaceRoot, maxSourceBytes }) {
  if (entry.action === "add") {
    return verifyClaimedFingerprint(entry, entry.path, workspaceRoot, maxSourceBytes);
  }

  // update, move, and remove all reference an existing sourceId -- confirm it's real before
  // doing anything else. Without this, "remove" was the only action type that could target a
  // completely fictitious sourceId and pass validation (update/move already reject via
  // unknown_source_id below; remove used to skip this lookup entirely).
  const confirmed = confirmedById.get(entry.sourceId);
  if (!confirmed) {
    return [{ code: "unknown_source_id", sourceId: entry.sourceId, message: `sources[] entry references sourceId ${entry.sourceId}, which is not in the confirmed catalog` }];
  }

  if (entry.action === "remove") return []; // existence already confirmed above; no fingerprint claim to verify

  if (entry.action === "update") {
    return verifyClaimedFingerprint(entry, confirmed.path, workspaceRoot, maxSourceBytes);
  }

  // entry.action === "move"
  const errors = [];
  if (entry.fromPath !== confirmed.path) {
    errors.push({ code: "move_frompath_mismatch", sourceId: entry.sourceId, message: `move claims fromPath ${entry.fromPath}, but the confirmed catalog has this source registered at ${confirmed.path}` });
    return errors; // the rest of the move checks are meaningless if the identity claim is already wrong
  }
  let oldAbsolutePath;
  try {
    oldAbsolutePath = confineScopePath(workspaceRoot, entry.fromPath);
  } catch (error) {
    if (!(error instanceof PathConfinementError)) throw error;
    return [{ code: "untrusted_source_path", sourceId: entry.sourceId, path: entry.fromPath, message: error.message }];
  }
  if (fs.existsSync(oldAbsolutePath)) {
    errors.push({ code: "move_source_still_exists", sourceId: entry.sourceId, message: `move claims fromPath ${entry.fromPath} is now empty, but it still exists in the live workspace` });
  }
  if (entry.observedContentHash !== confirmed.confirmedContentHash) {
    errors.push({ code: "move_content_mismatch", sourceId: entry.sourceId, message: "move's claimed contentHash does not match the confirmed source's contentHash -- this is not a content-preserving move" });
  }
  errors.push(...verifyClaimedFingerprint(entry, entry.path, workspaceRoot, maxSourceBytes));
  return errors;
}

function verifyClaimedFingerprint(entry, relativePath, workspaceRoot, maxSourceBytes) {
  let absolutePath;
  try {
    absolutePath = confineScopePath(workspaceRoot, relativePath);
  } catch (error) {
    if (!(error instanceof PathConfinementError)) throw error;
    return [{ code: "untrusted_source_path", sourceId: entry.sourceId ?? null, path: relativePath, message: error.message }];
  }
  let observed;
  try {
    observed = computeSourceFingerprint(absolutePath, { maxBytes: maxSourceBytes });
  } catch (error) {
    if (!(error instanceof FingerprintError)) throw error;
    return [{ code: error.code, sourceId: entry.sourceId ?? null, path: relativePath, message: error.message }];
  }
  const errors = [];
  if (observed.fingerprint !== entry.observedFingerprint || observed.contentHash !== entry.observedContentHash) {
    errors.push({
      code: "fingerprint_mismatch",
      sourceId: entry.sourceId ?? null,
      path: relativePath,
      message: "the proposal's claimed fingerprint does not match what is actually observed in the live workspace",
      claimedFingerprint: entry.observedFingerprint,
      observedFingerprint: observed.fingerprint
    });
  }
  return errors;
}

export function verifySourceFingerprints({ proposal, planningRoot, workspaceRoot }) {
  const confirmedById = new Map(readConfirmedSources(planningRoot).map((s) => [s.id, s]));
  const errors = [];
  for (const entry of proposal.sources || []) {
    errors.push(...verifyOneSourceAction(entry, { confirmedById, workspaceRoot, maxSourceBytes: proposal.scanParameters.maxSourceBytes }));
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discovery-proposal-fingerprints.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoveryProposal.mjs runtime/src/lib/tests/discovery-proposal-fingerprints.test.mjs
git commit -m "feat(discovery): re-verify every claimed fingerprint live, including move identity checks"
```

---

### Task 6: `resolveSourceReferences` — step 4b (dangling `sourceRef` detection)

**Files:**
- Modify: `runtime/src/lib/discoveryProposal.mjs`
- Test: `runtime/src/lib/tests/discovery-proposal-references.test.mjs`

**Interfaces:**
- Consumes: `readConfirmedSources` (`../lib/discoverScan.mjs`).
- Produces: `resolveSourceReferences({ proposal, planningRoot })` → `{ ok: true } | { ok: false, errors: [...] }`. Every `sourceRef` in every `scopeCommands[]` entry (including `alternatives[]`) must resolve to either an `update`/`move` entry in this same proposal, or an already-confirmed catalog `sourceId` — per this plan's Global Constraints, **never** an `add` entry (no ID exists yet).

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discovery-proposal-references.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { resolveSourceReferences } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-refs-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "sources"), { recursive: true });
  return { planningRoot };
}

function writeConfirmedSource(planningRoot, id) {
  const dir = path.join(planningRoot, "sources", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "source.yml"), stringifyYaml({
    schemaVersion: 1, id, path: "docs/x/", family: "decision-sources", kind: "decision", role: "decision",
    authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
    confirmedFingerprint: "0".repeat(64), confirmedContentHash: "0".repeat(64),
    provenance: { discoveredBy: "discover-scan", confirmedBy: "carlos", confirmedAt: "2026-07-25T10:00:00Z", confirmedOperationId: "018f4d1e-0000-7000-8000-000000000009" }
  }));
}

const scopeId = "018f4d1e-0000-7000-8000-000000000001";
const confirmedId = "018f4d1e-0000-7000-8000-000000000002";
const updatedId = "018f4d1e-0000-7000-8000-000000000003";
const danglingId = "018f4d1e-0000-7000-8000-000000000004";

function commandEntry(sourceId) {
  return {
    scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
    sourceRefs: [sourceId], sourceFingerprintAtSelection: { [sourceId]: "a".repeat(64) },
    requiresEnvironment: false, requiresSecrets: false, alternatives: []
  };
}

// resolves against an already-confirmed catalog source -> ok
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedSource(planningRoot, confirmedId);
  const proposal = { sources: [], scopeCommands: [commandEntry(confirmedId)] };
  assert.equal(resolveSourceReferences({ proposal, planningRoot }).ok, true);
}

// resolves against an update/move entry in the SAME proposal -> ok
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "update", sourceId: updatedId, observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }],
    scopeCommands: [commandEntry(updatedId)]
  };
  assert.equal(resolveSourceReferences({ proposal, planningRoot }).ok, true);
}

// does NOT resolve against an add entry (no id yet) -- referencing it is always dangling
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "add", path: "docs/y/", family: "decision-sources", kind: "decision", role: "decision", authority: { standing: "authoritative", force: "normative" }, availability: "implemented", observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }],
    scopeCommands: [commandEntry(danglingId)]
  };
  const result = resolveSourceReferences({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "dangling_source_ref" && e.sourceId === danglingId));
}

// no match anywhere -> dangling
{
  const { planningRoot } = makeWorkspace();
  const proposal = { sources: [], scopeCommands: [commandEntry(danglingId)] };
  const result = resolveSourceReferences({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "dangling_source_ref" && e.sourceId === danglingId));
}

// dangling ref inside alternatives[] is caught too, not just the selected command
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedSource(planningRoot, confirmedId);
  const proposal = {
    sources: [],
    scopeCommands: [{
      ...commandEntry(confirmedId),
      alternatives: [{
        command: "./alt", sourceRefs: [danglingId], sourceFingerprintAtSelection: { [danglingId]: "a".repeat(64) },
        confidence: "medium", requiresEnvironment: false, requiresSecrets: false
      }]
    }]
  };
  const result = resolveSourceReferences({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "dangling_source_ref" && e.sourceId === danglingId));
}

console.log("discovery-proposal-references: resolves against confirmed catalog and same-proposal update/move, rejects add and truly dangling refs (including inside alternatives)");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discovery-proposal-references.test.mjs`
Expected: FAIL with `resolveSourceReferences is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoveryProposal.mjs`:

```js
function resolvableSourceIds(proposal, confirmedIds) {
  const resolvable = new Set(confirmedIds);
  for (const entry of proposal.sources || []) {
    if (entry.action === "update" || entry.action === "move") resolvable.add(entry.sourceId);
    // "add" deliberately excluded -- no sourceId exists yet; "remove" deliberately excluded --
    // referencing a source being removed is handled as its own check in Task 8
  }
  return resolvable;
}

export function resolveSourceReferences({ proposal, planningRoot }) {
  const confirmedIds = readConfirmedSources(planningRoot).map((s) => s.id);
  const resolvable = resolvableSourceIds(proposal, confirmedIds);
  const errors = [];

  for (const command of proposal.scopeCommands || []) {
    for (const ref of command.sourceRefs || []) {
      if (!resolvable.has(ref)) {
        errors.push({ code: "dangling_source_ref", scopeId: command.scopeId, role: command.role, sourceId: ref, message: `sourceRef ${ref} does not resolve to a confirmed source or an update/move in this same proposal` });
      }
    }
    for (const alternative of command.alternatives || []) {
      for (const ref of alternative.sourceRefs || []) {
        if (!resolvable.has(ref)) {
          errors.push({ code: "dangling_source_ref", scopeId: command.scopeId, role: command.role, sourceId: ref, message: `alternative sourceRef ${ref} does not resolve to a confirmed source or an update/move in this same proposal` });
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discovery-proposal-references.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoveryProposal.mjs runtime/src/lib/tests/discovery-proposal-references.test.mjs
git commit -m "feat(discovery): reject dangling sourceRefs, including refs to not-yet-existing add entries"
```

---

### Task 7: `checkDriftReconciliation` — step 4c (unaddressed drift on a confirmed source/command)

**Files:**
- Modify: `runtime/src/lib/discoveryProposal.mjs`
- Test: `runtime/src/lib/tests/discovery-proposal-drift-reconciliation.test.mjs`

**Interfaces:**
- Consumes: `freshScan.knownSources`/`freshScan.knownCommandsEvidence` (already computed by Task 4's `verifyWorkspaceConsistency` — this step reuses that result rather than recomputing drift a second time).
- Produces: `checkDriftReconciliation({ proposal, freshScan })` → `{ ok: true } | { ok: false, errors: [...] }`. A confirmed source with `driftState !== "unchanged"` not addressed by a `sources[]` action for that `sourceId` → rejected. A confirmed command with `evidenceState` outside `{current, not-evidence-backed}` not addressed by a `scopeCommands[]` entry for that `(scopeId, role)` → rejected.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discovery-proposal-drift-reconciliation.test.mjs
import assert from "node:assert/strict";
import { checkDriftReconciliation } from "../discoveryProposal.mjs";

const srcA = "018f4d1e-0000-7000-8000-000000000001";
const scopeId = "018f4d1e-0000-7000-8000-000000000002";

// unchanged source, current command evidence -> nothing to reconcile, ok even with an empty proposal
{
  const freshScan = {
    knownSources: [{ sourceId: srcA, driftState: "unchanged" }],
    knownCommandsEvidence: [{ scopeId, role: "build", evidenceState: "current" }]
  };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, true);
}

// not-evidence-backed (declared) command never needs reconciliation, regardless of anything else
{
  const freshScan = {
    knownSources: [],
    knownCommandsEvidence: [{ scopeId, role: "test", evidenceState: "not-evidence-backed" }]
  };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, true);
}

// changed source, unaddressed -> rejected
{
  const freshScan = { knownSources: [{ sourceId: srcA, driftState: "changed" }], knownCommandsEvidence: [] };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unreconciled_source_drift" && e.sourceId === srcA));
}

// changed source, addressed via an update action -> ok
{
  const freshScan = { knownSources: [{ sourceId: srcA, driftState: "changed" }], knownCommandsEvidence: [] };
  const proposal = { sources: [{ action: "update", sourceId: srcA, observedFingerprint: "a".repeat(64), observedContentHash: "b".repeat(64) }], scopeCommands: [] };
  const result = checkDriftReconciliation({ proposal, freshScan });
  assert.equal(result.ok, true);
}

// missing source, addressed via remove -> ok
{
  const freshScan = { knownSources: [{ sourceId: srcA, driftState: "missing" }], knownCommandsEvidence: [] };
  const proposal = { sources: [{ action: "remove", sourceId: srcA }], scopeCommands: [] };
  const result = checkDriftReconciliation({ proposal, freshScan });
  assert.equal(result.ok, true);
}

// moved source, unaddressed -> rejected
{
  const freshScan = { knownSources: [{ sourceId: srcA, driftState: "moved", observedAtPath: "docs/new/" }], knownCommandsEvidence: [] };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unreconciled_source_drift" && e.sourceId === srcA));
}

// evidence-drifted command, unaddressed -> rejected
{
  const freshScan = { knownSources: [], knownCommandsEvidence: [{ scopeId, role: "build", evidenceState: "evidence-drifted" }] };
  const result = checkDriftReconciliation({ proposal: { sources: [], scopeCommands: [] }, freshScan });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unreconciled_command_evidence" && e.scopeId === scopeId && e.role === "build"));
}

// evidence-updated command, addressed by re-selecting it in scopeCommands -> ok
{
  const freshScan = { knownSources: [], knownCommandsEvidence: [{ scopeId, role: "build", evidenceState: "evidence-updated" }] };
  const proposal = {
    sources: [],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [srcA], sourceFingerprintAtSelection: { [srcA]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  };
  const result = checkDriftReconciliation({ proposal, freshScan });
  assert.equal(result.ok, true);
}

console.log("discovery-proposal-drift-reconciliation: unaddressed source/command drift is rejected, addressed drift and not-evidence-backed commands pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discovery-proposal-drift-reconciliation.test.mjs`
Expected: FAIL with `checkDriftReconciliation is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoveryProposal.mjs`:

```js
export function checkDriftReconciliation({ proposal, freshScan }) {
  const errors = [];

  const addressedSourceIds = new Set((proposal.sources || []).filter((e) => e.action !== "add").map((e) => e.sourceId));
  for (const known of freshScan.knownSources) {
    if (known.driftState === "unchanged") continue;
    if (!addressedSourceIds.has(known.sourceId)) {
      errors.push({ code: "unreconciled_source_drift", sourceId: known.sourceId, driftState: known.driftState, message: `source ${known.sourceId} has unreconciled drift (${known.driftState}) and is not addressed by any sources[] action in this proposal` });
    }
  }

  const addressedCommands = new Set((proposal.scopeCommands || []).map((c) => `${c.scopeId}:${c.role}`));
  const NEEDS_RECONCILIATION = new Set(["evidence-missing", "evidence-drifted", "evidence-updated", "unknown"]);
  for (const evidence of freshScan.knownCommandsEvidence) {
    if (!NEEDS_RECONCILIATION.has(evidence.evidenceState)) continue;
    if (!addressedCommands.has(`${evidence.scopeId}:${evidence.role}`)) {
      errors.push({ code: "unreconciled_command_evidence", scopeId: evidence.scopeId, role: evidence.role, evidenceState: evidence.evidenceState, message: `command ${evidence.scopeId}/${evidence.role} has unreconciled evidence (${evidence.evidenceState}) and is not addressed by any scopeCommands[] entry in this proposal` });
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discovery-proposal-drift-reconciliation.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoveryProposal.mjs runtime/src/lib/tests/discovery-proposal-drift-reconciliation.test.mjs
git commit -m "feat(discovery): require unaddressed source/command drift to block a proposal"
```

---

### Task 8: `checkRemovalReferentialIntegrity` — step 4d (a removed source must not be referenced anywhere)

**Files:**
- Modify: `runtime/src/lib/discoveryProposal.mjs`
- Test: `runtime/src/lib/tests/discovery-proposal-removal-integrity.test.mjs`

**Interfaces:**
- Consumes: `readConfirmedScopes`, `allCommandEntries` (`../lib/discoverScan.mjs`, Task 1).
- Produces: `checkRemovalReferentialIntegrity({ proposal, planningRoot })` → `{ ok: true } | { ok: false, errors: [...] }`. For every `remove` action, rejects if the `sourceId` is still referenced (a) by any `scopeCommands[]` entry in this same proposal, or (b) by any already-confirmed scope's commands not otherwise touched by this proposal.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discovery-proposal-removal-integrity.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyYaml } from "../yaml.mjs";
import { checkRemovalReferentialIntegrity } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-removal-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(path.join(planningRoot, "scopes"), { recursive: true });
  return { planningRoot };
}

function writeConfirmedScope(planningRoot, scopeId, commands) {
  const dir = path.join(planningRoot, "scopes", scopeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "scope.yml"), stringifyYaml({
    schemaVersion: 1, id: scopeId, key: "api", label: "API", kind: "code", path: "api/", owner: null, commands
  }));
}

const scopeId = "018f4d1e-0000-7000-8000-000000000001";
const removedId = "018f4d1e-0000-7000-8000-000000000002";
const unrelatedId = "018f4d1e-0000-7000-8000-000000000003";

function confirmedCommand(sourceId) {
  return {
    build: {
      command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [sourceId], sourceFingerprintAtSelection: { [sourceId]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }
  };
}

// remove with no references anywhere -> ok
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedScope(planningRoot, scopeId, confirmedCommand(unrelatedId));
  const proposal = { sources: [{ action: "remove", sourceId: removedId }], scopeCommands: [] };
  assert.equal(checkRemovalReferentialIntegrity({ proposal, planningRoot }).ok, true);
}

// remove referenced by the CONFIRMED catalog, untouched by this proposal -> rejected
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedScope(planningRoot, scopeId, confirmedCommand(removedId));
  const proposal = { sources: [{ action: "remove", sourceId: removedId }], scopeCommands: [] };
  const result = checkRemovalReferentialIntegrity({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "remove_still_referenced" && e.sourceId === removedId));
}

// remove referenced by the confirmed catalog, BUT the same proposal also updates that command
// away from the removed source -> ok (the proposal reconciles it in the same batch)
{
  const { planningRoot } = makeWorkspace();
  writeConfirmedScope(planningRoot, scopeId, confirmedCommand(removedId));
  const proposal = {
    sources: [{ action: "remove", sourceId: removedId }],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [unrelatedId], sourceFingerprintAtSelection: { [unrelatedId]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  };
  assert.equal(checkRemovalReferentialIntegrity({ proposal, planningRoot }).ok, true);
}

// remove referenced by this proposal's OWN scopeCommands[] -- self-contradictory, rejected
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "remove", sourceId: removedId }],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [removedId], sourceFingerprintAtSelection: { [removedId]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false, alternatives: []
    }]
  };
  const result = checkRemovalReferentialIntegrity({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "remove_still_referenced" && e.sourceId === removedId));
}

// remove referenced only inside an alternatives[] entry (not the selected command) -- still caught
{
  const { planningRoot } = makeWorkspace();
  const proposal = {
    sources: [{ action: "remove", sourceId: removedId }],
    scopeCommands: [{
      scopeId, role: "build", command: "./x", method: "reviewed", confidence: "high",
      sourceRefs: [unrelatedId], sourceFingerprintAtSelection: { [unrelatedId]: "a".repeat(64) },
      requiresEnvironment: false, requiresSecrets: false,
      alternatives: [{ command: "./alt", sourceRefs: [removedId], sourceFingerprintAtSelection: { [removedId]: "a".repeat(64) }, confidence: "medium", requiresEnvironment: false, requiresSecrets: false }]
    }]
  };
  const result = checkRemovalReferentialIntegrity({ proposal, planningRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "remove_still_referenced" && e.sourceId === removedId));
}

console.log("discovery-proposal-removal-integrity: unreferenced removes pass, references in the confirmed catalog or the proposal's own commands (including alternatives) are rejected unless reconciled in the same proposal");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discovery-proposal-removal-integrity.test.mjs`
Expected: FAIL with `checkRemovalReferentialIntegrity is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoveryProposal.mjs` (add `import { readConfirmedScopes, allCommandEntries } from "./discoverScan.mjs";` — merge with the existing `discoverScan.mjs` import line rather than duplicating it):

```js
function allProposalSourceRefs(proposal) {
  const refs = new Set();
  for (const command of proposal.scopeCommands || []) {
    for (const ref of command.sourceRefs || []) refs.add(ref);
    for (const alternative of command.alternatives || []) {
      for (const ref of alternative.sourceRefs || []) refs.add(ref);
    }
  }
  return refs;
}

function confirmedSourceRefsExcludingTouchedCommands(planningRoot, touchedCommandKeys) {
  const refs = new Set();
  for (const scope of readConfirmedScopes(planningRoot)) {
    for (const { role, entry } of allCommandEntries(scope)) {
      if (touchedCommandKeys.has(`${scope.id}:${role}`)) continue; // this proposal already reconciles it
      for (const ref of entry.sourceRefs || []) refs.add(ref);
      for (const alternative of entry.alternatives || []) {
        for (const ref of alternative.sourceRefs || []) refs.add(ref);
      }
    }
  }
  return refs;
}

export function checkRemovalReferentialIntegrity({ proposal, planningRoot }) {
  const removedIds = (proposal.sources || []).filter((e) => e.action === "remove").map((e) => e.sourceId);
  if (removedIds.length === 0) return { ok: true };

  const inThisProposal = allProposalSourceRefs(proposal);
  const touchedCommandKeys = new Set((proposal.scopeCommands || []).map((c) => `${c.scopeId}:${c.role}`));
  const inConfirmedCatalog = confirmedSourceRefsExcludingTouchedCommands(planningRoot, touchedCommandKeys);

  const errors = [];
  for (const sourceId of removedIds) {
    if (inThisProposal.has(sourceId) || inConfirmedCatalog.has(sourceId)) {
      errors.push({ code: "remove_still_referenced", sourceId, message: `source ${sourceId} is marked for removal but is still referenced by a command (either in this proposal or the confirmed catalog)` });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discovery-proposal-removal-integrity.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/lib/discoveryProposal.mjs runtime/src/lib/tests/discovery-proposal-removal-integrity.test.mjs
git commit -m "feat(discovery): reject remove actions still referenced anywhere, including alternatives"
```

---

### Task 9: `validateDiscoveryProposal` — the orchestrator (sequential, all-or-nothing)

**Files:**
- Modify: `runtime/src/lib/discoveryProposal.mjs`
- Test: `runtime/src/lib/tests/discovery-proposal-validate.test.mjs`

**Interfaces:**
- Consumes: `validateProposalStructure`, `verifyWorkspaceConsistency`, `verifySourceFingerprints`, `resolveSourceReferences`, `checkDriftReconciliation`, `checkRemovalReferentialIntegrity` (Tasks 3–8, all in this same file).
- Produces: `validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot })` → `{ ok: true, normalized: { proposal, verifiedAt, workspaceHash, scanParameters } } | { ok: false, errors: [...] }`. Runs the four gates **sequentially** — structure → consistency → fingerprints+references+drift+removal — stopping at the first gate that fails (a later gate depends on an earlier one having already established a sound baseline; running it against unsound input would produce meaningless results, not just redundant ones). Within the combined step-4 gate, every sub-check's errors are still collected together rather than stopping at the first sub-check.

- [ ] **Step 1: Write the failing test**

```js
// runtime/src/lib/tests/discovery-proposal-validate.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDiscoverScan } from "../discoverScan.mjs";
import { computeSourceFingerprint } from "../fingerprint.mjs";
import { validateDiscoveryProposal } from "../discoveryProposal.mjs";

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-validate-"));
  const planningRoot = path.join(workspaceRoot, ".planning");
  fs.mkdirSync(planningRoot, { recursive: true });
  return { workspaceRoot, planningRoot };
}

// a fully valid, self-consistent proposal -> ok, with a normalized result usable by a later plan
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "docs", "adr", "0001.md"), "decision");
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });
  const real = computeSourceFingerprint(path.join(workspaceRoot, "docs", "adr"), { maxBytes: 1024 * 1024 });

  const proposal = {
    schemaVersion: 1,
    scanId: scan.scanId,
    baseRevision: scan.baseRevision,
    scanParameters: scan.scanParameters,
    scopes: [],
    sources: [{
      action: "add", path: "docs/adr/", family: "decision-sources", kind: "decision", role: "decision",
      authority: { standing: "authoritative", force: "normative" }, availability: "implemented",
      observedFingerprint: real.fingerprint, observedContentHash: real.contentHash
    }],
    scopeCommands: [],
    diagnostics: []
  };

  const result = validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, true);
  assert.equal(result.normalized.workspaceHash, scan.baseRevision.workspaceHash);
  assert.equal(result.normalized.scanParameters.maxSourceBytes, 1024 * 1024);
  assert.deepEqual(result.normalized.proposal, proposal);
}

// structural failure short-circuits before any live re-scan happens
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const malformedProposal = { schemaVersion: 1, notAValidShape: true };
  const result = validateDiscoveryProposal({ proposal: malformedProposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "schema_invalid"));
}

// consistency failure (stale) short-circuits before fingerprint/reference/drift checks run
{
  const { workspaceRoot, planningRoot } = makeWorkspace();
  const scan = runDiscoverScan({ planningRoot, workspaceRoot, maxSourceBytes: 1024 * 1024 });
  const proposal = {
    schemaVersion: 1, scanId: scan.scanId, baseRevision: scan.baseRevision, scanParameters: scan.scanParameters,
    scopes: [], sources: [{ action: "remove", sourceId: "018f4d1e-0000-7000-8000-000000000099" }], scopeCommands: [], diagnostics: []
  };
  fs.mkdirSync(path.join(workspaceRoot, "somewhere-new"));

  const result = validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "stale_proposal"));
  assert.equal(result.errors.some((e) => e.code === "unknown_source_id"), false, "step 4 must never run once step 3 already failed");
}

console.log("discovery-proposal-validate: fully valid proposals pass with a usable normalized result, and each gate short-circuits the ones after it");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node runtime/src/lib/tests/discovery-proposal-validate.test.mjs`
Expected: FAIL with `validateDiscoveryProposal is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `runtime/src/lib/discoveryProposal.mjs`:

```js
export function validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot }) {
  const structure = validateProposalStructure(proposal);
  if (!structure.ok) return structure;

  const consistency = verifyWorkspaceConsistency({ proposal, planningRoot, workspaceRoot });
  if (!consistency.ok) return consistency;
  const { freshScan } = consistency;

  const fingerprints = verifySourceFingerprints({ proposal, planningRoot, workspaceRoot });
  const references = resolveSourceReferences({ proposal, planningRoot });
  const drift = checkDriftReconciliation({ proposal, freshScan });
  const removal = checkRemovalReferentialIntegrity({ proposal, planningRoot });

  const stepFourErrors = [
    ...(fingerprints.ok ? [] : fingerprints.errors),
    ...(references.ok ? [] : references.errors),
    ...(drift.ok ? [] : drift.errors),
    ...(removal.ok ? [] : removal.errors)
  ];
  if (stepFourErrors.length > 0) return { ok: false, errors: stepFourErrors };

  return {
    ok: true,
    normalized: {
      proposal,
      verifiedAt: new Date().toISOString(),
      workspaceHash: freshScan.baseRevision.workspaceHash,
      scanParameters: freshScan.scanParameters
    }
  };
}
```

Note the four step-4 sub-checks (`verifySourceFingerprints`, `resolveSourceReferences`, `checkDriftReconciliation`, `checkRemovalReferentialIntegrity`) are all run **unconditionally** and their errors merged, rather than short-circuiting on the first one — they're independent checks over the same already-consistency-verified proposal, so collecting all four kinds of problems in one pass is strictly better UX than making the caller fix one, resubmit, and discover the next.

- [ ] **Step 4: Run test to verify it passes**

Run: `node runtime/src/lib/tests/discovery-proposal-validate.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run every test file for this plan together, to confirm the fully-assembled module is internally consistent**

Run:
```bash
for f in discovery-proposal-schema discovery-proposal-structure discovery-proposal-consistency discovery-proposal-fingerprints discovery-proposal-references discovery-proposal-drift-reconciliation discovery-proposal-removal-integrity discovery-proposal-validate; do
  node runtime/src/lib/tests/$f.test.mjs || echo "FAILED: $f"
done
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add runtime/src/lib/discoveryProposal.mjs runtime/src/lib/tests/discovery-proposal-validate.test.mjs
git commit -m "feat(discovery): assemble the sequential, all-or-nothing DiscoveryProposal validation pipeline"
```

---

### Task 10: CLI wiring — `discover validate --file <path> | --stdin`

**Files:**
- Modify: `runtime/src/commands/discover.mjs`
- Modify: `runtime/src/index.mjs`
- Test: `runtime/src/commands/tests/discover.test.mjs`, `runtime/src/tests/dispatcher.test.mjs`

**Interfaces:**
- Produces: `runDiscoverValidate({ planningRoot, workspaceRoot, proposalText })` → parses `proposalText` as JSON, calls `validateDiscoveryProposal`, throws `UsageError` on malformed JSON (never lets a `SyntaxError` leak out as an uncaught crash — exit-code 2 territory — when it's really a usage mistake, exit-code 1 territory). `dispatch("discover", ["validate", "--file", <path>], cwd)` / `dispatch("discover", ["validate", "--stdin"], ...)` reading from fd 0, mirroring the existing `changeset propose --payload-file <file|->` pattern in `index.mjs` exactly (reuse `readPayloadText`, already defined there, rather than writing a second file-or-stdin reader).

- [ ] **Step 1: Write the failing test**

Read `runtime/src/commands/tests/discover.test.mjs` and `runtime/src/tests/dispatcher.test.mjs` first (both pre-existing, both already read in full earlier in this plan's design) and add to each, in their established inline style — no shared setup helper in either file.

Append to `runtime/src/commands/tests/discover.test.mjs`, before its final `console.log`:
```js
// discover validate -- malformed JSON is a UsageError (exit 1), never an uncaught crash (exit 2)
{
  let threw = false;
  try {
    runDiscoverValidate({ planningRoot, workspaceRoot, proposalText: "{ not valid json" });
  } catch (error) {
    threw = true;
    assert.ok(error instanceof UsageError, `expected UsageError, got ${error}`);
  }
  assert.ok(threw);
}

// discover validate -- a well-formed but structurally-invalid proposal returns {ok:false}, not a thrown error
{
  const result = runDiscoverValidate({ planningRoot, workspaceRoot, proposalText: JSON.stringify({ schemaVersion: 1 }) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "schema_invalid"));
}
```
And add `import { runDiscoverValidate } from "../discover.mjs";` to that file's existing import list (alongside `runDiscoverScan`).

Append to `runtime/src/tests/dispatcher.test.mjs`, before its final `console.log`:
```js
const validatePayload = path.join(cwd, "invalid-proposal.json");
fs.writeFileSync(validatePayload, JSON.stringify({ schemaVersion: 1 }));
const validateResult = dispatch("discover", ["validate", "--file", validatePayload], cwd);
assert.equal(validateResult.ok, false);
assert.ok(validateResult.errors.some((e) => e.code === "schema_invalid"));

assert.throws(() => dispatch("discover", ["validate"], cwd), UsageError, "discover validate requires --file or --stdin");
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node runtime/src/commands/tests/discover.test.mjs
node runtime/src/tests/dispatcher.test.mjs
```
Expected: FAIL — `runDiscoverValidate` does not exist yet; `discover validate` currently falls through to `notImplemented`.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `runtime/src/commands/discover.mjs` (currently just the single re-export line from Task 1) with:
```js
export { runDiscoverScan, DEFAULT_MAX_SOURCE_BYTES, MIN_MAX_SOURCE_BYTES, MAX_MAX_SOURCE_BYTES } from "../lib/discoverScan.mjs";
import { UsageError } from "../lib/errors.mjs";
import { validateDiscoveryProposal } from "../lib/discoveryProposal.mjs";

export function runDiscoverValidate({ planningRoot, workspaceRoot, proposalText }) {
  let proposal;
  try {
    proposal = JSON.parse(proposalText);
  } catch (error) {
    throw new UsageError(`invalid proposal JSON: ${error.message}`);
  }
  return validateDiscoveryProposal({ proposal, planningRoot, workspaceRoot });
}
```

In `runtime/src/index.mjs`, add to the imports:
```js
import { runDiscoverScan, runDiscoverValidate } from "./commands/discover.mjs";
```
(replacing the existing `import { runDiscoverScan } from "./commands/discover.mjs";` line).

Add a new branch inside the existing `if (command === "discover") { const [stage, ...rest] = args; ... }` block, alongside the existing `if (stage === "scan")` branch:
```js
    if (stage === "validate") {
      const options = argsToOptions(rest);
      const proposalText = readPayloadText(options.file || (options.stdin ? "-" : undefined), cwd);
      return runDiscoverValidate({ planningRoot, workspaceRoot: cwd, proposalText });
    }
```

`readPayloadText` already exists in `index.mjs` (used by `changeset propose --payload-file`) and already handles `"-"` meaning stdin and throwing `UsageError` for a missing/absent file argument — reused here rather than duplicated. Note `readPayloadText`'s existing signature takes `(payloadFileArg, cwd)` and already throws `UsageError` when `payloadFileArg` is falsy, so `options.file || (options.stdin ? "-" : undefined)` correctly produces `undefined` (triggering that existing `UsageError`) when neither `--file` nor `--stdin` is given.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node runtime/src/commands/tests/discover.test.mjs
node runtime/src/tests/dispatcher.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/src/commands/discover.mjs runtime/src/index.mjs runtime/src/commands/tests/discover.test.mjs runtime/src/tests/dispatcher.test.mjs
git commit -m "feat(discovery): wire discover validate into the CLI dispatcher"
```

---

### Task 11: Full regression and Plan 2 Definition of Done

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `npm run build:schemas && npm run test:unit`
Expected: all test files pass, including every new file added in Tasks 1–10.

- [ ] **Step 2: Run the full runtime build and bundle checks**

Run: `npm run build:runtime && npm run test:bundle`
Expected: bundle builds successfully and stays self-contained.

- [ ] **Step 3: Run the existing e2e and next-generation verification**

Run: `npm run test:cli-e2e && npm run verify:next-generation`
Expected: both pass unchanged — this plan adds a new CLI command and one new schema but does not touch the ChangeSet engine, lock, journal, or recovery machinery.

- [ ] **Step 4: Confirm repo hygiene**

Run: `git status --short` and `git diff --stat develop...HEAD`
Expected: no stray temp files; the diff only touches the files from Tasks 1–10 plus generated artifacts.

- [ ] **Step 5: Definition of Done checklist**

- [ ] Every `observedFingerprint`/`observedContentHash` claim anywhere in a `DiscoveryProposal` is independently recomputed and compared before being trusted — confirm by grepping `runtime/src/lib/discoveryProposal.mjs` for every place `entry.observedFingerprint`/`entry.observedContentHash` is *read* and confirming each is only ever compared against a freshly computed value, never written into a result without that comparison.
- [ ] Every host-repository path touched (`sources[].path`, `.fromPath`, and confirmed-source paths looked up by `sourceId`) goes through `confineScopePath` before any filesystem access — confirm by grepping for any `path.join(workspaceRoot, ...)` in `discoveryProposal.mjs` bypassing it (there should be none).
- [ ] `discover validate` never writes to `.planning/` under any code path — confirm by grepping `runtime/src/lib/discoveryProposal.mjs` and the new parts of `runtime/src/commands/discover.mjs` for `writeFileSync`/`writeFileAtomic`/`ensureDirectoryTree` (there should be none).
- [ ] The four step-4 sub-checks (fingerprints, references, drift, removal integrity) each have a dedicated adversarial test proving they reject the case they exist to catch, not just a happy-path test.
- [ ] The orchestrator's short-circuit behavior (step 3 failure prevents step 4 from running at all) has an explicit test, not just an implicit assumption.
- [ ] `move` identity is verified on three independent axes (fromPath matches the confirmed registration, the old path is actually gone, contentHash is preserved) — each has its own adversarial test, not one combined test that could pass for the wrong reason.
- [ ] No new npm dependency was added (`git diff develop...HEAD -- package.json package-lock.json` is empty).
- [ ] This plan does not introduce any new ChangeSet `kind` and does not modify `changeset.mjs`, `mutation.mjs`, `lock.mjs`, `journal.mjs`, `recovery.mjs`, or `changesetCommand.mjs` — confirm with `git diff --stat` against the base branch.
- [ ] `docs/superpowers/plans/2026-07-25-discovery-iteration-INDEX.md` is updated: this plan marked done only once merged, Plan 3 (ChangeSet integration) still clearly open and now unblocked.
