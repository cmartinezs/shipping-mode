# Estructura completa del plugin next-generation

## Objetivo

Este documento define la estructura total nueva del repositorio del plugin next-generation `1.0.0`. `v4` es solo una etiqueta historica de la iniciativa. La estructura cubre skills, runtime, hooks, spikes, template pack, schemas, metadata, documentacion publica, sitio web y outputs generados.

Regla base:

```text
repo del plugin = fuente instalable, runtime, docs y site
workspace usuario = .planning/ con estado canonico y proyecciones generadas
```

El repo del plugin no debe confundirse con el `.planning/` que se crea dentro de proyectos usuarios.

## Arbol objetivo del repo

```text
.
+-- .claude-plugin/
|   +-- plugin.json
|   +-- marketplace.json
|
+-- .github/
|   +-- workflows/
|       +-- deploy-pages.yml
|
+-- bin/
|   +-- <product-cli>
|
+-- hooks/
|   +-- hooks.json
|
+-- .page/
|   +-- components/
|   +-- context/
|   +-- data/
|   +-- hooks/
|   +-- locales/
|   +-- pages/
|   +-- scripts/
|   |   +-- verify.js
|   +-- styles/
|   +-- types/
|   +-- next.config.js
|   +-- package.json
|   +-- package-lock.json
|   +-- tailwind.config.ts
|   +-- tsconfig.json
|
+-- docs/
|   +-- commands.yml
|   +-- reference.md
|   +-- user-guide.md
|   +-- developer-guide.md
|   +-- training-mode-plan.md
|   +-- plugin-redesign-release-flow/
|   +-- plugin-review/
|   +-- claude-planning-v4-expert-review/
|   +-- claude-planning-v4-second-expert-review/
|   +-- claude-planning-v4-third-expert-review/
|   +-- claude-planning-v4-fourth-expert-review/
|   +-- claude-planning-v4-fifth-expert-review/
|   +-- design-history/
|
+-- spikes/
|   +-- host-integration/
|   +-- runtime-node20/
|   +-- canonical-core/
|   +-- worktree-merge/
|   +-- transaction-recovery/
|   +-- integrated-prototype/
|   +-- verify-corte-1.2.mjs
|
+-- runtime/
|   +-- src/
|   |   +-- commands/
|   |   |   +-- workspace-init.mjs
|   |   |   +-- config.mjs
|   |   |   +-- release.mjs
|   |   |   +-- item.mjs
|   |   |   +-- task.mjs
|   |   |   +-- check.mjs
|   |   |   +-- report.mjs
|   |   |   +-- decision.mjs
|   |   |   +-- update-version.mjs
|   |   |   +-- changeset.mjs
|   |   +-- lib/
|   |   +-- schemas/
|   +-- dist/
|   |   +-- <product-cli>.mjs
|   +-- fixtures/
|       +-- monorepo-software/
|       +-- simple-repo/
|       +-- non-code-scopes/
|   +-- package.json
|   +-- package-lock.json
|   +-- build.mjs
|
+-- template-pack/
|   +-- template-pack.yml
|   +-- templates/
|   |   +-- config.yml
|   |   +-- plugin.lock.yml
|   |   +-- scope.yml
|   |   +-- task-guide.yml
|   |   +-- task-guide.md
|   |   +-- test-guide.yml
|   |   +-- test-guide.md
|   |   +-- release.yml
|   |   +-- release-readme.md
|   |   +-- release-item.yml
|   |   +-- release-item-readme.md
|   |   +-- work-package.yml
|   |   +-- work-package-readme.md
|   |   +-- task.yml
|   |   +-- task-readme.md
|   |   +-- TRACEABILITY.md
|   |   +-- RELEASE-NOTES.md
|   |   +-- RETROSPECTIVE.md
|   |
|   +-- docs/
|   |   +-- TUTORIAL/
|   |   +-- WORKFLOWS/
|   |   +-- GLOSSARY.md
|   |   +-- GUIDE.md
|   |   +-- README.md
|   |   +-- LOGGING.md
|   |   +-- PROMPTING.md
|   |   +-- SMOKE-TESTS.md
|   +-- update-version/
|
+-- scripts/
|   +-- protect-planning-state.mjs
|   +-- protect-planning-state-hook.sh
|   +-- verify-next-generation.sh
|
+-- skills/
|   +-- init/
|   +-- config/
|   +-- release/
|   +-- item/
|   +-- task/
|   +-- check/
|   +-- report/
|   +-- decision/
|   +-- update/
|
+-- README.md
+-- CHANGELOG.md
+-- CONTRIBUTING.md
+-- AGENTS.md
```

