# Corte 3 Plan 4 - External Provider and Corte 3 Closure

## 1. Auditoria exacta de `develop`

Preparacion local requerida para este plan:

```text
branch base: develop
HEAD verificado: 8da8dd7cd9ee08afe4abfe1534a614bc59acb66e
merge verificado: PR #26, Corte 3 Plan 3 Work Source foundation
rama documental: plan/corte-3-plan-4-external-provider-closure
```

La auditoria de `develop` muestra que PR #24, PR #25 y PR #26 ya estan
incorporados. El runtime real ya contiene:

- `ReleaseItem` separado bajo `.planning/releases/<release-id>/items/<item-id>/`.
- `WorkPackage` separado bajo `items/<item-id>/work-packages/<package-id>/`.
- `work-source.import` como unico ChangeSet de import desde Work Sources.
- `LocalRepositoryWorkSource` con capabilities `discover`, `search`, `get`.
- `NormalizedWorkSourceItem` schema-closed y reusable por providers externos.
- `check work-sources --format json`, query-only.
- `sourceRefs` server-owned para imports, incluido `itemId` local estable.
- hash de configuracion de Work Source ligado al ChangeSet de import.
- revalidacion de provider/config/item durante validate/apply.
- contract harness inicial en `evaluateWorkSourceProviderContract`.

El runtime real todavia no contiene:

- `JiraMcpWorkSource`.
- frontera runtime-host-MCP ejecutable.
- `transport: mcp` ni `connection_ref` en `config.yml.work_sources[]`.
- `external_authoritative` ni `pull` como policy/sync mode aceptados.
- baseline de sync persistida mas alla de revision/source ref.
- `work-source.refresh`, `item refresh` o `check source-drift`.
- matriz de drift/conflict suficiente para refresh/pull.
- traceability query reutilizable Work Source -> Scope.

Esta brecha es deliberada: Plan 3 cerro import seguro local; Plan 4 debe cerrar
la fuente externa real y la evaluacion de drift sin adelantar Tasks, write-back
ni reportes publicos de Corte 5.

## 2. Boundary incluido

Plan 4 implementa exclusivamente este vertical slice:

```text
configured Jira Work Source
  -> host-owned Atlassian MCP transport
  -> JiraMcpWorkSource
  -> NormalizedWorkSourceItem
  -> work-source.import / work-source.refresh ChangeSets
  -> canonical Release Item
  -> source drift and conflict evaluation
  -> Corte 3 final DoD
```

El core sigue provider-agnostic. Fuera de `jiraMcpWorkSource.mjs`, fixtures Jira
y fake transport tests no pueden aparecer conceptos como `JiraIssue`,
`JiraTransition`, `AtlassianClient`, `JiraStatus` o `JiraProject`.

El dominio generico solo puede conocer:

```text
WorkSourceProvider
NormalizedWorkSourceItem
source refs
capabilities
policies
revisions
mappings
drift
conflicts
ChangeSets
findings normalizados
```

## 3. Exclusiones

Plan 4 no implementa:

- Tasks, `task.yml` o task lifecycle.
- gate execution, shell/build/test execution o Git task lifecycle.
- write-back a Jira.
- comentarios, transiciones, creacion o actualizacion externa.
- push, bidirectional sync o external mutation sagas.
- GitHub Issues, Azure Boards, Linear o providers adicionales.
- auto-repair desde checks.
- sistema completo de `report` de Corte 5.
- release notes publicas derivadas de Work Sources.
- documentacion final de producto de Corte 6.

Capabilities excluidas deben fallar explicitamente como
`CAPABILITY_UNAVAILABLE` o `SOURCE_CAPABILITY_MISSING`; no debe existir
comportamiento parcial silencioso.

## 4. Decisiones de arquitectura

1. `work-source.import` se conserva para crear Release Items desde cualquier
   provider de lectura.
2. El nuevo ChangeSet canonico de pull sera `work-source.refresh`.
3. El comando publico sera:

```text
shipping-mode item refresh <release-ref> <item-ref> --actor <actor>
```

4. `refresh` representa el boundary correcto: consulta la fuente primaria,
   evalua drift/conflict y propone una actualizacion local via ChangeSet. No
   implica push, bidirectional sync ni mutacion externa.
5. `check source-drift [release-ref] --format json` sera query-only y nunca
   creara ChangeSets.
