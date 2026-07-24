# Configuracion inicial del proyecto

## Objetivo

La skill `init` debe preparar el contexto que permite planificar sin asumir una estructura de proyecto especifica. Es el unico bootstrap de v4. No debe existir un segundo init dentro de `release`.

Para cambios posteriores, la skill `config` administra scopes, fuentes, politicas, Git, comandos, autonomia, guias y generadores custom.

## Resultado esperado

Archivos base:

```text
.planning/
  config.yml
  plugin.lock.yml
  events/
  operations/
  .runtime/
  scopes/
  concerns/
  gates/
  gate-profiles/
  execution-contexts/
  environments/
  decisions/
  releases/
  vendor/
    template-packs/
```

`config.yml` y `plugin.lock.yml` son legibles por scripts. Los README/reportes son proyecciones humanas generadas. Los templates canonicos se resuelven desde la instalacion del plugin, no desde una copia completa dentro del repo de trabajo.

## Configuracion minima

```yaml
project:
  name: example-project
  type: software

plugin:
  schema_version: <schema-version>
  launcher: <product-cli>

policies:
  release:
    mode: strict_sequence
    default_lane: main
  autonomy:
    apply_changes: approval_required
    execute_commands: approval_required
    waive_gates: approval_required
  paths:
    workspace_boundary: current_directory

git:
  enabled: true
  base_branch: main
  provider: github
  automation: assisted

commands:
  - id: web-build
    executable: npm
    args:
      - run
      - build
    working_directory: web
    timeout_seconds: 120
    approval: not_required

scope_catalog:
  directory: .planning/scopes
  enabled:
    - web
    - legal

runtime:
  event_store: .planning/events
  operation_store: .planning/operations
  runtime_store: .planning/.runtime
  template_vendor: .planning/vendor/template-packs
  operation_retention_days: 7
  retain_failed_operations: true
  retain_before_snapshots: false
  event_retention: permanent
```

`execution-contexts/` describe donde se ejecutan validaciones (`local`, `ci`, `container`, `preview`). `environments/` describe targets desplegables (`beta`, `demo`, `staging`, `production`). No mezclar `ci` con un ambiente desplegable.

`config.yml` no duplica la definicion completa de scopes. Cada scope vive en `.planning/scopes/<scope-id>/scope.yml`.

Ejemplo de `scope.yml`:

```yaml
id: web
display_id: web
label: Web application
kind: application
ownership:
  owner: frontend-team
paths:
  include:
    - web/
  overlap_policy: explicit
sources:
  functional_docs:
    - docs/product/
  technical_docs:
    - docs/frontend/
  guides:
    - docs/frontend-guidelines.md
  story_sources:
    - docs/backlog/
guides:
  task:
    path: .planning/scopes/web/task-guide.yml
    projection: .planning/scopes/web/task-guide.md
    status: approved
    revision: sha256:...
    provenance: {}
  test:
    path: .planning/scopes/web/test-guide.yml
    projection: .planning/scopes/web/test-guide.md
    status: approved
    revision: sha256:...
    provenance: {}
custom_generators:
  task_guide: scripts/planning/web-task-guide.mjs
  test_suite: scripts/planning/web-test-suite.mjs
validation_profiles:
  build:
    commands:
      - web-build
concerns:
  - security
  - accessibility
```

`plugin.lock.yml` debe registrar reproducibilidad:

```yaml
plugin:
  version: 1.0.0
  schema_version: 1
  template_pack:
    id: default
    version: 1.0.0
    fingerprint: sha256:...
    vendor_snapshot: .planning/vendor/template-packs/sha256-...
```

Los ids anteriores son ejemplos. El plugin no debe tener una lista fija de scopes.

## Contrato del repositorio anfitrion

Shipping Mode administra `.planning/**`, pero no es propietario de las fuentes de verdad del repositorio donde se instala. El repositorio anfitrion conserva sus propios documentos, manifests, configuraciones, contratos, scripts y reglas de entrega; Shipping Mode los descubre, referencia, fingerprinta y transforma en contexto operativo sin reemplazarlos.