`planning-template/` completo queda como estructura legacy de v3. En v4 se reemplaza por `runtime/` y `template-pack/`. No existen `planning-template/active/`, `planning-template/finished/`, `planning-template/_template/00-initial.md`, `01-expansion.md` ni `02-deepening/` como contrato v4.

## Separacion de runtime, templates y tooling

La separacion nueva es deliberada:

| Ruta | Tipo | Responsabilidad |
|------|------|-----------------|
| `bin/` | Launcher interno estable del plugin | Entrada minima visible por el Bash tool cuando el plugin esta habilitado; delega al bundle del runtime. |
| `hooks/` | Enforcement del plugin | `PreToolUse` bloquea escrituras directas a `.planning/**`. |
| `runtime/` | Codigo del producto plugin | Codigo fuente, bundle self-contained, librerias, schemas, fixtures y ejecucion deterministica. |
| `template-pack/` | Artefactos renderizables | Templates, docs de template pack y migraciones de template pack. No contiene scripts de dominio. |
| `scripts/` | Tooling del repo | Verificacion, mantenimiento y tareas de publicacion del repositorio del plugin. No se distribuye como runtime publico. |
| `.page/scripts/` | Tooling del sitio | Validadores/build helpers del sitio web. No pertenece al plugin runtime. |
| `skills/` | API conversacional | Wrappers delgados que llaman al launcher y acotan juicio/aprobacion. |

Por tanto, `scripts/` dentro de `planning-template/` era una herencia v3, no una decision correcta para v4. El redisenio nuevo lo reemplaza por `runtime/src/commands/` y `runtime/src/lib/`.

## Metadata del plugin

`.claude-plugin/` contiene solo metadata de distribucion:

| Archivo | Responsabilidad v4 |
|---------|--------------------|
| `plugin.json` | Nombre, version, descripcion corta, autor y metadata requerida por Claude Code. Debe describir el producto final, el namespace de skills y el runtime release/release-item/work-package/task, no el flujo v3 Markdown-first. |
| `marketplace.json` | Texto publico, comandos expuestos, enlaces, tags y metadata de marketplace. No debe listar comandos legacy. |

Reglas:

- La version debe coincidir con `CHANGELOG.md`, README badge, site package y update-version despues de decidir producto y naming.
- La descripcion debe mencionar el nombre aprobado por naming gate, las skills canonicas `init`, `config`, `release`, `item`, `task`, `check`, release items tipados, work packages, ChangeSets y estado canonico.
- El nombre publico final se resuelve exclusivamente por el namespace del plugin.
- No debe prometer compatibilidad con comandos v3.

## Skills

`skills/` expone la API conversacional. Cada carpeta contiene un `SKILL.md` delgado.

Skills base:

```text
skills/init/
skills/config/
skills/release/
skills/item/
skills/task/
skills/check/
skills/report/
skills/decision/
```

Skill de mantenimiento:

```text
skills/update/
```

Skills avanzadas solo si se justifican despues del vertical slice:

```text
skills/run/
skills/recover/
skills/backlog/
```

Contrato de cada `SKILL.md`:

- proposito;
- argumentos publicos;
- precondiciones;
- llamada al launcher `<product-cli> <domain> <stage>`;
- frontmatter `disable-model-invocation` y `allowed-tools` restringido por comando cuando aplique;
- comandos permitidos por stage;
- aprobaciones host/runtime separadas;
- donde entra juicio del agente;
- cuando pedir aprobacion humana;
- stop conditions;
- manejo de error;
- salida esperada.

No debe contener parseo Markdown, asignacion de IDs, logica de transiciones, pasos Git repetidos, tablas grandes duplicadas ni reglas ya definidas por schemas/runtime/templates.

