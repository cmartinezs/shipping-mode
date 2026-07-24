# Corte 0 — Runtime Foundation (diseño de endurecimiento)

Estado: aprobado para pasar a plan de implementación.
Fecha: 2026-07-24.

## 1. Objetivo

Convertir `src/runtime.mjs` de prototipo (reutilización directa de
`spikes/integrated-prototype/prototype.mjs`) a una implementación real y
acotada de Corte 0, según la definición estricta de
`docs/plugin-redesign-release-flow/03-plan-incremental.md`: bootstrap de
`init`/`config`, catálogo de scopes y `plugin.lock.yml`. Nada más.

No se marca Corte 0 como cerrado al final de este pase. Se marca como
"fundación real completa, descubrimiento de git/scopes/guides pendiente
como iteración obligatoria siguiente".

## 2. Alcance

### 2.1 Dentro de alcance (real, con schemas, IDs, ChangeSet, journal y tests)

- `init` — bootstrap no interactivo vía flags/args explícitos.
- `config set` — actualización de `config.yml`.
- `config scope add` — alta de una entrada en el catálogo de scopes.
- `changeset validate|approve|apply` — ciclo de vida genérico de operación,
  usado por `init`/`config` internamente.
- `check schema` — validación de `config.yml`/`plugin.lock.yml`/`scopes/**`
  contra los schemas reales.

### 2.2 Fuera de alcance en este pase (iteración obligatoria posterior)

- Detección automática de git, descubrimiento de carpetas/paquetes,
  confirmación humana interactiva, registro de guides/comandos
  estructurados, configuración de autonomía (todo `04-release-init-configuracion.md`).
- `release`, `item`, `work-package`, `task`, `report`,
  `check health|guides|gates`, `decision`, `update`.
- Cualquier forma de saga de comandos externos (git/gh/deploy) y sus
  estados de compensación/rollback.

El código de esas áreas fuera de alcance que hoy vive en `src/runtime.mjs`
se retira del runtime productivo. Ya existe una copia de referencia en
`spikes/integrated-prototype/prototype.mjs`; no se duplica.

## 3. Inventario de comandos

```
shipping-mode init --name <name> [--base-branch <b>] [--vcs git|none] --actor <actor>
shipping-mode config set --name <name> --actor <actor>
shipping-mode config scope add --key <slug> --label <label> --kind code|non_code --path <path> [--owner <o>] --actor <actor>
shipping-mode changeset propose --kind <workspace.init|config.update|scope.add> --payload-file <file|-> --actor <actor>
shipping-mode changeset validate <operation-id>
shipping-mode changeset approve <operation-id> --actor <actor>
shipping-mode changeset apply <operation-id>
shipping-mode check schema
shipping-mode --version
shipping-mode --help
```

`init` y `config` son atajos que arman el payload y llaman al mismo camino
de código que `changeset propose`. Nunca escriben `.planning/**`
directamente: solo `changeset apply` escribe archivos canónicos.

Cualquier comando/kind fuera de alcance (`release`, `item`, `work-package`,
`task`, `report`, `check health|guides|gates`,
`changeset propose --kind release.*|item.*|task.*`, etc.) responde:

```json
{
  "product": "shipping-mode",
  "command": "...",
  "status": "NOT_IMPLEMENTED",
  "corte": "0",
  "message": "deferred to Corte N, see docs/plugin-redesign-release-flow/03-plan-incremental.md"
}
```

con exit code `3`. Exit codes: `0` éxito, `1` error de validación/estado
(`INVALID`/`REJECTED`/`STALE`/`RECOVERY_REQUIRED`), `2` error interno
inesperado, `3` `NOT_IMPLEMENTED`.

## 4. Storage (`.planning/`)

```
.planning/
  config.yml
  plugin.lock.yml
  scopes/
    <scope-uuidv7>/
      scope.yml
  operations/
    <operation-uuidv7>/
      operation.yml
      change-set.json
      result.json
  events/
    <yyyy>/<mm>/<event-uuidv7>.json
  .runtime/                          # gitignored, transitorio
    operations/
      <operation-uuidv7>/
        before/
        staged/
        logs/
```

