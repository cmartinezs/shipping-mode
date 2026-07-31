# Corte 3 Plan 4 — External Provider and Corte 3 Closure

## 1. Auditoría exacta de `develop`

Base verificada:

```text
branch: develop
HEAD al iniciar el plan: 8da8dd7cd9ee08afe4abfe1534a614bc59acb66e
merge incluido: PR #26 — Corte 3 Plan 3 Work Source Foundation
rama documental: plan/corte-3-plan-4-external-provider-closure
```

PR #24, PR #25 y PR #26 están incorporados. El runtime real ya contiene:

- `ReleaseItem` y `WorkPackage` como agregados separados.
- `work-source.import` como ChangeSet de import.
- `LocalRepositoryWorkSource` con `discover`, `search` y `get`.
- provider registry y contract harness inicial.
- `NormalizedWorkSourceItem`.
- `sourceRefs` server-owned.
- config hash, revision binding, optimistic locking, idempotencia y recovery.
- `check work-sources`, query-only.
- `dispatch(command, args, cwd, runtimeContext = null)`.

La auditoría también detecta cuatro restricciones que condicionan Plan 4:

1. **No existe un bridge productivo hacia Atlassian MCP.**  
   `bin/shipping-mode.mjs` llama `dispatch(...)` sin `runtimeContext`. La skill
   `item` ejecuta el binario y tampoco inyecta un transport. Un objeto fake
   inyectado en tests no demuestra integración productiva.

2. **`NormalizedWorkSourceItem` aún no es plenamente external-provider-ready.**  
   Su `trace` obligatorio contiene campos locales (`observedPath`,
   `observedBytes`, `observedContentHash`); `description` y
   `acceptanceCriteria` están sobre-restringidos; y cada kind exige campos
   canónicos que Jira no entrega por defecto.

3. **Los items importados por Plan 3 no tienen baseline de sync.**  
   Agregar `sourceSync` como requisito inmediato invalidaría documentos
   actualmente válidos.

4. **La semántica de drift debe separar campos source-managed de campos locales.**  
   Comparar hashes completos del Release Item produciría falsos conflictos y
   podría sobrescribir estado, dependencias o decisiones locales.

Estas restricciones no son detalles de implementación. Son gates de arquitectura
que este plan debe resolver antes de declarar que Jira es un provider productivo.

## 2. Boundary incluido

Plan 4 busca cerrar:

```text
configured Jira Work Source
  -> proven host-owned transport bridge
  -> JiraMcpWorkSource
  -> NormalizedWorkSourceItem
  -> work-source.import / work-source.refresh
  -> canonical Release Item
  -> persisted sync baseline
  -> query-only drift evaluation
  -> Corte 3 final DoD
```

El core continúa provider-agnostic. Fuera del adapter Jira, fixtures y host
adapter no pueden aparecer tipos como:

```text
JiraIssue
JiraTransition
AtlassianClient
JiraStatus
JiraProject
```

El core conoce únicamente:

```text
WorkSourceProvider
WorkSourceTransportPort
NormalizedWorkSourceItem
source refs
sync baselines
mapping profiles
capabilities
policies
revisions
drift states
ChangeSets
findings normalizados
```

## 3. Exclusiones

Plan 4 no implementa:

- Tasks, `task.yml` ni task lifecycle.
- gate execution, shell/build/test execution ni Git task lifecycle.
- create/update/transition/comment externos.
- push, bidirectional sync o write-back.
- sagas de mutación externa.
- GitHub Issues, Azure Boards, Linear u otros providers.
- auto-repair.
- sistema público completo de `report`.
- release notes públicas.
- documentación final de producto.

Las capacidades excluidas deben responder `CAPABILITY_UNAVAILABLE` o
`SOURCE_CAPABILITY_MISSING`; no deben existir stubs que aparenten soporte real.

## 4. Gate crítico P4-0 — demostrar el bridge host–MCP

### 4.1 Problema

El runtime Node standalone no puede invocar una herramienta MCP del host. El
bridge siguiente es solo una intención mientras no exista evidencia ejecutable:

```text
runtime provider port
  <- host adapter
      <- Atlassian MCP
```

