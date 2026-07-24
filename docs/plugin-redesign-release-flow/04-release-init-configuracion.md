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
| Decision sources | Extension | `adr/`, `docs/adr/`, `docs/decisions/`, `docs/99-decisions/` | Resolver decisiones durables, trade-offs y constraints que pueden superseder documentacion mas antigua |
| Developer guides | Extension | `docs/developer-guide/`, repository maps, API/DB/security/testing/deployment guides | Explicar como se trabaja realmente en este repositorio y como ejecutar cambios seguros |
| Engineering standards | Extension | best practices, coding standards, AI-assisted development guides, checklists | Reglas generales adoptadas por el equipo, distintas de la arquitectura o guia de un modulo concreto |
| Repository map | Extension | repository map, module map, package map | Fuente explicita de boundaries, stacks, package roots, dependencias y artefactos significativos |
| Evidence contracts | Extension | evidence docs, release proof, compliance/performance/deployment evidence | Definir que prueba hace falta para considerar un cambio, release o ambiente realmente validado |
| Design system | Extension | `design-system/`, tokens, components, foundations, UI kits, component prompts | Fuente canonica para work packages UI, semantica visual, estados y reglas de interaccion |
| Prompt sources | Extension | `prompts/`, `*.prompt.md`, `*.prompt.yml`, `*.st` | Contratos versionados de prompts para proyectos AI; evita prompts inline o no trazables |
| Custom automation | Diseno actual | `scripts/`, `tools/`, `bin/`, generators propios | Reutilizar automatizacion existente por contrato estable |

`Diseno actual` significa que la categoria ya estaba exigida o explicitamente detectable en este flujo. `Extension` formaliza artefactos adicionales necesarios para que discovery, guides, gates y autonomia puedan apoyarse en las fuentes reales del repositorio.

### Modelo de conocimiento del repositorio

Shipping Mode no debe modelar una fuente unicamente por su path. Antes de usarla para planificar, generar guias o ejecutar trabajo debe resolver **que representa, que autoridad tiene, que scope gobierna y si sigue vigente**.

El modelo conceptual separa dos dimensiones principales:

**`kind` — que conocimiento contiene:**

```text
product
requirements
architecture
decision
developer-guide
engineering-standard
agent-instructions
repository-map
api-contract
data-contract
database
testing
quality
security
observability
design-system
i18n
runtime
environment
deployment
ci
ownership
prompt
generator
evidence
planning
```

**`role` — que autoridad documental ejerce:**

| Role | Semantica |
|------|-----------|
| `canonical` | Fuente vigente de verdad para su tema. |
| `decision` | Decision durable aceptada; puede superseder fuentes canonicas mas antiguas dentro de su alcance. |
| `derived` | Resultado derivado de fuentes; coordina o resume pero no reemplaza las fuentes que lo originaron. |
| `operational` | Guia, comando, checklist o procedimiento usado para ejecutar trabajo. |
| `evidence` | Prueba de ejecucion, validacion, despliegue, cumplimiento o resultado. |
| `generated` | Proyeccion regenerable; no se edita ni se trata como autoridad independiente. |
| `historical` | Contexto anterior sin autoridad sobre el estado activo. |
| `reference` | Material util para consulta, pero no normativo por si solo. |

Metadata minima recomendada para una fuente resuelta:

```yaml
- path: docs/04-architecture/
  kind: architecture
  role: canonical
  authority: authoritative
  scope: project
  freshness: current
  availability: implemented
  generated: false
  editable: true
  fingerprint: sha256:...
  provenance:
    discovered_by: init
    confirmed_by: carlos
```

`availability` evita confundir especificacion con estado real. Valores iniciales:

```text
implemented
partial
planned
deprecated
historical
```

La configuracion aprobada de Shipping Mode selecciona **que fuentes inspeccionar**; no convierte automaticamente esas fuentes en verdaderas. La autoridad proviene del rol, del estado real del repositorio y de decisiones durables confirmadas.

### Documentation entry point y mapa canonico

Cuando el repositorio tenga un indice documental (`docs/README.md`, `README.md` u otro equivalente), `init` debe detectarlo como `documentation_entry_point`. Desde ahi puede construir un mapa canonico del tipo `need -> start here` para producto, arquitectura, decisiones, implementation guides, evidencia y otros dominios.