No existe `.planning/approvals/`. La aprobación queda ligada al hash del
ChangeSet y registrada en `operation.yml` (`approval.changeSetHash`,
cruzado contra `change-set.json.hash`).

`init` crea únicamente lo que Corte 0 usa: no crea `releases/`, `items/`,
`work-packages/`, `tasks/`, `template-pack/`.

## 5. Modelo de IDs

- `src/lib/ids.mjs` implementa un generador real de UUIDv7 (RFC 9562:
  timestamp de 48 bits big-endian + nibble de versión `7` + bits de
  variante `10xx` + aleatoriedad), no solo el validador `isUuidV7` que ya
  existe en `spikes/canonical-core/canonical.mjs`.
- Todo ID primario (operación, evento, scope) es un UUIDv7 real.
- Cada scope tiene `id` (UUIDv7, canónico) y `key` (slug humano,
  p. ej. `backend`), replicando el patrón UUIDv7/display-id que los ADRs
  documentan para otras entidades.
- No hay jerarquía padre-hijo real que resolver en este corte (no existen
  release/item/task); el objetivo de "corregir resolución de relaciones
  usando IDs UUIDv7 reales" se cumple retirando el generador ad hoc actual
  (que cuenta directorios existentes) y su bug de condición de carrera.

## 6. Schemas y pipeline de build

Siete schemas reales en `src/schemas/`: `config`, `plugin-lock`, `scope`,
`change-set`, `operation`, `event`, `result`.

Pipeline (`scripts/build-schemas.mjs`):

```
schemas JSON -> Ajv standalone ESM (strict, allErrors, code.source, code.esm)
             -> bundle autocontenido (esbuild)
             -> src/generated/validators.mjs
             -> src/lib/schema.mjs (fachada)
```

- Ajv y esbuild son `devDependencies` exclusivas de build; nunca se
  requieren en el workspace del usuario final (ADR-0002).
- Se agrega `package-lock.json` con versiones fijadas; la verificación
  determinista corre con `npm ci`.
- `src/lib/schema.mjs` es la única fachada pública:
  `validate(schemaName, data) -> { valid, errors }`. El dominio nunca
  importa Ajv ni `src/generated/**` directamente.
- `src/generated/**` no se edita a mano; se regenera con
  `npm run build:schemas` y un test falla si la regeneración diverge del
  archivo versionado.

## 7. Máquina de estados de `operation` / `change-set`

Estados (`operation.yml.status`):

```
PROPOSED -> VALIDATED -> APPROVED -> APPLYING -> APPLIED
```

Terminales de error: `INVALID`, `REJECTED`, `STALE`, `RECOVERY_REQUIRED`.
Cada transición agrega `history: [{at, from, to, actor, reason}]`.

- **propose**: crea `operations/<id>/change-set.json` (`schemaVersion`,
  `operationId`, `kind`, `target`, `baseRevisions`, `payload`, `hash`) y
  `operation.yml` en `PROPOSED`. `baseRevisions` usa el valor literal
  `"ABSENT"` para archivos que se espera que no existan todavía —nunca
  `null`, cadena vacía, u omisión de la ruta— porque hay que distinguir
  "se espera ausente" de "no considerado por esta operación".
  `hash` (`changeSetHash`) se calcula sobre la representación canónica del
  ChangeSet **excluyendo el propio campo `hash`**.
- **validate**: valida `payload` contra el schema vía `src/lib/schema.mjs`
  y recalcula `baseRevisions` contra el estado actual. Falla el schema →
  `INVALID`. Revisión ya cambiada → `STALE`. Si no → `VALIDATED`.
- **approve `--actor`**: requiere `VALIDATED`. Rechaza auto-aprobación
  (`actor === proposedBy`) salvo `--override-self-approval` explícito
  (igual queda en `history`). Escribe
  `approval: {actor, approvedAt, changeSetHash}`.
- **apply**: requiere `APPROVED`. Ver secuencia durable en §8.

## 8. Secuencia durable de `apply`

