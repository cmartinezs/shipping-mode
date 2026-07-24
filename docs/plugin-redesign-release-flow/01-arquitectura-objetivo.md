# Arquitectura objetivo

## Principios

1. Release primero: la release es la unidad publica de planificacion, seguimiento, liberacion y cierre.
2. Release Item como valor: user story, capability, defect, enabler, spike, compliance, migration u operational work representan unidades de alcance entregable.
3. Work package por scope: el trabajo tecnico se divide por unidades estables de ownership y validacion, no por "historias hermanas".
4. Scopes globales: los scopes pertenecen al proyecto y las releases referencian revisiones concretas de sus guias.
5. Estado estructurado: YAML o JSON es fuente de verdad; Markdown es proyeccion humana generada.
6. Identidad estable y distribuida: UUIDv7 es el ID primario; `display_id` es determinista e inmutable y el slug es decorativo.
7. Marca reconocible: el producto next-generation usa exclusivamente el namespace del plugin; `v4` es etiqueta historica.
8. Menos comandos publicos: un comando por intencion principal; las variaciones son subcomandos o stages internos.
9. Skills delgadas: la skill coordina intencion, aprobacion y juicio del agente; no implementa mecanica repetible.
10. Runtime determinista: parseo, validacion, escritura atomica, indices, estados, secuencia, locks, journal y comandos planificados viven en scripts/librerias.
11. IA acotada: el agente interpreta producto, descompone trabajo, toma decisiones tecnicas justificadas, implementa codigo y revisa evidencia.
12. Configuracion explicita: policies, lanes, gates, autonomia, comandos permitidos y generadores custom viven en configuracion versionada.
13. Reproducibilidad: cada workspace registra plugin lock, schema, template pack, guide revisions y eventos.

## Modelo de dominio

```text
Project Context
+-- Scope Catalog
|   +-- Scope
|   +-- Task Guide
|   +-- Test Guide
+-- Policies
+-- Decisions
+-- Releases
    +-- Release
        +-- Release Item
            +-- Scope Work Package
            |   +-- Tasks
            +-- Scope Work Package
                +-- Tasks
```

Version corta:

```text
release -> release item -> scope work package -> task
```

## Limites de agregados

El termino "Release Aggregate" no debe implicar atomicidad global sobre todo el arbol. El modelo operativo tiene agregados relacionados:

```text
ProjectContext Aggregate
Scope Aggregate
Release Aggregate
ReleaseItem Aggregate
WorkPackage Aggregate
Task Aggregate
```

Invariantes locales se validan transaccionalmente dentro de un agregado:

- schema valido;
- transicion permitida;
- scope valido;
- estado local;
- campos condicionales;
- gates propios.

Invariantes transversales se calculan o validan mediante queries y policies:

- readiness de Release;
- completion agregada;
- dependencias satisfechas;
- grafo sin ciclos;
- work packages obligatorios completados;
- gates transversales aprobados.

Modelo de consistencia:

```text
strong consistency within aggregate
eventual/recomputed consistency across aggregates
```

Operaciones multiagregado declaran agregados leidos, agregados mutados, revisiones, orden de escritura, compensacion, postcondiciones y riesgo de conflicto.

### Release

La release controla:

- objetivo del incremento;
- alcance comprometido;
- target, lane y politica de entrega;
- release items incluidos;
- gates de release;
- riesgos y blockers agregados;
- eventos de release y deployment;
- evidencia de cierre y finalizacion.

La release no reemplaza deployment ni retrospectiva. Los eventos de deployment y la finalizacion son entidades/eventos diferenciados dentro del agregado de release.

### Release Item

El Release Item es la entidad canonica de alcance dentro de una release. Puede representar trabajo funcional, tecnico, investigativo, operacional o regulatorio.

```yaml
kind: user_story | capability | defect | enabler | spike | compliance | migration | operational
```

Campos condicionales:

| Kind | Campos requeridos |
|------|-------------------|
| `user_story` | actor, need, value, acceptance_criteria |
| `capability` | outcome, behavior, acceptance_criteria |
| `defect` | observed_behavior, expected_behavior, reproduction, severity |
| `enabler` | technical_outcome, unlocked_capabilities |
| `spike` | question, timebox, expected_decision |
| `compliance` | obligation, authority, deadline, evidence |
| `migration` | source_state, target_state, rollback |
| `operational` | procedure, owner, evidence |

