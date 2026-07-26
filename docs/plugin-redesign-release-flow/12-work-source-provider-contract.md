# Work Source Provider contract

## Objetivo

Shipping Mode puede recibir trabajo desde fuentes internas del repositorio y desde proveedores externos mediante un contrato comun de **Work Sources**.

El modelo canonico interno no cambia:

```text
Work Source
  -> NormalizedWorkSourceItem
    -> Release Item
      -> Work Package
        -> Task
```

`ReleaseItem` sigue siendo la entidad canonica de alcance dentro de Shipping Mode. Un Work Source alimenta, refresca o sincroniza Release Items, pero no reemplaza el dominio interno ni introduce modelos externos como entidades centrales.

## Distincion: Documentation Source vs Work Source

Shipping Mode usa dos familias de fuentes:

| Familia | Proposito | Ejemplos | Salida principal |
|---------|-----------|----------|------------------|
| `Documentation Source` | Conocimiento, reglas, arquitectura, guias, evidencia y constraints. | `docs/architecture`, ADRs, OpenAPI, coding guides, CI, evidence docs. | Scope guides, gates, provenance documental, checks de vigencia. |
| `Work Source` | Unidades de trabajo candidatas para una release. | backlog local, requirements, user stories, Jira issues, GitHub Issues, Azure Boards, Linear. | `NormalizedWorkSourceItem`, `ReleaseItem.source_refs`, sync/drift. |

Ambas pueden compartir primitives como fingerprint, provenance, authority, availability y revision refs. No deben compartir semantica de dominio: una guia tecnica no es backlog y un issue externo no es documentacion tecnica.

## Provider contract

Todo adapter implementa conceptualmente:

```text
WorkSourceProvider
```

Contrato minimo:

```yaml
provider: jira | local_repository | github_issues | azure_boards | linear | custom
source_id: <project-configured-source-id>
capabilities:
  discover: true|false
  search: true|false
  get: true|false
  create: true|false
  update: true|false
  transition: true|false
  comment: true|false
sync_modes_supported:
  - import_only
  - pull
  - push
  - bidirectional
policies_supported:
  - external_authoritative
  - shipping_mode_authoritative
  - import_snapshot
  - bidirectional_controlled
mapping_versions_supported:
  - 1
```

Capabilities son declarativas y verificables. El runtime no intenta una operacion que el provider no declara, y un provider que declara una capability debe superar sus contract tests antes de activarse.

Implementaciones principales del roadmap:

```text
LocalRepositoryWorkSource
JiraMcpWorkSource
```

El contrato queda preparado para:

```text
GitHubIssuesWorkSource
AzureBoardsWorkSource
LinearWorkSource
```

sin cambiar `ReleaseItem`, `WorkPackage` ni `Task`.

## NormalizedWorkSourceItem

Los adapters no exponen payloads raw como dominio interno. Cada provider transforma su fuente a:

```yaml
schema_version: 1
source_id: jira-gradeops
provider: jira
external_id: GRADE-142
external_url: https://example.atlassian.net/browse/GRADE-142
type: story
title: Import assessment brief
description:
  format: markdown
  text: ...
acceptance_criteria:
  - text: ...
status:
  provider_status: In Progress
  normalized_status: in_progress
priority:
  provider_priority: High
  normalized_priority: high
labels:
  - assessment
relationships:
  parent_refs: []
  reference_refs: []
dependencies:
  - type: blocks
    target:
      source_id: jira-gradeops
      external_id: GRADE-141
assignee:
  display_name: ...
  provider_account_id: ...
owner: ...
revision:
  external_revision: "10042"
  content_revision: sha256:...
  updated_at: 2026-07-26T00:00:00Z
provider_metadata:
  issue_type: Story
  project_key: GRADE
```

El schema debe representar al menos id externo/provider, tipo, titulo, descripcion, criterios de aceptacion, status, prioridad, labels/tags, relaciones padre/referencia, dependencias/links, assignee/owner cuando aplique, URL, revision/update y metadata minima de trazabilidad.

