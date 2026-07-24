# Eliminacion legacy

## Objetivo

v4 parte en limpio. La eliminacion legacy no es una migracion silenciosa ni una capa de compatibilidad: es la remocion deliberada de comandos, storage, templates y documentacion que sostienen el modelo v3.

## Regla principal

No se mantienen aliases. Si un comando v3 no coincide con la superficie v4, se borra del plugin. Si una capacidad sigue siendo necesaria, se reimplementa en el comando gestor v4 correspondiente.

## Superficie v4 permitida

Skills publicas base:

```text
init
config
release
item
task
check
report
decision
update
```

Comandos avanzados solo si se justifican:

```text
run
recover
backlog
```

Todo lo demas debe borrarse o quedar fuera del plugin v4.

`release` queda como router publico del lifecycle de release. No existe `release init`; el bootstrap completo es `init` y la configuracion posterior vive en `config`. La forma visible final es `/<plugin-name>:<skill-name>` y no existe una segunda convencion de namespace.

## Alcance completo

La eliminacion legacy cubre todo el plugin:

```text
.claude-plugin/        # manifests y marketplace metadata
.page/                 # landing site, comandos, tutoriales, textos y build
.github/workflows/     # deploy/publicacion del site si referencia outputs o comandos
docs/                  # user/developer/reference/commands docs
runtime/               # launcher, use cases, librerias, schemas y fixtures v4
template-pack/         # templates, docs renderizables y update-version v4+
planning-template/     # estructura legacy v3 que se elimina o reemplaza
scripts/               # tooling de repo, verify, migraciones internas
skills/                # comandos expuestos al usuario
README.md
CHANGELOG.md
CONTRIBUTING.md
CLAUDE.md
AGENTS.md
```

No basta con borrar carpetas de `skills/`. Una capacidad legacy esta viva si sigue apareciendo en docs, site, config, tutoriales, templates, scripts, verificadores, changelog o metadata de publicacion.

## Comandos a eliminar

Carpetas `skills/` a borrar salvo que se reimplementen con nombre v4:

```text
skills/release-init/
skills/release-new/
skills/release-add/
skills/release-remove/
skills/release-status/

skills/plan-new/
skills/plan-expand/
skills/plan-from-epic/
skills/plan-from-release/
skills/plan-template/

skills/us-new/
skills/us-enrich/
skills/us-split/
skills/us-status/
skills/epic-enrich/

skills/doc-generate/
skills/doc-story/
skills/doc-task/

skills/plan-health/
skills/plan-validate/
skills/plan-task-validate/
skills/plan-audit-docs/
skills/plan-doctor/
skills/plan-status/
skills/plan-standup/
skills/plan-history/
skills/plan-export/

skills/plan-enrich-epic/
skills/plan-enrich-story/
skills/plan-split-story/
skills/plan-merge/
skills/plan-story-skip/

skills/plan-agent-plan/
skills/plan-agent-execute/
skills/plan-agent-validate/

skills/plan-retry/
skills/plan-rollback/
skills/plan-clone/
skills/plan-smoke-config/
skills/plan-git-config/
skills/plan-test-suite/
skills/plan-edge-case/
skills/plan-retrospective/
```

Revisar manualmente antes de borrar:

```text
skills/plan-run/
skills/plan-recover/
skills/plan-backlog/
```

Si esas capacidades sobreviven despues del vertical slice, se recrean como `skills/run/`, `skills/recover/` o `skills/backlog/`; no se conservan con prefijo `plan`.

## Storage a eliminar

No deben existir como contrato v4:

```text
.planning/active/
.planning/finished/
.releases/
```

El storage v4 es:

```text
.planning/
  config.yml
  plugin.lock.yml
  events/
  operations/
  .runtime/
  scopes/
  decisions/
  releases/
  vendor/
```

Los ejemplos, templates y scripts v4 no deben crear ni leer `active/`, `finished/` o `.releases/`.

`init` no debe copiar el template pack completo al repo de trabajo. El repo de trabajo guarda `.planning/config.yml`, `.planning/plugin.lock.yml`, `.planning/events/`, `.planning/operations/`, `.planning/.runtime/`, scope catalog, releases, artefactos generados y snapshots historicos de template packs; los templates canonicos se leen desde la instalacion del plugin.

El estado operativo v4 debe vivir en YAML/JSON canonico:

```text
config.yml
plugin.lock.yml
scope.yml
release.yml
release-item.yml
work-package.yml
task.yml
events/YYYY/MM/<event-id>.json
operations/<operation-id>/operation.yml
```