`runtimeContext` existe en `dispatch`, pero el launcher actual no lo suministra.
Por lo tanto, Plan 4 queda **bloqueado para implementación productiva** hasta que
un spike demuestre un bridge real en el host objetivo.

### 4.2 Opciones admisibles

El spike debe probar exactamente una de estas opciones:

1. **Embedding in-process confiable**  
   El host carga el bundle, construye un `WorkSourceTransportRegistry` y llama
   `dispatch(..., runtimeContext)` dentro del mismo proceso o de un proceso hijo
   con un canal autenticado por el host.

2. **Envelope firmado o autenticado por el host**  
   El runtime genera una solicitud canónica; el host ejecuta MCP y devuelve un
   envelope cuya autenticidad puede verificarse sin confiar en JSON arbitrario
   entregado por el caller.

Una secuencia skill → MCP → archivo/stdin sin autenticación puede existir solo
como guardrail cooperativo. No puede presentarse como trust boundary fuerte ni
como provenance server-owned.

### 4.3 Criterios de aceptación del spike

El spike es crítico y no waivable. Debe demostrar:

- invocación real desde una skill/plugin instalada, no solo unit tests;
- conexión ausente → `SOURCE_UNAVAILABLE`;
- request/response binding;
- respuesta MCP no confundible con payload CLI arbitrario;
- ningún secreto dentro de `.planning`;
- cancelación y timeout;
- límites de tamaño;
- error normalization;
- test fake determinista;
- smoke read-only opcional con conexión real;
- standalone CLI sin bridge permanece fail-closed.

Resultado permitido:

```text
PASSED
FAILED
INCONCLUSIVE
```

Si el resultado no es `PASSED`, se detiene la implementación de Jira productivo.
Puede implementarse el provider contract con fake transport, pero Corte 3 no se
marca completo.

## 5. Decisiones de arquitectura

1. `work-source.import` continúa creando Release Items.
2. `work-source.refresh` será el ChangeSet de pull local.
3. Comando público previsto:

```text
shipping-mode item refresh <release-ref> <item-ref> --actor <actor>
```

4. `refresh` nunca escribe en Jira.
5. `check source-drift [release-ref] --format json` será query-only.
6. No se agrega `check sync`; no existe una segunda dirección.
7. `connectivity` no se agrega al vocabulario de capabilities. Es una condición
   de activación del transport.
8. El standalone CLI puede operar providers locales. Para Jira debe recibir un
   bridge host probado; sin él falla cerrado.
9. Solo se publica `work-source.refreshed`. Los conflictos detectados por checks
   o durante proposal son findings, no eventos.
10. No se materializan links Jira como `ReleaseItem.dependencies` de forma
    automática. Las dependencias canónicas requieren UUIDv7 internos.

## 6. Frontera runtime–host–MCP

Después de aprobar P4-0, se implementan tres componentes separados:

```text
WorkSourceTransportPort       # contrato provider-neutral
HostWorkSourceTransport       # integración del host aprobada por el spike
FakeWorkSourceTransport       # fixtures deterministas
```

Request canónico:

```yaml
schemaVersion: 1
requestId: <uuidv7>
provider: jira
transport: mcp
connectionRef: atlassian
sourceId: jira-gradeops
operation: discover | search | get
capability: discover | search | get
mappingVersion: 1
configHash: sha256:...
params:
  projectKeys: [GRADE]
  itemRef: GRADE-142
  queryText: assessment
  limit: 50
  requestedFieldIds: [...]
requestHash: sha256:...
```

Response seguro:

```yaml
schemaVersion: 1
requestId: <same uuidv7>
requestHash: <same hash>
provider: jira
transport: mcp
connectionRef: atlassian
sourceId: jira-gradeops
status: OK | NOT_FOUND | UNAVAILABLE | MISCONFIGURED | MALFORMED
items: []
item: null
findings: []
observedAt: <host timestamp>
responseFingerprint: sha256:...
```

El DTO de respuesta es schema-closed y bounded. Contiene solo campos permitidos
por el mapping profile. No contiene payload Jira raw.

El runtime valida:

- request ID y hash;
- source/provider/transport/connection;
- operation y capability;
- límite de items y bytes;
- field IDs solicitados;
- response fingerprint;
- ausencia de claves secret-like;
- ausencia de propiedades desconocidas.

