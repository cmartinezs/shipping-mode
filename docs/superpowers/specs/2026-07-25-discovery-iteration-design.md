# Discovery Iteration — Design

Status: approved by user section-by-section, 2026-07-25. Terminal state before this design: implementer moves to `superpowers:writing-plans`.

## A — Scope & Goals

This iteration is the "iteración obligatoria siguiente" explicitly deferred by Corte 0
(see `docs/plans/corte-0-runtime-foundation-implementation.md` and
`docs/specs/corte-0-runtime-foundation.md`), scoped up to include the full host
knowledge-model taxonomy from `docs/plugin-redesign-release-flow/04-release-init-configuracion.md`
and `05-scope-task-guides.md`, not just the minimal 4-item list Corte 0 named.

**Builds:**

- `discover scan`: read-only, deterministic enumeration — git detection, scope
  candidates, source candidates (by family), and drift for already-confirmed
  sources/commands.
- A **sources catalog** in `.planning` (new schema): `family`, `kind`, `role`,
  `authority` (two dimensions), `availability`, fingerprint, provenance.
- An extension to the **scope** schema with normalized `commands.{build,test,smoke,lint,verify,custom.*}`,
  each traceable to its evidence.
- `discover propose`: bulk command that takes the skill's classification
  (`DiscoveryProposal`), re-verifies every mechanical claim against the live
  workspace, detects command conflicts, reconciles drift, and produces one
  ChangeSet.
- **Autonomy configuration** (family+authority for sources, confidence+conflict
  for commands) that gates whether the skill may auto-approve, enforced
  server-side by `changeset approve --mode autonomous|human`.
- Minimal drift lifecycle: `new/unchanged/changed/missing/moved`, computed
  on demand, never persisted as a separate state.

**Explicit non-goals (real, larger features named in 04/05, deliberately out of this slice):**

- Guide generation pipeline (`Source Index` → the `draft/generated/approved/stale/rejected`
  state machine in doc 05).
- Derivation of `concerns`/`gates`/`gate-profiles` from host cross-cutting strategies.
- Documentation entry-point navigability checks (broken links, orphaned docs).
- Hierarchical agent-instruction resolution **at execution time**
  (workspace→scope→path precedence). This iteration catalogs those sources; it
  does not implement runtime precedence logic when executing work.
- Environment claims (`defined/configured/deployed/verified`) with associated evidence.

## B — Data model: sources catalog

`discover scan` produces two independent candidate categories, not one:
**scope candidates** (folders/packages — the original Corte 0 pending item) and
**source candidates** (by family — the 19 families in
`04-release-init-configuracion.md:165-187`).

### Confirmed catalog entry

Persists **only** after a ChangeSet is applied — no `status` field, because the
existing Operation/ChangeSet lifecycle (`PROPOSED→VALIDATED→APPROVED→APPLYING→APPLIED`)
already provides "pending state" for free.

```yaml
- id: src_01J...
  path: docs/04-architecture/
  family: technical-sources        # 1 of 19 (doc 04:165-187)
  kind: architecture                # 1 of 24 (doc 04:200-226)
  role: canonical                   # 1 of 8 (doc 04:230-239)
  authority:
    standing: authoritative         # contextual | supporting | authoritative
    force: normative                 # unknown | informational | advisory | normative
  availability: mixed                # 1 of 7 (doc 04:262-269)
  confirmedFingerprint: sha256:...
  confirmedContentHash: sha256:...
  provenance:
    discoveredBy: discover-scan
    confirmedBy: carlos
    confirmedAt: "2026-07-25T10:00:00Z"
    confirmedOperationId: op_01J...
```

No `freshness`/`driftState` field lives here — see below.

### Ephemeral scan/proposal output (never persisted as-is)

```json
{
  "sourceId": "src_01J... | null",
  "path": "docs/04-architecture/",
  "observedFingerprint": "sha256:...",
  "observedContentHash": "sha256:...",
  "driftState": "new | unchanged | changed | missing | moved",
  "freshness": "current | stale | unknown",
  "observedAtPath": null
}
```