6. No se agrega `check sync` en Plan 4: con `pull` solamente, `check
   source-drift` ya cubre disponibilidad, config, mapping, revision, baseline y
   recomendacion de `item refresh`. `check sync` queda diferido hasta que exista
   una segunda direccion real en Corte 4.
7. `connectivity` no se agrega a `WORK_SOURCE_CAPABILITIES`. La disponibilidad
   del transport se prueba como parte del contract harness para providers
   externos, pero las capabilities de dominio de Plan 4 siguen siendo
   `discover`, `search` y `get`.

## 5. Frontera runtime-host-MCP

El runtime Node no debe asumir que puede invocar una herramienta MCP de Claude
Code directamente. La frontera ejecutable sera:

```text
runtime provider port
  <- host transport adapter injected by launcher/skill runtimeContext
      <- Atlassian MCP tool owned by the host
```

Responsabilidades:

- Shipping Mode runtime construye requests canonicos y valida responses.
- `JiraMcpWorkSource` consume un `WorkSourceTransportPort` inyectado.
- El host adapter invoca Atlassian MCP con credenciales ya configuradas fuera
  de Shipping Mode.
- `.planning` guarda solo `connection_ref`, nunca secretos.
- CLI sin host transport devuelve `SOURCE_UNAVAILABLE`.
- CI usa fake transport determinista, nunca una cuenta Atlassian real.

Contrato request:

```yaml
schemaVersion: 1
provider: jira
transport: mcp
connectionRef: atlassian
sourceId: jira-gradeops
operation: discover | search | get
requestId: <uuidv7>
requestHash: <sha256 canonical request>
mappingVersion: 1
configHash: <sha256 work source config snapshot>
capability: discover | search | get
params:
  projectKeys: [GRADE]
  itemRef: GRADE-142        # get only
  queryText: "assessment"   # search only, bounded plain text, not raw JQL
  limit: 50
```

Contrato response:

```yaml
schemaVersion: 1
provider: jira
transport: mcp
connectionRef: atlassian
sourceId: jira-gradeops
requestId: <same uuidv7>
requestHash: <same sha256>
status: OK | NOT_FOUND | UNAVAILABLE | MISCONFIGURED | MALFORMED
items: []                  # discover/search
item: null                 # get
findings: []
observedAt: <host timestamp>
responseHash: <sha256 canonical safe response>
```

El response puede contener una lista acotada de DTOs Jira seguros para el
adapter, no payload Jira raw. `JiraMcpWorkSource` valida schema, requestHash,
sourceId, provider, connectionRef, operation y limites antes de normalizar.

Autenticacion:

- La autenticacion vive en el host Atlassian MCP.
- Shipping Mode solo referencia `connection_ref: atlassian`.
- El runtime no lee variables secretas del dominio, no almacena tokens y no
  acepta headers/cookies/URLs con credenciales.

Cuando el host no tiene Atlassian MCP conectado:

- `check work-sources` reporta `SOURCE_UNAVAILABLE`.
- `check source-drift` reporta `SOURCE_UNAVAILABLE`.
- `item import` o `item refresh` fallan antes de proponer o quedan `STALE`
  durante validate/apply si la desconexion ocurre despues de propose.

## 6. Configuracion segura

Extension minima de `config.yml.work_sources[]`:

```yaml
work_sources:
  - id: jira-gradeops
    provider: jira
    transport: mcp
    enabled: true
    connection_ref: atlassian
    mapping_version: 1
    import_policy: external_authoritative
    sync_mode: pull
    capabilities:
      - discover
      - search
      - get
    options:
      project_keys:
        - GRADE
      query_scope:
        mode: project_keys_and_text
        max_results: 50
        allowed_issue_types:
          - Story
          - Bug
          - Epic
          - Spike
          - Enabler
          - Compliance
          - Migration
          - Operational
```

Invariantes:

- `provider: local_repository` requiere `roots`, no admite `transport` ni
  `connection_ref`, y sigue limitado a `import_snapshot/import_only` en Plan 4.
- `provider: jira` requiere `transport: mcp`, `connection_ref`, `options.project_keys`
  y `mapping_version: 1`.
- `provider: jira` no admite `roots`.
- `transport: mcp` no admite URLs, headers, tokens, cookies, comandos ni raw
  payloads en config.
- `sync_mode: pull` requiere `import_policy: external_authoritative`.
- `capabilities` para Jira en Plan 4 solo puede contener `discover`, `search`,
  `get`.
- `options.query_scope` no puede aceptar JQL arbitrario; solo filtros cerrados
  y limites.
- `connection_ref` es opaco, estable y no secreto.