## 7. Configuración segura

Extensión prevista:

```yaml
work_sources:
  - id: jira-gradeops
    provider: jira
    transport: mcp
    enabled: true
    connection_ref: atlassian
    mapping_version: 1
    mapping_profile: jira-gradeops-v1
    import_policy: external_authoritative
    sync_mode: pull
    capabilities: [discover, search, get]
    options:
      project_keys: [GRADE]
      query_scope:
        mode: project_keys_and_text
        max_results: 50
      allowed_issue_types: [Story, Bug, Epic, Spike]
      field_map:
        Story:
          kind: user_story
          actor: customfield_10101
          need: customfield_10102
          value: customfield_10103
          acceptanceCriteria: customfield_10104
        Bug:
          kind: defect
          observedBehavior: customfield_10201
          expectedBehavior: customfield_10202
          reproduction: customfield_10203
          severity: priority
```

Reglas:

- `local_repository` conserva roots e `import_snapshot/import_only`.
- `jira` requiere `transport: mcp`, `connection_ref`, `mapping_profile`,
  project keys y field map cerrado.
- Jira no admite roots.
- `pull` requiere `external_authoritative`.
- solo `discover/search/get`.
- no JQL arbitrario.
- no tokens, cookies, headers, URLs con credenciales, comandos ni payloads raw.
- field selectors son IDs/nombres limitados, no expresiones ejecutables.
- el config hash incluye transport, connection ref, mapping profile, field map,
  capabilities, policy, mode y options.

## 8. NormalizedWorkSourceItem external-compatible

Plan 4 debe corregir el schema antes de implementar Jira:

- `trace` pasa a una unión cerrada:
  - variante local compatible con Plan 3;
  - variante external con `externalId`, `observedAt`,
    `responseFingerprint` y evidencia bounded.
- `description` puede ser `null`; no se fabrican descripciones.
- `acceptanceCriteria`:
  - al menos una para `user_story` y `capability`;
  - puede ser vacía para los demás kinds.
- `fields` continúa siendo condicional y exacto por kind.
- revision externa robusta prevalece sobre timestamps.
- ninguna variante permite raw payload.

Los documentos/Operations Plan 3 con trace local siguen siendo válidos. La
evolución debe ser aditiva o mediante unión compatible; no se invalida recovery
histórico.

## 9. Jira adapter y mapping v1

Archivos previstos:

```text
runtime/src/lib/jiraMcpWorkSource.mjs
runtime/src/lib/workSourceTransportPort.mjs
runtime/src/lib/workSourceMapping.mjs
runtime/src/lib/tests/fixtures/jira-mcp/v1/*.json
runtime/src/lib/tests/fakes/fakeWorkSourceTransport.mjs
```

Campos comunes:

- key estable → `itemId`;
- URL segura → `url`;
- issue type;
- summary → title;
- description nullable;
- status y priority originales/normalizados;
- labels;
- parent/epic e issue links como relaciones externas;
- assignee/owner;
- external revision o fingerprint seguro;
- metadata mínima y bounded.

Los campos canónicos específicos del kind se obtienen únicamente mediante el
`field_map` configurado y validado. No se infieren mediante LLM, regex ambigua ni
placeholders.

Si falta un campo requerido:

```text
SOURCE_MISCONFIGURED
reason: REQUIRED_MAPPING_FIELD_MISSING
```

Tipos sin mapping fallan cerrado. `Task` y `Sub-task` no se convierten
silenciosamente.

Links/dependencies Jira permanecen como relaciones externas normalizadas. Plan 4
no los convierte automáticamente a UUIDs internos.

## 10. Source refs y baseline de sync

`sourceRefs` continúa siendo provenance compacta. Se agrega `sourceSync` como
estructura **opcional y compatible**:

```yaml
sourceSync:
  schemaVersion: 1
  baselines:
    - baselineId: <uuidv7>
      sourceRefIdentityHash: sha256:...
      role: primary
      sourceId: jira-gradeops
      provider: jira
      locator:
        externalId: GRADE-142
      sourceRevision: "10042"
      mappingVersion: 1
      mappingProfile: jira-gradeops-v1
      configHash: sha256:...
      managedFields:
        - /kind
        - /title
        - /description
        - /actor
        - /need
        - /value
        - /acceptanceCriteria
      managedSnapshot: {}
      managedSnapshotHash: sha256:...
      aggregateRevisionAtSync: sha256:...
      syncedAt: <server time>
      syncedBy: <actor>
```

