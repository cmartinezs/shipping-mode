# Mapa de comandos y skills

## Superficie publica objetivo

Nombre publico del producto next-generation:

```text
ARC Flow
```

`ARC Flow` es una etiqueta historica de trabajo; la interfaz publica se resuelve por el namespace del plugin.

La regla de naming del producto next-generation es:

- el nombre del plugin/producto aporta el namespace publico;
- las skills canonicas usan nombres cortos sin prefijo: `init`, `config`, `release`, `item`, `task`, `check`, `report`, `decision`, `update`;
- la forma visible es `/<plugin-name>:<skill-name>`, por ejemplo `/<plugin-name>:init`;
- launcher interno estable `<product-cli>`;
- dominios internos sin prefijo conversacional (`workspace`, `config`, `release`, `item`, `task`, `check`, `report`, `decision`, `changeset`);
- no usar `claude-*` ni `plan-*` como marca publica nueva;
- conservar menciones `plan-*` solo en tablas de reemplazo legacy.

Comandos publicos base:

| Skill canonica | Forma visible esperada | Responsabilidad publica | Use cases internos | Script/launcher |
|----------------|------------------------|--------------------------|--------------------|-----------------|
| `init` | `/<product-name>:init` | Bootstrap completo del workspace actual: estructura, deteccion inicial, config base y plugin lock. | `workspace.bootstrap`, `config.detect`, `lock.create` | `<product-cli> workspace init` |
| `config` | `/<product-name>:config` | Administrar scopes, fuentes, politicas, Git, comandos permitidos, autonomia, guias y generadores custom. | `scope.configure`, `policy.configure`, `guide.refresh`, `command.configure` | `<product-cli> config <stage>` |
| `release` | `/<product-name>:release` | Router publico del lifecycle de release: crear, planificar, consultar readiness, liberar, registrar deployment y finalizar. | `release.create`, `release.plan`, `release.query`, `release.transition`, `deployment.record`, `release.finalize` | `<product-cli> release <stage>` |
| `item` | `/<product-name>:item` | Crear/enriquecer Release Items tipados, validar criterios funcionales, crear work packages y atomizarlos por scope. | `release-item.create`, `release-item.enrich`, `work-package.create`, `work-package.atomize` | `<product-cli> item <stage>` |
| `task` | `/<product-name>:task` | Inspeccionar, preparar, ejecutar, validar, corregir y cerrar tasks atomicas. | `task.inspect`, `task.start`, `task.verify`, `task.correction`, `task.closeout` | `<product-cli> task <stage>` |
| `check` | `/<product-name>:check` | Validar invariantes, schemas, links, dependencias, guias, gates, readiness y evidencia sin mutar. | `check.health`, `check.schema`, `check.guides`, `check.gates`, `check.readiness` | `<product-cli> check <stage>` |
| `report` | `/<product-name>:report` | Generar summary, status, standup, history, release notes, traceability, docs y exports. | `report.status`, `report.standup`, `report.history`, `report.release-notes`, `report.export` | `<product-cli> report <stage>` |
| `decision` | `/<product-name>:decision` | Registrar, actualizar, aceptar o rechazar decisiones y vincularlas con releases, release items, scopes o gates. | `decision.propose`, `decision.accept`, `decision.reject`, `decision.link` | `<product-cli> decision <stage>` |

Ocho comandos bien definidos son preferibles a un comando unico sobrecargado. `release` puede ser fachada publica, pero su `SKILL.md` no debe contener todo el lifecycle.

## Comando de mantenimiento

`update` se conserva como comando de mantenimiento del plugin/template pack. No forma parte del flujo diario release/release-item/task, pero sigue siendo publico porque permite actualizar workspaces v4 a revisiones compatibles futuras.

| Skill canonica | Forma visible esperada | Responsabilidad | Script/launcher |
|----------------|------------------------|-----------------|-----------------|
| `update` | `/<product-name>:update` | Aplicar migraciones v4+ compatibles, actualizar lock/template pack y reportar cambios requeridos. | `<product-cli> update <stage>` |

## Comandos avanzados

Solo implementar cuando exista una necesidad real y evidencia de uso:

| Skill canonica | Forma visible esperada | Uso |
|----------------|------------------------|-----|
| `run` | `/<product-name>:run` | Orquestador end-to-end encima de release/release-item/task/check. No pertenece al primer vertical slice. |
| `recover` | `/<product-name>:recover` | Retry, rollback, clone, merge, compensaciones y fallas de operacion con stages explicitos. |
| `backlog` | `/<product-name>:backlog` | Importar o mantener backlog externo cuando no hay release directa. |