## 7. Provider contract

El contrato compartido se amplia sin cambiar el vocabulario del core:

- `discover({ source, transport })` devuelve items deterministas dentro del
  scope configurado.
- `search({ source, query, transport })` usa texto/filtros cerrados, no JQL raw.
- `get({ source, itemRef, transport })` devuelve un item unico o finding
  normalizado.
- Todos devuelven `NormalizedWorkSourceItem` validado o findings
  provider-neutral.
- Errors externos se normalizan a `SOURCE_UNAVAILABLE`,
  `SOURCE_MISCONFIGURED`, `SOURCE_CAPABILITY_MISSING`, `SOURCE_NOT_FOUND` o
  `MAPPING_OBSOLETE`.
- Un provider activo que declara una capability y falla contract tests no puede
  activarse.

Operaciones `create`, `update`, `transition`, `comment`, `push` y
`bidirectional` siguen no disponibles.

## 8. Jira adapter y mapping v1

Archivos nuevos previstos:

```text
runtime/src/lib/jiraMcpWorkSource.mjs
runtime/src/lib/workSourceTransportPort.mjs
runtime/src/lib/tests/fixtures/jira-mcp/v1/*.json
runtime/src/lib/tests/fakes/fakeJiraMcpTransport.mjs
```

Mapping Jira v1 normaliza, cuando existan:

- issue key estable -> `itemId` y `sourceRef.externalId`.
- URL -> `url` y `sourceRef.externalUrl`.
- issue type -> `type` y `metadata.issueType`.
- summary -> `title`.
- description -> `description`.
- acceptance criteria -> `acceptanceCriteria`.
- status original y normalizado.
- priority original y normalizada.
- labels ordenados.
- parent/epic -> `relationships`.
- issue links/dependencies -> `relationships` y `dependencies`.
- assignee -> `assignee`.
- owner/custom owner -> `owner`.
- revision robusta -> `revision.externalRevision` si el MCP entrega version
  robusta; si no, fingerprint de snapshot seguro y `updatedAt` como evidencia
  secundaria.
- metadata minima: `projectKey`, `issueType`, `statusCategory`, `priorityName`,
  `parentKey`, `linkCount`, `mappingFixtureVersion`.

El payload Jira raw nunca llega al dominio ni se persiste.

Issue type -> `ReleaseItem.kind`:

| Jira issue type | ReleaseItem.kind |
|---|---|
| Story, User Story | `user_story` |
| Bug, Defect | `defect` |
| Epic, Feature, Capability | `capability` |
| Enabler | `enabler` |
| Spike | `spike` |
| Compliance | `compliance` |
| Migration | `migration` |
| Operational, Operations, Runbook | `operational` |

Tipos no mapeados, incluidos `Task` y `Sub-task`, fallan cerrado con finding
explicito `SOURCE_MISCONFIGURED` y evidencia `mapping=unsupported_issue_type`.
No se convierten silenciosamente en `user_story`.

## 9. Baseline de sync

No basta `externalRevision` en `sourceRefs`. Plan 4 agrega una estructura
server-owned separada dentro de `release-item.yml`:

```yaml
sourceSync:
  schemaVersion: 1
  baselines:
    - id: <uuidv7>
      role: primary
      sourceId: jira-gradeops
      provider: jira
      locator:
        externalId: GRADE-142
        externalUrl: https://example.atlassian.net/browse/GRADE-142
      sourceRevision: "10042"
      mappingVersion: 1
      configHash: <sha256>
      syncedAt: <server time>
      syncedBy: <actor>
      normalizedSnapshotHash: <sha256>
      mappedSnapshotHash: <sha256>
      localProjectionHash: <sha256>
      sourceRefHash: <sha256>
      normalizedSnapshot: <NormalizedWorkSourceItem bounded>
      mappedSnapshot: <ReleaseItem requestSnapshot bounded>
```

`sourceRefs` remains the compact provenance/locator surface. `sourceSync`
stores bounded server-owned snapshots needed for deterministic drift. The two
structures are validated together:

- every primary source ref imported by Work Source must have exactly one primary
  baseline;
- source ref locator/revision/mapping must match the baseline;
- baseline hashes must match snapshots;
- snapshots must be schema-valid and provider-neutral;
- no raw Jira payload is persisted.

`work-source.import` must start writing the initial baseline. `work-source.refresh`
must update Release Item fields, source ref revision and baseline atomically.
Updating only source revision without updating baseline is invalid.