Regla principal:

> Shipping Mode MUST preferir artefactos nativos y autoritativos del repositorio antes que introducir configuracion especifica del plugin. `.planning/**` referencia o proyecta esas fuentes; no debe convertirse en una segunda fuente de verdad que duplique contenido ya expresado por el proyecto.

La ausencia de una fuente no implica inventarla. `init`/`config` deben registrar el gap como `pending`/fuente faltante y, cuando la automatizacion estricta dependa de ella, bloquear esa automatizacion hasta que exista una fuente suficiente o una decision humana acepte explicitamente el riesgo.

### Familias de artefactos host

| Familia | Origen | Ejemplos detectables | Uso por Shipping Mode |
|---------|--------|----------------------|-----------------------|
| Product sources | Diseno actual | backlog, user stories, master plan, product docs | Origen de Release Items, alcance y contexto de producto |
| Functional sources | Diseno actual | `docs/product/`, requirements, reglas de negocio, criterios de aceptacion | Comportamiento esperado y acceptance context |
| Technical sources | Diseno actual | arquitectura, technical design, contratos, coding/style, testing, logging, security | Construir task/test guides y restricciones tecnicas |
| Agent/repository instructions | Diseno actual + extension | `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CLAUDE.md` | Instrucciones del repo/agente y convenciones operativas |
| Project/module manifests | Diseno actual | `package.json`, `pom.xml`, `build.gradle`, `pyproject.toml`, `go.mod`, `Cargo.toml`, workspace manifests | Detectar stack, paquetes, workspaces y candidatos a scope |
| Execution commands | Diseno actual | build, test, smoke expuestos por manifests, wrappers o scripts | Registrar comandos estructurados y validation profiles |
| Quality definitions | Extension | ESLint, Prettier, Checkstyle, Spotless, Ruff, coverage, Sonar, static analysis | Descubrir quality gates reales del proyecto |
| Local runtime/environment | Diseno actual + extension | `Dockerfile*`, `compose*.yml`, `.env.example`, `.env.template`, devcontainer | Levantar/validar el proyecto sin copiar secretos |
| Public/data contracts | Diseno actual + extension | OpenAPI, AsyncAPI, protobuf, GraphQL schemas, JSON Schema, DB migrations | Detectar interfaces publicas, compatibilidad y riesgos persistentes |
| Delivery/CI/deployment | Extension | `.github/workflows/**`, `.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines.yml`, Terraform, Helm, Kubernetes, Pulumi | Descubrir la definicion real de build/test/package/deploy y targets |
| Ownership | Extension | `CODEOWNERS`, ownership docs | Inferir owner candidato de scopes y areas afectadas |
| Custom automation | Diseno actual | `scripts/`, `tools/`, `bin/`, generators propios | Reutilizar automatizacion existente por contrato estable |

`Diseno actual` significa que la categoria ya estaba exigida o explicitamente detectable en este flujo. `Extension` formaliza artefactos adicionales necesarios para que discovery, guides, gates y autonomia puedan apoyarse en las fuentes reales del repositorio.

### Precedencia y no duplicacion

Cuando exista mas de una fuente candidata, `init` propone y el humano confirma. Una vez configurado, la referencia explicita aprobada en `.planning` tiene precedencia sobre nuevas inferencias automaticas, pero **no copia la fuente**: guarda su path, tipo, fingerprints y metadata necesaria.

Ejemplos:

- si `package.json` ya define `test`, no crear un segundo comando libre equivalente sin necesidad; registrar una referencia/comando estructurado que invoque esa capacidad;
- si CI ejecuta una secuencia de quality gates mas completa que README, CI es una fuente candidata prioritaria para descubrir la verificacion real;
- si `CODEOWNERS` define ownership, usarlo como evidencia para proponer owner del scope, no duplicar una tabla paralela sin provenance;
- si OpenAPI o una migration cambia, ese artefacto debe poder incorporarse a provenance, impact analysis y gates del work package correspondiente;
- si existe un custom generator, invocarlo y validar su salida en vez de reimplementar su logica dentro de Shipping Mode.