Ejemplo conceptual:

```yaml
canonical_sources:
  product:
    - docs/00-project/
    - docs/02-product/
  architecture:
    - docs/04-architecture/
  decisions:
    - docs/99-decisions/
  implementation:
    - docs/09-developer-guide/
  evidence:
    - docs/05-evidence/
```

El mapa es metadata de Shipping Mode; no exige que el host replique esta estructura. Si existe un entry point, `check` debe poder verificar navegabilidad, links rotos y documentos activos huerfanos antes de considerar saludable el corpus documental.

### Instrucciones jerarquicas para agentes

`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` y equivalentes pueden existir en raiz y dentro de scopes. Shipping Mode debe resolverlas por proximidad y alcance del path afectado, no aplanarlas en una sola bolsa de instrucciones.

```text
workspace instructions
    -> scope instructions
        -> path/module instructions
```

Una instruccion mas especifica gobierna su subtree salvo que contradiga una decision durable o policy superior explicitamente configurada.

### Autoridad, conflicto y drift

El hecho de que un documento exista no lo vuelve vigente. Al resolver conflictos:

1. una decision durable `accepted` puede superseder documentacion anterior dentro de su alcance;
2. una fuente `canonical` expresa intencion vigente, pero debe contrastarse con codigo/configuracion/CI cuando haga afirmaciones sobre estado implementado;
3. el estado real del repositorio demuestra lo que **existe**, pero no redefine silenciosamente la intencion de producto o arquitectura; una contradiccion se registra como drift;
4. fuentes `derived`, `generated`, `historical` o `reference` no pueden reemplazar por si solas una fuente `canonical` o `decision`;
5. cuando no pueda resolverse el conflicto deterministicamente, Shipping Mode debe registrar un gap/decision pendiente y bloquear automatizacion estricta dependiente de esa conclusion.

Por lo tanto:

> Documentation is evidence to inspect, not truth to trust blindly.

Una auditoria de vigencia puede considerar, segun aplique:

- existencia de paths, modulos, endpoints, migrations, profiles y comandos referenciados;
- fingerprints de fuentes aprobadas;
- links internos y alcanzabilidad desde el entry point documental;
- contraste entre documentacion y manifests/codigo/config/CI real;
- estado `implemented|partial|planned|deprecated|historical`;
- decisiones aceptadas que cambien la interpretacion de documentos anteriores.

Un cambio de contenido, rol, autoridad, disponibilidad o evidencia de vigencia puede marcar una guide aprobada como `stale`, no solo un cambio de bytes.

### Estrategias transversales como concerns y gates

Cuando el host documente estrategias transversales —por ejemplo seguridad, observabilidad, testing, UI/design system, accesibilidad, i18n, privacidad o compliance— Shipping Mode debe proponerlas como `concerns` y/o `gates` aplicables por impacto, no convertirlas automaticamente en releases tecnicas separadas.

```text
host strategy / standard
    -> concern candidate
        -> gate/profile rules
            -> work packages/tasks affected
```

La documentacion host define la intencion y condiciones de aplicacion; `.planning/concerns/**`, `.planning/gates/**` y `.planning/gate-profiles/**` son la proyeccion operacional de Shipping Mode. Deben conservar provenance hacia las fuentes que originaron cada regla.

### Claims de ambiente y evidencia

Encontrar Terraform, Kubernetes o un workflow de deploy solo prueba que un ambiente esta **definido**. Shipping Mode debe distinguir al menos:

```text
defined
configured
deployed
verified
```