`freshness` is a derived alias of `driftState` for human reading
(`unchanged→current`, `changed→stale`, `new→unknown`); undefined for
`missing`/`moved` since `driftState` already fully describes those. If ever
cached, it must be explicitly marked recalculable/non-authoritative — the
recommendation is to never persist it at all.

### Fingerprint algorithm

**Single file:** `confirmedFingerprint = confirmedContentHash = sha256(bytes)`.
The manifest algorithm below applies only to directories.

**Directory — traversal rules:**

- Excludes `.git/` only; no other automatic exclusion (no `.gitignore`
  integration) — YAGNI for this iteration. An over-broad source is corrected
  by narrowing its registered `path`, which is exactly where a human already
  confirms.
- Symlinks are never followed, opened, or read — not even when the target
  points outside the workspace. Changing the **text** of a symlink's target
  changes the fingerprint; changing only the content of the object the link
  points to does **not** change it, because that object is never read.
- Content bytes only — no mtime/permissions/uid/gid.
- Paths normalized to POSIX (`/`) and NFC-unicode before sorting/hashing.
  Two distinct original paths normalizing to the same string → hard
  diagnostic (`normalized_path_collision`), never silently resolved.
- A path or symlink target that isn't valid UTF-8 → hard diagnostic.
- An unreadable file (EACCES etc.) → hard diagnostic
  (`unreadable: <path>`), never silently omitted. Test note: a plain
  `chmod 000` is not sufficient to prove this — root/CI can still read it.
  The test must either run the reading process as an unprivileged user or use
  a filesystem adapter/mock that forces `EACCES`; ideally also keep one real
  CLI/E2E test with actual user switching where the environment allows it.
- Size cap: default **536870912 bytes (512 MiB)** per source, configurable via
  `discover scan --max-source-bytes` in range **[1 MiB, 2 GiB]**. Computed via
  an `lstat`/`stat` preflight over every entry — summing declared sizes —
  before any content `open`/`read`; a symlink's target size is never counted.
  Exceeding it fails with `{"error":"source_too_large","path":"...","limitBytes":...,"observedBytes":<exact stat sum>}`.

**Manifest encoding** — every field is a fixed-length hex digest, never a raw
string, so no delimiter (`\0`/`\n`) embedded in a path or symlink target can
create ambiguity:

```
# fingerprint (sensitive to path — directory reorganization changes it)
# lines sorted by raw relPathUtf8 before hashing
file\0<sha256Hex(relPathUtf8Bytes)>\0<sha256Hex(fileBytes)>\n
symlink\0<sha256Hex(relPathUtf8Bytes)>\0<sha256Hex(targetUtf8Bytes)>\n
fingerprint = sha256(sorted-lines-concatenated)

# contentHash (path-independent — for moved detection; multiplicity preserved)
# lines sorted by the full line
file\0<sha256Hex(fileBytes)>\n
symlink\0<sha256Hex(targetUtf8Bytes)>\n
contentHash = sha256(sorted-lines-concatenated)
```

Reuses the dual-hash pattern Corte 0 already has (`revisionHash` canonical-JSON
vs. `contentHash` raw bytes), applied here to host directories instead of
ChangeSets.

**`moved` identity:** declared only when a `missing` confirmed source's
`contentHash` matches **exactly one** new candidate uniquely. Ambiguous
(≥2 matches) → report `missing` + `new` separately, never assert identity.
When confirmed via a ChangeSet, the **same `sourceId`** is retained — only
`path`, both hashes, and `provenance` update. Never delete+recreate with a new
ID, which would destroy the identity `contentHash` was used to prove.
Residual risk, accepted: `contentHash` proves structural content equality, not
absolute semantic identity — the uniqueness rule is what bounds this risk to
an acceptable level for auto-declaring `moved`.

## C — Data model: scope commands

Extends the existing scope schema — a command is an operational capability of
a scope, not a source. A **discriminated union by `method`**:

```yaml
commands:
  test:                                # declared variant
    command: "./mvnw test"
    method: declared
    declaredBy: carlos
    declaredAt: "2026-07-25T10:00:00Z"
    declaredOperationId: op_01J...
    requiresEnvironment: false          # required explicit booleans, no implicit default
    requiresSecrets: false
    alternatives: []                    # always empty for declared

  build:                                # inferred / reviewed variant
    command: "./mvnw package"
    method: reviewed                     # inferred | reviewed
    confidence: high                      # high | medium | low
    sourceRefs: ["src_01J..."]             # non-empty SET, no duplicates
    sourceFingerprintAtSelection:
      src_01J...: "sha256:abc123"          # keys exactly match sourceRefs set
    requiresEnvironment: false
    requiresSecrets: false
    alternatives:
      - command: "npm run build"
        sourceRefs: ["src_02K..."]
        sourceFingerprintAtSelection:
          src_02K...: "sha256:def456"
        confidence: medium
        requiresEnvironment: false
        requiresSecrets: false
                                          # no `method` on alternatives — not selected

  custom:
    e2e:                                  # open extension for roles beyond the 5 known
      command: "npm run test:e2e"
      method: reviewed
      confidence: high
      sourceRefs: ["src_03L..."]
      sourceFingerprintAtSelection:
        src_03L...: "sha256:..."
      requiresEnvironment: true
      requiresSecrets: false
      alternatives: []
```

`declaredOperationId`/`confirmedOperationId` (here and in Section B) are never
supplied by the caller — they are populated by the runtime, at apply time,
with the ID of the very operation that confirmed the entry. The `DiscoveryProposal`
and `config scope set-command` **inputs** never contain them.

`method` names the origin, not transactional state (everything in the catalog
already passed an applied ChangeSet):
- `declared`: a human set it directly via `config scope set-command --scope-id <id> --role <role> --command <cmd> --actor <actor>` — still goes through `propose→validate→approve→apply`; "direct" means without `discover`, never without ChangeSet.
- `inferred`: came from `discover propose`, auto-approved by autonomy policy (no human looked at this specific item).
- `reviewed`: came from `discover propose`, paused, and a human approved it explicitly.

For `DiscoveryProposal` input, `method` is untrusted proposal data used only to
validate the evidence shape. The persisted catalog command's `method` is
server-owned at apply time: `--mode autonomous` stores `inferred`, and
`--mode human` stores `reviewed`.

**Well-known roles:** `build | test | smoke | lint | verify` (schema slots).
Anything else goes under `custom.<role>`, pattern `^[a-z][a-z0-9-]{0,63}$`,
must not reuse a well-known name.

**Invariants:**
1. `sourceRefs` is a non-empty set — duplicates rejected. `sourceFingerprintAtSelection` keys must match that set exactly. Applies to the selected command and every alternative.
2. `method:declared` forbids `sourceRefs`/`confidence`/`sourceFingerprintAtSelection`; requires `declaredBy`/`declaredAt`/`declaredOperationId`; `alternatives` must be `[]`.
3. `method:inferred|reviewed` requires `sourceRefs`(≥1 unique), `confidence`, and matching `sourceFingerprintAtSelection`.
4. Duplicate-key identity = `(exact command string, normalized sourceRefs-as-set)` — the command text itself is never semantically normalized (whitespace/quoting/vars can change behavior).
5. The selected command's key must not equal any alternative's key; no two alternatives may share a key — both rejected (fail closed, never silently deduped).
6. `alternatives.length > 0` forces pause **only during `discover propose`**; already-applied alternatives persist as history without blocking future execution.
7. `requiresEnvironment`/`requiresSecrets` are required explicit booleans (no implicit default accepted by validation) and are descriptive only — never an authorization/sandboxing signal for any consumer executing the command.

**Evidence state** (never persisted — computed on demand wherever `scan`/`propose`/a future read-only `check` extension needs it), for a command aggregated over all its `sourceRefs`:

1. No `sourceRefs` (declared) → `not-evidence-backed`.
2. Any ref missing from catalog or its live path unresolvable → `evidence-missing`.
3. No live observation available to compare → `unknown`.
4. Any ref's `confirmedFingerprint(catalog) != observedFingerprint(live)` → primary `evidence-drifted`; `reasons` includes `live-source-differs-from-catalog`, plus `catalog-advanced-since-selection` if that's also true.
5. Else if any ref's `sourceFingerprintAtSelection != confirmedFingerprint(catalog)` → `evidence-updated`, `reasons: [catalog-advanced-since-selection]`.
6. Else → `current`.

