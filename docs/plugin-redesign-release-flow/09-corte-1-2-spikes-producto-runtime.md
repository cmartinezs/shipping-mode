# Corte -1.2: spikes de producto y runtime

## Objetivo

La quinta revision mantiene el dominio `release -> release item -> scope work package -> task` y cierra producto nuevo `1.0.0`, Node.js 20+, UUIDv7, display IDs inmutables y parent inmutable. Los spikes documentados no son evidencia de resolucion; este corte se cierra solo con prototipos, fixtures, pruebas y ADRs.

Regla:

```text
No iniciar el vertical slice productivo hasta cerrar los spikes de este corte.
```

La validacion inicial no depende del CLI que los spikes deben construir:

```text
spikes/
  host-integration/
  runtime-node20/
  canonical-core/
  worktree-merge/
  transaction-recovery/
  integrated-prototype/
  verify-corte-1.2.mjs
```

Ejecutar durante el corte:

```text
node spikes/verify-corte-1.2.mjs
npm run verify:corte-1.2
```

Despues del prototipo integrado, agregar como regresion:

```text
<product-cli> check architecture --contract corte-1.2
```

## 1. Naming gate

`ARC Flow` y `arcflow` quedan como codename, no como marca aprobada.

Antes de modificar manifests, sitio, paquetes o binarios definitivos, validar:

- GitHub;
- npm;
- PyPI;
- crates.io;
- Homebrew;
- Chocolatey;
- dominios;
- marketplaces;
- buscadores;
- nombres de binarios instalables;
- marcas o productos relevantes.

Criterios:

- distintivo;
- corto;
- pronunciable;
- buscable;
- disponible;
- no atado exclusivamente a Claude;
- compatible con plugin y CLI;
- sin duplicacion incomoda con slash commands namespaced.

## 2. Namespace real de plugin

La API publica debe disenarse como composicion:

```text
plugin name + skill name
```

No asumir que una skill se vera como comando standalone. El host puede mostrar:

```text
/<product-name>:init
/<product-name>:config
/<product-name>:release
```

Por eso los nombres canonicos de skills deben ser cortos:

```text
skills/init/
skills/config/
skills/release/
skills/item/
skills/task/
skills/check/
skills/report/
skills/decision/
skills/update/
```

Las skills usan exclusivamente `/<plugin-name>:<skill-name>`; no existe una segunda convencion de namespace.

## 3. Runtime prerequisite

Un bundle JavaScript self-contained elimina `npm install`, pero no elimina Node.js.

Decision cerrada:

```text
bundle JavaScript self-contained + Node.js 20+ obligatorio
```

El launcher debe hacer preflight:

- `node` disponible;
- version minima;
- permisos de ejecucion;
- ruta del plugin root;
- mensaje de instalacion claro;
- salida JSON para skills.

## 4. Paths canonicos

Los IDs primarios distribuidos no bastan si el filesystem usa solo `display_id`.

Ejemplo de path canonico:

```text
releases/0190f1c8-5f11-7cc1-8bb2-2a45f8154ef2/
items/0190f1c8-6041-7d11-8bb2-2a45f8154ef3/
work-packages/0190f1c8-7131-7e01-8bb2-2a45f8154ef4/
tasks/0190f1c8-7a21-7e01-8bb2-2a45f8154ef5/
```

Opciones permitidas:

```text
releases/<uuidv7>/
items/<uuidv7>/
work-packages/<uuidv7>/
tasks/<uuidv7>/
```

El `display_id` y el slug son para lectura humana y proyecciones. Las referencias internas usan `id`.

## 5. Merge protocol

Evitar listas de hijos en padres como fuente canonica.

Preferir:

```yaml
# release-item.yml
release_id: 0190f1c8-5f11-7cc1-8bb2-2a45f8154ef2
```

En vez de:

```yaml
# release.yml
items:
  - 0190f1c8-6041-7d11-8bb2-2a45f8154ef3
  - 0190f1c8-6041-7d21-8bb2-2a45f8154ef6
```

Los indices de hijos son proyecciones regenerables. Operaciones que modifican padres requieren single writer, lock de agregado, reconciliacion explicita o nueva propuesta despues del merge.

## 6. Limite del ChangeSet

El ChangeSet controla obligatoriamente el control plane:

```text
.planning/**
policies
operations
events
approvals
state transitions
canonical metadata
```

El work product se registra como evidencia:

```text
src/**
tests/**
infra/**
product docs
configuration
```

El runtime no debe convertirse en editor universal de codigo. Puede generar templates, skeletons, documentacion o configuracion solo mediante operaciones explicitas y limitadas.

Ejemplo de evidencia:

```yaml
work_product:
  git_diff_hash: sha256:...
  commit_sha: ...
  changed_paths:
    - src/...
  verification_refs:
    - test-run:...
```

## 7. DSL de guias

YAML no basta si contiene lenguaje natural como regla ejecutable.