`provider_metadata` es encapsulado: sirve para trazabilidad y verificacion del adapter, no para que el core tome dependencias sobre campos especificos de Jira, Linear u otro proveedor.

## Source references en Release Items

`release-item.yml` conserva referencias normalizadas a una o mas fuentes:

```yaml
source_refs:
  - source_id: jira-gradeops
    provider: jira
    external_id: GRADE-142
    external_url: https://example.atlassian.net/browse/GRADE-142
    external_revision: "10042"
    imported_at: 2026-07-26T00:00:00Z
    mapping_version: 1
    role: primary
```

Para fuente local:

```yaml
source_refs:
  - source_id: local-product-backlog
    provider: local_repository
    path: docs/backlog/assessment.md
    content_revision: sha256:...
    imported_at: 2026-07-26T00:00:00Z
    mapping_version: 1
    role: primary
```

Estos ejemplos no agotan el schema. Una referencia puede incluir provider, id externo, URL, path, revision externa, fingerprint de contenido, mapping version, rol, import timestamp y metadata de verificacion. Debe poder haber multiples referencias, por ejemplo una historia local enriquecida por un issue externo o un item que agrega dos fuentes relacionadas.

Roles iniciales:

```text
primary
supporting
derived_from
supersedes
related
```

## Configuracion segura

`Project Context` declara Work Sources sin secretos:

```yaml
work_sources:
  - id: local-backlog
    provider: local_repository
    enabled: true
    roots:
      - docs/backlog/
      - docs/requirements/
    import_policy: import_snapshot
    sync_mode: import_only

  - id: jira-gradeops
    provider: jira
    transport: mcp
    enabled: true
    import_policy: external_authoritative
    sync_mode: pull
    mcp_connection_ref: atlassian
```

Reglas:

- `.planning/**` no persiste tokens, credenciales, refresh tokens ni secretos.
- Autenticacion MCP/API pertenece al host/connection layer.
- Permisos MCP del host y approvals de Shipping Mode son capas distintas.
- La configuracion solo referencia datos seguros: ids de fuente, provider, transport, roots/queries permitidas, policy, sync mode y referencias opacas a conexiones ya configuradas fuera de `.planning`.
- Un provider deshabilitado no participa en import, sync, checks ni writes.

## Sync y source of truth

Shipping Mode no asume sincronizacion bidireccional automatica.

Sync modes:

```text
import_only
pull
push
bidirectional
```

Source-of-truth policies:

```text
external_authoritative
shipping_mode_authoritative
import_snapshot
bidirectional_controlled
```

La policy define campos sincronizables, direccion permitida y comportamiento ante drift. Si ambas partes cambiaron el mismo campo desde la ultima revision conocida, no hay merge automatico: se crea conflicto y decision pendiente.

Estados/finding codes canonicos:

```text
SOURCE_UNAVAILABLE
SOURCE_MISCONFIGURED
SOURCE_CAPABILITY_MISSING
SOURCE_NOT_FOUND
SOURCE_STALE
SOURCE_CONFLICT
SYNC_REQUIRED
MAPPING_OBSOLETE
```

`SOURCE_STALE` ocurre cuando la revision externa o fingerprint actual difiere de la revision registrada. `SOURCE_CONFLICT` ocurre cuando hay cambios concurrentes incompatibles para una policy/campo. `SYNC_REQUIRED` indica que hay drift resoluble mediante una operacion propuesta y aprobada.

Cuando exista revision externa robusta, esa revision prevalece sobre timestamps. Para fuentes locales se usa `content_revision` canonico; para directorios se usa tree hash.

## Import y mapping versionado

Importar desde Work Source produce un ChangeSet:

```text
provider item
  -> NormalizedWorkSourceItem
  -> proposed ReleaseItem
  -> source_refs
  -> evidence
```

Cada mapping declara version:

```yaml
mapping:
  provider: jira
  version: 1
  normalized_schema_version: 1
```

Cambiar reglas de mapping requiere version nueva o migracion explicita. `check source-drift` debe poder detectar `MAPPING_OBSOLETE` cuando un Release Item fue importado con una version que el provider ya no considera activa.