(`evidence-drifted` outranks `evidence-updated` because live drift is the more urgent, non-exclusive condition — both reasons can be reported together.)

## D — CLI: `discover scan`, `DiscoveryProposal`, `discover propose`

### D.1 `discover scan` (read-only, never mutates `.planning`)

```
shipping-mode discover scan [--max-source-bytes <n>]
```

```json
{
  "schemaVersion": 1,
  "scanId": "scan_01J...",
  "generatedAt": "2026-07-25T...",
  "baseRevision": { "vcsRevision": "git:<sha>", "workspaceHash": "sha256:..." },
  "scanParameters": { "maxSourceBytes": 536870912 },
  "git": { "enabled": true, "branch": "main", "remote": "origin", "vcs": "git" },
  "scopeCandidates": [
    { "path": "api/", "signals": ["pom.xml"], "suggestions": { "kind": "code", "ruleIds": ["scope.maven-project"] } }
  ],
  "sourceCandidates": [
    { "path": "docs/adr/", "candidateFamilies": ["decision-sources"], "ruleIds": ["source.adr-directory"], "observedFingerprint": "sha256:...", "observedContentHash": "sha256:..." }
  ],
  "knownSources": [
    { "sourceId": "src_01J...", "path": "docs/04-architecture/", "observedFingerprint": "sha256:...", "observedContentHash": "sha256:...", "driftState": "unchanged", "freshness": "current" }
  ],
  "knownCommandsEvidence": [
    { "scopeId": "api", "role": "test", "evidenceState": "current", "reasons": [] }
  ],
  "diagnostics": []
}
```

`git` closes the 4th original Corte 0 pending item — no new command: the
skill reads this block and passes it through the **already-existing**
`init`/`config set --base-branch/--vcs` flags, unchanged.

`suggestions`/`candidateFamilies` are mechanical rule output with `ruleIds`
provenance — never a confirmed classification. The skill remains solely
responsible for the final `family`/`kind`/`role`/`authority` decision.

`baseRevision` is composite because `git:<sha>` alone cannot distinguish two
different real workspace states that share a commit (uncommitted edits, new
files, local deletions) — `workspaceHash` is the actual consistency value;
`scanId` is correlation/debugging only.

**`workspaceHash`** — same fixed-length-hex-field discipline as the source
fingerprint manifest, using a helper for list fields:

```
stringSetHash(strings) = sha256( concat-sorted-by-line( sha256Hex(utf8(s)) + "\n" for s in strings ) )
```

```
scope\0<sha256Hex(pathUtf8)>\0<stringSetHash(signals)>\0<sha256Hex(suggestions.kind or "")>\0<stringSetHash(ruleIds)>\n
sourceCandidate\0<sha256Hex(pathUtf8)>\0<stringSetHash(candidateFamilies)>\0<observedFingerprintHex>\0<observedContentHashHex>\0<stringSetHash(ruleIds)>\n
knownSource\0<sourceId>\0<driftState>\0<sha256Hex(pathUtf8)>\0<observedFingerprintHex|sha256Hex("missing")>\0<observedContentHashHex|sha256Hex("missing")>\0<sha256Hex(observedAtPath or "")>\n
commandEvidence\0<scopeId>\0<role>\0<evidenceState>\0<stringSetHash(reasons)>\n
```
sorted lexicographically by full line, concatenated, `workspaceHash = sha256(...)`.
If the facts behind an `evidenceState` change, `reasons` changes and so does
the hash, even if the aggregate label doesn't.

`scanParameters.maxSourceBytes` range **[1 MiB, 2 GiB]**, default 512 MiB —
declared here because `discover propose` must re-observe with these exact
parameters, never its own silent default.

### D.2 `DiscoveryProposal` (skill-authored — untrusted input)