Las guias deben usar una DSL cerrada para:

- applicability;
- required sections;
- ordering;
- dependency;
- gate selection;
- evidence requirements;
- command selection;
- execution context selection;
- deployment environment selection.

Operadores permitidos iniciales:

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

Ejemplo:

```yaml
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

ordering:
  - predecessor_type: contract-check
    successor_type: real-api-connection
```

La narrativa puede vivir en `description`, pero no controla automatizacion.

## 8. Catalogos canonicos

Agregar storage canonico para conceptos transversales:

```text
.planning/
  concerns/
    security.yml
    accessibility.yml
  gates/
    unit-tests.yml
    threat-model.yml
    accessibility-review.yml
  gate-profiles/
    security-default.yml
    frontend-default.yml
  execution-contexts/
    local.yml
    ci.yml
    preview.yml
  environments/
    beta.yml
    staging.yml
    demo.yml
    production.yml
```

IDs de catalogo usan claves humanas validadas:

```text
web
unit-tests
security
deploy-beta
```

Entidades runtime usan IDs distribuidos:

```text
release
release item
work package
task
event
operation
```

## 9. Hashing canonico

Definir pipeline unico:

```text
YAML 1.2 seguro
-> objeto validado
-> eliminar campos no semanticos
-> canonical JSON RFC 8785
-> UTF-8
-> SHA-256
```

Rechazar:

- claves duplicadas;
- custom tags;
- aliases peligrosos;
- anchors no permitidos;
- valores ambiguos;
- tipos implicitos de YAML 1.1.

Distinguir:

```text
content_revision
source_fingerprint
template_fingerprint
operation_hash
change_set_hash
render_hash
tree_hash
```

`revision` no puede incluir su propio campo `revision` en el hash.

El fingerprint de directorios debe declarar paths normalizados, orden lexicografico, politica de symlinks, exclusiones, interaccion con Git ignore y hash de contenido, como tree hash o manifest Merkle.

## 10. Eventos, operaciones y retencion

Decision inicial:

```text
YAML/JSON de agregados = estado canonico
eventos = auditoria inmutable
```

No implementar event sourcing completo en la primera version.

Storage operativo:

```text
.planning/events/              # auditoria versionable
.planning/operations/          # manifests resumidos, versionable segun policy
.planning/.runtime/            # staging, before, logs; gitignored
.planning/vendor/              # snapshots segun lock
```

Politica ejemplo:

```yaml
runtime:
  operation_retention_days: 7
  retain_failed_operations: true
  retain_before_snapshots: false
  event_retention: permanent
```

Debe existir mantenimiento para archive, purge y report sin romper locks ni evidencia requerida.

## 11. Reportes y renders

`check` es query-only.

`report` puede escribir solo si usa una operacion:

```text
<product-cli> report render propose
<product-cli> changeset apply 0190f1c8-4e39-7a21-8bb2-2a45f8154ef1
```

Status, readiness, release notes y traceability pueden salir a stdout sin mutar.

## 12. Trust model

La aprobacion no es una frontera criptografica si el agente puede ejecutar el launcher.

Declaracion requerida:

```text
El sistema provee guardrails, trazabilidad y human-in-the-loop cooperativo. No es una sandbox frente a un agente malicioso con acceso equivalente al usuario.
```

Refuerzos:

- confirmacion explicita;
- actor y sesion;
- texto de aprobacion;
- policy que prohiba autoapproval;
- challenge interactivo;
- hooks;
- deteccion de drift;
- permisos de filesystem cuando sea posible;
- auditoria de llamadas.

## 13. Estado y template de spikes

Estados permitidos:

```text
PLANNED
IN_PROGRESS
PASSED
FAILED
INCONCLUSIVE
DECISION_ACCEPTED_WITH_LIMITATIONS
```

```mermaid
stateDiagram-v2
    [*] --> PLANNED : plan_spike
    PLANNED --> IN_PROGRESS : start_spike
    IN_PROGRESS --> PASSED : pass_spike
    IN_PROGRESS --> FAILED : fail_spike
    IN_PROGRESS --> INCONCLUSIVE : classify_spike_inconclusive
    IN_PROGRESS --> DECISION_ACCEPTED_WITH_LIMITATIONS : accept_spike_with_limitations
    FAILED --> IN_PROGRESS : reopen_spike
    INCONCLUSIVE --> IN_PROGRESS : reopen_spike
    FAILED --> DECISION_ACCEPTED_WITH_LIMITATIONS : accept_spike_with_limitations
    INCONCLUSIVE --> DECISION_ACCEPTED_WITH_LIMITATIONS : accept_spike_with_limitations
    DECISION_ACCEPTED_WITH_LIMITATIONS --> IN_PROGRESS : reopen_accepted_limitation
    PASSED --> [*]
    DECISION_ACCEPTED_WITH_LIMITATIONS --> [*]
```

