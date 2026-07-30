# Corte 3 Plan 3 — Work Source Foundation

## Auditoría del runtime actual

`develop` está en `5c75d9b` e incluye PR #24 y PR #25. El runtime ya tiene
`ReleaseItem` y `WorkPackage` como agregados separados bajo
`.planning/releases/<release-id>/items/...`, UUIDv7, `RI-*`/`WP-*`
determinísticos, ChangeSets, idempotency binding, optimistic locking por
`baseRevisions`, eventos inmutables, recovery, checks query-only y proyecciones
YAML/README atómicas. `release-item.schema.json` ya contiene `sourceRefs`,
pero `release-item.create` todavía permite que el caller entregue referencias;
Plan 3 no reutiliza ese camino para import porque debilitaría el trust boundary.

`config.schema.json` ya reserva `work_sources` y `policies.workSources`, pero
la semántica implementada antes de este plan es mínima. `source.schema.json`
pertenece a Documentation Sources. Se pueden compartir path confinement,
fingerprint y límites de lectura, pero Work Sources alimentan Release Items y no
deben duplicar el catálogo documental ni interpretarse como guías.

El runtime real no tiene provider registry, `NormalizedWorkSourceItem`, provider
local productivo, import, `check work-sources`, ni gating contractual. El core
genérico tampoco contiene nombres Jira, lo que se preserva.

## Boundary incluido

Plan 3 implementa exclusivamente:

```text
configured Work Source
  -> WorkSourceProvider
  -> NormalizedWorkSourceItem
  -> work-source.import ChangeSet
  -> canonical Release Item with server-derived sourceRefs
```

El ChangeSet kind único es `work-source.import`. No se oculta el import dentro
de `release-item.create`, porque el caller no puede entregar un
`NormalizedWorkSourceItem` confiable ni `sourceRefs` server-owned.

## Exclusiones

No se implementa `JiraMcpWorkSource`, Atlassian MCP, GitHub Issues, Azure
Boards, Linear, refresh, pull/push/bidirectional sync, write-back, create,
update, transition, comment, sagas externas, traceability global, release notes
derivadas de Work Sources, Tasks, `task.yml`, gate execution, lifecycle terminal
nuevo para Work Package ni auto-repair. Esas capabilities permanecen deferred o
`CAPABILITY_UNAVAILABLE`.

## Modelo de configuración

`config.yml.work_sources[]` es cerrado y seguro. Cada fuente declara `id`,
`provider`, `enabled`, `roots`, `mapping_version`, `import_policy`, `sync_mode`,
`capabilities` y `options`. Plan 3 activa solo `local_repository` con
`import_only` e `import_snapshot`. No se persisten secretos, tokens, cookies,
headers de auth, payloads raw, rutas absolutas ni referencias de conexión
inventadas.

Los roots locales son relativos al workspace, normalizados, no pueden contener
`..`, no pueden ser absolutos, no pueden apuntar a `.planning`, deben existir,
deben ser directorios reales y no pueden escapar por symlink.

## Provider registry y capabilities

`WorkSourceProvider` es contrato de adapter, no agregado. El registry rechaza
capabilities desconocidas, providers duplicados, source IDs duplicados,
providers desconocidos, providers deshabilitados para operaciones mutantes y
capabilities declaradas sin implementación válida. La resolución y el orden son
determinísticos por `source.id`.

Capabilities conocidas: `discover`, `search`, `get`, `create`, `update`,
`transition`, `comment`. Plan 3 declara e implementa solo `discover`, `search`
y `get` para `local_repository`.

## NormalizedWorkSourceItem

Se agrega schema versionado, cerrado y provider-agnostic con `schemaVersion`,
`sourceId`, `provider`, `itemId`, locator local/externo, `type`, `title`,
descripción estructurada, acceptance criteria, status normalizado, prioridad
normalizada, labels, relaciones, dependencias, assignee/owner opcionales,
revision, `mappingVersion` y metadata segura acotada.

Los arrays con identidad semántica se validan por clave en código. La metadata
extensible es JSON-safe, limitada por profundidad/tamaño, excluye secretos, no
contiene raw payload y no participa en decisiones del core.

## Source references