`apply` **no es atómico como conjunto multiarchivo** — cada `rename()` es
atómico por archivo, pero una operación de varios archivos es
**crash-consistent**, no transaccional: durante `APPLYING` puede existir
temporalmente un estado parcialmente aplicado, resuelto por recovery
idempotente. Ningún documento, nombre de test o criterio de cierre debe
prometer atomicidad transaccional multiarchivo.

Secuencia exacta:

1. Revalidar schema, `baseRevisions` y `changeSetHash` (defensivo, aunque
   `validate`/`approve` ya lo comprobaron).
2. Preparar `.runtime/operations/<id>/before/` (snapshot del contenido
   actual, o marca `ABSENT`) y `staged/` (contenido nuevo renderizado).
3. Persistir en `operation.yml` los eventos esperados
   (`eventId`, `type`, `idempotencyKey`, `relativePath`), generados y
   fijados **antes** de tocar cualquier archivo canónico.
4. Transición `APPROVED -> APPLYING` (escritura durable en disco antes de
   tocar `.planning/config.yml` et al.).
5. Aplicar cada archivo mediante `rename()` desde `staged/` a su ruta
   canónica.
6. Escribir `result.json` (archivos tocados + hashes nuevos).
7. Escribir los eventos esperados de forma idempotente, usando los IDs
   fijados en el paso 3 (nunca se generan IDs nuevos en este paso).
8. Transición `APPLYING -> APPLIED`.

Escritura de eventos, idempotente: si el archivo del evento no existe se
crea; si existe con el mismo hash se considera completado; si existe con
contenido distinto, la operación pasa a `RECOVERY_REQUIRED` (un evento
corrupto/alterado es una violación de integridad, nunca se resuelve en
silencio).

## 9. Recovery

Corre al inicio de cada invocación del CLI: busca
`operations/*/operation.yml` con `status === APPLYING` y, por archivo
involucrado, clasifica el hash canónico actual contra lo esperado:

| Condición | Clasificación | Acción |
|---|---|---|
| `canonical == staged` | ya aplicado | no-op, continuar con el siguiente paso pendiente |
| `canonical == before` | aún no aplicado | repetir `rename()` desde `staged/` |
| canónico ausente y `before == ABSENT` | aún no creado | `rename()` desde `staged/` |
| cualquier otro valor | modificación divergente | **no** repetir el rename, **no** sobrescribir |

Ante una modificación divergente: transición a `RECOVERY_REQUIRED`,
registrar el conflicto en `operation.yml`
(`conflict: {detectedAt, file, expectedBeforeHash, expectedStagedHash, actualHash}`),
y la invocación normal se detiene con un error explícito y evidencia
suficiente para resolución manual. Recovery solo completa pasos
pendientes (5 a 8 de §8); nunca revierte ni sobrescribe estado divergente
en silencio.

## 10. Confinamiento del workspace

Toda ruta canónica (`baseRevisions`, `staged/`, `before/`, destino de
`rename()`, paths de scope) se resuelve y se verifica contenida dentro de
`.planning/` (confinamiento por `realpath`, rechazando symlinks que
escapen del workspace) antes de escribir. Se rechaza explícitamente,
antes de escribir nada:

- path traversal (`../`);
- rutas absolutas fuera del workspace;
- symlinks que resuelvan fuera del workspace;
- `scope --path` manipulado para apuntar fuera del workspace;
- un destino que cambie entre `validate` y `apply`.

Cualquiera de estos casos falla con evidencia explícita, antes de tocar
`staged/`, `before/` o cualquier archivo canónico.

## 11. Skills

Solo quedan activas bajo `skills/` las tres skills reales de este corte:
`init`, `config`, `check` — con `SKILL.md` y `allowed-tools` actualizados
a la superficie real de §3.

Las carpetas `skills/decision/`, `skills/item/`, `skills/release/`,
`skills/report/`, `skills/task/`, `skills/update/` se retiran del
directorio activo: no deben aparecer en manifest, help, autocomplete ni
documentación pública mientras no tengan funcionalidad real (el mapeo
comando↔skill ya vive documentado en
`docs/plugin-redesign-release-flow/02-mapa-comandos-skills.md`, no hace
falta preservar los stubs). El runtime CLI conserva el contrato
`NOT_IMPLEMENTED` para invocación directa de esos comandos.

