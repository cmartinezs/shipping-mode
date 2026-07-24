# Corte 0 Runtime Foundation — Execution Corrections

Status: normative execution amendments to `docs/plans/corte-0-runtime-foundation-implementation.md` revision 4.

These corrections do **not** reopen the architecture or create a new plan revision. They close three implementation-edge inconsistencies found after the revision-4 plan review. When a task below conflicts with the base plan, this document takes precedence for that task.

## 1. Task 19 — `RECOVERY_REQUIRED` remains blocking across invocations

### Problem

The revision-4 recovery loop handles `APPLIED` and `APPLYING`, then treats every other status as `NOT_APPLICABLE`.

That creates an unsafe sequence:

1. recovery detects divergence and persists `RECOVERY_REQUIRED`;
2. the current mutating invocation is blocked correctly;
3. a later mutating invocation runs recovery again;
4. the persisted `RECOVERY_REQUIRED` operation is treated as `NOT_APPLICABLE`;
5. the new mutation may proceed even though the manual recovery conflict is unresolved.

### Required implementation

In `runtime/src/lib/recovery.mjs`, after validating `operation.yml` and before the generic non-`APPLYING` branch, preserve the blocking outcome explicitly:

```js
if (operation.status === "RECOVERY_REQUIRED") {
  outcomes.push({ operationId, outcome: "RECOVERY_REQUIRED" });
  continue;
}
```

The ordering must remain conceptually:

```text
invalid metadata -> RECOVERY_REQUIRED outcome
RECOVERY_REQUIRED -> RECOVERY_REQUIRED outcome
APPLIED -> cleanup residue
APPLYING -> classify/replay
other states -> NOT_APPLICABLE
```

`withWorkspaceMutation` must therefore block **every** later mutating command until the conflict is manually resolved.

### Required tests

Add a regression test that:

1. creates an `APPLYING` operation;
2. introduces divergent canonical content;
3. runs recovery and verifies the operation becomes `RECOVERY_REQUIRED`;
4. attempts a mutating command and verifies it is blocked;
5. attempts a second independent mutating command and verifies it is still blocked;
6. verifies no new operation was created by either attempt.

The test must prove persistence of the blocking condition, not only blocking in the invocation that first discovers the conflict.

---

## 2. Task 17 / Task 20 — reuse the complete persisted `expectedEvents` after a pre-`APPLYING` crash

### Problem

Revision 4 correctly reserves the event UUIDv7 during `propose`, but the `AFTER_MANIFEST` boundary is stronger than event-ID stability alone.

The spec requires that once `expectedEvents` has been persisted, the full immutable event document is fixed:

- `eventId`;
- `occurredAt`;
- `actor`;
- `payload`;
- `idempotencyKey`;
- `relativePath`;
- `contentHash`;
- the complete `document`.

If a crash occurs after `expectedEvents` is written but before `APPROVED -> APPLYING`, retrying `prepareApply()` must not rebuild the event with a new timestamp or any newly derived content.

### Required implementation

In `prepareApply`:

1. if the operation already contains a valid, non-empty `expectedEvents` manifest from an interrupted pre-`APPLYING` attempt, reuse it verbatim;
2. do **not** call `buildExpectedEvent()` again in that case;
3. validate the persisted event manifest and its relational invariants before reuse;
4. only build `expectedEvents` from `reservedEvents` when no persisted manifest exists yet;
5. once persisted, `expectedEvents` is immutable for the lifetime of the operation.

Conceptually:

```js
const expectedEvents = operation.expectedEvents?.length
  ? validateAndReuseExpectedEvents(operation)
  : buildAndPersistExpectedEvents(operation, actor, ...);
```

A retry after `AFTER_BEFORE` or `AFTER_STAGED` may still build the event for the first time because no event manifest has been durably persisted yet. A retry after `AFTER_MANIFEST` must reuse the exact persisted bytes/semantic document.

### Required tests

Strengthen the crash-matrix test for `AFTER_MANIFEST`:

1. capture the full persisted `expectedEvents[0]` immediately after the simulated crash;
2. retry `applyOperation`;
3. assert deep equality between the persisted pre-retry event and the final event manifest;
4. additionally assert the same `contentHash`, `occurredAt`, `actor`, `payload`, `idempotencyKey`, and `eventId`;
5. verify only one event file is ultimately written.

Checking only `eventId` is insufficient.

---

## 3. Task 6 — operation schema must require state-owned fields, not only constrain them when present

### Problem

In JSON Schema, a `properties` declaration does not make a property mandatory.

The revision-4 `if`/`then` examples narrow `validation` and `approval` when those objects exist, but without `required` at the enclosing `then` level a document can satisfy a later workflow status while omitting the state-owned object entirely.

Likewise, `RECOVERY_REQUIRED` must not accept `conflict: null`.

### Required schema changes

For statuses `VALIDATED`, `APPROVED`, `APPLYING`, and `APPLIED`, require the `validation` property itself:

```json
{
  "if": {
    "properties": {
      "status": { "enum": ["VALIDATED", "APPROVED", "APPLYING", "APPLIED"] }
    }
  },
  "then": {
    "required": ["validation"],
    "properties": {
      "validation": {
        "type": "object",
        "required": ["validatedAt", "changeSetHash"],
        "properties": {
          "validatedAt": { "type": "string" },
          "changeSetHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
        }
      }
    }
  }
}
```

For statuses `APPROVED`, `APPLYING`, and `APPLIED`, require the `approval` property itself:

```json
{
  "if": {
    "properties": {
      "status": { "enum": ["APPROVED", "APPLYING", "APPLIED"] }
    }
  },
  "then": {
    "required": ["approval"],
    "properties": {
      "approval": {
        "type": "object",
        "required": ["actor", "approvedAt", "changeSetHash", "selfApproval"],
        "properties": {
          "actor": { "type": "string" },
          "approvedAt": { "type": "string" },
          "changeSetHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
          "selfApproval": { "type": "boolean" }
        }
      }
    }
  }
}
```

For `RECOVERY_REQUIRED`, require a non-null conflict object:

```json
{
  "if": {
    "properties": {
      "status": { "const": "RECOVERY_REQUIRED" }
    }
  },
  "then": {
    "required": ["conflict"],
    "properties": {
      "conflict": { "type": "object" }
    }
  }
}
```

Keep the existing `APPLYING`/`APPLIED` requirements for non-empty `filePlan` and `expectedEvents`, and the existing `APPLIED` requirement for non-null `appliedAt`.

### Required tests

Add schema-negative fixtures/assertions for:

- `VALIDATED` without `validation`;
- `APPROVED` without `approval`;
- `APPLYING` without `validation`;
- `APPLYING` without `approval`;
- `RECOVERY_REQUIRED` without `conflict`;
- `RECOVERY_REQUIRED` with `conflict: null`.

All must fail `operation.schema.json` validation.

---

## Execution acceptance

These amendments are complete when Tasks 6, 17, 19 and 20 implement the behavior above and the added regression cases pass together with the revision-4 verification suite.

No other architecture or task scope is reopened by this document.