Un Release Item funcional puede contener:

- actor;
- necesidad;
- valor;
- comportamiento esperado;
- criterios de aceptacion;
- reglas funcionales;
- outcome;
- Definition of Done funcional;
- work packages requeridos u opcionales.

Un Release Item no se divide artificialmente por componentes tecnicos. Si una capacidad afecta web, API, datos y documentacion, sigue siendo un solo item y contiene cuatro work packages.

### Scope Work Package

Un work package contiene la porcion tecnica o disciplinaria de un Release Item para un scope propietario:

- scope propietario;
- diseno tecnico;
- interfaces;
- contratos;
- dependencias tecnicas;
- riesgos y blockers del scope;
- gates aplicables;
- tasks atomicas;
- evidencia del scope.

Un work package puede representar API, frontend, agents, infraestructura, documentacion, datos, compliance u operacion manual.

### Task

La task es el cambio atomico ejecutable:

- objetivo tecnico;
- archivos esperados;
- precondiciones;
- pasos;
- pruebas;
- evidencia;
- closeout.

Una task pertenece a exactamente un work package y hereda el scope de ese work package.

## Scope

`scope` queda definido como una unidad estable de delivery, ownership y validacion que puede recibir work packages y posee paths, fuentes, reglas y gates propios.

Un scope no es solo una carpeta. Puede mapear a artefactos, repositorios, paquetes, servicios, modulos, equipos, disciplinas o procesos. Por eso debe declarar `kind`:

```yaml
kind: application | service | library | infrastructure | documentation | process | compliance | data | operations
```

Reglas:

- `config.yml` solo referencia el catalogo de scopes; la definicion completa vive en `.planning/scopes/<scope-id>/scope.yml`.
- Los scopes se configuran en `/<product-name>:init` y se modifican con `/<product-name>:config`.
- Todo scope tiene `id`, `label`, `kind` y al menos un `path` o una justificacion `non_code: true`.
- Cada kind activa reglas y gates distintos; un scope `compliance` no hereda automaticamente gates de software.
- Las guias ejecutables `task-guide.yml` y `test-guide.yml` viven a nivel de proyecto bajo `.planning/scopes/<scope-id>/`; los `.md` equivalentes son proyecciones humanas.
- Cada Work Package registra `guide_refs` con las revisiones exactas de `task-guide.yml` y `test-guide.yml` usadas al crearlo o atomizarlo; la release puede mantener un indice agregado para trazabilidad, pero no ser la unica referencia.
- Los scripts no asumen nombres como `web`, `api` o `docs`; solo leen el catalogo configurado.

Conceptos transversales no se modelan como scopes por defecto. Separar:

- Delivery Scope;
- Cross-cutting Concern;
- Gate Profile.

Los solapamientos de paths requieren politica explicita:

```yaml
paths:
  overlap_policy: reject | allow | explicit
```

## Storage canonico

Estructura objetivo:

```text
.planning/
  config.yml
  plugin.lock.yml
  events/
  operations/
  .runtime/

  scopes/
    web/
      scope.yml
      task-guide.yml
      task-guide.md
      test-guide.yml
      test-guide.md
    api/
      scope.yml
      task-guide.yml
      task-guide.md
      test-guide.yml
      test-guide.md

  concerns/
    security.yml
    accessibility.yml
  gates/
    unit-tests.yml
    threat-model.yml
  gate-profiles/
    frontend-default.yml
    security-default.yml
  execution-contexts/
    local.yml
    ci.yml
    preview.yml
  environments/
    beta.yml
    staging.yml
    demo.yml
    production.yml

  decisions/
    DEC-0001-slug/
      decision.yml
      README.md

  releases/
    <uuidv7>/
      release.yml
      README.md

      items/
        <uuidv7>/
          release-item.yml
          README.md

          work-packages/
            <uuidv7>/
              work-package.yml
              tasks/
                <uuidv7>/
                  task.yml
                  README.md

            <uuidv7>/
              work-package.yml
              tasks/
                <uuidv7>/
                  task.yml
                  README.md

      TRACEABILITY.md
      RELEASE-NOTES.md
      RETROSPECTIVE.md
```