## Runtime y scripts

`runtime/` contiene el codigo ejecutable distribuido con el plugin. No vive dentro del template pack porque no es plantilla: es runtime.

La entrada interna estable del plugin es un launcher raiz minimo:

```text
bin/<product-cli>
```

Ese launcher delega al bundle:

```text
runtime/dist/<product-cli>.mjs
```

Las skills deben invocar el launcher conceptual:

```text
<product-cli> <domain> <stage> [args] [--format json|markdown]
```

El launcher resuelve internamente rutas de instalacion, template pack, schemas y workspace actual. El usuario no debe necesitar conocer rutas internas como `runtime/src/commands/release.mjs` ni `runtime/dist/<product-cli>.mjs`.

Scripts de dominio:

| Script | Responsabilidad |
|--------|-----------------|
| `workspace-init.mjs` | Bootstrap del workspace, config inicial, plugin lock y estructura base. |
| `config.mjs` | Scopes, fuentes, policies, comandos, autonomia, guias y generadores. |
| `release.mjs` | Release aggregate, lifecycle, readiness, deployment events y finalization. |
| `item.mjs` | Release Items tipados, criterios funcionales cuando apliquen, work packages y atomizacion. |
| `task.mjs` | Inspect, start, verify, correction y closeout de tasks. |
| `check.mjs` | Schemas, invariantes, guide freshness, gates, readiness y evidencia. |
| `report.mjs` | Status, standup, history, traceability, release notes, docs y exports. |
| `decision.mjs` | Decision records, aceptacion/rechazo, waivers y enlaces. |
| `update-version.mjs` | Migraciones futuras v4+ y actualizacion del template pack. |

`runtime/src/lib/` contiene librerias compartidas:

```text
schema.mjs
identity.mjs
revision.mjs
paths.mjs
command-policy.mjs
event-journal.mjs
change-set.mjs
atomic-write.mjs
project-store.mjs
scope-store.mjs
release-store.mjs
release-item-store.mjs
work-package-store.mjs
task-store.mjs
guide-store.mjs
render.mjs
```

Reglas:

- Todas las mutaciones pasan por ChangeSet.
- `apply` falla si una entrada de `baseRevisions` esta obsoleta.
- Los comandos ejecutables se guardan como `executable + args + working_directory + timeout + approval`.
- Las escrituras son atomicas y confinadas al workspace actual.
- Cada operacion relevante registra eventos JSON inmutables bajo `.planning/events/`.

## Schemas

`runtime/src/schemas/` es el contrato estructurado del runtime. Los schemas validan estado y operaciones; por eso pertenecen al runtime, no al template pack.

| Schema | Entidad |
|--------|---------|
| `config.schema.json` | Project context, policies, commands, scopes y autonomia. |
| `plugin-lock.schema.json` | Version del plugin, schema y template pack fingerprint. |
| `scope.schema.json` | Scope catalog, kind, ownership, paths, guide revisions y provenance. |
| `guide-metadata.schema.json` | Estado de guia, source fingerprints, generator y aprobacion. |
| `execution-context.schema.json` | Runners, commands, setup, teardown y evidencia de ejecucion. |
| `environment.schema.json` | Targets desplegables, promotion, rollback, approvals, secrets refs y smoke verification. |
| `release.schema.json` | Release aggregate, lifecycle, lane, release items, gates, deployment events y finalization. |
| `release-item.schema.json` | Release Item tipado: user story, capability, defect, enabler, spike, compliance, migration u operational. |
| `work-package.schema.json` | Trabajo tecnico por scope y gates propios. |
| `task.schema.json` | Cambio atomico, evidencia y closeout. |
| `change-set.schema.json` | Operacion propuesta/aplicable con `baseRevisions` e idempotencia. |
| `operation.schema.json` | Estado de operacion multiarchivo bajo `.planning/operations/` y referencias a runtime storage. |
| `event.schema.json` | Evento append-only por archivo bajo `.planning/events/`. |

Schemas compartidos requeridos:

```text
actor.schema.json
approval.schema.json
gate.schema.json
blocker.schema.json
risk.schema.json
waiver.schema.json
decision.schema.json
deployment-event.schema.json
finalization.schema.json
revision-ref.schema.json
command-spec.schema.json
provenance.schema.json
resolution.schema.json
```

Los schemas se versionan con el plugin y se referencian desde `plugin.lock.yml` junto al template pack compatible.

## Templates

`template-pack/templates/` contiene renderers o plantillas canonicas para crear estado y proyecciones. Aqui no debe haber scripts ejecutables de dominio.

Plantillas de estado canonico:

```text
config.yml
plugin.lock.yml
scope.yml
task-guide.yml
test-guide.yml
release.yml
release-item.yml
work-package.yml
task.yml
```

Plantillas de proyeccion humana:

```text
release-readme.md
release-item-readme.md
work-package-readme.md
task-readme.md
TRACEABILITY.md
RELEASE-NOTES.md
RETROSPECTIVE.md
task-guide.md
test-guide.md
```

Reglas:

- El workspace usuario no recibe una copia completa de `template-pack/`.
- `/<product-name>:init` crea estado inicial y lock; las plantillas se leen desde la instalacion del plugin.
- Markdown generado debe poder regenerarse desde YAML/JSON canonico.
- Si un usuario edita Markdown generado, `/<product-name>:check docs` debe detectar drift o regenerarlo segun politica.

## Fixtures y pruebas de arquitectura

`runtime/fixtures/` contiene proyectos minimos para validar el runtime:

| Fixture | Cubre |
|---------|-------|
| `monorepo-software/` | Multiples scopes de codigo, worktrees, comandos por paquete, dependencias y gates. |
| `simple-repo/` | Proyecto pequeno con una release, un release item, un work package y tasks. |
| `non-code-scopes/` | Scopes `documentation`, `process` o `compliance` sin build/test de software. |
| `concurrent-worktrees/` | Dos operaciones validas que colisionarian con IDs secuenciales o revision global. |
| `failed-multi-file-operation/` | Falla despues de staging para validar rollback/compensacion y eventos. |
| `historic-template-pack/` | Workspace con lock a un template pack anterior y snapshot vendor. |
| `cross-platform-paths/` | Paths, line endings y launcher en Windows/WSL2 o Git Bash segun soporte declarado. |

`scripts/verify-next-generation.sh` debe validar:

- comandos v4 presentes y comandos v3 ausentes;
- schemas presentes;
- fixtures validos;
- ChangeSets idempotentes;
- rechazo por `baseRevisions` obsoletas;
- eventos por archivo e idempotencia del journal;
- snapshots historicos de template pack resolubles cuando el lock lo requiere;
- ausencia de storage v3;
- referencias publicas alineadas en docs y site;
- version markers alineados.

## Documentacion del repo

`docs/` contiene documentacion fuente del plugin, no estado de usuario.

| Ruta | Responsabilidad v4 |
|------|--------------------|
| `docs/commands.yml` | Inventario canonico de comandos v4. Fuente para reference/site cuando sea posible. |
| `docs/reference.md` | Referencia publica de comandos, argumentos y stages. |
| `docs/user-guide.md` | Guia de uso para usuarios del plugin. |
| `docs/developer-guide.md` | Guia para mantener runtime, schemas, launcher, templates y validators. |
| `docs/training-mode-plan.md` | Training/demo actualizado al flujo v4 si se conserva. |
| `docs/plugin-redesign-release-flow/` | Decision de arquitectura del redisenio v4. |
| `docs/plugin-review/` | Revisiones historicas y hallazgos que alimentan el redisenio. |
| `docs/claude-planning-v4-expert-review/` | Review externo de la propuesta v4. |
| `docs/claude-planning-v4-second-expert-review/` | Segunda revision experta, fuente del Corte -1.1. |
| `docs/claude-planning-v4-third-expert-review/` | Tercera revision experta, fuente del Corte -1.2 y spikes. |
| `docs/claude-planning-v4-fourth-expert-review/` | Cuarta revision experta, fuente de contratos de cierre del Corte -1.2. |
| `docs/design-history/` | Material archivado; no debe ser fuente publica principal. |

Reglas:

- `docs/commands.yml` debe listar solo comandos activos v4 y comandos avanzados cuando existan.
- `docs/reference.md`, README y site no deben contener tabla de comandos similares legacy.
- La documentacion publica debe explicar primero `init -> config -> release -> item -> work package -> task -> check/report`, renderizado con el namespace real del plugin.
- Los docs de redesign pueden mencionar v3 como diagnostico, pero los docs publicos no deben ensenarlo como flujo vigente.

## Sitio web

`.page/` es el sitio Next.js/Tailwind del plugin.

Fuente editable:

```text
.page/components/
.page/context/
.page/data/
.page/hooks/
.page/locales/
.page/pages/
.page/scripts/verify.js
.page/styles/
.page/types/
.page/package.json
.page/package-lock.json
```

Outputs generados, no editar:

```text
.page/.next/
.page/out/
.page/node_modules/
```

Responsabilidades v4 del sitio:

- Home: explicar el flujo `init -> config -> release -> item -> work package -> task -> ChangeSet -> check/report -> release/deployment -> finalize`.
- Commands: mostrar solo comandos v4 y separar `update` como mantenimiento.
- Tutorials: usar display IDs solo para lectura humana, UUIDv7 en paths y referencias internas, y storage `.planning/scopes/` + `.planning/releases/`.
- Training: no ensenar `plan-new`, `plan-expand`, `active/finished`, `.releases/` ni historias hermanas por scope.
- Locales: actualizar `en` y `es` juntos.
- Verify: `.page/scripts/verify.js` debe fallar ante comandos legacy, storage v3 o copy antiguo.

Validacion:

```text
cd .page
npm run build
```

## Workspace generado en proyectos usuarios

El plugin v4 crea esta estructura en el proyecto del usuario:

```text
.planning/
  config.yml
  plugin.lock.yml
  events/
    2026/
      07/
        <event-id>.json
  operations/
    <operation-id>/
      operation.yml
      change-set.json
      result.json
  .runtime/
    operations/
      <operation-id>/
        before/
        staged/
        logs/

  scopes/
    <scope-id>/
      scope.yml
      task-guide.yml
      task-guide.md
      test-guide.yml
      test-guide.md

  concerns/
    <concern-id>.yml
  gates/
    <gate-id>.yml
  gate-profiles/
    <gate-profile-id>.yml
  execution-contexts/
    <execution-context-id>.yml
  environments/
    <deployment-environment-id>.yml

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
      TRACEABILITY.md
      RELEASE-NOTES.md
      RETROSPECTIVE.md
  vendor/
    template-packs/
      <fingerprint>/
```

No se genera:

```text
.planning/active/
.planning/finished/
.releases/
.planning/scripts/
```

El runtime vive en el plugin; el workspace guarda estado, lock, eventos, scopes, releases y proyecciones.

## Publicacion y versionado

Antes de publicar:

- `.claude-plugin/plugin.json` y `marketplace.json` describen solo el producto aprobado, no el flujo v3.
- `README.md`, `docs/commands.yml`, `docs/reference.md`, `docs/user-guide.md` y site estan alineados.
- `bin/`, `runtime/`, `runtime/src/schemas/`, `runtime/dist/<product-cli>.mjs`, `template-pack/template-pack.yml` y `template-pack/templates/` tienen versiones compatibles.
- `CHANGELOG.md` declara ruptura, comandos removidos, storage nuevo y ausencia de aliases.
- `template-pack/update-version/<N>-<N+1>.md` explica el corte limpio y futuras migraciones v4+.
- `scripts/verify-next-generation.sh`, `.page/scripts/verify.js` y `npm run build` pasan.

## Criterio de consistencia

Una capacidad esta correctamente ubicada cuando:

- skill: solo orquesta conversacion y launcher;
- script: ejecuta use case determinista;
- lib: encapsula contrato tecnico reutilizable;
- schema: define estado valido;
- template: renderiza estado o proyeccion;
- doc: explica el contrato;
- site: presenta el flujo publico;
- metadata: publica version y comandos;
- workspace usuario: guarda estado canonico y evidencia.

Si una regla aparece duplicada en skill, script, template, doc y site, debe moverse al lugar canonico y el resto debe referenciarla.