No se persiste el `NormalizedWorkSourceItem` completo. Se guarda únicamente la
proyección canónica de campos source-managed necesaria para drift.

Invariantes:

- como máximo una baseline primary por source ref primary;
- identity, locator, revision y mapping coinciden con sourceRef;
- `managedFields` pertenece al mapping profile;
- hash coincide con snapshot;
- baseline y sourceRef se actualizan atómicamente;
- `importedAt` nunca cambia durante refresh;
- `syncedAt` vive en baseline;
- no raw provider payload.

## 11. Compatibilidad con imports Plan 3

Items importados antes de Plan 4 pueden tener primary sourceRef sin `sourceSync`.
Deben permanecer schema-valid.

Estado interno:

```text
BASELINE_MISSING
```

Comportamiento:

- `check source-drift` consulta la fuente.
- si el remote mapped snapshot coincide exactamente con la proyección managed
  actual, recomienda `work-source.refresh` en modo `capture_baseline`;
- si no coincide, devuelve `SOURCE_CONFLICT`;
- nunca inventa una baseline histórica;
- nunca actualiza contenido desde check.

Imports nuevos escriben baseline desde el inicio para providers locales y Jira.

## 12. Field ownership y drift

Cada mapping profile declara `managedFields`. Todos los demás campos del
Release Item son local-owned y se preservan.

No forman parte del snapshot managed:

- `id`, `displayId`, `releaseId`;
- status/resolution;
- audit;
- dependencies internas;
- source refs y sync metadata;
- Work Packages;
- cualquier campo no declarado por el profile.

Inputs:

```text
B = baseline managed snapshot
R = current remote mapped managed snapshot
L = current local managed projection
A0 = aggregate revision at sync
A1 = current aggregate revision
```

Matriz:

| Condición | Estado | Finding | Acción |
|---|---|---|---|
| provider/transport unavailable | `SOURCE_UNAVAILABLE` | `SOURCE_UNAVAILABLE` | retry |
| config inválida | `SOURCE_MISCONFIGURED` | `SOURCE_MISCONFIGURED` | fix config |
| capability ausente | `SOURCE_CAPABILITY_MISSING` | mismo | fix/disable |
| source ausente | `SOURCE_NOT_FOUND` | mismo | decisión humana |
| baseline ausente y `R == L` | `BASELINE_MISSING_SAFE` | `SYNC_REQUIRED` | capture baseline |
| baseline ausente y `R != L` | `BASELINE_MISSING_CONFLICT` | `SOURCE_CONFLICT` | decisión humana |
| mapping/profile no activo | `MAPPING_OBSOLETE` | mismo | explicit remap |
| `R == B` y `L == B` y `A1 == A0` | `UNCHANGED` | ninguno | no-op |
| `R == B` y `L == B` y `A1 != A0` | `LOCAL_UNMANAGED_CHANGED` | ninguno | no-op |
| `R != B` y `L == B` y `A1 == A0` | `REMOTE_CHANGED` | `SYNC_REQUIRED` | refresh |
| `R != B` y `L == B` y `A1 != A0` | `BOTH_CHANGED_COMPATIBLE` | `SYNC_REQUIRED` | refresh preservando local-owned |
| `L != B` y `R == B` | `LOCAL_MANAGED_CHANGED` | `SOURCE_CONFLICT` | decisión humana |
| `L != B` y `R != B` | `SOURCE_CONFLICT` | mismo | decisión humana |
| config hash cambió | `CONFIG_CHANGED` | `SOURCE_STALE` | reevaluar/re-proponer |

`SOURCE_STALE` se reserva para cambios de config/revision/baseline entre
propose–validate–apply. Un cambio local en campos managed no se etiqueta como
source stale: es conflicto bajo `external_authoritative`.

No hay merge automático de dos modificaciones sobre campos managed.

## 13. ChangeSet y comando refresh

ChangeSet:

```text
work-source.refresh
```

Comando:

```text
shipping-mode item refresh <release-ref> <item-ref> \
  --actor <actor> [--idempotency-key <key>]
```