### Requisitos minimos de resolucion

No todas las familias son obligatorias en todos los proyectos. `init` debe, como minimo, poder resolver o marcar explicitamente como pendiente:

1. raiz del workspace y boundary;
2. Git y branch base cuando Git esta habilitado;
3. estructura de scopes/modulos o justificacion `non_code`;
4. fuentes funcionales/tecnicas suficientes para cada scope o gaps declarados;
5. comandos build/test/smoke conocidos o pendientes por scope;
6. instrucciones del repositorio/agente cuando existan;
7. quality/runtime/contracts/delivery/ownership cuando la tecnologia o el proyecto los utilicen.

Los artefactos condicionales no se convierten en requisitos artificiales: por ejemplo, un proyecto sin base de datos no necesita migrations, uno sin despliegue no necesita IaC y uno sin Git no necesita CI basado en Git.

## Preguntas de `init`

El script debe inferir primero y preguntar despues. Preguntas esperadas:

1. Git: existe repositorio git, cual es la branch base, se usara `gh`, y que acciones requieren aprobacion.
2. Scopes: que frentes existen, que paths cubre cada uno, cual sera su id estable y que `kind` corresponde.
3. Historias/producto: donde estan historias fuente, backlog, master plan, requirements o documentos de producto.
4. Documentacion funcional: donde vive la definicion de comportamiento, reglas de negocio y criterios de aceptacion.
5. Documentacion tecnica: donde viven arquitectura, technical design, contratos, guias de estilo/coding, testing, logging y seguridad.
6. Instrucciones del repositorio/agente: si existen `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` u otras instrucciones autoritativas y cual es su alcance.
7. Validacion: que comandos build/test/smoke se conocen por scope, de que artefacto nativo se derivan y cuales quedan pendientes.
8. Quality: que lint, format, coverage, static analysis, Sonar u otros quality gates ya utiliza el proyecto.
9. Runtime local: que Dockerfiles, Compose/devcontainers y templates de entorno permiten ejecutar el proyecto sin depender de secretos almacenados en `.planning`.
10. Contratos y datos: si existen OpenAPI/AsyncAPI/protobuf/GraphQL/JSON Schema, migrations u otros contratos publicos o persistentes relevantes.
11. Delivery: que CI/CD, deployment definitions o IaC representan la ruta real de build, test, package y deploy.
12. Ownership: si `CODEOWNERS` u otra fuente permite inferir owners por scope/path.
13. Guias operativas: si ya existe una guia rapida para crear work packages, tasks o tests por scope, o si debe generarse desde las fuentes.
14. Generadores custom: si el proyecto tiene scripts propios para resumir guias, crear templates de task o generar test suites.
15. Politicas/autonomia/runtime: modo de release, lanes, gates, deployment/finalizacion, que puede ejecutar el agente sin aprobacion y donde persiste Shipping Mode su estado operacional.

## Preguntas de `config`

`config` modifica configuracion existente. Debe operar con ChangeSets y aprobacion cuando cambie una politica que afecte ejecucion o alcance.

Stages esperados:

```text
/<product-name>:config scopes
/<product-name>:config sources
/<product-name>:config policies
/<product-name>:config git
/<product-name>:config commands
/<product-name>:config autonomy
/<product-name>:config guide refresh --scope <scope-id>
/<product-name>:config guide approve --scope <scope-id>
/<product-name>:config generator add --scope <scope-id>
```

## Deteccion determinista

El script puede detectar:

- carpetas top-level, paquetes y workspaces;
- `.git/`, branch actual y remotos;
- manifests de stack/modulos como `package.json`, `pom.xml`, `build.gradle`, `settings.gradle`, `pyproject.toml`, `go.mod`, `Cargo.toml` y equivalentes;
- `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/` y otras instrucciones/documentacion del repo;
- carpetas con nombres comunes de backlog, requirements o producto, sin tratarlas como obligatorias;
- archivos de guias por patrones como `*guideline*`, `*guide*`, `architecture`, `style`, `coding`, `testing`, `logging`, `security`, `product`;
- definiciones de quality como ESLint/Prettier, Checkstyle/Spotless, Ruff, coverage, Sonar y static-analysis config;
- `Dockerfile*`, `compose*.yml`, devcontainers y templates de entorno como `.env.example`/`.env.template`; nunca secretos reales como fuente persistible;
- contratos como OpenAPI, AsyncAPI, `*.proto`, GraphQL schemas, JSON Schema y directorios/configuracion de migrations;
- CI/CD como `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines.yml` y equivalentes;
- deployment/IaC como Terraform, Helm, Kubernetes manifests y Pulumi;
- ownership como `CODEOWNERS` y documentos equivalentes;
- scripts candidatos bajo rutas como `scripts/`, `tools/` o `bin/` que generen docs, tests, matrices o artefactos operativos.

La deteccion no decide sola el contrato final. Propone un ChangeSet y escribe solo despues de validacion, revisiones por agregado vigentes y aprobacion cuando corresponda.

## Reglas

- La raiz de workspace es siempre el directorio actual y su `./.planning/`; no se buscan `.planning/` en padres.
- Los artefactos nativos del repositorio son las fuentes de verdad. `.planning/**` guarda referencias, fingerprints, metadata operativa y proyecciones; no duplica innecesariamente reglas o configuracion ya expresadas por el proyecto.
- La configuracion explicita aprobada por `config` prevalece sobre nuevas inferencias automaticas, pero debe conservar provenance hacia la fuente host original.
- Una fuente faltante se registra como gap/pending; Shipping Mode no inventa convenciones tecnicas para ocultar ausencia de documentacion.
- Discovery puede leer templates de entorno (`.env.example`, `.env.template`) pero no debe leer/persistir secretos reales (`.env`, credentials, tokens) como fuentes de planificacion.
- CI/CD y manifests nativos son fuentes candidatas para descubrir comandos reales; Shipping Mode los normaliza a `executable + args + working_directory + timeout + approval`, nunca a strings de shell libres.
- Todo scope debe tener `id`, `label`, `kind` y al menos un `path` o una justificacion `non_code: true`.
- Un Release Item nuevo no declara `scope_id`; declara `kind` y campos condicionales. Los work packages declaran `scope_id`.
- Si una capacidad cruza scopes, se crea un Release Item unico con varios work packages.
- Cada work package vive bajo el Release Item y tiene sus propias tasks atomizadas.
- Si no hay guia tecnica para un scope de codigo, el release plan debe crear un Release Item/work package/task previa para definirla antes de tareas de implementacion.
- Si hay documentacion suficiente, `config guide refresh` debe generar o refrescar `task-guide.yml`, `test-guide.yml` y sus proyecciones Markdown antes de atomizar work packages.
- Si no hay documentacion suficiente, la guia debe marcar gaps explicitos y bloquear la automatizacion deterministica de tasks/tests hasta que se creen fuentes faltantes o una decision humana acepte el riesgo.
- Si existe un generador custom del proyecto, el plugin debe invocarlo por contrato estable y validar su salida, no duplicar su logica en la skill.
- Si no hay fuente de release items, `release plan` o `item add` puede crearlos desde una descripcion humana, pero debe registrar que no hubo backlog fuente.
- Si git esta deshabilitado, los scripts no deben generar pasos `git`/`gh`; deben generar evidencia local y checklist manual.
- Todas las mutaciones se registran como eventos JSON inmutables bajo `.planning/events/` con operation ID, actor/agente, timestamps, hashes de entrada/salida, archivos modificados y resultado. `events.ndjson` queda solo como export.