## 10. State/finding matrix

Inputs:

- `Bns`: baseline normalized source snapshot.
- `Bri`: baseline mapped Release Item snapshot.
- `Rns`: current remote normalized source snapshot.
- `Cli`: current canonical Release Item projection to source-owned fields.
- `M`: current mapping version.
- `C`: current Work Source config hash.

State matrix:

| Condition | State | Finding | Recommendation |
|---|---|---|---|
| provider unavailable | `SOURCE_UNAVAILABLE` | `SOURCE_UNAVAILABLE` | retry when host connection exists |
| source config invalid/missing | `SOURCE_MISCONFIGURED` | `SOURCE_MISCONFIGURED` | fix config |
| declared capability absent | `SOURCE_CAPABILITY_MISSING` | `SOURCE_CAPABILITY_MISSING` | disable or fix provider |
| source item not found | `SOURCE_NOT_FOUND` | `SOURCE_NOT_FOUND` | operator decision, no auto-delete |
| mapping version unsupported or baseline older than active mapping | `MAPPING_OBSOLETE` | `MAPPING_OBSOLETE` | re-import/remap under explicit ChangeSet |
| `Rns == Bns` and `Cli == Bri` | `UNCHANGED` | none | no-op |
| `Rns != Bns` and `Cli == Bri` | `REMOTE_CHANGED` | `SYNC_REQUIRED` | propose `item refresh` |
| `Rns == Bns` and `Cli != Bri` | `LOCAL_CHANGED` | `SOURCE_STALE` | review local changes, no overwrite |
| disjoint source-owned/provider-owned fields changed compatibly | `BOTH_CHANGED_COMPATIBLE` | `SYNC_REQUIRED` | propose compatible refresh preserving local-owned fields |
| same source-owned field changed locally and remotely | `SOURCE_CONFLICT` | `SOURCE_CONFLICT` | manual resolution |
| config hash differs from baseline but schema-valid | `SOURCE_STALE` | `SOURCE_STALE` | re-evaluate before refresh |

Terminology:

- transactional staleness is propose/validate/apply drift and returns operation
  status `STALE`;
- persistent drift is query-time divergence after import and returns findings;
- conflict is incompatible local/external changes relative to the last baseline;
- mapping obsolete means the stored mapping cannot be trusted for current
  provider rules;
- unavailable means host/provider could not be queried.

## 11. ChangeSet y comandos publicos

Canonical ChangeSet:

```text
work-source.refresh
```

Public command:

```text
shipping-mode item refresh <release-ref> <item-ref> --actor <actor> [--idempotency-key <key>]
```

Flow:

1. resolve Release by UUIDv7 or `REL-*`;
2. resolve Release Item by UUIDv7 or `RI-*`;
3. require exactly one primary source ref;
4. resolve source config/provider/capability `get`;
5. require `sync_mode: pull` and `import_policy: external_authoritative`;
6. fetch and normalize current source item;
7. evaluate drift matrix against baseline;
8. if unchanged, return deterministic no-op proposal result without writing;
9. if resolvable, propose `work-source.refresh`;
10. record base revisions: parent Release, target Release Item, config hash,
    source revision, mapping version, baseline hashes;
11. require approval;
12. validate by re-fetching source and re-evaluating drift;
13. apply by atomically rewriting `release-item.yml`, README, sourceRef and
    `sourceSync` baseline;
14. verify post-write projection and baseline hashes;
15. publish one bounded event;
16. recover idempotently after every durable boundary;
17. prevent duplicate refreshes for same item/source/base request hash.

`check` never refreshes, never updates revisions and never creates ChangeSets.

## 12. Trust boundaries

Server-owned fields for import and refresh:

- source ID and provider resolution;
- secure connection ref;
- external item ID/path and URL;
- external/content revision;
- normalized source item;
- mapping version;
- config hash;
- baseline hashes;
- mapped snapshot;
- source refs and imported/refreshed timestamps;
- parent Release;
- target Release Item;
- target paths;
- Operation ID;
- event ID;
- actor and proposedAt;
- idempotency request hash;
- base revisions.

Validation must reject tampering even if `change-set.json.hash` is recalculated.

## 13. Idempotencia y optimistic locking

`work-source.refresh` idempotency request hash includes:

```text
actor
releaseId
itemId
sourceId
provider
connectionRef
externalId/itemId/path
baselineId
baseline normalizedSnapshotHash
baseline mappedSnapshotHash
current source revision
current normalizedSnapshotHash
mappingVersion
configHash
targetPaths
```