Resultados de proposal:

```text
PROPOSED
NO_CHANGES
CONFLICT
UNAVAILABLE
```

Flujo:

1. resolver Release e Item canónicos;
2. exigir primary source ref única para refresh;
3. resolver source, mapping profile, provider y transport;
4. fetch/normalize/map;
5. evaluar baseline y drift;
6. no crear Operation para `NO_CHANGES`, conflict o unavailable;
7. crear `work-source.refresh` solo para `REMOTE_CHANGED`,
   `BOTH_CHANGED_COMPATIBLE` o `BASELINE_MISSING_SAFE`;
8. bind de Release/Item revision, source revision, config hash, mapping profile,
   baseline ID/hash, managed fields/snapshot y target paths;
9. approval normal;
10. validate re-fetches y recalcula todo;
11. apply reescribe YAML/README/sourceRef/sourceSync atómicamente;
12. verify compara schema, projection y hashes;
13. publicar `work-source.refreshed`;
14. recovery idempotente.

`capture_baseline` no modifica campos managed cuando `R == L`.

## 14. Idempotencia y concurrencia

El request hash incluye:

```text
actor
releaseId
itemId
source identity
connectionRef
mapping profile/version
config hash
baseline ID/hash or BASELINE_MISSING
remote revision
remote managed snapshot hash
local managed snapshot hash
aggregate revision
target paths
mode refresh|capture_baseline
```

Semántica:

- misma idempotency key explícita + mismo request hash → misma Operation;
- misma key + distinto hash → error;
- sin key explícita no se promete reutilizar el mismo Operation;
- una reserva por target item + baseline impide dos refresh pendientes;
- el segundo intento concurrente devuelve la Operation reservada o conflicto
  determinista según la primitive existente;
- replay aplicado no duplica evento;
- cambio local/remoto/config/mapping convierte validate/apply en `STALE`.

## 15. Trust boundaries

Server-owned:

- source/provider/transport/connection resolution;
- external locator y revision;
- normalized DTO;
- mapping profile/version;
- managed fields;
- managed snapshot y hashes;
- baseline;
- config hash;
- sourceRef;
- Release/Item IDs;
- target paths;
- operation/event IDs;
- actor/proposedAt;
- idempotency request hash;
- base revisions.

La validación semántica debe detectar tampering aun si se recalcula el hash
público del ChangeSet.

La fuerza de la provenance del transport depende del resultado P4-0. Un envelope
cooperativo sin autenticación no se documentará como protección contra caller
malicioso.

## 16. Contract-test harness

El harness compartido cubre:

- availability;
- discover determinism;
- search determinism;
- get normalization;
- revision detection;
- mapping correctness;
- missing required mapped fields;
- error normalization;
- stale detection;
- safe retry read-only;
- bounded output;
- no secret/raw leakage.

Se ejecuta para:

```text
LocalRepositoryWorkSource
JiraMcpWorkSource + FakeWorkSourceTransport
```

Un provider activo que falla una capability declarada queda inactivo.

## 17. Checks query-only

Comandos:

```text
shipping-mode check work-sources --format json
shipping-mode check source-drift [release-ref] --format json
```

`check source-drift`:

- respeta recovery pending;
- filtra opcionalmente por Release;
- inspecciona items con primary sourceRef;
- resuelve source/provider/transport;
- fetch/normalize/map;
- evalúa baseline y mapping;
- devuelve estado, finding y recomendación;
- no escribe, no crea Operation, no emite evento.

Sin host bridge, Jira aparece `SOURCE_UNAVAILABLE`; el check no acepta una
respuesta externa arbitraria como argumento confiable.

## 18. Traceability

Query interna:

```text
Work Source
  -> sourceRef/baseline
  -> Release Item
  -> Work Package
  -> Scope
```

No requiere fetch remoto para producir trazabilidad canónica. Puede incluir el
estado de drift solo cuando el caller suministra un transport host válido.

No se implementa el catálogo público de reports de Corte 5.

## 19. Eventos

Único evento nuevo:

```text
work-source.refreshed
```

Se emite solo después de apply verificado. Payload bounded:

- Release/Item IDs;
- source/provider;
- external/local item identity;
- old/new source revision;
- mapping profile/version;
- config hash;
- baseline ID;
- Operation/idempotency/ChangeSet hashes;
- actor;
- nueva revision del Release Item.

Los conflictos query-only o pre-proposal no emiten eventos.

## 20. Crash recovery

Fault matrix:

- manifest;
- staged YAML;
- staged README;
- first rename;
- both renames;
- result;
- event;
- operation finalization;
- source changes durante recovery;
- config/mapping changes;
- workspace con recovery pending.

Invariantes:

- no false success;
- no partial baseline;
- no sourceRef revision sin baseline correspondiente;
- no duplicate event;
- no overwrite de cambios locales;
- no re-fetch destructivo durante replay de un apply ya durable;
- divergencia se marca recovery-required.

## 21. Cambios de schemas

- `config.schema.json`: Jira MCP + field map cerrado.
- `normalized-work-source-item.schema.json`: trace union external-compatible,
  description nullable y acceptance criteria condicional.
- `release-item.schema.json`: `sourceSync` opcional y cerrado.
- `change-set.schema.json`: payload `work-source.refresh`.
- `operation.schema.json`: kind refresh.
- `event.schema.json`: `work-source.refreshed`.

No se obliga a documentos Plan 3 existentes a contener baseline.

## 22. Plan archivo por archivo y TDD

### Task 0 — host transport spike

Files:

```text
spikes/host-work-source-transport/**
docs/plugin-redesign-release-flow/decisions/**
```

Test/evidence first: plugin instalada, conexión missing y fake bridge.

DoD: P4-0 `PASSED`.  
Commit: `spike(host): prove work source transport bridge`.

### Task 1 — schema compatibility tests

Files:

```text
runtime/src/schemas/normalized-work-source-item.schema.json
runtime/src/lib/tests/schema-fixtures.test.mjs
runtime/src/lib/tests/work-source-foundation.test.mjs
```

Test first:

- legacy local trace remains valid;
- external trace valid;
- nullable description;
- conditional acceptance criteria;
- raw fields rejected.

Commit: `test(schema): define external normalized item compatibility`.

### Task 2 — secure Jira config

Files:

```text
runtime/src/schemas/config.schema.json
runtime/src/lib/workSourceImport.mjs
runtime/src/lib/tests/work-source-foundation.test.mjs
```

Test first: valid mapping profile; secrets/JQL/roots/missing field map rejected.  
Commit: `feat(work-sources): define secure jira mapping config`.

### Task 3 — transport port

Files:

```text
runtime/src/lib/workSourceTransportPort.mjs
runtime/src/lib/tests/work-source-transport-port.test.mjs
```

Test first: request/response binding, limits, malformed/unavailable.  
Commit: `feat(work-sources): add transport port contract`.

### Task 4 — fake transport and Jira fixtures

Files:

```text
runtime/src/lib/tests/fakes/fakeWorkSourceTransport.mjs
runtime/src/lib/tests/fixtures/jira-mcp/v1/**
```

Test first: deterministic replay and error fixtures.  
Commit: `test(work-sources): add jira transport fixtures`.

### Task 5 — Jira mapping profile

Files:

```text
runtime/src/lib/workSourceMapping.mjs
runtime/src/lib/tests/jira-mcp-work-source.test.mjs
```

Test first: each kind, missing required field, unknown type, no dependency UUID
fabrication.  
Commit: `feat(work-sources): map jira through closed profiles`.

### Task 6 — Jira provider

Files:

```text
runtime/src/lib/jiraMcpWorkSource.mjs
runtime/src/lib/workSourceProvider.mjs
```

Test first: discover/search/get, no transport, bad response, deterministic output.  
Commit: `feat(work-sources): add jira read provider`.

### Task 7 — host bridge integration

Files depend on P4-0 result and must be named in the accepted ADR.

Test first: real plugin invocation path and standalone fail-closed.  
Commit: `feat(host): connect approved work source transport bridge`.

### Task 8 — sourceSync schema and compatibility

Files:

```text
runtime/src/schemas/release-item.schema.json
runtime/src/lib/tests/release-item-schema.test.mjs
runtime/src/lib/releaseItemStore.mjs
```

