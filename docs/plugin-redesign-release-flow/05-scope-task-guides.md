# Guias por scope para work packages, tasks y tests

## Objetivo

Cada scope necesita guias operativas que traduzcan la documentacion del proyecto a reglas concretas para crear work packages, tasks tecnicas y test suites. La guia no debe vivir hardcodeada en el plugin. Debe generarse desde las fuentes configuradas del proyecto, revisarse, aprobarse y refrescarse cuando esas fuentes cambien.

Regla principal:

```text
YAML es regla ejecutable. Markdown es explicacion humana.
```

YAML ejecutable significa DSL cerrada, no frases en lenguaje natural dentro de campos `when` o `rule`. El runtime debe poder evaluar reglas sin interpretar narrativa, invocar un LLM ni leer Markdown.

Operadores iniciales permitidos:

```text
equals
not_equals
contains
exists
all
any
not
in
matches
```

Contrato de evaluacion:

- `dsl_version: 1` obligatorio en cada guia ejecutable.
- Tipos permitidos: `string`, `number`, `boolean`, `null`, `array`, `object`, `date`, `datetime`.
- Field paths usan notacion por punto, por ejemplo `item.kind`, `item.tags` o `work_package.contracts.api`.
- No hay coercion implicita de tipos.
- Campos inexistentes producen error estructurado salvo que el operador sea `exists`.
- Strings son case-sensitive por defecto y se evalua sobre Unicode normalizado segun la politica de hashing.
- `all` y `any` hacen short-circuit y emiten trace de decision.
- `matches` debe declarar motor regex, timeout, tamano maximo de input/patron y proteccion ReDoS.

Nombres:

```text
scope task guide
scope test guide
```

## Archivos

Las guias viven a nivel de proyecto:

```text
.planning/
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
```

Cada release registra la revision usada:

```yaml
scope_refs:
  - scope_id: web
    task_guide_revision: sha256:...
    test_guide_revision: sha256:...
  - scope_id: api
    task_guide_revision: sha256:...
    test_guide_revision: sha256:...
```

Esto evita duplicar guias por release y permite reproducir el contexto de una release historica. Si una release necesita congelar contenido adicional, debe hacerlo como metadata estructurada, no como nueva fuente canonica.

## Metadata de guia

`scope.yml` debe mantener el estado y provenance:

```yaml
scope_id: web
kind: application
guides:
  task:
    status: approved
    revision: sha256:...
    path: .planning/scopes/web/task-guide.yml
    projection: .planning/scopes/web/task-guide.md
    provenance:
      sources:
        - docs/product/
        - docs/frontend-guidelines.md
      source_fingerprints:
        - path: docs/frontend-guidelines.md
          fingerprint: sha256:...
      generator_version: 1.0.0
      model: gpt-5
      prompt_version: scope-task-guide-v1
      generated_at: 2026-07-22T00:00:00Z
      reviewed_by: carlos
      approved_at: 2026-07-22T00:00:00Z
  test:
    status: approved
    revision: sha256:...
    path: .planning/scopes/web/test-guide.yml
    projection: .planning/scopes/web/test-guide.md
    provenance:
      sources:
        - docs/testing.md
      source_fingerprints: []
      generator_version: 1.0.0
      model: null
      prompt_version: null
      generated_at: 2026-07-22T00:00:00Z
      reviewed_by: carlos
      approved_at: 2026-07-22T00:00:00Z
```

Estados permitidos:

```text
generated
reviewed
approved
stale
rejected
```

```mermaid
stateDiagram-v2
    [*] --> generated : generate_guide
    generated --> reviewed : submit_guide_for_review
    generated --> rejected : reject_guide
    reviewed --> approved : approve_guide
    reviewed --> rejected : reject_guide
    approved --> stale : detect_guide_drift
    stale --> generated : regenerate_guide
    rejected --> generated : revise_guide
    approved --> [*]
```

| Evento | Transicion | Motivo o guard |
|--------|------------|----------------|
| `generate_guide` | inicial -> `generated` | Se genera una guia con fuentes, revision y provenance registradas. |
| `submit_guide_for_review` | `generated` -> `reviewed` | La guia supera validaciones estructurales y queda lista para revision humana. |
| `approve_guide` | `reviewed` -> `approved` | Un aprobador autorizado confirma contenido, fuentes y policy. |
| `reject_guide` | `generated` o `reviewed` -> `rejected` | La guia tiene defectos, fuentes insuficientes o incumple la policy. |
| `detect_guide_drift` | `approved` -> `stale` | Cambia una fuente o fingerprint y la revision aprobada deja de ser vigente. |
| `regenerate_guide` | `stale` -> `generated` | Se produce una nueva revision a partir de fuentes actuales. |
| `revise_guide` | `rejected` -> `generated` | Se corrigen las observaciones y se genera una nueva revision. |