No se mantienen `.planning/active/`, `.planning/finished/` ni `.releases/` como contrato de v4. Tampoco se usa el patron `story-name.md` junto a `story-name/`; cada entidad con hijos vive en una carpeta con YAML canonico y README generado.

Estado canonico:

- `config.yml`;
- `plugin.lock.yml`;
- `scope.yml`;
- concern, gate, gate profile, execution context y deployment environment YAML;
- `release.yml`;
- `release-item.yml`;
- `work-package.yml`;
- `task.yml`;
- `.planning/events/**/*.json`;
- `.planning/operations/<operation-id>/operation.yml`.

Proyecciones humanas generadas:

- `README.md`;
- `TRACEABILITY.md`;
- `RELEASE-NOTES.md`;
- `RETROSPECTIVE.md`;
- reportes;
- dashboards Markdown;
- exports.

`events.ndjson` puede existir como export o proyeccion, no como journal primario.

## Plugin lock y template pack

`/<product-name>:init` crea `.planning/plugin.lock.yml` para fijar la reproducibilidad:

```yaml
plugin:
  version: 1.0.0
  schema_version: 1
  template_pack:
    id: default
    version: 1.0.0
    fingerprint: sha256:...
```

Los templates canonicos viven en la instalacion del plugin. El workspace no recibe una copia completa del template pack; solo guarda estado, lock y artefactos generados. El runtime debe poder leer artefactos creados con revisiones anteriores compatibles del schema y bloquear o advertir cuando cambian schema, template pack o guide revisions.

Para reproducibilidad historica, el workspace puede guardar snapshots minimos de templates realmente utilizados:

```text
.planning/vendor/template-packs/<fingerprint>/
```

El fingerprint identifica el pack; el snapshot garantiza disponibilidad cuando el plugin instalado ya no contiene esa revision exacta.

## Identidad

Los IDs son inmutables y no mezclan identidad, orden visible, scope, slug ni titulo. La clave primaria debe ser distribuida para evitar colisiones en worktrees.

Recomendado:

```yaml
id: 0190f1c8-4e39-7a21-8bb2-2a45f8154ef1
display_id: T-3Q6NZ8KD
display_id_status: ACTIVE
slug: validate-schema
```

`display_id` mejora lectura, pero no es la referencia primaria:

```text
R-7H3K9-release-flow-redesign
RI-4F8Q2-configure-project-scopes
WP-9M2AB-api-contract
T-3Q6NZ-validate-schema
```

Cambiar un titulo no debe romper dependencias ni trazabilidad. Las relaciones padre-hijo son inmutables; trasladar trabajo crea un agregado reemplazante.

Lifecycle de `display_id`:

```text
ACTIVE
RETIRED
```

```mermaid
stateDiagram-v2
    [*] --> ACTIVE : create_display_id
    ACTIVE --> RETIRED : retire_display_id
    RETIRED --> [*]
```

| Evento | Transicion | Motivo o guard |
|--------|------------|----------------|
| `create_display_id` | inicial -> `ACTIVE` | El display ID se deriva del UUIDv7 y se persiste al crear el agregado. |
| `retire_display_id` | `ACTIVE` -> `RETIRED` | El agregado se retira y su display ID no puede reutilizarse. |

Reglas:

- asignar el display ID al crear;
- no reutilizar IDs retirados o cancelados;
- mantener el display ID inmutable;
- resolver `display_id` solo como entrada humana;
- usar siempre `id` en referencias internas;
- derivar el display ID con prefijo de agregado y Base32 Crockford de un short-hash del UUIDv7, por ejemplo `RI-4F8Q2B7X`;
- ampliar la longitud si una colision real aparece antes de persistirlo.

## Estados y dimensiones separadas

El lifecycle y los blockers son dimensiones separadas. No se usa `BLOCKED` como reemplazo del estado real.

### Release

Estados:

```text
DRAFT
PLANNED
ACTIVE
VERIFYING
RELEASED
CANCELLED
```