Plan 3 conserva `sourceRefs: []` para Release Items manuales. Un item importado
debe tener una referencia `primary` derivada por runtime, con `sourceId`,
`provider`, `path` o id externo estable, revision observada, `mappingVersion`,
`importedAt` server-owned y `role`. No se aceptan `importedAt`, revision,
provider, source ID ni target paths forjados desde caller o ChangeSet tampering.

## Mapping versionado

`mapping_version: 1` convierte tipos locales soportados hacia los kinds
canónicos de Release Item:
`user_story`, `capability`, `defect`, `enabler`, `spike`, `compliance`,
`migration`, `operational`. Un tipo no soportado falla cerrado.

## Provider local

`LocalRepositoryWorkSource` lee solo archivos YAML/JSON estructurados con
contrato local explícito bajo roots configurados. Markdown puede referenciarse
como contenido, pero no se interpreta heurísticamente. Discovery/search/get son
determinísticos, usan orden estable, lectura segura, límites de tamaño,
fingerprint canónico y errores normalizados.

## Operación de import

`shipping-mode item import <release-ref> --source <source-ref> --actor <actor>`
resuelve Release, fuente, provider y capability; obtiene y normaliza el item;
aplica mapping versionado; genera Release Item y source refs; registra
revision/fingerprint observada; crea `work-source.import`; y revalida provider e
item durante validate/apply. Si el contenido cambia entre propose y apply, la
operación pasa a `STALE`.

## Identidad e idempotency

La idempotency incluye actor, Release canónica, Work Source canónica, item
estable, mapping version, revision observada, intent normalizado y rol primary.
Reusar key con otro Release, source item, mapping, revision o intent falla. Las
reservas de identidad usan los documentos reservados existentes de Release
Items para impedir duplicados concurrentes del mismo primary source item.

## Trust boundaries y optimistic locking

Son server-owned: Release Item ID/display ID, parent Release, source/provider
resolution, normalized output, mapping version, source refs, revisions,
`importedAt`, target paths, Operation ID, event ID, request/proposal binding,
base revisions, audit e initial status. `checkKindInvariants` rechaza tampering
aunque se recalcule el hash público de `change-set.json`.

## Eventos y checks

Apply publica `work-source.imported` con payload bounded: item ID/display ID,
Release ID, source ID/provider, source item path/id, revision, mapping version,
operation ID, idempotency key, ChangeSet hash, revision creada y actor.

`shipping-mode check work-sources --format json` es query-only y reporta source,
provider resuelto, enabled/disabled, capabilities, validez de configuración,
roots disponibles, estado de contract-test activation y findings normalizados.

## Crash recovery

El import reutiliza la maquinaria atómica de ChangeSet: staging, YAML rename,
README rename, result, event y estado aplicado. La revalidación del provider
cubre fuente modificada/desaparecida. Recovery no modifica `release.yml`, no
duplica Release Items ni eventos y no deja referencias parciales.

## Matriz adversarial

Tests cubren source desconocida/deshabilitada, provider desconocido, capability
no declarada, capability declarada sin implementación, IDs duplicados, registry
duplicado, mapping no soportado, type no soportado, path traversal, ruta
absoluta, symlink, escape del root, `.planning` como root, archivo grande,
archivo desaparecido/cambiado, orden determinístico, duplicate primary import,
raw payload injection, metadata con secretos/sin límites, source refs/revision/
importedAt/target path forjados, hash recalculado y crash en durable boundaries.

## Plan TDD

1. Contract tests para registry/config/capabilities/provider local.
2. Schema tests para `NormalizedWorkSourceItem`, source refs e import payload.
3. Import tests para propose/validate/apply, idempotency y duplicate primary.
4. Stale/trust-boundary tests sobre provider output y ChangeSet tampering.
5. Crash recovery tests sobre `work-source.import`.
6. CLI/check/skill tests y regresión completa.

## Definition of Done

Plan 3 queda listo cuando el runtime expone provider registry seguro,
`LocalRepositoryWorkSource`, schemas cerrados, `work-source.import`,
`item import`, `check work-sources`, eventos, recovery, trust boundary,
validators/bundle regenerados, docs/skills actualizados y la suite obligatoria
completa está verde.

## Riesgos residuales

Plan 4 debe conectar providers externos reales al mismo harness, enriquecer
drift/conflict/sync, decidir políticas de múltiples primary incompatibles,
proyectar traceability global y derivar release notes desde Work Sources.
