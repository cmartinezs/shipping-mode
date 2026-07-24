# Corte 0 — Runtime Foundation (diseño de endurecimiento)

Estado: aprobado conceptualmente, revisión 2 incorpora correcciones de
diseño antes de pasar a plan de implementación.
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
  contra los schemas reales, estrictamente query-only.

### 2.2 Fuera de alcance en este pase (iteración obligatoria posterior)

- Detección automática de git, descubrimiento de carpetas/paquetes,
  confirmación humana interactiva, registro de guides/comandos
  estructurados, configuración de autonomía (todo `04-release-init-configuracion.md`).
- `release`, `item`, `work-package`, `task`, `report`,
  `check health|guides|gates`, `decision`, `update`.
- Cualquier forma de saga de comandos externos (git/gh/deploy) y sus
  estados de compensación/rollback.
- Gobernanza de aprobación (separación obligatoria proponente/aprobador,
  roles, políticas de autonomía) — ver §10.

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
shipping-mode changeset approve <operation-id> --actor <actor> [--allow-self-approval]
shipping-mode changeset apply <operation-id> --actor <actor>
shipping-mode check schema
shipping-mode --version
shipping-mode --help
```

`init` y `config` son atajos que arman el payload y llaman al mismo camino
de código que `changeset propose`.

`init`/`config` **no mutan estado canónico del proyecto**. Persisten
únicamente la propuesta y su operación bajo `.planning/operations/`. Solo
`changeset apply` modifica `config.yml`, `plugin.lock.yml` y
`scopes/**`. Ver la distinción operacional/canónico en §5.

`changeset apply` requiere `--actor` porque es una transición mutante y
auditable como cualquier otra. Las transiciones automáticas internas
(revalidación defensiva dentro de `apply`, recovery) usan actores
explícitos reservados: `system:validator`, `system:recovery` — nunca se
atribuyen al actor humano que invocó el comando contenedor.

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
(`INVALID`/`STALE`/`RECOVERY_REQUIRED`), `2` error interno inesperado,
`3` `NOT_IMPLEMENTED`.

## 4. Estructura de directorios del proyecto

Se alinea con el árbol objetivo de `07-estructura-plugin-v4.md`. No se
mantiene `src/` en la raíz — este pase migra el código productivo:

```
runtime/
  src/
    lib/          # ids, canonical, schema, changeset, journal, lock, paths
    commands/     # init, config, changeset, check
    schemas/      # *.schema.json
    generated/    # validators.mjs generado, no editado a mano
  dist/
    shipping-mode.mjs   # bundle único autocontenido (runtime + yaml + validadores)
bin/
  shipping-mode.mjs      # entry point npm "bin", sin cambiar de ruta; delega al bundle
```

`bin/shipping-mode.mjs` no cambia de ubicación (es el `bin` publicado en
`package.json` y la ruta referenciada por `.claude-plugin/plugin.json` vía
convención de host) pero su implementación pasa a ser un shim delgado que
importa `../runtime/dist/shipping-mode.mjs`. Los tests unitarios corren
contra `runtime/src/**` directamente (iteración rápida); los tests CLI
e2e ejercitan el bundle real vía `bin/shipping-mode.mjs`, probando el
artefacto que de verdad se distribuye.

`spikes/`, `hooks/`, `scripts/`, `docs/` no se mueven.
`scripts/verify-next-generation.sh` se actualiza para referenciar las
rutas nuevas (hoy invoca `node src/tests/vertical-slice.test.mjs`
directamente por ruta).

## 5. Storage en el workspace del usuario (`.planning/`)

```
.planning/
  .gitignore                 # contiene ".runtime/"; se crea como parte
                              # del ChangeSet de workspace.init
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
  .runtime/
    workspace.lock/           # ver §11
    operations/
      <operation-uuidv7>/
        before/
        staged/
        logs/
```

Se distinguen explícitamente dos dominios:

- **Infraestructura operacional** (mutada libremente por el ciclo de vida
  de la operación, no representa el proyecto en sí):
  `.planning/operations/` y `.planning/.runtime/`.
- **Estado canónico del proyecto** (lo que el usuario y el resto del
  runtime consideran la verdad): `config.yml`, `plugin.lock.yml`,
  `scopes/**`, `.gitignore`.

`propose`/`validate`/`approve` solo escriben infraestructura operacional.
Únicamente `changeset apply` escribe estado canónico, y lo hace siguiendo
la secuencia durable de §12.

No existe `.planning/approvals/`. La aprobación queda ligada al hash del
ChangeSet y registrada en `operation.yml` (`approval.changeSetHash`,
cruzado contra `change-set.json.hash`).

`init` crea únicamente lo que Corte 0 usa: no crea `releases/`, `items/`,
`work-packages/`, `tasks/`, `template-pack/`.

## 6. Modelo de IDs

- `runtime/src/lib/ids.mjs` implementa un generador real de UUIDv7 (RFC
  9562: timestamp de 48 bits big-endian + nibble de versión `7` + bits de
  variante `10xx` + aleatoriedad), no solo el validador `isUuidV7` que ya
  existe en `spikes/canonical-core/canonical.mjs`.
- Todo ID primario (operación, evento, scope) es un UUIDv7 real, generado
  en `propose` y **inmutable** a través de `validate`/`approve`/`apply`.
- No hay jerarquía padre-hijo real que resolver en este corte (no existen
  release/item/task); el objetivo de "corregir resolución de relaciones
  usando IDs UUIDv7 reales" se cumple retirando el generador ad hoc actual
  (que cuenta directorios existentes) y su bug de condición de carrera.

## 7. Catálogo de scopes

Fuente única de resolución, en dos piezas sincronizadas por la misma
operación:

```yaml
# config.yml
scopeRefs:
  - id: <uuidv7>
    key: backend
```

```
.planning/scopes/<uuidv7>/scope.yml   # detalle completo de la entrada
```

`config scope add` genera un ChangeSet cuyo `filePlan` (§12) toca **ambos
archivos en la misma operación**: agrega la entrada a `config.yml` y crea
el nuevo `scope.yml`. Nunca se aplican por separado.

Reglas:

- `key` se normaliza a kebab-case antes de comparar o persistir.
- Unicidad case-insensitive sobre `scopeRefs[].key`.
- El UUIDv7 del scope se genera en `propose` y no cambia en `apply`.
- La operación incluye la revisión de `config.yml` en `baseRevisions`
  (§8), de modo que dos altas concurrentes con la misma `key` no puedan
  aplicarse ambas: la segunda queda `STALE` porque la revisión de
  `config.yml` ya cambió cuando la primera se aplicó. Esto se refuerza
  con el workspace lock (§11), que impide que ambas lleguen a `apply` en
  paralelo sin serializarse.

## 8. Modelo de hashes

Se usan dos hashes con propósitos distintos — nunca un único hash para
ambos:

- **`revisionHash`**: SHA-256 de la representación canónica (claves
  ordenadas recursivamente, JSON) del objeto YAML/JSON parseado. Se usa
  para concurrencia semántica: `baseRevisions`, detección de cambios que
  importan al dominio.
- **`contentHash`**: SHA-256 de los bytes exactos del archivo en disco.
  Se usa para staging y recovery: detecta cualquier cambio externo,
  incluyendo reformateo o comentarios que no alteran el significado mismo.

Para archivos que se espera que no existan, ambos valores son el literal
`ABSENT` **como valor de campo dentro de JSON/YAML**, nunca como
contenido literal de un archivo real (no se crea un archivo cuyo
contenido sea la cadena `"ABSENT"`; la ausencia se registra
estructuralmente, ver `filePlan` en §12).

`changeSetHash` (el hash del propio ChangeSet) es distinto de los dos
anteriores: SHA-256 de la representación canónica de `change-set.json`
**excluyendo el propio campo `hash`**.

Antes de aplicar deben coincidir `revisionHash` **y** `contentHash`
esperados contra el estado actual. Esto evita sobrescribir en silencio
cambios de formato/comentarios/bytes ocurridos después de `validate`.

## 9. Schemas, YAML y pipeline de build

Siete schemas reales en `runtime/src/schemas/`: `config`, `plugin-lock`,
`scope`, `change-set`, `operation`, `event`, `result`.

Parsing/serialización YAML: dependencia fijada **`yaml`** (Node no trae
parser YAML). Configuración obligatoria:

- rechazo de claves duplicadas (`uniqueKeys`);
- límite de alias (`maxAliasCount: 0` — Corte 0 no necesita alias/anchors,
  se deshabilitan por completo en vez de acotarlos);
- schema seguro, sin tags custom;
- serialización determinista: las claves se ordenan (misma
  canonicalización que `revisionHash`) antes de pasar el objeto a
  `stringify`, para que la salida no dependa del orden de inserción.

Pipeline (`scripts/build-runtime.mjs`):

```
schemas JSON -> Ajv standalone ESM (strict, allErrors, code.source, code.esm)
             -> esbuild (bundlea runtime + "yaml" + validadores generados)
             -> runtime/dist/shipping-mode.mjs
```

- `ajv`, `esbuild` y `yaml` son dependencias fijadas en
  `package-lock.json` (`yaml` es dependencia real de `runtime/src/**`;
  `ajv`/`esbuild` son solo herramientas de build). El paso de bundling
  hace que el artefacto final no dependa de `node_modules` en ningún
  punto: `runtime/dist/shipping-mode.mjs` incluye el parser YAML y los
  validadores inline. El workspace del usuario final nunca ejecuta
  `npm install` (ADR-0002).
- Verificación determinista: `npm ci` + regenerar no debe cambiar
  `runtime/src/generated/**` ni `runtime/dist/shipping-mode.mjs`.
- `runtime/src/lib/schema.mjs` es la única fachada pública:
  `validate(schemaName, data) -> { valid, errors }`. El dominio nunca
  importa Ajv, `yaml`, ni `runtime/src/generated/**` directamente fuera
  de esa fachada (y del módulo de parsing YAML equivalente).

## 10. Máquina de estados de `operation` / `change-set`

Estados (`operation.yml.status`):

```
PROPOSED -> VALIDATED -> APPROVED -> APPLYING -> APPLIED
```

Terminales de error: `INVALID`, `STALE`, `RECOVERY_REQUIRED`. **No existe
`REJECTED`** en este corte: no hay comando `changeset reject`, y no se
mantiene un estado sin una transición real que lo produzca. La política
de rechazo/gobernanza queda para la futura configuración de
autonomía/gobernanza (§2.2).

Cada transición agrega `history: [{at, from, to, actor, reason}]`.

- **propose**: crea `operations/<id>/change-set.json` y `operation.yml`
  en `PROPOSED`. `baseRevisions` usa `{revisionHash, contentHash}` por
  archivo, con `ABSENT`/`ABSENT` para archivos que se espera no existan.
- **validate**: valida `payload` contra el schema vía
  `runtime/src/lib/schema.mjs` y recalcula `baseRevisions` contra el
  estado actual (ambos hashes). Falla el schema → `INVALID`. Alguna
  revisión ya cambió → `STALE`. Si no → `VALIDATED`.
- **approve `--actor` [`--allow-self-approval`]**: requiere `VALIDATED`.
  La auto-aprobación (`actor === proposedBy`) está **permitida** en este
  corte (no hay separación de roles todavía — eso es gobernanza futura,
  §2.2), pero debe declararse explícitamente con `--allow-self-approval`
  y quedar registrada:
  ```yaml
  approval:
    actor: ...
    approvedAt: ...
    changeSetHash: ...
    selfApproval: true|false
  ```
  Si `actor === proposedBy` y no se pasó `--allow-self-approval`, falla
  con un error explícito (no se aprueba implícitamente en ningún caso).
- **apply `--actor`**: requiere `APPROVED`. Ver secuencia durable en §12.

## 11. Workspace lock

`baseRevisions` por sí solo no evita una carrera del tipo
`verify base → verify base → apply → apply` entre dos procesos. Se agrega
un lock de exclusión mutua sobre todo el workspace:

```
.planning/.runtime/workspace.lock/
```

Adquisición atómica vía `mkdir` (falla con `EEXIST` si ya está tomado),
seguida de una escritura síncrona de metadata dentro del directorio:

```yaml
token: <random>
pid: <pid>
hostname: <hostname>
startedAt: <iso>
operationId: <uuidv7|null>
```

Se adquiere antes de: recovery, `validate`, `approve`, `apply`, y
cualquier operación que modifique `operation.yml`. **Nunca** antes de
`--help`, `--version`, `check schema` (§13, query-only).

Manejo de lock activo/abandonado:

- Lock con `hostname` distinto al actual → nunca se rompe
  automáticamente; error explícito indicando qué host lo sostiene.
- Lock con `hostname` igual y `pid` vivo (`process.kill(pid, 0)` no
  lanza `ESRCH`) → nunca se rompe automáticamente; error explícito de
  "lock en uso".
- Lock con `hostname` igual y `pid` muerto → se considera abandonado por
  un crash; se rompe de forma segura y se registra el evento.
- Lock cuyo directorio existe pero sin metadata válida (crash entre
  `mkdir` y la escritura de metadata) → tratado igual que "otro host":
  no se rompe automáticamente, error explícito para resolución manual.

Después de adquirir el lock, `apply` **vuelve a verificar** `baseRevisions`
(ambos hashes) de forma autoritativa antes de continuar — la verificación
previa a pedir el lock es solo un fail-fast optimista.

Test dedicado: dos procesos concurrentes intentando `apply` sobre la
misma base — el resultado debe ser siempre uno de dos desenlaces seguros
(uno aplica y el otro falla por lock-en-uso, o uno aplica y el otro falla
`STALE` tras adquirir el lock después), nunca doble aplicación ni
corrupción.

## 12. Secuencia durable de `apply`

`apply` **no es atómico como conjunto multiarchivo** — cada `rename()` es
atómico por archivo, pero una operación de varios archivos es
**crash-consistent**, no transaccional: durante `APPLYING` puede existir
temporalmente un estado parcialmente aplicado, resuelto por recovery
idempotente. Ningún documento, nombre de test o criterio de cierre debe
prometer atomicidad transaccional multiarchivo.

Secuencia exacta:

1. Adquirir el workspace lock (§11).
2. Ejecutar un barrido de recovery global (§13) sobre cualquier otra
   operación que esté en `APPLYING`.
3. Revalidar, bajo el lock: schema, `baseRevisions`
   (`revisionHash` + `contentHash`) y `changeSetHash` contra el estado
   actual — autoritativo, no solo el chequeo optimista previo.
4. Preparar `.runtime/operations/<id>/before/` (snapshot de contenido
   solo para archivos que existen actualmente — nada se escribe para los
   que se esperan `ABSENT`) y `staged/` (contenido nuevo renderizado
   para todos los archivos objetivo).
5. Persistir en `operation.yml` el `filePlan` (uno por archivo) y
   `expectedEvents` (IDs y metadata de evento fijados **antes** de tocar
   cualquier archivo canónico):
   ```yaml
   filePlan:
     - target: config.yml
       stagedRelativePath: config.yml
       expectedBefore: ABSENT
       beforeContentHash: ABSENT
       beforeRevisionHash: ABSENT
       stagedContentHash: <sha256>
       stagedRevisionHash: <sha256>
   expectedEvents:
     - eventId: <uuidv7>
       type: workspace.initialized
       idempotencyKey: <string>
       relativePath: <yyyy>/<mm>/<uuidv7>.json
   ```
6. Transición `APPROVED -> APPLYING` (escritura durable en disco antes de
   tocar `.planning/config.yml` et al.).
7. Aplicar cada archivo mediante `rename()` desde `staged/` a su ruta
   canónica. **Nota:** `rename()` consume/mueve el archivo de origen —
   `staged/<f>` deja de existir tras un rename exitoso. Por eso el
   `filePlan` persiste los hashes esperados (paso 5): recovery nunca
   depende de que `staged/` siga conteniendo el archivo.
8. Escribir `result.json` (archivos tocados + hashes nuevos).
9. Escribir los eventos esperados de forma idempotente, usando los IDs
   fijados en el paso 5 (nunca se generan IDs nuevos aquí): si el archivo
   del evento no existe se crea; si existe con el mismo `contentHash` se
   considera completado; si existe con contenido distinto, la operación
   pasa a `RECOVERY_REQUIRED` (un evento corrupto/alterado es una
   violación de integridad, nunca se resuelve en silencio).
10. Transición `APPLYING -> APPLIED`; liberar el lock; limpieza
    oportunista de `.runtime/operations/<id>/` (§13).

## 13. Recovery

Corre al inicio de cualquier comando mutante (`propose`, `validate`,
`approve`, `apply`), **después** de adquirir el workspace lock (§11).
**Nunca** corre como efecto secundario de `--help`, `--version` o
`check schema` — esos comandos son estrictamente query-only; `check
schema` puede *reportar* operaciones en `APPLYING` o
`RECOVERY_REQUIRED`, pero nunca las modifica.

Para cada operación en `APPLYING`, y para cada entrada de su `filePlan`
persistido (§12 paso 5), se calcula el `contentHash` actual del archivo
canónico (o `ABSENT` si no existe) y se clasifica contra lo persistido
—nunca contra el contenido todavía presente en `staged/`, que puede ya
haber sido consumido por un `rename()` previo—:

| Condición (hash canónico actual vs. `filePlan` persistido) | Clasificación | Acción |
|---|---|---|
| == `stagedContentHash` | ya aplicado | no-op para este archivo |
| == `beforeContentHash` **y** `staged/<f>` existe con hash == `stagedContentHash` | pendiente | repetir `rename()` desde `staged/` |
| == `beforeContentHash` **pero** `staged/<f>` falta o su hash no coincide | conflicto | `RECOVERY_REQUIRED` |
| cualquier otro valor | modificación divergente | `RECOVERY_REQUIRED` |

Ante `RECOVERY_REQUIRED`: se registra el conflicto en `operation.yml`
(`conflict: {detectedAt, file, expectedBeforeContentHash,
expectedStagedContentHash, actualContentHash}`), y la invocación normal
se detiene con un error explícito y evidencia suficiente para resolución
manual. Recovery solo completa pasos pendientes (7 a 10 de §12); nunca
revierte ni sobrescribe estado divergente en silencio.

Una vez que todos los archivos de una operación quedan clasificados como
"ya aplicado", recovery completa idempotentemente los pasos restantes
(`result.json` si falta, eventos si faltan, transición a `APPLIED`),
usando el actor `system:recovery`.

**Limpieza de `.runtime/operations/<id>/`**: se limpia después de que la
operación llega a `APPLIED`. Si el proceso cae después de `APPLIED` pero
antes de completar la limpieza, la siguiente invocación puede eliminar
los residuos de forma segura e idempotente (el registro permanente vive
en `operations/<id>/{operation.yml,change-set.json,result.json}` y en
`events/`; `.runtime/` es enteramente prescindible una vez `APPLIED`).

## 14. Confinamiento de paths

Dos dominios distintos, con raíces y reglas diferentes — la Sección 10 de
la revisión 1 de este documento los confundía incorrectamente en uno
solo:

### 14.1 Destinos de mutación del runtime

Todo destino que el runtime escribe (`staged/`, `before/`, la ruta final
de cada `rename()`, `operations/**`, `.runtime/**`) debe permanecer
estrictamente contenido dentro de `.planning/`.

### 14.2 Paths referenciados por un scope

Los paths que un `scope` referencia (`config scope add --path <path>`)
apuntan al workspace del proyecto y **normalmente están fuera de
`.planning/`** — por ejemplo `web/`, `api/`, `agents/`, `docs/` son
válidos y esperados. Para estos, la raíz de confinamiento es el
workspace del proyecto (el directorio que contiene `.planning/`), y se
rechaza:

- rutas absolutas;
- `../` que escape del workspace;
- symlinks que resuelvan fuera del workspace;
- paths que apunten dentro de `.planning/` (un scope referencia código
  del producto, no el plano de control).

### 14.3 Resolución segura para destinos que todavía no existen

En ambos dominios, cuando el path de destino puede no existir todavía, no
se usa `realpath()` directamente sobre el destino completo (fallaría o
sería ambiguo). En su lugar:

1. Normalizar textualmente el path solicitado y rechazar de inmediato si,
   ya normalizado, no queda contenido bajo la raíz correspondiente.
2. Caminar segmento por segmento desde la raíz. Para cada prefijo que sí
   existe en disco, `lstat()` ese segmento; si es un symlink, resolverlo
   y verificar que el destino resuelto siga contenido en la raíz
   (rechazar si no, incluso a través de symlinks encadenados).
3. Detenerse en el primer segmento que no existe (`ENOENT`) — no se
   intenta `lstat`/`realpath` sobre el resto, que ya fue validado
   textualmente en el paso 1.
4. El path queda confinado solo si todos los prefijos existentes pasaron
   la verificación de symlink del paso 2 y el path final normalizado cae
   dentro de la raíz.

## 15. Skills

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

## 16. Plan de testing

- **Unit** (`runtime/src/lib/{ids,canonical,schema,changeset,journal,lock,paths}.mjs`):
  generación/validación UUIDv7; `revisionHash` vs `contentHash` (casos
  donde solo el formato cambia pero no el contenido semántico, y
  viceversa); `changeSetHash` excluye `hash`; `ABSENT` como valor de
  campo nunca como contenido de archivo; auto-aprobación explícita
  (`selfApproval: true/false`, rechazo si falta el flag); clasificación
  de recovery contra el `filePlan` persistido (ya aplicado / pendiente /
  conflicto / divergente), incluyendo el caso donde `staged/` ya fue
  consumido por un `rename()` previo; prevención de eventos duplicados;
  confinamiento de paths en ambos dominios (14.1 y 14.2), incluyendo
  resolución segura de destinos inexistentes (14.3); unicidad
  case-insensitive de `scopeRefs[].key`.
- **Lock/concurrencia**: dos procesos reales concurrentes ejecutando
  `apply` sobre la misma base — verificar que el resultado sea siempre
  uno de los dos desenlaces seguros descritos en §11, nunca corrupción ni
  doble aplicación; lock abandonado por proceso muerto en el mismo host
  se rompe; lock de otro host u otro proceso vivo nunca se rompe
  automáticamente.
- **YAML**: rechazo de claves duplicadas; `maxAliasCount: 0` rechaza
  alias/anchors; serialización determinista (mismo objeto → mismos
  bytes, independiente del orden de inserción).
- **Schema/build**: los 7 schemas compilan; casos válidos/inválidos por
  schema; `npm ci` + regeneración no cambia `runtime/src/generated/**` ni
  `runtime/dist/shipping-mode.mjs`; el bundle final corre sin
  `node_modules` y contiene el parser YAML inline (no solo los
  validadores); no quedan referencias a `ajv/dist/runtime` ni imports
  externos en el artefacto.
- **CLI e2e** (spawn real de `bin/shipping-mode.mjs`, contra el bundle en
  `runtime/dist/shipping-mode.mjs`, no in-process): camino feliz
  `init -> validate -> approve -> apply -> check schema`; `apply` sin
  aprobación falla; `STALE` si un archivo cambia entre `validate`/
  `approve` y `apply`; `check schema` no muta nada y reporta operaciones
  `APPLYING`/`RECOVERY_REQUIRED` sin tocarlas; `NOT_IMPLEMENTED` con
  contrato y exit code exactos para todo lo de §2.2; alta de scope
  concurrente con la misma `key` — una tiene éxito, la otra falla
  `STALE` o por unicidad.
- **Matriz de crash durable** (simulando falla justo después de cada
  paso de §12, contra la clasificación de §13): tras (1) crear `before/`,
  (2) crear `staged/`, (3) persistir `filePlan`+`expectedEvents`, (4)
  pasar a `APPLYING`, (5) aplicar el primer archivo, (6) aplicar todos
  los archivos, (7) escribir `result.json`, (8) escribir el primer
  evento, (9) escribir todos los eventos, (10) antes de pasar a
  `APPLIED`. Cada punto debe demostrar recuperación idempotente o
  transición segura a `RECOVERY_REQUIRED`, sin duplicar eventos ni
  sobrescribir contenido divergente. Incluye además limpieza segura de
  `.runtime/operations/<id>/` cuando el crash ocurre después de
  `APPLIED` pero antes de la limpieza.
- **Regresión** (sin cambios de comportamiento esperados):
  `hooks/tests/protect-planning-state.test.mjs`,
  `scripts/tests/verify-next-generation.test.mjs`,
  `spikes/tests/verify-corte-1.2.test.mjs`,
  `spikes/host-integration/tests/host-integration.test.mjs`.
  `src/tests/vertical-slice.test.mjs` se reemplaza (ya no puede afirmar
  que `release/item/task/...` "pasan") y se relocaliza bajo `runtime/`;
  se actualiza la línea correspondiente en
  `scripts/verify-next-generation.sh`.

## 17. Definition of Done de este pase

- [ ] Todos los tests nuevos/actualizados (unit, lock/concurrencia, YAML,
      schema/build, CLI e2e, matriz de crash, confinamiento) pasan.
- [ ] Las suites de regresión existentes siguen pasando sin cambios de
      comportamiento.
- [ ] `.planning/**` sigue protegido contra escritura directa.
- [ ] Ningún comando fuera de alcance tiene una ruta silenciosa o parcial:
      todos responden `NOT_IMPLEMENTED` con contrato y exit code
      verificados por test.
- [ ] `README.md` y este documento reflejan con precisión qué cubre esta
      fundación y qué queda como iteración obligatoria siguiente
      (descubrimiento de git/scopes/guides, autonomía, release/item/
      work-package/task, `check health/guides/gates`, `report`,
      gobernanza de aprobación).
- [ ] Ningún texto afirma atomicidad transaccional multiarchivo; el
      lenguaje usado es "crash-consistent con recovery idempotente".
- [ ] Ningún texto afirma que existe separación obligatoria
      proponente/aprobador: la auto-aprobación está permitida y marcada
      explícitamente (`selfApproval`), la gobernanza es trabajo futuro.
- [ ] El bundle `runtime/dist/shipping-mode.mjs` corre sin `node_modules`
      y sin imports externos verificables.
- [ ] Corte 0 **no** se marca como cerrado/terminado en ningún documento.

## 18. Explícitamente fuera de alcance (iteración obligatoria siguiente)

Ver §2.2. Debe quedar registrado en el README y en el índice de docs como
trabajo pendiente obligatorio, no opcional.