Markdown (`README.md`, `TRACEABILITY.md`, `RELEASE-NOTES.md`, `RETROSPECTIVE.md`, reportes y exports) es proyeccion humana generada.

## Template pack y docs a eliminar o rehacer

Eliminar o reemplazar:

```text
planning-template/active/
planning-template/finished/
planning-template/_template/00-initial.md
planning-template/_template/01-expansion.md
planning-template/_template/02-deepening/
planning-template/scripts/
```

Rehacer como v4:

```text
bin/<product-cli>
runtime/src/commands/
runtime/src/lib/
runtime/src/schemas/
runtime/dist/<product-cli>.mjs
runtime/fixtures/
runtime/package.json
runtime/package-lock.json
runtime/build.mjs
template-pack/template-pack.yml
template-pack/templates/release.md
template-pack/templates/scope.md
template-pack/templates/task-guide.yml
template-pack/templates/task-guide.md
template-pack/templates/test-guide.yml
template-pack/templates/test-guide.md
template-pack/templates/release-item.md
template-pack/templates/work-package.md
template-pack/templates/task.md
template-pack/templates/TRACEABILITY.md
template-pack/templates/RELEASE-NOTES.md
template-pack/templates/RETROSPECTIVE-RAW.md
template-pack/docs/
template-pack/update-version/
```

Reglas del template pack:

- vive en la instalacion del plugin;
- se versiona junto con el plugin;
- se usa para renderizar artefactos hacia `.planning/releases/`;
- no se copia completo al repo de trabajo;
- se referencia por version/fingerprint en `.planning/plugin.lock.yml`;
- declara compatibilidad con las versiones de schema soportadas por `runtime/src/schemas/`.

Reglas del runtime:

- vive fuera del template pack;
- contiene comandos de dominio, librerias, schemas, fixtures y bundle self-contained;
- no se copia al workspace usuario;
- expone solo el launcher estable de `bin/<product-cli>` a las skills.

Actualizar referencias en:

```text
README.md
CHANGELOG.md
CONTRIBUTING.md
CLAUDE.md
AGENTS.md
docs/commands.yml
docs/reference.md
docs/user-guide.md
docs/developer-guide.md
docs/training-mode-plan.md
docs/plugin-review/
template-pack/docs/TUTORIAL/
template-pack/docs/WORKFLOWS/
template-pack/docs/GLOSSARY.md
template-pack/docs/GUIDE.md
template-pack/docs/README.md
template-pack/templates/config.yml
template-pack/update-version/
```

## Configuracion y metadata

Actualizar o rehacer:

```text
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
.page/package.json
.page/package-lock.json
README.md version badge
CHANGELOG.md
```

Reglas:

- `plugin.json` debe describir v4 como release/release-item/work-package/task, no lifecycle planning v3.
- `marketplace.json` no debe listar comandos removidos ni texto antiguo.
- todo version marker del producto next-generation debe apuntar a `1.0.0`; el plugin actual 3.x queda en maintenance only.
- `CHANGELOG.md` debe declarar ruptura, comandos removidos, storage nuevo y ausencia de aliases.
- `template-pack/update-version/` debe explicar que v4 es corte limpio. Si existe herramienta auxiliar de export desde v3, debe documentarse como opcional.
- `config.yml` debe modelar `project`, `policies`, `git`, `commands`, `scope_catalog`, `guide_outputs`, `custom_generators`, validacion y autonomia; no debe duplicar `scope.yml` ni conservar `terminology.planning_item` o estados INITIAL/EXPANSION/DEEPENING.
- `plugin.lock.yml` debe fijar `plugin.version`, `schema_version`, `template_pack.id`, `template_pack.version` y `template_pack.fingerprint`.

## Site y landing page

Actualizar fuente, no outputs generados:

```text
.page/components/
.page/pages/
.page/locales/
.page/context/
.page/hooks/
.page/types/
.page/scripts/verify.js
.page/package.json
.page/package-lock.json
```

No editar como fuente:

```text
.page/out/
.page/.next/
```

Cambios esperados:

- home debe explicar el flujo v4: init -> config -> release -> item -> scope work packages -> task -> ChangeSets -> check/report -> release/deployment -> finalize.
- pagina de comandos debe mostrar solo comandos v4.
- tutoriales deben usar `.planning/releases/`, `.planning/scopes/`, UUIDv7 como identidad primaria y display IDs solo en comandos, reportes y proyecciones, junto con task guides y test guides.
- training/demo no debe ensenar `plan-new`, `plan-expand`, `active/finished`, `.releases/` ni planificaciones adicionales por scope.
- localizaciones `en` y `es` deben actualizarse juntas.
- `.page/scripts/verify.js` debe fallar si el site renderiza comandos legacy.

Verificacion site:

```text
cd .page
npm run build
```

## Documentacion publica

Actualizar como minimo:

```text
README.md
docs/commands.yml
docs/reference.md
docs/user-guide.md
docs/developer-guide.md
template-pack/docs/TUTORIAL/reference.md
template-pack/docs/TUTORIAL/*.md
template-pack/docs/WORKFLOWS/**/*.md
template-pack/docs/GLOSSARY.md
template-pack/docs/GUIDE.md
template-pack/docs/README.md
```

Reglas:

- `docs/commands.yml` es inventario canonico de comandos v4.
- `docs/reference.md` debe generarse o revisarse desde `docs/commands.yml`.
- README no debe tener tabla de "similar commands" para comandos legacy.
- tutoriales deben iniciar desde `init`, no desde `/release init`, `/plan-new` o `/plan-expand`.
- developer guide debe explicar launcher, runtime/librerias v4, schemas, ChangeSets, event journal y el contrato stage-first interno.
- glossary debe definir release, release item, item kind, delivery scope, cross-cutting concern, gate profile, scope work package, task guide, test guide, ChangeSet, operation, plugin lock, waiver, blocker, deployment event y finalization.

## Tooling y CI del plugin

Actualizar:

```text
scripts/verify-next-generation.sh
scripts/migrate-commands.sh
.github/workflows/deploy-pages.yml
.gitignore
```

Reglas:

- `verify-next-generation.sh` debe validar manifest, docs, site source, template, scripts y ausencia legacy del producto next-generation.
- `migrate-commands.sh` debe borrarse si solo migra comandos v3, o reescribirse para tareas v4 reales.
- workflow de Pages debe seguir construyendo desde `.page` y no depender de outputs legacy.
- `.gitignore` debe seguir excluyendo outputs generados, no fuentes v4.

## Scripts legacy

Cada script debe caer en una de tres categorias:

| Categoria | Accion |
|-----------|--------|
| Reescribir | El script implementa una capacidad v4 con modelo release/release-item/scope/work-package/task. |
| Extraer libreria | Se rescata logica pura a `runtime/src/lib/`. |
| Borrar | El script solo existe para modelos v3. |

Revision inicial:

```text
launcher                 -> crear como entrada estable <product-cli> <domain> <stage>
release.mjs              -> reescribir como use cases v4 de release aggregate
planning-init.mjs        -> reemplazar por workspace-init.mjs
planning-config.mjs      -> reemplazar por config.mjs
planning-story.mjs       -> reemplazar por item.mjs
planning-task.mjs        -> reemplazar por task.mjs
planning-check.mjs       -> reemplazar por check.mjs
planning-report.mjs      -> reemplazar por report.mjs
planning-decision.mjs    -> reemplazar por decision.mjs
doc-generate.mjs         -> plegar bajo report o borrar wrapper directo
planning-atomize.mjs     -> integrar a item atomize
planning-mutate.mjs      -> reemplazar por ChangeSet/stores/librerias v4
planning-archive.mjs     -> borrar o reimplementar como release finalization
planning-done.mjs        -> borrar si queda cubierto por release/release-item/task stages
planning-clone.mjs       -> borrar salvo que recover lo justifique
planning-merge.mjs       -> borrar; crear un agregado reemplazante y cerrar el anterior con provenance y replacement_id
planning-retry.mjs       -> mover a recover si se conserva
planning-rollback.mjs    -> mover a recover si se conserva
planning-story-skip.mjs  -> mover a release-item/task resolution con waiver si se conserva
planning-from-release.mjs -> integrar a release plan o item import
update-version.mjs       -> conservar para futuras migraciones v4+
```

## Checks obligatorios

`scripts/verify-next-generation.sh` debe fallar si encuentra:

- `skills/release-*`;
- ausencia de `skills/config/` cuando `docs/commands.yml` lo declare;
- `skills/us-*`;
- `skills/doc-*`;
- comandos removidos en `docs/commands.yml`;
- referencias activas a `.planning/active`, `.planning/finished` o `.releases`;
- referencias a `INITIAL`, `EXPANSION` o `DEEPENING` como estados publicos;
- `Linked Child Plannings` o cualquier instruccion de planificaciones adicionales por scope;
- ejemplos que usen `NNN-slug` como raiz de trabajo;
- ejemplos que usen `story-01-a`/`story-01-b` o `story_group`/`story_part` como modelo v4;
- referencias activas a `/release init`;
- comandos internos que expongan rutas `.planning/scripts/*.mjs` como API publica en vez del launcher;
- templates que creen `00-initial.md`, `01-expansion.md` o `02-deepening/`;
- comandos legacy en `.page/locales`, `.page/components`, `.page/pages` o `.page/out`;
- referencias legacy en `.claude-plugin/marketplace.json` o `.claude-plugin/plugin.json`;
- version markers desalineados entre `.claude-plugin/plugin.json`, `.page/package*.json`, README badge y `CHANGELOG.md`;
- `docs/commands.yml` desalineado con carpetas `skills/` v4;
- `template-pack/templates/config.yml` sin `scopes` o con campos v3 como contrato principal;
- presencia de `planning-template/` como estructura activa de v4;
- ausencia de schemas para entidades canonicas y ChangeSets;
- ausencia de schemas para Release Item, Operation, Actor, Approval, Gate, Blocker, Risk, Waiver, Decision, Deployment Event, Revision Ref, Command Spec, Provenance y Resolution;
- ausencia de `plugin.lock.yml` en fixtures v4;
- ausencia de `bin/<product-cli>` o `runtime/dist/<product-cli>.mjs`;
- comandos guardados como strings de shell en fixtures/templates v4.

Checks sugeridos:

```text
test ! -e planning-template
rg -n "release-init|release-new|release-add|release-remove|release-status" README.md docs runtime template-pack skills .page .claude-plugin --glob '!docs/plugin-redesign-release-flow/**'
rg -n "us-new|us-enrich|us-split|us-status|epic-enrich" README.md docs runtime template-pack skills .page .claude-plugin --glob '!docs/plugin-redesign-release-flow/**'
rg -n "\.planning/active|\.planning/finished|\.releases" README.md docs runtime template-pack skills .page .claude-plugin --glob '!docs/plugin-redesign-release-flow/**'
rg -n "INITIAL|EXPANSION|DEEPENING|Linked Child Plannings|02-deepening" README.md docs runtime template-pack skills .page .claude-plugin --glob '!docs/plugin-redesign-release-flow/**'
rg -n "plan-new|plan-expand|plan-from-epic|plan-template|doc-task|plan-test-suite" README.md docs runtime template-pack skills .page .claude-plugin --glob '!docs/plugin-redesign-release-flow/**'
rg -n "release init|story-01-a|story-01-b|story_group|story_part" README.md docs runtime template-pack skills .page .claude-plugin --glob '!docs/plugin-redesign-release-flow/**'
rg -n "\.planning/scripts/.*\.mjs" README.md docs runtime template-pack skills .page .claude-plugin --glob '!docs/plugin-redesign-release-flow/**'
```

## Verificacion de cierre

Antes de publicar v4:

```text
bash scripts/verify-next-generation.sh
cd .page
npm run build
git diff --check
```

Revision manual:

- abrir README y confirmar que solo describe v4;
- abrir `docs/reference.md` y confirmar que solo lista comandos v4;
- abrir landing site local o build output y confirmar que no muestra comandos v3;
- revisar `template-pack/` como template pack instalado, no como carpeta copiada por `init`;
- revisar fixtures v4 y confirmar que Markdown se regenera desde YAML/JSON canonico;
- revisar que ChangeSets fallen ante `baseRevisions` obsoletas;
- revisar que `check` no genere ni modifique artefactos;
- revisar `CHANGELOG.md` y version markers juntos.

## Publicacion

El release v4 debe comunicar:

- no hay compatibilidad de comandos v3;
- no hay migracion automatica obligatoria de workspaces v3;
- el nuevo storage canonico es `.planning/config.yml`, `.planning/plugin.lock.yml`, `.planning/events/`, `.planning/operations/`, `.planning/scopes/`, `.planning/releases/` y snapshots historicos en `.planning/vendor/template-packs/`; `.planning/.runtime/` queda para staging/logs no versionados;
- los comandos v3 fueron removidos, no deprecados;
- los Release Items tipados reemplazan story groups y los work packages reemplazan historias hermanas por scope;
- si se entrega una herramienta de export/migracion v3, es auxiliar y no condiciona el contrato v4.