| Evento | Transicion | Motivo o guard |
|--------|------------|----------------|
| `plan_spike` | inicial -> `PLANNED` | La hipotesis, alcance, timebox y criterios quedan definidos. |
| `start_spike` | `PLANNED` -> `IN_PROGRESS` | Se inicia el prototipo dentro del timebox aprobado. |
| `pass_spike` | `IN_PROGRESS` -> `PASSED` | La evidencia cumple los criterios de aprobacion. |
| `fail_spike` | `IN_PROGRESS` -> `FAILED` | La hipotesis falla o un criterio obligatorio no se cumple. |
| `classify_spike_inconclusive` | `IN_PROGRESS` -> `INCONCLUSIVE` | La evidencia no permite una decision confiable. |
| `reopen_spike` | `FAILED` o `INCONCLUSIVE` -> `IN_PROGRESS` | Se autoriza un nuevo intento con alcance o mitigacion revisados. |
| `accept_spike_with_limitations` | `IN_PROGRESS`, `FAILED` o `INCONCLUSIVE` -> `DECISION_ACCEPTED_WITH_LIMITATIONS` | Solo si todos los criterios fallidos son `critical: false` o `waivable: true`; requiere ADR. |
| `reopen_accepted_limitation` | `DECISION_ACCEPTED_WITH_LIMITATIONS` -> `IN_PROGRESS` | Se cumple la condicion de reapertura registrada en el ADR. |

El Corte -1.2 no cierra si algun spike queda `PLANNED`, `IN_PROGRESS`, `FAILED` o `INCONCLUSIVE`.

Cada spike declara:

```yaml
critical: true
waivable: false
pass_criteria:
  - id: no-data-loss
    severity: critical
    waivable: false
```

`DECISION_ACCEPTED_WITH_LIMITATIONS` no puede utilizarse cuando falla un criterio `critical` con `waivable: false`. Los criterios de integridad, ausencia de perdida de datos, reproducibilidad de hashes, aislamiento de paths e idempotencia son siempre critical y no waivable.

Cada spike debe usar esta estructura:

```text
Hypothesis
Scope
Non-goals
Timebox
Prototype location
Reusable or disposable
Inputs
Fault model
Pass criteria
Fail criteria
Evidence
Decision record
Result
```

## 14. Spikes obligatorios

### Spike 1: Host integration

Validar manifest, namespace, discovery, autocomplete, help, `bin/` en PATH del Bash tool, plugin root, plugin data, reload y update.

### Spike 2: Runtime Node 20+

Adoptar Node.js 20+ obligatorio con bundle JavaScript self-contained. Debe cubrir Node ausente, version incompatible, binario colisionado, Windows, WSL2, Linux y macOS.

### Spike 3: Canonical core

Implementar UUIDv7, display ID determinista, canonical JSON RFC 8785, hashing, path normalization y evaluador DSL suficiente para atomizar sin Markdown ni LLM.

### Spike 4: Worktree merge

Probar create/create, edit/edit, delete/edit, supersede/edit e indices regenerables. No probar `move/edit`: las relaciones padre-hijo son inmutables.

### Spike 5: Transaction recovery

Fallar despues de staging, primer write, canonical state, antes del evento y despues de comando externo. Validar rollback, compensacion, retry, idempotencia y limpieza.

Cuando una operacion haya producido efectos parciales, debe transicionar a `COMPENSATING` o `MANUAL_INTERVENTION_REQUIRED`, segun exista o no una compensacion automatica segura.

### Spike 6: Integrated prototype

Ejecutar el flujo:

```text
init
-> release
-> item
-> work package
-> task
-> propose
-> validate
-> approve
-> apply
-> verify
-> check
-> report
```

El spike anterior de guia ejecutable queda integrado al Canonical Core o como prueba adicional del prototipo integrado.

## Criterios critical no waivable

| Spike | Criterios obligatorios |
|-------|------------------------|
| Canonical Core | hash reproducible, path normalization, unicidad de identidad y DSL determinista |
| Worktree Merge | ausencia de perdida de datos, ausencia de sobrescritura silenciosa e indices regenerables |
| Transaction Recovery | idempotencia, consistencia, recovery verificable y ausencia de corrupcion |
| Integrated Prototype | integridad del estado, ChangeSet obligatorio y audit trail |

Estos criterios se declaran `severity: critical` y `waivable: false` en el
manifest de cada spike. Un fallo critical bloquea el cierre del Corte -1.2.

## Criterio de salida

El Corte -1.2 se cierra solo si todos los spikes producen:

```text
S1 PASSED
S2 PASSED
S3 PASSED
S4 PASSED
S5 PASSED
S6 PASSED
```

- decisiones explicitas;
- contratos verificables;
- fixtures;
- pruebas automatizadas;
- evidencia de ejecucion;
- ADRs;
- documentacion actualizada;
- decision final de nombre/producto/versionado.