Test first: existing item without baseline valid; compact baseline valid; hash and
identity mismatches invalid.  
Commit: `feat(items): add compatible source sync baseline`.

### Task 9 — import baseline

Files:

```text
runtime/src/lib/workSourceImport.mjs
runtime/src/lib/tests/work-source-foundation.test.mjs
```

Test first: new local/Jira imports include baseline; legacy items unaffected.  
Commit: `feat(work-sources): persist import baseline`.

### Task 10 — drift evaluator

Files:

```text
runtime/src/lib/workSourceDrift.mjs
runtime/src/lib/tests/work-source-drift.test.mjs
```

Test first: every state in Section 12.  
Commit: `feat(work-sources): evaluate managed-field drift`.

### Task 11 — refresh ChangeSet

Files:

```text
runtime/src/lib/workSourceRefresh.mjs
runtime/src/schemas/change-set.schema.json
runtime/src/schemas/operation.schema.json
runtime/src/lib/changeset.mjs
runtime/src/lib/tests/work-source-refresh.test.mjs
```

Test first: no-op, capture baseline, remote refresh, conflict, tampering, stale.  
Commit: `feat(work-sources): add refresh changeset`.

### Task 12 — CLI and runtime context propagation

Files:

```text
runtime/src/index.mjs
runtime/src/commands/item.mjs
bin/shipping-mode.mjs
skills/item/SKILL.md
```

Test first: runtime context reaches provider only through approved bridge;
standalone external request fails closed.  
Commit: `feat(cli): expose safe item refresh`.

### Task 13 — source drift check

Files:

```text
runtime/src/commands/check.mjs
runtime/src/index.mjs
skills/check/SKILL.md
runtime/src/commands/tests/check-source-drift.test.mjs
```

Test first: query-only and deterministic.  
Commit: `feat(check): add source drift query`.

### Task 14 — provider contract expansion

Files:

```text
runtime/src/lib/workSourceContract.mjs
runtime/src/lib/tests/work-source-contract.test.mjs
```

Test first: local and Jira share same harness.  
Commit: `test(work-sources): harden provider contract`.

### Task 15 — traceability query

Files:

```text
runtime/src/lib/sourceTraceability.mjs
runtime/src/lib/tests/source-traceability.test.mjs
```

Test first: missing source/item/package/scope and deterministic ordering.  
Commit: `feat(work-sources): add traceability query`.

### Task 16 — event and recovery

Files:

```text
runtime/src/schemas/event.schema.json
runtime/src/lib/changeset.mjs
runtime/src/lib/tests/work-source-refresh-crash-recovery.test.mjs
```

Test first: durable-boundary matrix and no duplicate event.  
Commit: `feat(work-sources): recover refresh atomically`.

### Task 17 — generated artifacts and closure

Files:

```text
runtime/src/generated/validators.mjs
runtime/dist/shipping-mode.mjs
bin/shipping-mode.mjs
spikes/host-integration/tests/host-integration.test.mjs
docs/superpowers/plans/2026-07-29-corte-3-INDEX.md
```

Commit: `build(runtime): close Corte 3 Plan 4`.

## 23. Matriz adversarial

- bridge ausente/no autenticado;
- standalone CLI con payload externo forjado;
- connection missing/unavailable;
- timeout/cancel;
- response hash/request mismatch;
- oversized/malformed response;
- secret/raw leakage;
- unknown issue type;
- required canonical mapping field missing;
- local trace legacy;
- baseline missing safe/conflict;
- remote-only drift;
- local unmanaged change;
- local managed change;
- both compatible/conflict;
- mapping/config stale;
- source deleted/ambiguous;
- explicit idempotency reuse/mismatch;
- concurrent refresh reservation;
- target/path/baseline tampering;
- recovery en cada durable boundary;
- no external writes;
- query-only checks;
- deterministic local/Jira provider contracts.

## 24. Validación completa

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

CI usa fake transport. Un smoke real es read-only, opcional y no reemplaza los
tests. P4-0 sí debe producir evidencia de host integration real o declarar el
bloqueo.

## 25. Definition of Done

Plan 4 está completo solo si:

- P4-0 pasó;
- el bridge productivo es ejecutable y documentado;
- standalone CLI falla cerrado para external providers sin bridge;
- Jira config y mapping profiles son cerrados;
- normalized schema admite external provider sin romper Plan 3;
- Jira implementa únicamente discover/search/get;
- imports nuevos escriben baseline;
- items Plan 3 sin baseline siguen válidos;
- refresh/capture baseline son ChangeSet-only;
- drift usa campos managed;
- checks son query-only;
- local y Jira pasan el mismo harness;
- no existen Tasks, reports completos ni writes externos;
- suite completa y workflow oficial pasan.

Corte 3 se marca completo únicamente después de merge de Plan 4 con toda la
evidencia anterior.

## 26. Riesgos residuales

Corte 4:

- Task aggregate y lifecycle;
- gate/command execution;
- Git lifecycle;
- write-back y mutaciones externas;
- sagas y compensación.

Corte 5:

- reports públicos;
- source status/traceability UI;
- release notes;
- UX consolidada de checks.

Bloqueo actual:

```text
PRODUCTIVE JIRA HOST PATH: PENDING
```

## 27. Implementacion de cierre

La implementacion de Tasks 1-17 conserva la separacion aprobada por P4-0:
`WorkSourceTransportPort` define el contrato, `HostWorkSourceTransport` consume
exclusivamente el envelope del bridge aprobado y `FakeWorkSourceTransport` queda
confinado a fixtures y CI. El CLI standalone no obtiene bridge state ni
envelopes desde flags/stdin, por lo que Jira falla cerrado sin contexto host.

La captura permanece en hooks plugin-level (`hooks/hooks.json`), con estado
persistent en `CLAUDE_PLUGIN_DATA`; esos hooks no se trasladan al frontmatter de
skills. El refresh solo muta Release Item YAML/README mediante
`work-source.refresh`, preserva campos local-owned, actualiza sourceRef y
sourceSync atomically y emite unicamente `work-source.refreshed` despues de un
apply verificado. `check source-drift` y la query de trazabilidad son
query-only.

La diferencia material respecto del texto inicial del plan es que el runtime
legacy conserva `workSourceConfigHash` sin prefijo para no romper Plan 3; los
transport requests y sourceSync lo expresan como `sha256:<hash>`. El binding
entre ambos valores se valida en el adapter, el mapping y el baseline.

## 28. Host orchestration productivo

La implementacion posterior al review de PR #29 agrega una capa host-side
explicita, separada del core provider-neutral:

- `AtlassianMcpHostAdapter` convierte requests canonicos Jira MCP a acciones
  read-only allowlisted (`jira_get_issue` y `jira_search`) y normaliza la
  respuesta Atlassian a `WorkSourceTransportResponse`.
- `HostWorkSourceInvocation` implementa PREPARE/MCP/RESUME con invocaciones
  HMAC-signed bajo `CLAUDE_PLUGIN_DATA/work-source-host-invocations/`.
- `scripts/work-source-host-runner.mjs` es el entrypoint interno para skills
  instaladas.
- `skills/item` y `skills/check` distinguen provider local del provider Jira
  externo y documentan PREPARE -> MCP -> RESUME.

Invariantes preservadas:

- los hooks de captura siguen exclusivamente en `hooks/hooks.json`;
- el core no conoce herramientas `mcp__atlassian__*`, prompts Claude Code,
  hook payloads, `CLAUDE_PLUGIN_DATA` ni `bridge.key`;
- el bridge challenge usa el mismo `requestId` que el
  `WorkSourceTransportRequest`;
- `item import`, `item refresh` y `check source-drift` reanudan `dispatch` con un
  transport en memoria;
- el standalone CLI sigue fail-closed para Jira sin runtimeContext host;
- no se aceptan flags para raw response, envelope file, transport response ni
  JSON confiado por caller.

Estado:

```text
PRODUCTIVE JIRA HOST PATH: PENDING
CORTE 3 PLAN 4: IMPLEMENTED CORE + HOST ORCHESTRATION — PENDING REAL JIRA EVIDENCE
CORTE 3: IN PROGRESS
```

La evidencia automatizada cubre adapter, lifecycle, replay rejection, skill
placement, hook placement, provider local sin regresion y bridge P4-0. Falta el
smoke real desde plugin instalado contra Atlassian MCP con autorizacion normal
del usuario; hasta entonces no se marca `PASSED`.