## External mutations

Crear, modificar, transicionar o comentar una fuente externa es un side effect y se modela como saga:

```text
prepare -> execute -> verify -> record
```

Con compensacion cuando exista accion segura:

```text
prepare -> execute -> verify -> compensate -> record
```

Toda mutacion externa requiere:

- capability declarada por el provider;
- policy que permita el campo/accion/direccion;
- ChangeSet aprobado y vigente;
- idempotency key;
- base revision externa registrada;
- retries seguros;
- observabilidad y evidencia;
- verificacion posterior contra el provider;
- resultado registrado con revision final.

Un agente no puede modificar Jira u otro provider solo porque el host MCP tenga permisos. Shipping Mode debe aprobar la operacion segun policy y registrar evidencia.

Evidencia minima:

```yaml
external_operation:
  source_id: jira-gradeops
  provider: jira
  capability: comment
  idempotency_key: ...
  source_item:
    external_id: GRADE-142
  initial_revision: "10042"
  operation_request_hash: sha256:...
  result: succeeded
  final_revision: "10043"
  verified_at: 2026-07-26T00:00:00Z
```

## Jira adapter

`JiraMcpWorkSource` es el primer provider externo real y debe implementarse mediante Atlassian MCP cuando llegue su fase.

Mapea Jira hacia el contrato generico:

```text
Issue
Issue Type
Status
Priority
Labels
Description
Acceptance Criteria cuando exista
Links
Parent/Epic relations
Transitions
Comments
```

El core no debe contener nombres como `JiraIssue`, `JiraTransition` o `JiraClient` fuera del adapter. El core solo conoce `WorkSourceProvider`, `NormalizedWorkSourceItem`, capabilities, source refs, policies, operations y findings normalizados.

## Local repository adapter

`LocalRepositoryWorkSource` es un provider real, no una excepcion historica.

Entradas candidatas:

```text
docs/backlog/**
docs/requirements/**
docs/product/**
user stories locales
otros documentos configurados explicitamente
```

El adapter local debe:

- descubrir documentos configurados como Work Sources;
- fingerprintar archivos y directorios con revision canonica;
- normalizar items locales a `NormalizedWorkSourceItem`;
- conservar path, content revision y mapping version;
- detectar drift cuando cambia el contenido;
- compartir los mismos contract tests que Jira, segun capabilities declaradas.

Un documento local puede seguir siendo Documentation Source para guias si su rol es conocimiento, y Work Source si contiene unidades de trabajo importables. La configuracion debe declarar esa intencion.

## Contract tests de providers

La suite contractual reutilizable valida cada provider segun capabilities declaradas:

```text
connectivity
search determinism
get normalization
revision detection
idempotency
error normalization
mapping correctness
stale detection
safe retry
write verification
```

Reglas:

- `connectivity` aplica a providers externos y a disponibilidad de paths locales.
- `search determinism` exige orden y filtros reproducibles para fixtures equivalentes.
- `get normalization` valida que no se filtre payload raw al dominio interno.
- `revision detection` valida revision externa o fingerprint robusto.
- `idempotency`, `safe retry` y `write verification` aplican solo si el provider declara create/update/transition/comment.
- `error normalization` traduce errores provider-specific a findings canonicos.
- `mapping correctness` usa fixtures versionados por provider.
- `stale detection` compara revision actual contra `source_refs`.

Un provider que declara una capability y falla sus contract tests no puede activarse. Los fixtures deben incluir `LocalRepositoryWorkSource` y `JiraMcpWorkSource` para demostrar que ambos usan el mismo contrato.

## Checks y reportes

Los checks/reportes se adaptan al naming real del runtime sin crear comandos innecesarios:

```text
check work-sources
check source-drift
check sync
report source-status
report traceability
```

Deben detectar:

- conexion no disponible;
- provider mal configurado;
- capabilities faltantes;
- source desaparecida;
- source modificada externamente;
- Release Item desincronizado;
- conflictos;
- mappings obsoletos.

`check` sigue siendo query-only. `report` puede renderizar proyecciones via ChangeSet cuando escriba archivos.