Concurrent behavior:

- two refreshes with same baseline/source revision return the same Operation;
- two refreshes with different source revision cannot share idempotency;
- refresh after local edit becomes `SOURCE_CONFLICT` or `SOURCE_STALE`;
- refresh after config/mapping drift becomes `STALE` during validate/apply;
- applied ChangeSet replay is idempotent and never emits a second event.

## 14. Crash recovery

Crash boundaries to test:

- after operation manifest;
- after staged `release-item.yml`;
- after staged README;
- after first rename;
- after result write;
- after event write;
- after operation status remains pending with canonical files present;
- after result written but operation not finalized;
- after event written but result pending;
- workspace starts with recovery pending.

Recovery rules:

- no false success;
- no partial Release Item write;
- no duplicate event;
- no duplicate baseline;
- no source revision update without matching baseline update;
- no local changes lost after stale/concurrent detection.

## 15. Contract-test harness

Extend `runtime/src/lib/workSourceContract.mjs` into a shared harness that
drives capabilities declared by each source:

- availability for external transport or local roots;
- discover determinism;
- search determinism;
- get normalization;
- revision detection;
- mapping correctness;
- error normalization;
- stale detection;
- safe retry only where applicable.

The same harness must run for:

```text
LocalRepositoryWorkSource
JiraMcpWorkSource with FakeJiraMcpTransport
```

CI never uses a real Atlassian account. Fake transport fixtures must cover:

- missing connection;
- unavailable connection;
- malformed response;
- unknown issue type;
- mapping v1;
- revision changes;
- source deleted;
- source key ambiguity;
- no raw payload leakage;
- no secret leakage.

## 16. Checks query-only

Plan 4 implements conceptually:

```text
shipping-mode check work-sources --format json
shipping-mode check source-drift [release-ref] --format json
```

`check work-sources` extends current behavior with Jira transport availability,
config invariants, provider activation status and contract-test results.

`check source-drift`:

- scans Release Items with source refs;
- optionally narrows to one Release;
- resolves provider and primary source ref;
- fetches current external normalized state;
- compares baseline;
- detects mapping obsolete;
- emits deterministic findings and recommendation;
- does not write;
- does not refresh;
- does not mutate revisions;
- does not create ChangeSets.

## 17. Traceability

Plan 4 closes the reusable internal query:

```text
Work Source
  -> normalized item
  -> source ref
  -> Release Item
  -> Work Package
  -> Scope
```

Add a provider-neutral query library that can feed JSON output from checks.
Do not implement the public Corte 5 report catalog. Corte 5 can later use this
query to build `report source-status`, `report traceability` and release notes.

## 18. Eventos

Events allowed in Plan 4:

```text
work-source.refreshed
work-source.sync-conflict-detected
```

`work-source.refreshed` is emitted only after an applied `work-source.refresh`.
Payload is bounded: release ID, item ID/display ID, source ID/provider,
external item ID/path, old/new source revision, mapping version, config hash,
operation ID, idempotency key, ChangeSet hash, actor and refreshed revision.

`work-source.sync-conflict-detected` is optional and only for approved/attempted
refresh that reaches conflict evaluation during mutation flow. Query-only
findings from `check source-drift` are sufficient and must not emit events.

Events never include raw provider payloads, secrets, headers, cookies, URLs with
credentials or unbounded metadata.

## 19. Cambios de schemas

Required schema changes:

- `config.schema.json`: add conditional Jira MCP config and external
  `external_authoritative/pull`.
- `normalized-work-source-item.schema.json`: keep provider-neutral shape; add
  only bounded Jira-safe trace fields if required by tests.
- `release-item.schema.json`: add closed `sourceSync` baseline structure and
  optional baseline id binding on source refs if needed.
- `change-set.schema.json`: add `work-source.refresh` payload.
- `operation.schema.json`: add `work-source.refresh` to allowed kinds.
- `event.schema.json`: add `work-source.refreshed` and optional conflict event.

Generated validators and bundles must be regenerated by `npm run build:schemas`
and `npm run build:runtime`.

## 20. Cambios archivo por archivo

### TDD task 1 - Jira config schema

File: `runtime/src/schemas/config.schema.json`
Function/schema: `$defs.workSource`
Test first: `runtime/src/lib/tests/schema-fixtures.test.mjs`
Behavior: valid Jira MCP config passes; tokens, headers, URLs, raw payloads,
commands, roots, arbitrary JQL and unsupported capabilities fail.
Errors: schema invalid; `SOURCE_MISCONFIGURED` via config normalization.
Validation: `npm run build:schemas && npm run test:unit`
Recommended commit: `test/schema: define secure jira mcp work source config`