```json
{
  "schemaVersion": 1,
  "scanId": "scan_01J...",
  "baseRevision": { "vcsRevision": "git:<sha>", "workspaceHash": "sha256:..." },
  "scanParameters": { "maxSourceBytes": 536870912 },
  "scopes": [ ],
  "sources": [
    { "action": "add", "path": "docs/adr/", "family": "decision-sources", "kind": "decision", "role": "decision", "authority": { "standing": "authoritative", "force": "normative" }, "availability": "implemented", "observedFingerprint": "sha256:...", "observedContentHash": "sha256:..." },
    { "action": "update", "sourceId": "src_01J...", "observedFingerprint": "sha256:...", "observedContentHash": "sha256:..." },
    { "action": "move", "sourceId": "src_02K...", "fromPath": "docs/old/", "path": "docs/new/", "observedFingerprint": "sha256:...", "observedContentHash": "sha256:..." },
    { "action": "remove", "sourceId": "src_04M..." }
  ],
  "scopeCommands": [ ],
  "diagnostics": []
}
```

`action` is `add | update | move | remove` — no `acknowledge-missing`. Under
the Section B model (catalog persists no `status`/`freshness`), an
acknowledge action would have no durable effect: the next scan would still
report the source `missing`, forcing indefinite re-acknowledgment. Adding a
durable field for this would reopen Section B; instead, a `missing` source
stays a blocking diagnostic on every future scan/propose until it either
reappears (`update` reconciles it) or is explicitly `remove`d.

A source absent from this array is simply untouched — no `keep`/`unchanged`
action needed.

### D.3 `discover propose --file <path> | --stdin` — pipeline (all-or-nothing)

```
1. Structural validation (every B/C invariant, the discriminated unions, enums, sets)
2. scanParameters within allowed range — else reject
3. Live re-scan using exactly those scanParameters; compare baseRevision.workspaceHash
   to the fresh observation — mismatch → reject (stale_proposal)
4. Fingerprint re-verification (never trust the skill's claimed values) +
   reference resolution (dangling ref → reject) +
   drift reconciliation (unaddressed drift on a confirmed source/command → blocking diagnostic) +
   referential integrity on `remove` (residual sourceRefs anywhere in the
   confirmed catalog, across all scopes, not addressed by this same proposal → reject;
   this includes the proposal's **own** `scopeCommands` — a proposal that both
   `remove`s a `sourceId` and has any command, new or existing, still listing
   that `sourceId` in `sourceRefs` is self-contradictory and rejected in full)
5. Autonomy evaluation — ONLY once 1-4 are fully valid
→ ChangeSet VALIDATED, carrying:
   preconditions.discoveryWorkspace { workspaceHash, scanParameters }
   autonomyEvaluation { policyFingerprint, autoApprovable, blockedBy[] }
→ approve (mode-gated — see Section E)
→ apply: re-verify discoveryWorkspace precondition live
→ apply atomic write
```

A dangling/ambiguous reference is **invalid** (step 4, hard rejection) — it
never surfaces merely as an `autonomyEvaluation.blockedBy` entry, because
autonomy is computed only after the full proposal is already valid.

### D.4 Precondition at `apply` (closes the propose→apply TOCTOU window)

The persisted operation carries:

```json
{ "preconditions": { "discoveryWorkspace": { "workspaceHash": "sha256:...", "scanParameters": { "maxSourceBytes": 536870912 } } } }
```

Before writing anything, `apply` recomputes `workspaceHash` live using
exactly these persisted `scanParameters` — never the payload indirectly, never
a future version's default. If it doesn't match:

- `apply` writes nothing (no partial mutation).
- The operation is left recoverable, not corrupted.
- `StaleError` is thrown — the **existing** Corte 0 typed error, mapping to
  the **existing** terminal `STALE` state. No new state machine, just one more
  source of staleness feeding an existing mechanism.

**Exact guarantee:** the knowledge applied corresponds to the workspace
re-observed immediately before the `.planning` mutation. This is not an
absolute exclusion against uncoordinated external writers to the **host**
repo — the existing workspace lock protects `.planning` itself, not host
content, which is out of Shipping Mode's control.