No se implementan por anticipacion para evitar reconstruir la explosion de comandos v3.

## Comandos removidos y reemplazos conceptuales

Estos comandos no se preservan como aliases en v4. La tabla sirve para decidir que capacidades sobreviven y donde quedan.

| Comandos v3 | Destino v4 | Accion v4 | Razon |
|-------------|------------|-----------|-------|
| `release-init`, `release-new`, `release-add`, `release-remove`, `release-status` | `/<product-name>:init`, `/<product-name>:config`, `/<product-name>:release` con stages `new`, `status`, `mark`, `deployment`, `finalize` | Borrar skills v3. | Init/config son de workspace; release queda como router de lifecycle, no CRUD aislado. |
| `plan-status`, `plan-standup`, `plan-history`, `plan-export` | `/<product-name>:report` con stages `status`, `standup`, `history`, `export` | Borrar wrappers separados. | Son vistas/proyecciones, no checks. |
| `plan-health`, `plan-validate`, `plan-task-validate`, `plan-audit-docs`, `plan-doctor` | `/<product-name>:check` con stages `health`, `schema`, `task`, `docs`, `doctor`, `readiness` | Borrar skills v3 o reimplementar solo `check`. | Todos validan invariantes, schemas, gates o evidencia. |
| `doc-generate`, `doc-story`, `doc-task` | `/<product-name>:report docs --level` con niveles `release`, `release-item`, `work-package`, `task` | Borrar wrappers separados. | Markdown es proyeccion generada desde estado canonico. |
| `us-new`, `us-enrich`, `us-split`, `us-status`, `epic-enrich` | `/<product-name>:backlog` con stages `new`, `enrich`, `split`, `status`, `import`, si se justifica | Borrar por defecto. | Backlog externo no debe competir con release activa. |
| `plan-enrich-epic`, `plan-enrich-story`, `plan-split-story` | `/<product-name>:item` con stages `enrich`, `split`, `package add`, `atomize` | Borrar skills v3. | El Release Item es unidad de alcance; los slices tecnicos son work packages. |
| `plan-merge`, `plan-story-skip` | Crear el agregado reemplazante mediante `item add` y cerrar el anterior mediante `item resolve --resolution SUPERSEDED --replacement <id>` | Borrar skills v3. | `recover` queda reservado para recuperación de operaciones; skip requiere resolución/waiver, no estado principal. |
| `plan-from-epic`, `plan-from-release`, `plan-template`, `plan-new`, `plan-expand` | `/<product-name>:release plan` o `/<product-name>:item import` | Borrar flujo INITIAL/EXPANSION como API publica. | El flujo INITIAL/EXPANSION desaparece del contrato v4. |
| `plan-agent-plan`, `plan-agent-execute`, `plan-agent-validate`, `plan-run` | `/<product-name>:run` solo si se justifica | Borrar agentes por fase. | Un orquestador avanzado no debe formar parte del primer corte. |
| `plan-retry`, `plan-rollback`, `plan-clone` | `/<product-name>:recover` con stages `retry`, `rollback`, `clone`, si se justifica | Borrar skills sueltas. | Recuperacion debe operar sobre eventos y ChangeSets. |
| `plan-smoke-config`, `plan-git-config` | `/<product-name>:config` con stages `commands`, `git`, `policies` | Borrar config commands sueltos. | Configuracion pertenece al Project Context. |
| `plan-test-suite` | `/<product-name>:task prepare`, `/<product-name>:item atomize` o `/<product-name>:config guide refresh` | Borrar como comando principal. | `check` no muta; la generacion pertenece a prepare/atomize/config. |
| `plan-edge-case`, `plan-retrospective` | `/<product-name>:release note unexpected`, `/<product-name>:release finalize` o `/<product-name>:report retro` | Borrar como comandos de planning. | Retrospectiva cierra release y se sintetiza desde eventos/hechos. |

## Corte limpio v4

La version v4 instala una superficie nueva, sin wrappers de compatibilidad.

Reglas:

- no crear aliases legacy;
- no mantener `.releases/`, `.planning/active/` ni `.planning/finished/` como storage;
- no aceptar `NNN-slug` como identificador raiz si el contrato exige ID primario distribuido o `display_id` humano resoluble;
- no duplicar skills por etapa cuando una etapa puede ser stage interno;
- no usar IDs que mezclen slug, scope, titulo u orden de item;
- si una capacidad v3 no entra en project context, release, release item, work package, task, check, report o decision, se elimina o queda como comando avanzado solo con una razon fuerte.

## Contrato de skills

Cada `SKILL.md` debe tener como maximo:

- proposito del comando;
- argumentos publicos;
- precondiciones;
- llamada al launcher determinista;
- herramientas permitidas;
- comandos permitidos;
- punto exacto donde entra juicio del agente;
- criterios de stop;
- manejo de error;
- salida esperada;
- reglas de aprobacion humana.

Frontmatter esperado para flujos con efectos secundarios:

```yaml
---
description: ...
argument-hint: ...
disable-model-invocation: true
---
```

Las skills canonicas usan nombres cortos y se exponen mediante el
namespace del plugin:

```text
/<plugin-name>:init
/<plugin-name>:config
/<plugin-name>:release
/<plugin-name>:item
/<plugin-name>:task
/<plugin-name>:check
/<plugin-name>:report
/<plugin-name>:decision
/<plugin-name>:update
```

No se crearan skills duplicadas con prefijos por acronimo.
El Spike Host Integration valida discovery, autocomplete, ayuda y
presentacion, pero no altera esta convencion.

`allowed-tools` debe restringirse por comando exacto. `check` puede usar
`Bash(<product-cli> check *)`; `report` solo puede preaprobar
`Bash(<product-cli> report status *)`, `Bash(<product-cli> report standup *)`
y `Bash(<product-cli> report history *)`. Las skills mutantes no declaran
`allowed-tools` general.

Politica de permisos:

| Stage u operacion | Preaprobacion sugerida |
|-------------------|------------------------|
| `check`, `status`, `inspect`, `propose`, `validate` | permitida |
| `approve` | no permitida por defecto |
| `apply` | no permitida por defecto |
| Git mutante | segun policy |
| deployment | aprobacion explicita |

Las aprobaciones runtime no reemplazan permisos del host, y los permisos del host no reemplazan aprobaciones de ChangeSet. La policy base debe ser:

```yaml
approvals:
  allow_agent_self_approval: false
```

La skill no debe contener:

- parseo manual de Markdown;
- asignacion de IDs;
- logica de estados;
- pasos Git repetidos;
- tablas duplicadas;
- reglas que ya viven en schemas, runtime, templates o docs canonicos;
- aprobacion de su propio ChangeSet;
- escritura directa de `.planning/`;
- `apply` sin approval/policy.

## Contrato del runtime

El contrato interno usa stage-first, pero mediante launcher estable:

```text
<product-cli> workspace init [args] [--format json|markdown]
<product-cli> config <stage> [args] [--format json|markdown]
<product-cli> release <stage> [args] [--format json|markdown]
<product-cli> item <stage> [args] [--format json|markdown]
<product-cli> task <stage> [args] [--format json|markdown]
<product-cli> check <stage> [args] [--format json|markdown]
<product-cli> report <stage> [args] [--format json|markdown]
<product-cli> decision <stage> [args] [--format json|markdown]
<product-cli> changeset <propose|validate|approve|apply|verify> [args] [--format json|markdown]
```

Mutaciones no aplican directamente. Primero producen un `ChangeSet`:

```text
inspect -> propose -> validate -> approve -> stage -> apply -> verify -> record
```

`apply` requiere `baseRevisions` vigentes por agregado, `operationId`, `idempotencyKey` y aprobacion vinculada al hash del ChangeSet cuando cambie alcance, se omita un gate, se acepte un riesgo, se ejecute un comando sensible, se cancele trabajo comprometido, se libere o se despliegue.

## Librerias internas recomendadas

```text
runtime/src/lib/
  schema.mjs          # carga y valida schemas
  identity.mjs        # IDs primarios distribuidos, display IDs, idempotency keys
  revision.mjs        # workspace revision, optimistic locking, locks
  paths.mjs           # cwd boundary, path normalization, symlink checks
  command-policy.mjs  # comandos estructurados, allowlist, approvals
  event-journal.mjs   # eventos JSON inmutables bajo .planning/events/
  change-set.mjs      # inspect/propose/validate/apply/verify
  atomic-write.mjs    # temp files, rename, rollback tecnico
  project-store.mjs   # config, plugin lock, policies
  scope-store.mjs     # scope catalog y guide metadata
  release-store.mjs   # release aggregate y lifecycle
  release-item-store.mjs # release item tipado
  work-package-store.mjs # ownership tecnico, gates y tasks
  task-store.mjs      # task metadata, dependencias, evidencia
  guide-store.mjs     # guide status, fingerprints, provenance
  render.mjs          # proyecciones Markdown/json
```

Esto mantiene SOLID en serio: una skill coordina una intencion; el runtime aplica contratos mecanicos con librerias de responsabilidad tecnica unica.