Una guia `generated`, `stale` o `rejected` no habilita atomizacion automatica en modo estricto. Debe existir aprobacion humana o una waiver explicita.

## Fuentes

Las guias se generan desde:

- documentacion funcional;
- documentacion tecnica;
- guias de arquitectura;
- guias de estilo/coding;
- guias de UI/UX, contratos, datos, seguridad, logging o testing;
- PDRs/ADRs aceptados;
- templates existentes del proyecto;
- scripts de build/test/smoke;
- convenciones detectadas en codigo solo cuando la documentacion lo permite o cuando el usuario lo aprueba.

El runtime guarda `Source Index` con paths y fingerprints para detectar staleness.

## Contenido de `task-guide.yml`

Estructura ejecutable recomendada:

```yaml
schema_version: 1
dsl_version: 1
scope_id: web
revision: sha256:...
work_package_types:
  - id: ui-feature
    applies_when:
      all:
        - field: item.kind
          op: in
          value:
            - user_story
            - capability
        - field: item.tags
          op: contains
          value: ui
    required_sections:
      - visible_behavior
      - component_plan
      - data_contracts
    required_gates:
      - build
      - unit-tests
      - accessibility-review
task_types:
  - id: data-provider
    applies_when:
      all:
        - field: work_package.type
          op: equals
          value: ui-feature
        - field: work_package.contracts.api
          op: exists
    required_sections:
      - contract
      - loading_states
      - error_mapping
    template_ref: task-data-provider
decomposition_rules:
  - id: contract-before-ui
    ordering:
      predecessor_type: contract-check
      successor_type: real-api-connection
automation:
  generator: scripts/planning/web-task-guide.mjs
  input_schema: scope-guide-input-v1
  fallback: mark-gaps
open_gaps: []
```

## Contenido de `task-guide.md`

Estructura narrativa recomendada:

```md
# Task Guide: <scope-id>

## Source Index

| Source | Role | Fingerprint | Notes |
|--------|------|-------------|-------|

## Scope Contract

| Field | Value |
|-------|-------|
| Scope kind | |
| Ownership | |
| Paths | |
| Non-code scope | |

## Work Package Types

| Type | When to use | Required sections | Required gates |
|------|-------------|-------------------|----------------|

## Task Types

| Type | When to use | Required sections | Deterministic template |
|------|-------------|-------------------|------------------------|

## Readiness Gates

| Gate | Applies to | Deterministic check | Blocks atomization? |
|------|------------|---------------------|---------------------|

## Task Decomposition Rules

- [scope-specific rules derived from docs]

## Automation Contract

- generator:
- inputs:
- output schema:
- fallback when missing:

## Open Gaps

| Gap | Impact | Required action |
|-----|--------|-----------------|
```

## Ejemplo agnostico: scope UI

Si la documentacion de un scope UI dice que una pantalla debe pasar por datos, representacion y conexion real, la guia puede derivar tipos como:

| Type | Purpose |
|------|---------|
| `contract-check` | Verificar datos de lectura/escritura, DTOs, errores, permisos, i18n y sync/async antes de disenar la pantalla. |
| `wireframe` | Definir estructura visible, estados, rutas, acciones y jerarquia de informacion. |
| `component-hierarchy` | Mapear page/section/component/hook/schema/service y responsabilidades. |
| `functional-mockup` | Construir maqueta con datos fake que pruebe layout, estados y flujos sin backend real. |
| `data-provider` | Definir loader/facade/query/mutation, estados, errores, cache y transformaciones. |
| `real-api-connection` | Reemplazar fake data por API real sin cambiar el contrato visible ya probado. |
| `e2e-suite` | Automatizar el flujo real con ambiente aislado y evidencia reproducible. |

Esos tipos son ejemplo de lo que puede salir de la documentacion de un scope. No son reglas globales del plugin.

## Ejemplo agnostico: scope compliance

Un scope no-code puede derivar work packages y tasks manuales:

| Type | Purpose |
|------|---------|
| `policy-review` | Revisar que el cambio respete politica interna o regulatoria. |
| `approval-record` | Registrar aprobador, fecha, alcance aprobado y evidencia. |
| `external-notice` | Preparar comunicacion o artefacto requerido fuera del codigo. |

Sus gates no deben exigir build/test de software salvo que el scope configure comandos propios.

## Contenido de `test-guide.yml`

Estructura ejecutable recomendada:

```yaml
schema_version: 1
dsl_version: 1
scope_id: web
revision: sha256:...
gates_by_work_package_type:
  - work_package_type: ui-feature
    required_gates:
      - build
      - accessibility-review
    command_refs:
      - web-build
    evidence:
      - command_output
      - screenshot_when_ui
gates_by_task_type:
  - task_type: data-provider
    required_gates:
      - unit-tests
      - integration-tests
test_data:
  - need: authenticated-user
    strategy: fixture
execution_contexts:
  - local
  - ci
deployment_environments:
  - beta
  - production
open_gaps: []
```

## Contenido de `test-guide.md`

Estructura narrativa recomendada:

```md
# Test Guide: <scope-id>

## Source Index

| Source | Role | Fingerprint | Notes |
|--------|------|-------------|-------|

## Gates By Work Package Type

| Work Package Type | Required gates | Commands | Evidence |
|-------------------|----------------|----------|----------|

## Gates By Task Type

| Task Type | Required gates | Commands | Evidence |
|-----------|----------------|----------|----------|

## Test Data, Execution Contexts And Deployment Environments

| Need | Strategy | Setup | Teardown |
|------|----------|-------|----------|

## Deterministic Generation

- generator:
- input schema:
- output paths:
- validation command:

## Open Gaps

| Gap | Impact | Required action |
|-----|--------|-----------------|
```

## Automatizacion deterministica

La ruta del generador es configurable por proyecto:

```yaml
scopes:
  - id: web
    custom_generators:
      task_guide: scripts/planning/web-task-guide.mjs
      task_template: scripts/planning/web-task-template.mjs
      test_suite: scripts/planning/web-test-suite.mjs
```

Contrato:

- El plugin invoca el generador con input JSON.
- El generador retorna YAML/JSON ejecutable, Markdown narrativo y metadata.
- El plugin valida secciones requeridas, fingerprints y rutas de salida.
- Si falta el generador, el plugin cae a extraccion generica y marca las partes inciertas como gaps.
- El agente AI puede sintetizar narrativa faltante solo en secciones explicitamente marcadas como no deterministicas.
- La guia generada sigue siendo entrada no deterministica hasta que sea revisada, aprobada y versionada. Solo el YAML/JSON aprobado puede alimentar atomizacion automatica.

## Seguridad de generadores

Los generadores custom deben tratarse como codigo ejecutable sujeto a politica:

- resolver rutas dentro del boundary del workspace actual;
- rechazar path traversal y symlink escape;
- pasar inputs como archivos JSON o stdin, no por interpolacion de shell;
- guardar executable y args por separado;
- aplicar timeouts;
- redactar secretos en logs;
- registrar version del generador, input hash y output hash;
- exigir aprobacion para rutas de generador nuevas o modificadas salvo que la politica las permita.

## Puntos de integracion

`init`:

- descubre fuentes y generadores candidatos;
- escribe config inicial y plugin lock;
- crea entradas del catalogo de scopes cuando es posible.

`config guide refresh`:

- genera o refresca `task-guide.yml`, `test-guide.yml` y sus proyecciones `task-guide.md`/`test-guide.md`;
- actualiza metadata y revisiones de guia;
- reporta fuentes stale y gaps.

`config guide approve`:

- marca guias revisadas como aprobadas;
- registra aprobador, timestamp y revision en `scope.yml`;
- emite un evento JSON inmutable bajo `.planning/events/`.

`item package add`:

- lee guias de scope aprobadas antes de crear un work package;
- registra la revision de guia usada por el work package y la agrega al indice de la release.

`item atomize`:

- lee el work package y las guias de scope antes de crear tasks;
- falla cuando faltan guias requeridas o estan stale, salvo que el usuario apruebe una waiver explicita.

`check guides`:

- valida frescura de guias, secciones requeridas, provenance y salida del generador.

`check tests`:

- no genera test suites. Devuelve findings y operaciones recomendadas; la generacion vive en `task prepare`, `item atomize` o `config guide refresh`.