**`STALE` is terminal for that operation.** "Recoverable" means: rescan and
create a **new** operation — never resume the same operation against a
different baseline.

## E — Autonomy configuration, enforced server-side

```yaml
autonomy:
  discovery:
    default: pause                        # pause | auto-approve — fallback when no more specific rule applies
    scopeCommandConfidenceFloor: high      # only applies to scope commands (sources have no confidence field)
    sourceOverrides:
      - family: project-module-manifests
        mode: auto-approve
        authorityCeiling:
          standing: supporting             # contextual | supporting | authoritative
          force: advisory                   # unknown | informational | advisory | normative
    scopeCommand:
      mode: auto-approve                    # single policy for all inferred commands (no "family" concept for commands)
```

Set via `config autonomy set --file autonomy.json --actor <actor>` — bulk
JSON like `discover propose`, same `propose→validate→approve→apply` gate.

**`effectiveMode(item)` resolution, in order:**
1. Source `move`/`remove` → hard pause (`destructive_action`), `effectiveMode` never consulted.
2. Scope `add` → hard pause (`new_scope_always_pauses`), never consulted.
3. Otherwise: `effectiveMode = most-specific-applicable-override ?? autonomy.discovery.default` (family override for sources; `scopeCommand.mode` for commands). For sources specifically, `default:auto-approve` does **not** implicitly whitelist an unconfigured family: source auto-approval requires an explicit family override because the required `authorityCeiling` lives on that override. A source family with no override therefore blocks with `family_not_allowlisted`, even when the fallback mode is `auto-approve`.
4. Only if `effectiveMode == auto-approve` does the item proceed to its own gate:
   - source `add`/`update`: `authority.standing <= ceiling.standing` **and** `authority.force <= ceiling.force` (both inclusive); on `update`, any dimension escalating past the *previously confirmed* value → hard pause (`authority_escalation`) regardless of ceiling.
   - scope command `inferred`: `confidence >= scopeCommandConfidenceFloor` **and** `alternatives.length == 0`.
   - `declared` commands: never gated — a direct human action, never routed through `discover propose`.
5. A `family` changed by an `update` is re-evaluated fresh against the **new** family — never inherits the old family's permission.

**Persisted per operation:**

```json
{
  "autonomyEvaluation": {
    "policyFingerprint": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "autoApprovable": false,
    "blockedBy": [
      { "itemRef": "sources[0]", "reason": "authority_above_ceiling" },
      { "itemRef": "scopeCommands[api].test", "reason": "alternatives_present" }
    ]
  }
}
```

`policyFingerprint` reuses the existing Corte 0 `revisionHash` (canonical-JSON)
mechanism, applied to the autonomy policy **confirmed at evaluation time** —
never a policy proposed within the same pending operation.

**Reason codes:** `family_not_allowlisted | authority_above_ceiling | authority_escalation | low_confidence | alternatives_present | destructive_action | new_scope_always_pauses | default_pause | autonomy_config_change | policy_changed_since_validation`.

`family_not_allowlisted` is emitted specifically when a **source** item's
family has no matching entry in `sourceOverrides` at all (so `effectiveMode`
fell through to `autonomy.discovery.default`). `default_pause` is the general
case: `effectiveMode` resolved to `pause` for any other reason — an explicit
family override set to `mode: pause`, or a scope command governed only by
`scopeCommand.mode`/the global `default`. `destructive_action` and
`new_scope_always_pauses` are always used for their specific triggers even
though those, too, never reach `effectiveMode`.

**Server-side enforcement — the control that actually matters:**

```
shipping-mode changeset approve <operation-id> --actor discovery-skill --mode autonomous
shipping-mode changeset approve <operation-id> --actor carlos --mode human
```