```mermaid
stateDiagram-v2
    [*] --> DRAFT : create_release
    DRAFT --> PLANNED : plan_release
    DRAFT --> CANCELLED : cancel_release
    PLANNED --> ACTIVE : activate_release
    PLANNED --> CANCELLED : cancel_release
    ACTIVE --> VERIFYING : start_release_verification
    ACTIVE --> CANCELLED : cancel_release
    VERIFYING --> RELEASED : release_release
    VERIFYING --> ACTIVE : reopen_release
    VERIFYING --> CANCELLED : cancel_release
    RELEASED --> [*]
    CANCELLED --> [*]
```

| Evento | Transicion | Motivo o guard |
|--------|------------|----------------|
| `create_release` | inicial -> `DRAFT` | Se crea la release con identidad y alcance iniciales. |
| `plan_release` | `DRAFT` -> `PLANNED` | El alcance, dependencias y work packages requeridos son validos. |
| `activate_release` | `PLANNED` -> `ACTIVE` | Existe aprobacion para ejecutar el trabajo planificado. |
| `start_release_verification` | `ACTIVE` -> `VERIFYING` | El trabajo requerido fue entregado y se inicia la verificacion. |
| `release_release` | `VERIFYING` -> `RELEASED` | Readiness, gates y evidencia de release cumplen la policy. |
| `reopen_release` | `VERIFYING` -> `ACTIVE` | La verificacion detecta fallas corregibles y permite remediacion. |
| `cancel_release` | `DRAFT`, `PLANNED`, `ACTIVE` o `VERIFYING` -> `CANCELLED` | Cancelacion explicita con motivo y actor registrados. |

Finalizacion es metadata:

```yaml
finalization:
  completed: true
  completed_at: ...
  retrospective_status: APPROVED
```

Completion y readiness son derivados, no lifecycle:

```yaml
completion:
  required_work_packages: 8
  completed_work_packages: 7
readiness:
  releasable: false
  blocking_gates:
    - smoke-web
```

### Release Item, Work Package y Task

Estados:

```text
TODO
READY
IN_PROGRESS
VERIFYING
DONE
CANCELLED
```

```mermaid
stateDiagram-v2
    [*] --> TODO : create_work_item
    TODO --> READY : prepare_work_item
    TODO --> CANCELLED : cancel_work_item
    READY --> IN_PROGRESS : start_work_item
    READY --> CANCELLED : cancel_work_item
    IN_PROGRESS --> VERIFYING : submit_work_item
    IN_PROGRESS --> CANCELLED : cancel_work_item
    VERIFYING --> DONE : complete_work_item
    VERIFYING --> IN_PROGRESS : reopen_work_item
    VERIFYING --> CANCELLED : cancel_work_item
    DONE --> [*]
    CANCELLED --> [*]
```

| Evento | Transicion | Motivo o guard |
|--------|------------|----------------|
| `create_work_item` | inicial -> `TODO` | Se crea el elemento con alcance y padre validos. |
| `prepare_work_item` | `TODO` -> `READY` | Dependencias, guia aplicable y precondiciones estan satisfechas. |
| `start_work_item` | `READY` -> `IN_PROGRESS` | Un actor autorizado inicia la ejecucion. |
| `submit_work_item` | `IN_PROGRESS` -> `VERIFYING` | Se entrega evidencia y se solicita verificacion. |
| `complete_work_item` | `VERIFYING` -> `DONE` | Los criterios de aceptacion y gates pasan. |
| `reopen_work_item` | `VERIFYING` -> `IN_PROGRESS` | La verificacion encuentra trabajo pendiente o evidencia insuficiente. |
| `cancel_work_item` | `TODO`, `READY` o `IN_PROGRESS` -> `CANCELLED` | Cancelacion explicita con resolucion y riesgo registrados. |

`SKIPPED` existe como resolucion, no como estado principal:

```yaml
resolution: SKIPPED
reason: ...
approved_by: ...
accepted_risk: ...
replacement:
  release_id: 0190f1c8-5f11-7cc1-8bb2-2a45f8154ef2
  work_item_id: 0190f1c8-6041-7d11-8bb2-2a45f8154ef3
```

Cada elemento declara:

```yaml
commitment: required | optional
```

Los elementos `required` no pueden omitirse sin waiver formal.

Relaciones padre-hijo inmutables:

```text
ReleaseItem.release_id        immutable
WorkPackage.release_item_id   immutable
Task.work_package_id          immutable
```