### TDD task 2 - config normalization

File: `runtime/src/lib/workSourceImport.mjs`
Function/schema: `normalizeWorkSourceConfig`, `workSourceConfigSnapshot`
Test first: `runtime/src/lib/tests/work-source-foundation.test.mjs`
Behavior: accept `jira/mcp/external_authoritative/pull`; reject invalid
provider/transport/policy combinations; hash includes transport and
connectionRef.
Errors: unsupported policy, missing connection ref, incompatible capability.
Validation: `npm run test:unit`
Recommended commit: `feat(work-sources): normalize jira mcp source config`

### TDD task 3 - transport port

File: `runtime/src/lib/workSourceTransportPort.mjs`
Function/schema: request/response validators
Test first: `runtime/src/lib/tests/work-source-transport-port.test.mjs`
Behavior: build canonical requests, validate responses, bind requestHash and
connectionRef, normalize transport errors.
Errors: missing connection, unavailable, malformed response, hash mismatch.
Validation: `npm run test:unit`
Recommended commit: `feat(work-sources): add host transport port contract`

### TDD task 4 - fake Jira MCP transport

File: `runtime/src/lib/tests/fakes/fakeJiraMcpTransport.mjs`
Function/schema: deterministic fake transport
Test first: `runtime/src/lib/tests/jira-mcp-work-source.test.mjs`
Behavior: replay fixtures deterministically; simulate missing connection,
unavailable connection, malformed response, deleted source and ambiguity.
Errors: normalized provider findings only.
Validation: `npm run test:unit`
Recommended commit: `test(work-sources): add deterministic fake jira mcp transport`

### TDD task 5 - Jira mapping fixtures

File: `runtime/src/lib/tests/fixtures/jira-mcp/v1/*.json`
Function/schema: fixture corpus
Test first: `runtime/src/lib/tests/jira-mcp-work-source.test.mjs`
Behavior: cover mapped issue types, unknown issue type, links, parent/epic,
acceptance criteria, assignee/owner, revision, raw/secret leakage.
Errors: unsupported issue type fails closed.
Validation: `npm run test:unit`
Recommended commit: `test(work-sources): fixture jira mapping v1`

### TDD task 6 - JiraMcpWorkSource

File: `runtime/src/lib/jiraMcpWorkSource.mjs`
Function/schema: `discover`, `search`, `get`, mapping v1 helpers
Test first: `runtime/src/lib/tests/jira-mcp-work-source.test.mjs`
Behavior: normalize Jira fixture DTOs to `NormalizedWorkSourceItem`; never leak
raw payload; map statuses/priorities/types deterministically.
Errors: `SOURCE_NOT_FOUND`, `SOURCE_MISCONFIGURED`, `SOURCE_UNAVAILABLE`.
Validation: `npm run test:unit`
Recommended commit: `feat(work-sources): add jira mcp read provider`

### TDD task 7 - provider registry injection

File: `runtime/src/lib/workSourceProvider.mjs`
Function/schema: registry factory and provider descriptors
Test first: `runtime/src/lib/tests/work-source-foundation.test.mjs`
Behavior: registry accepts provider factories requiring host transport; disabled
Jira source can be inspected; enabled source without transport is unavailable.
Errors: capability missing, unknown provider, unavailable transport.
Validation: `npm run test:unit`
Recommended commit: `feat(work-sources): inject external provider transports`

### TDD task 8 - source sync baseline schema

File: `runtime/src/schemas/release-item.schema.json`
Function/schema: `sourceSync`
Test first: `runtime/src/lib/tests/release-item-schema.test.mjs`
Behavior: closed bounded baseline accepts normalized/mapped snapshots and
hashes; rejects raw payload, secrets, stale/mismatched hashes and duplicate
primary baselines.
Errors: schema invalid and semantic health findings.
Validation: `npm run build:schemas && npm run test:unit`
Recommended commit: `feat(items): add server-owned source sync baseline schema`

### TDD task 9 - import baseline write