`--mode` defaults to `human` if omitted — never silently autonomous.
`--mode autonomous` is accepted only if, verified server-side (never trusted
from the caller):
- this operation's own persisted `autonomyEvaluation.autoApprovable === true` (an `autonomyEvaluation` belonging to another operation, or not associated with this one, is rejected);
- the **currently confirmed** autonomy policy still matches `policyFingerprint` — else `StaleError` / `policy_changed_since_validation` (same precondition-recheck pattern as D.4, applied to policy instead of workspace);
- the runtime invocation carries a server-owned `discovery.autonomous-approve` capability in trusted authorization context. `--actor` is audit metadata only and can never grant this capability; a caller spelling an actor such as `discovery-skill` is insufficient. The bare CLI has no way to manufacture this trusted context. A full capability/RBAC model remains out of scope for this iteration.
- the persisted evaluation is structurally bound to this exact `operationId` and validated `changeSetHash`, in addition to its `policyFingerprint`; copying an otherwise identical evaluation from another operation is rejected.

`--mode human` approves a paused operation under the existing actor model,
**unaffected by `autoApprovable`** and **unaffected by the `policyFingerprint` check** (that check applies only to `autonomous`, and must never block or alter normal human review).

**Autonomy never self-approves:** any ChangeSet from `config autonomy set` gets
`autonomyEvaluation.autoApprovable: false` **unconditionally** — it never even
enters the gate algorithm. Applies equally to expansions and restrictions of
the policy; a uniform rule simplifies audit and avoids semantic-comparison
mistakes.

**Formal orders** (confirmed):
- `standing`: `contextual`(0) < `supporting`(1) < `authoritative`(2)
- `force`: `unknown`(0) < `informational`(1) < `advisory`(2) < `normative`(3)
- `confidence`: `low`(0) < `medium`(1) < `high`(2)
- Ceiling comparisons are always inclusive (`value <= ceiling`).
- `unknown`/`contextual` are valid classifications, not wildcards — they are simply the lowest ordinal tier, treated like any other value.

## F/G — Drift & git detection

Fully absorbed into B and D above (drift: fingerprint-based `new/unchanged/changed/missing/moved`
in the `ScanResult`/`DiscoveryProposal`/precondition mechanism; git: the `git`
block in `discover scan`, D.1). Not repeated as separate sections.

## H — Testing plan & Definition of Done

**H.1 Fingerprint algorithm (unit)**
- Single file: `confirmedFingerprint == confirmedContentHash == sha256(bytes)`.
- Directory with 2 identical file copies vs. 1 copy → different `contentHash` (multiplicity preserved).
- Symlink: changing the target **text** changes the fingerprint; changing only the content of the pointed-to object does not; the target is never followed, opened, or read, even pointing outside the workspace.
- Normalized-path collision (POSIX+NFC) between two distinct originals → hard diagnostic.
- Invalid UTF-8 path or target → hard diagnostic.
- Unreadable file → hard diagnostic, never silently skipped. Must be proven reliable under root/CI: run the reader as an unprivileged user, or use a filesystem adapter/mock forcing `EACCES`; keep one real CLI/E2E test with actual user switching where the environment allows it.
- Size preflight: `lstat`/`stat` of every entry happens before any content `open`/`read` (assert no content read syscalls occur when the cap is already exceeded by declared sizes); `observedBytes` is the exact stat-sum, symlink target size never counted; exceeding the cap (default 512 MiB, or a configured value) fails closed with the exact `observedBytes`.
- `moved`: unique `contentHash` match at a new path with the old one missing → `moved`; ambiguous (≥2 matches) → `missing`+`new` reported separately, never `moved`.

**H.2 `discover propose` — adversarial validation**
- Every structural invariant from B/C: `declared` with `sourceRefs`/`confidence` present; duplicate `sourceRefs`; mismatched `sourceFingerprintAtSelection` keys; `custom` reusing a well-known name; malformed `custom` name; alternative duplicating the selected command; duplicate alternatives among themselves.
- `scanParameters.maxSourceBytes` outside `[1 MiB, 2 GiB]` → reject.
- `workspaceHash` mismatch against live re-scan → `stale_proposal`. Cover: different enumeration order producing the same hash (determinism), a genuinely ambiguous/reordered list still hashing identically when content is identical, and a changed `scanParameters` claim causing a legitimate mismatch.
- Skill-claimed fingerprint not matching live recomputation → reject (proves the skill cannot fabricate/recycle a fingerprint).
- Dangling `sourceRef` (neither in this proposal nor the confirmed catalog) → reject.
- `remove` of a source still referenced by an untouched confirmed command → reject (referential integrity); same case with the command also updated in the same proposal → accepted.
- Unaddressed drift on an already-confirmed source → blocking diagnostic.