Ningun comando publico ni interno modifica `parent_id` despues de crear el
agregado. Para trasladar trabajo se crea un nuevo agregado, se copia solo el
contenido permitido, se registra provenance y se marca el anterior como
`SUPERSEDED` o `CANCELLED` con `replacement_id`.

Blockers:

```yaml
status: IN_PROGRESS
blockers:
  - blocker_id: B0001
    status: OPEN
    severity: BLOCKING
    reason: Missing API contract
    created_at: ...
    resolved_at: null
```

Waivers:

```yaml
waivers:
  - waiver_id: W0001
    gate: security-review
    reason: ...
    approved_by: ...
    expires_at: ...
```

## Politicas de release

La secuencia lineal no debe estar hardcodeada. La configuracion define el modo:

```yaml
release_policy:
  mode: strict_sequence
  lanes:
    - main
    - hotfix
```

Modos permitidos para el primer runtime:

- `strict_sequence`: no liberar una release si hay una anterior abierta en la misma lane.
- `dependency_graph`: libera cuando sus dependencias declaradas estan satisfechas.

Modos futuros, no incluidos en el primer vertical slice:

- `release_train`: agrupa releases por ventanas de entrega.
- `parallel`: permite releases independientes con gates explicitos.

La cancelacion exige razon, impacto y aprobacion humana. Una release cancelada conserva su ID y queda registrada en el journal.

## Protocolo determinista de mutacion

Toda mutacion debe seguir:

```text
inspect -> propose -> validate -> approve -> stage -> apply -> verify -> record
```

`dry-run` y `--write` no son el contrato conceptual de v4. El contrato es ChangeSet con `propose/validate/approve/apply/verify`. `apply` debe fallar si cambia una revision de agregado leida o mutada.

Contrato minimo:

```json
{
  "schemaVersion": 1,
  "operationId": "0190f1c8-4e39-7a21-8bb2-2a45f8154ef1",
  "operation": "item.atomize",
  "target": {
    "releaseId": "0190f1c8-5f11-7cc1-8bb2-2a45f8154ef2",
    "releaseItemId": "0190f1c8-6041-7d11-8bb2-2a45f8154ef3",
    "workPackageId": "0190f1c8-7131-7e01-8bb2-2a45f8154ef4"
  },
  "baseRevisions": {
    "release:0190f1c8-5f11-7cc1-8bb2-2a45f8154ef2": "sha256:...",
    "releaseItem:0190f1c8-6041-7d11-8bb2-2a45f8154ef3": "sha256:...",
    "workPackage:0190f1c8-7131-7e01-8bb2-2a45f8154ef4": "sha256:...",
    "guide:web:task": "sha256:..."
  },
  "idempotencyKey": "...",
  "assumptions": [],
  "preconditions": [],
  "fileChanges": [],
  "commands": [],
  "postconditions": [],
  "requiresApproval": true
}
```

Propiedades obligatorias:

- validable por JSON Schema;
- serializable;
- idempotente;
- auditable;
- reintentable;
- rechazable;
- aplicable sin volver a consultar al LLM;
- invalido cuando cambia una revision de agregado relevante.

Cada aplicacion debe usar staging, optimistic locking por agregado, operation journal, validacion post-write y rollback tecnico cuando aplique. El manifest resumido de la operacion vive bajo `.planning/operations/<operation-id>/`; staging, snapshots `before/` y logs viven bajo `.planning/.runtime/operations/<operation-id>/` y no son versionados por defecto.

El ChangeSet controla obligatoriamente el control plane (`.planning/**`, policies, operaciones, eventos, aprobaciones, transiciones y metadata canonica). El work product (`src/**`, `tests/**`, `infra/**`, docs de producto y configuracion externa) se registra como evidencia o se modifica solo mediante operaciones explicitas y limitadas. El runtime no es un editor universal ni un rollback engine global.

Los comandos externos se modelan como saga:

```text
prepare -> execute -> verify -> compensate
```

La aprobacion se vincula al hash del ChangeSet. Modificar el ChangeSet invalida la aprobacion.

## Seguridad de comandos

Los comandos no se guardan como strings de shell. Se guardan como estructura:

```yaml
command:
  executable: npm
  args:
    - run
    - test
  working_directory: web
  timeout_seconds: 120
  approval: required
```