File: `runtime/src/lib/workSourceImport.mjs`
Function/schema: `prepareWorkSourceImport`, `renderWorkSourceImport`,
`workSourceImportInvariantFindings`
Test first: `runtime/src/lib/tests/work-source-foundation.test.mjs`
Behavior: `work-source.import` writes initial sourceSync baseline for local and
Jira imports; tampering is rejected.
Errors: invalid baseline hash, sourceRef/baseline mismatch.
Validation: `npm run test:unit`
Recommended commit: `feat(work-sources): persist import sync baseline`

### TDD task 10 - drift evaluator

File: `runtime/src/lib/workSourceDrift.mjs`
Function/schema: `evaluateSourceDrift`
Test first: `runtime/src/lib/tests/work-source-drift.test.mjs`
Behavior: produce all states in the matrix deterministically.
Errors: missing baseline, mapping obsolete, config stale, source unavailable,
conflict.
Validation: `npm run test:unit`
Recommended commit: `feat(work-sources): evaluate source drift matrix`

### TDD task 11 - refresh proposal

File: `runtime/src/lib/workSourceRefresh.mjs`
Function/schema: `prepareWorkSourceRefresh`, `renderWorkSourceRefresh`,
invariant findings
Test first: `runtime/src/lib/tests/work-source-refresh.test.mjs`
Behavior: propose/update only when drift is resolvable; preserve local-owned
fields; bind baseline, config, mapping, source revision and target paths.
Errors: no primary source, missing baseline, source conflict, source not found,
stale local/remote/config/mapping.
Validation: `npm run test:unit`
Recommended commit: `feat(work-sources): add refresh changeset`

### TDD task 12 - CLI item refresh

File: `runtime/src/commands/item.mjs`, `runtime/src/index.mjs`,
`bin/shipping-mode.mjs`, `skills/item/SKILL.md`
Function/schema: `runItemRefresh`, dispatch parser, help text
Test first: `runtime/src/commands/tests/work-source-refresh-commands.test.mjs`
Behavior: `item refresh <release-ref> <item-ref> --actor` only proposes a
ChangeSet; no direct item write.
Errors: usage errors, not found, conflict, unavailable provider.
Validation: `npm run test:unit && npm run test:cli-e2e`
Recommended commit: `feat(cli): expose item refresh proposal command`

### TDD task 13 - source drift check

File: `runtime/src/commands/check.mjs`, `runtime/src/index.mjs`,
`bin/shipping-mode.mjs`, `skills/check/SKILL.md`
Function/schema: `checkSourceDrift`
Test first: `runtime/src/commands/tests/check-source-drift.test.mjs`
Behavior: query-only scan, optional release filter, deterministic findings and
recommended operation.
Errors: recovery pending, missing source, provider unavailable, mapping obsolete.
Validation: `npm run test:unit && npm run test:cli-e2e`
Recommended commit: `feat(check): add query-only source drift check`

### TDD task 14 - contract harness expansion

File: `runtime/src/lib/workSourceContract.mjs`
Function/schema: `evaluateWorkSourceProviderContract`
Test first: `runtime/src/lib/tests/work-source-contract.test.mjs`
Behavior: run availability, discover/search/get determinism, revision,
mapping, error normalization and safe retry according to declared capabilities.
Errors: provider activation false on any declared capability failure.
Validation: `npm run test:unit`
Recommended commit: `test(work-sources): harden shared provider contract`

### TDD task 15 - traceability query

File: `runtime/src/lib/sourceTraceability.mjs`
Function/schema: `querySourceTraceability`
Test first: `runtime/src/lib/tests/source-traceability.test.mjs`
Behavior: return Work Source -> normalized item/source ref -> Release Item ->
Work Package -> Scope projection without writing reports.
Errors: missing parent, invalid source ref, missing scope.
Validation: `npm run test:unit`
Recommended commit: `feat(work-sources): add internal source traceability query`

### TDD task 16 - events and recovery

File: `runtime/src/lib/changeset.mjs`, `runtime/src/lib/workSourceRefresh.mjs`,
`runtime/src/schemas/event.schema.json`
Function/schema: event reservation/publication for refresh
Test first: `runtime/src/lib/tests/work-source-refresh-crash-recovery.test.mjs`
Behavior: one `work-source.refreshed` event after apply; no duplicate event or
partial baseline after recovery.
Errors: event/result/operation divergence recovered or marked pending.
Validation: `npm run test:unit && npm run test:real-crash-e2e`
Recommended commit: `feat(work-sources): publish refresh event with recovery`

### TDD task 17 - generated artifacts and host integration

