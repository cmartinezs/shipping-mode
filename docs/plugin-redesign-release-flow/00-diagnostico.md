# Diagnostico

## Situacion observada

El inventario actual tiene 53 comandos documentados en `docs/commands.yml` y 53 carpetas bajo `skills/`. La distribucion de skills es:

| Familia | Cantidad | Observacion |
|---------|----------|-------------|
| `plan-*` | 40 | Mezcla setup, lifecycle, ejecucion, reportes, recuperacion, validacion, backlog y automatizacion. |
| `release-*` | 5 | CRUD de releases, pero la release agrupa plannings, no historias. |
| `us-*` | 4 | Backlog paralelo a `plan-enrich-*` y `epic-enrich`. |
| `doc-*` | 3 | Wrappers de un script comun, buenos candidatos a plegarse bajo un comando de reporte/documentacion. |
| `epic-*` | 1 | Otro punto de entrada de backlog. |

El README expone 10 grupos de comandos y una tabla adicional de "Similar commands". Esa tabla existe porque el modelo publico ya no es obvio: hay comandos distintos para enriquecer backlog vs planning, para split de backlog vs planning, para health vs validate, para status/report/standup/history/export, y para release CRUD separado.

## Problema de modelo

El modelo historico parece ser:

```text
planning -> stories -> tasks
release -> plannings
```

El modelo requerido ahora es:

```text
project context -> release -> release item -> scope work package -> technical task
```

Esto cambia el centro de gravedad. El usuario no deberia tener que crear una "planning" como entidad mental principal para despues agregarla a una release. La planning puede seguir existiendo como concepto historico, pero la API publica debe hablar primero de releases, release items tipados, work packages por scope y tasks.

La correccion principal del review v4 es que los antiguos `story-01-a` y `story-01-b` no son User Stories independientes. Son slices tecnicos de una misma capacidad. La entidad que antes se estaba llamando `Story Group` debe ascender a `User Story` o `Capability`; las partes por scope deben modelarse como `Scope Work Package`.

## Problema de superficie publica

Hay demasiados comandos que representan variaciones mecanicas de una misma responsabilidad:

- `release-init`, `release-new`, `release-add`, `release-remove`, `release-status` son etapas de un unico dominio `release`.
- `plan-status`, `plan-report`, `plan-standup`, `plan-history`, `plan-export` son vistas sobre el mismo modelo.
- `plan-health`, `plan-validate`, `plan-task-validate`, `plan-audit-docs`, `plan-doctor` son validaciones con distinto alcance.
- `us-new`, `us-enrich`, `us-split`, `us-status`, `epic-enrich`, `plan-enrich-epic`, `plan-enrich-story`, `plan-split-story`, `plan-from-epic`, `plan-from-release` mezclan backlog, importacion y mutacion del arbol activo.
- `plan-agent-plan`, `plan-agent-execute`, `plan-agent-validate`, `plan-run` son orquestadores superpuestos.

Esto viola el criterio de responsabilidad unica a nivel de skill: muchas skills no son capacidades distintas, sino wrappers publicos para una etapa particular de un mismo script.

Tambien existe una contradiccion de UX: tener `/plan-init` y `/release init` obliga al usuario a decidir que inicializacion necesita. En v4 debe existir un unico bootstrap con marca nueva y namespace real de plugin: `/<product-name>:init`. La configuracion posterior de scopes, fuentes, politicas, comandos y autonomia debe vivir en `/<product-name>:config`.

`release` puede existir como router publico, pero no como comando dios. Debe delegar en use cases internos pequenos: crear release, planificar alcance, consultar readiness, registrar deployment, transicionar lifecycle o cerrar finalizacion.

## Problema de estado y mutaciones

El diseno inicial todavia trataba Markdown como almacenamiento operativo para estados, dependencias, indices y orquestacion. Eso es fragil porque el Markdown puede ser reformateado por usuarios, agentes o merges, y porque existen muchas representaciones textuales equivalentes para la misma tabla.

La regla v4 debe ser:

```text
YAML o JSON es la fuente de verdad. Markdown es una proyeccion humana generada.
```

El almacenamiento canonico debe incluir `config.yml`, `plugin.lock.yml`, `scope.yml`, `release.yml`, `release-item.yml`, `work-package.yml`, `task.yml`, manifests de operacion bajo `.planning/operations/` y eventos JSON inmutables bajo `.planning/events/`. Staging, snapshots y logs viven bajo `.planning/.runtime/`. Los Markdown (`README.md`, `TRACEABILITY.md`, `RELEASE-NOTES.md`, `RETROSPECTIVE.md`, reportes y exports) se regeneran desde ese estado.

`dry-run` y `--write` tampoco bastan como protocolo seguro. Toda mutacion debe pasar por `inspect -> propose -> validate -> approve -> stage -> apply -> verify -> record`, con `ChangeSet` validable, `baseRevisions` por agregado, idempotencia, optimistic locking, staging multiarchivo y journal de eventos por archivo.

## Lo que ya esta bien encaminado

Ya existe una direccion correcta:

- `planning-template/scripts/planning-task.mjs` centraliza etapas de task como `inspect`, `readiness`, `git-setup`, `start`, `publish`, `correction`, `closeout`; en v4 esta capacidad debe renombrarse y moverse a `runtime/src/commands/task.mjs`.
- `planning-template/scripts/planning-check.mjs` centraliza `health`, `validate` y `task-validate`; en v4 esta capacidad debe renombrarse y moverse a `runtime/src/commands/check.mjs`.
- `planning-template/scripts/doc-generate.mjs` centraliza documentacion de task, story y planning.
- `planning-template/scripts/release.mjs` ya centraliza release CRUD, aunque con el modelo viejo de release -> plannings.
- `planning-template/scripts/planning-from-release.mjs` ya apunta al bridge desde documentos de release.

Esas rutas son evidencia del repo v3 actual, no ubicacion objetivo. En v4, la logica rescatable debe moverse a `runtime/src/commands/` o `runtime/src/lib/`, y `planning-template/` debe dejar de ser contenedor de scripts.

El siguiente paso no deberia ser crear mas skills. Antes de implementar el primer comando publico v4, hace falta un Corte -1 de dominio y runtime: schemas, storage canonico, ChangeSet, IDs estables, politicas, launcher, fixtures y pruebas de arquitectura.

## Riesgos si se sigue igual

- Cada nuevo flujo genera otro comando de primer nivel.
- Los usuarios aprenden comandos por memoria, no por modelo.
- Las skills crecen como procedimientos largos con juicio y mecanica mezclados.
- La documentacion se vuelve una lista de excepciones.
- La release queda como reporte agregado, no como contrato de entrega.
- El cierre secuencial de releases sera dificil de validar si no queda como politica explicita.
- Dos agentes o worktrees pueden pisarse si no existe control de revision y journal.
- Los IDs basados en orden, scope o slug romperan referencias cuando cambie el titulo o se reordene el trabajo.
- Los scopes no-code o de compliance heredaran gates de software si `scope` no queda definido como unidad estable de ownership y validacion con `kind` propio.