El runtime debe protegerse contra command injection, path traversal, symlink escape, ejecucion fuera del workspace, comandos no aprobados, exposicion de secretos y uso indiscriminado de `git` o `gh`.

## Launcher estable

La interfaz interna recomendada no expone rutas como `.planning/scripts/release.mjs` ni rutas de instalacion del plugin. Las skills llaman un launcher interno estable del plugin. Mientras no cierre el naming gate, se documenta como placeholder:

```text
<product-cli> <domain> <stage> [args] [--format json|markdown]
```

El launcher resuelve:

- instalacion del plugin;
- version;
- template pack;
- workspace actual;
- schemas;
- runtime;
- boundaries de paths;
- compatibilidad de schema.

Capas de invocacion:

| Capa | Forma | Alcance |
|------|-------|---------|
| API conversacional | `/<plugin-name>:init` | Skill namespaced dentro de Claude Code. |
| Launcher interno estable del plugin | `<product-cli>` | Ejecutable disponible para las skills y el Bash tool cuando el plugin esta habilitado. |
| CLI externa opcional | `<product-cli>` instalado por npm/Homebrew/binario/installer | Solo existe si se distribuye fuera de Claude Code. |

No describir el launcher interno como interfaz externa hasta que exista una distribucion adicional decidida y probada.

## Responsabilidades deterministas

El runtime debe hacerse cargo de:

- asignar IDs primarios distribuidos sin colisiones y display IDs humanos;
- calcular revisiones por agregado;
- validar schemas;
- validar transiciones de estados;
- aplicar politicas de release/lane/dependencias;
- crear carpetas y archivos desde templates;
- actualizar YAML canonico;
- regenerar proyecciones Markdown;
- calcular completion/readiness derivados desde Release Items, work packages y tasks sin cambiar automaticamente el lifecycle;
- validar links, dependencias, gates, evidencia y guide revisions;
- generar y refrescar indices por scope desde fuentes configuradas;
- generar esqueletos de work package, task y test suite desde guias YAML aprobadas;
- producir comandos git/gh permitidos como estructuras, no shell libre;
- registrar eventos append-only como archivos JSON inmutables bajo `.planning/events/`;
- bloquear cambios concurrentes con optimistic locking.

## Responsabilidades del agente AI

El agente queda limitado a:

- transformar intencion de negocio en Release Items candidatos;
- proponer work packages por scope;
- dividir work packages en tasks tecnicas atomicas;
- sintetizar guias cuando las fuentes no permiten extraccion deterministica completa;
- completar secciones de diseno que requieren juicio;
- detectar riesgos y tradeoffs no triviales;
- implementar codigo;
- revisar evidencia y proponer correcciones;
- sintetizar decisiones y retrospectivas desde hechos capturados.

Cuando el agente produzca Release Items, work packages o tasks, debe entregar un bloque estructurado que el runtime valida y aplica como `ChangeSet`. El agente no debe editar manualmente estados, indices, rutas, dependencias o proyecciones derivables.

## Flujo feliz propuesto

```text
/<product-name>:init
/<product-name>:config scopes
/<product-name>:config policies
/<product-name>:release new --title "Capability name" --target 2026-Q3-M1-W2 --date 2026-08-07
/<product-name>:item add REL-5F11 --kind user_story --title "Publish assessment"
/<product-name>:item package add REL-5F11 ITEM-6041 --scope api --title "Command contract and persistence"
/<product-name>:item package add REL-5F11 ITEM-6041 --scope web --title "Teacher publishing UI"
/<product-name>:item atomize REL-5F11 ITEM-6041 WP-7131
/<product-name>:item atomize REL-5F11 ITEM-6041 WP-7A21
/<product-name>:task inspect REL-5F11 ITEM-6041 WP-7131 TASK-7A21
/<product-name>:task start REL-5F11 ITEM-6041 WP-7131 TASK-7A21
/<product-name>:check readiness REL-5F11
/<product-name>:report status REL-5F11
/<product-name>:release mark REL-5F11 VERIFYING
/<product-name>:release mark REL-5F11 RELEASED
/<product-name>:release finalize REL-5F11
```

La forma exacta puede cambiar, pero el usuario debe sentir que navega release -> release item -> scope work package -> task, no una coleccion de utilidades ni una jerarquia de planificaciones paralelas.