**H.3 Autonomy**
- `effectiveMode`: family override present vs. absent (default fallback).
- Authority ceiling inclusive boundary (`value == ceiling` passes, `value > ceiling` fails).
- Escalation on `update` blocks even under the ceiling.
- `move`/`remove` always pause regardless of how permissive the family override is.
- Scope `add` always pauses.
- `scopeCommandConfidenceFloor` gates only `inferred` commands; `declared` is never gated.
- `alternatives` non-empty always pauses.
- Whole-ChangeSet atomicity: one blocked item ⇒ `autoApprovable:false` for the entire batch even if the rest pass.
- `config autonomy set` is always `autoApprovable:false` unconditionally, bypassing the gate algorithm entirely.
- A `family` changed via `update` is evaluated fresh against the new family, never inheriting the old permission.

**H.4 Server-side enforcement of `changeset approve --mode`**
- `--mode autonomous` with persisted `autoApprovable:false` → rejected regardless of caller claims.
- `--mode autonomous` with `autoApprovable:true` but `policyFingerprint` no longer matching the currently confirmed policy → `StaleError`/`policy_changed_since_validation`.
- `autonomyEvaluation` belonging to a different operation, or not correctly associated with this one → rejected.
- Actor without autonomous-approval capability → rejected.
- `policyFingerprint` current and `autoApprovable:true` → autonomous approval accepted (positive case).
- `--mode human` does not depend on `autoApprovable` at all, and is unaffected by the `policyFingerprint` check — normal human review must never be blocked or altered by it.
- Flag omitted → defaults to `human`, never silently autonomous.

**H.5 Apply-time precondition + real crash recovery**
- Workspace unchanged between `validate` and `apply` → succeeds, persists verified `confirmedFingerprint`/`confirmedContentHash`.
- Workspace changed (`workspaceHash` mismatch) → `StaleError`, `apply` writes nothing, operation terminal (recovery = rescan + new operation, never resume the same one against a different baseline).
- **Real crash test (full cycle, not just "not corrupted"):**
  1. Run a real multi-source `apply` in a real OS process.
  2. Kill the process after a verifiable checkpoint, with a mutation partially executed.
  3. Confirm no mixed/inconsistent confirmed catalog is ever exposed as a valid read result.
  4. Run the existing recovery mechanism (reusing Corte 0's checkpoints/`filePlan`/recovery — no new crash machinery).
  5. Confirm the end state is exactly one of Corte 0's permitted outcomes: full consistent apply, or a consistent rolled-back/recovered state per the existing contract.
  6. Confirm idempotency: running recovery a second time does not duplicate sources, commands, provenance, or `filePlan` effects.
  A parseable JSON result is not sufficient proof — semantic and referential consistency of the catalog must hold.

**H.6 Schemas and build**
- New schemas (sources catalog, scope `commands` extension, `DiscoveryProposal`, autonomy config) compiled via Ajv-standalone at build time, same mechanism as the schemas already in the build. The exact count of pre-existing schemas is verified against the real build registry at implementation time rather than hardcoded in prose here, to avoid this document going stale if the registry changes before implementation starts.
- `npm run verify:next-generation` extended to cover all of the above; bundle stays self-contained.

**Definition of Done:**
- [ ] `npm ci` reproducible; build deterministic in isolated directories (same pattern as Corte 0).
- [ ] Every adversarial case in H.1–H.5 has a dedicated test: fails the expected way before the fix, passes after (real TDD).
- [ ] At least one real crash (process kill, not a simulated exception) during discovery `apply`, with the full recovery cycle in H.5 verified.
- [ ] Full Corte 0 regression suite + all new tests green.
- [ ] No accidental temp/scratch files in the diff.
- [ ] Spec/plan docs updated only if genuinely misaligned after implementation — Corte 0 itself is not reopened.