Una afirmacion de `deployed` o `verified` requiere evidencia host asociada (por ejemplo smoke result, deployment record, environment evidence o equivalente). Las fuentes de deployment describen intencion/configuracion; la evidencia demuestra estado operacional.

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
6. Entry point y fuentes canonicas: si existe un indice documental y que areas son fuente canonica, derivada, generada o historica.
7. Decisiones durables: donde viven ADR/PDR/decision records, que status usan y cuales tienen autoridad vigente.
8. Instrucciones del repositorio/agente: si existen `README.md`, `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, instrucciones anidadas u otras reglas y cual es su alcance.
9. Guias/standards: si existen developer guides, repository maps, engineering standards, AI-assisted-development guides o checklists operativos.
10. Validacion: que comandos build/test/smoke se conocen por scope, de que artefacto nativo se derivan y cuales quedan pendientes.
11. Quality: que lint, format, coverage, static analysis, Sonar u otros quality gates ya utiliza el proyecto.
12. Runtime local: que Dockerfiles, Compose/devcontainers y templates de entorno permiten ejecutar el proyecto sin depender de secretos almacenados en `.planning`.
13. Contratos y datos: si existen OpenAPI/AsyncAPI/protobuf/GraphQL/JSON Schema, migrations u otros contratos publicos o persistentes relevantes.
14. Delivery y ambientes: que CI/CD, deployment definitions o IaC representan la ruta real de build/test/package/deploy y que evidencia existe para distinguir `defined`, `configured`, `deployed` y `verified`.
15. Evidencia: si el proyecto define contratos de evidencia para releases, compliance, performance, despliegue, negocio u otros outcomes.
16. UI/AI especializadas: si existen design systems, prompt sources versionados u otras fuentes especializadas condicionadas por el tipo de scope.
17. Ownership: si `CODEOWNERS` u otra fuente permite inferir owners por scope/path.
18. Guias operativas: si ya existe una guia rapida para crear work packages, tasks o tests por scope, o si debe generarse desde las fuentes.
19. Generadores custom: si el proyecto tiene scripts propios para resumir guias, crear templates de task o generar test suites.
20. Politicas/autonomia/runtime: modo de release, lanes, gates, deployment/finalizacion, que puede ejecutar el agente sin aprobacion y donde persiste Shipping Mode su estado operacional.

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
- `README.md`, `docs/README.md` y otros candidatos a documentation entry point;
- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `CONTRIBUTING.md` y variantes anidadas por scope/path;
- carpetas con nombres comunes de backlog, requirements o producto, sin tratarlas como obligatorias;
- decision registries y ADR/PDR por patrones como `adr/`, `decisions/`, `99-decisions/` y templates asociados;
- developer guides, repository maps, best practices, AI-assisted-development guides y checklists operativos;
- archivos de guias por patrones como `*guideline*`, `*guide*`, `architecture`, `style`, `coding`, `testing`, `logging`, `security`, `product`;
- design systems por patrones como `design-system/`, tokens, foundations, component manifests y UI kits;
- prompt sources versionados como `prompts/`, `*.prompt.md`, `*.prompt.yml`, `*.st` cuando el proyecto usa AI;
- evidence contracts y evidence reports cuando el proyecto define prueba de release, deployment, compliance, performance o valor;
- directorios/artefactos marcados como `archive`, `historical`, `raw`, `generated` o equivalentes para clasificarlos sin promoverlos automaticamente a autoridad;
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
- La configuracion explicita aprobada por `config` prevalece sobre nuevas inferencias automaticas para seleccionar fuentes, pero debe conservar provenance hacia la fuente host original y no altera por si sola su autoridad semantica.
- Una fuente se registra con `kind`, `role`, `scope`, `authority`, `freshness`, `availability`, fingerprint y provenance cuando esos datos puedan resolverse; path por si solo no es un contrato suficiente.
- Fuentes `generated`, `derived`, `historical` o `reference` no reemplazan automaticamente decisiones aceptadas o fuentes canonicas.
- Cuando documentacion y estado real del repositorio divergen, registrar drift y resolverlo explicitamente; no confiar ciegamente en Markdown ni convertir el codigo en una redefinicion silenciosa de la intencion.
- Si existe documentation entry point, validar links y alcanzabilidad de documentos activos; documentos activos huerfanos son un finding, no contexto invisible.
- Una fuente faltante se registra como gap/pending; Shipping Mode no inventa convenciones tecnicas para ocultar ausencia de documentacion.
- Discovery puede leer templates de entorno (`.env.example`, `.env.template`) pero no debe leer/persistir secretos reales (`.env`, credentials, tokens) como fuentes de planificacion.
- CI/CD y manifests nativos son fuentes candidatas para descubrir comandos reales; Shipping Mode los normaliza a `executable + args + working_directory + timeout + approval`, nunca a strings de shell libres.
- Para ambientes y releases distinguir configuracion de evidencia: `defined`/`configured` no autorizan claims `deployed`/`verified` sin evidencia host asociada.
- Las instrucciones para agentes se resuelven jerarquicamente por scope/path; una instruccion anidada no se aplica fuera de su boundary.
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