`.planning/**` write protection: sin cambios funcionales; solo
re-verificación de que las 21 pruebas existentes
(`hooks/tests/protect-planning-state.test.mjs`) siguen pasando.

## 12. Plan de testing

- **Unit** (`src/lib/{ids,canonical,schema,changeset,journal}.mjs`):
  generación/validación UUIDv7; canonicalización y hash; `ABSENT` vs ruta
  omitida en `baseRevisions`; `changeSetHash` excluye `hash`; rechazo de
  auto-aprobación; clasificación de recovery para cada combinación
  (staged/before/ausente-esperado/divergente); prevención de eventos
  duplicados; confinamiento de paths (traversal, absolutas, symlink).
- **Schema/build**: los 7 schemas compilan; casos válidos/inválidos por
  schema; `npm ci` + regeneración no cambia `src/generated/**`; el bundle
  corre sin `node_modules`; no quedan referencias a `ajv/dist/runtime` ni
  imports externos.
- **CLI e2e** (spawn real de `bin/shipping-mode.mjs`, no in-process):
  camino feliz `init -> validate -> approve -> apply -> check schema`;
  `apply` sin aprobación falla; `STALE` si un archivo cambia entre
  `validate`/`approve` y `apply`; `NOT_IMPLEMENTED` con contrato y exit
  code exactos para todo lo de §2.2.
- **Matriz de crash durable** (simulando falla justo después de cada
  frontera de la secuencia de §8, contra la clasificación de §9): tras (1)
  crear `before/`, (2) crear `staged/`, (3) persistir eventos esperados,
  (4) pasar a `APPLYING`, (5) aplicar el primer archivo, (6) aplicar todos
  los archivos, (7) escribir `result.json`, (8) escribir el primer
  evento, (9) escribir todos los eventos, (10) antes de pasar a
  `APPLIED`. Cada punto debe demostrar recuperación idempotente o
  transición segura a `RECOVERY_REQUIRED`, sin duplicar eventos ni
  sobrescribir contenido divergente.
- **Confinamiento del workspace**: traversal, ruta absoluta, symlink que
  escapa, scope con path manipulado, destino que cambia entre `validate`
  y `apply` — todos deben fallar antes de escribir.
- **Regresión** (sin cambios de comportamiento esperados):
  `hooks/tests/protect-planning-state.test.mjs`,
  `scripts/tests/verify-next-generation.test.mjs`,
  `spikes/tests/verify-corte-1.2.test.mjs`,
  `spikes/host-integration/tests/host-integration.test.mjs`.
  `src/tests/vertical-slice.test.mjs` se reemplaza (ya no puede afirmar
  que `release/item/task/...` "pasan"); se actualiza la línea
  correspondiente en `scripts/verify-next-generation.sh`.

## 13. Definition of Done de este pase

- [ ] Todos los tests nuevos/actualizados (unit, schema/build, CLI e2e,
      matriz de crash, confinamiento) pasan.
- [ ] Las suites de regresión existentes siguen pasando sin cambios de
      comportamiento.
- [ ] `.planning/**` sigue protegido contra escritura directa.
- [ ] Ningún comando fuera de alcance tiene una ruta silenciosa o parcial:
      todos responden `NOT_IMPLEMENTED` con contrato y exit code
      verificados por test.
- [ ] `README.md` y este documento reflejan con precisión qué cubre esta
      fundación y qué queda como iteración obligatoria siguiente
      (descubrimiento de git/scopes/guides, autonomía, release/item/
      work-package/task, `check health/guides/gates`, `report`).
- [ ] Ningún texto afirma atomicidad transaccional multiarchivo; el
      lenguaje usado es "crash-consistent con recovery idempotente".
- [ ] Corte 0 **no** se marca como cerrado/terminado en ningún documento.

## 14. Explícitamente fuera de alcance (iteración obligatoria siguiente)

Ver §2.2. Debe quedar registrado en el README y en el índice de docs como
trabajo pendiente obligatorio, no opcional.