File: `runtime/dist/shipping-mode.mjs`, `runtime/src/generated/validators.mjs`,
`spikes/host-integration/tests/host-integration.test.mjs`
Function/schema: generated bundle/help expectations
Test first: host integration fixture expectation updates
Behavior: bundle includes new commands, schemas and ChangeSet kind.
Errors: stale generated validators or help output.
Validation: `npm run build:schemas && npm run build:runtime && npm run build:test-bundle && npm run test:host-integration && npm run verify:artifacts && npm run verify:next-generation`
Recommended commit: `build(runtime): regenerate plan 4 artifacts`

## 21. Plan TDD incremental

Implementation order:

1. schema tests fail for Jira config.
2. config normalization tests pass.
3. transport port and fake transport tests pass.
4. Jira mapping fixture tests pass.
5. Jira provider contract tests pass.
6. sourceSync schema and import baseline tests pass.
7. drift evaluator matrix tests pass.
8. refresh ChangeSet tests pass.
9. CLI refresh/check tests pass.
10. crash recovery tests pass.
11. host integration and generated artifact verification pass.

Each step must keep previous Corte 0, Corte 1, Corte 2 and Corte 3 tests green.

## 22. Matriz adversarial

Required adversarial cases:

- fake Jira MCP transport deterministic.
- missing connection.
- connection unavailable.
- malformed provider response.
- raw payload leakage.
- secret leakage.
- unknown issue type.
- mapping v1.
- mapping obsolete.
- external revision changes.
- source deleted.
- source key ambiguity.
- remote-only drift.
- local-only drift.
- concurrent conflicting drift.
- compatible changes.
- refresh idempotency.
- stale config.
- stale mapping.
- stale parent.
- ChangeSet tampering.
- crash recovery at each durable boundary.
- deterministic local/Jira contract tests.
- query-only checks.
- no external writes.

## 23. Validacion completa

Future PR minimum validation:

```bash
npm ci
npm run build:schemas
npm run build:runtime
npm run build:test-bundle
npm run test:unit
npm run test:cli-e2e
npm run test:real-crash-e2e
npm run test:security-e2e
npm run test:bundle
npm run test:host-integration
npm run verify:artifacts
npm run verify:next-generation
git diff --check
git status --short
```

No real Atlassian account is allowed in CI. Any optional manual smoke against a
real host connection must be documented as non-blocking evidence and must not
write external data.

## 24. Definition of Done de Plan 4

Plan 4 is done when:

- Jira MCP source config is closed and secret-free.
- Runtime-host-MCP boundary is explicit, injectable and fakeable.
- `JiraMcpWorkSource` implements only `discover`, `search`, `get`.
- Jira mapping v1 is fixture-backed and fail-closed.
- `work-source.import` writes sourceSync baseline.
- `work-source.refresh` proposes/applies pull updates via ChangeSet only.
- Drift/conflict matrix is deterministic.
- `check work-sources` and `check source-drift` are query-only.
- Contract harness gates both local and Jira providers.
- No Jira types leak into core.
- No Tasks, external writes or Corte 5 report system are introduced.
- Full validation suite passes.

## 25. Definition of Done final de Corte 3

Corte 3 can be marked complete only after Plan 4 is implemented, reviewed and
merged. Final Corte 3 evidence:

- Plan 1 Release Item core complete, PR #24 merged.
- Plan 2 Work Package core complete, PR #25 merged.
- Plan 3 Work Source foundation complete, PR #26 merged.
- Plan 4 external provider/closure complete and merged.
- Release Items, Work Packages and Work Sources are all implemented as separate
  provider-agnostic contracts.
- Local and Jira Work Sources share the same provider contract and
  NormalizedWorkSourceItem.
- Import, refresh, drift checks, source refs and traceability query are all
  covered by TDD, recovery and security tests.
- Corte 4-only and Corte 5-only capabilities remain explicitly unavailable.

## 26. Riesgos residuales trasladados a Cortes 4 y 5

Corte 4:

- Task aggregate and task lifecycle.
- gate execution and structured command execution.
- Git task lifecycle.
- optional write-back to external Work Sources.
- external mutation sagas with prepare/execute/verify/record.

Corte 5:

- public `report source-status`.
- public `report traceability`.
- release notes from Work Source provenance.
- consolidated check/report UX if `check sync` gains real semantics.

Residual implementation blocker before coding:

- Productive Jira access depends on a host Atlassian MCP connection being
  available at runtime. This is not a blocker for implementation because the
  runtime boundary and fake transport make CI deterministic, but it is a
  blocker for real manual provider smoke until the host connection exists.
