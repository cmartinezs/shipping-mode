# Propuesta de rediseno next-generation

Fecha: 2026-07-22

## Objetivo

Reordenar el plugin bajo una identidad nueva y reconocible. El producto next-generation `1.0.0` es una implementacion nueva, no una version compatible del plugin 3.x. La unidad publica de entrega es la release, sin convertirla en una coleccion de comandos sueltos ni en una base de datos Markdown. `v4` es solo etiqueta historica de la iniciativa.

```text
project context -> release -> release item -> scope work package -> task
```

El Release Item representa una unidad entregable tipada: user story, capability, defect, enabler, spike, compliance, migration u operational work. Cuando un item afecta varios frentes, no se divide en "historias hermanas"; se conserva como un solo item y se descompone en work packages por scope. Cada work package contiene el diseno, contratos, riesgos, gates, referencias de guia y tasks tecnicas del scope propietario.

El flujo publico debe ser mas claro, con menos comandos visibles, una identidad estable, estado canonico estructurado, Markdown como proyeccion humana y trabajo mecanico delegado a un runtime determinista.

La superficie publica deja de usar prefijos genericos `claude-*` o `plan-*`. La API usa exclusivamente la composicion `plugin name + skill name`, por ejemplo `/<plugin-name>:init`.

El producto next-generation es un producto nuevo `1.0.0`. `v4` queda unicamente como etiqueta historica de la iniciativa y no representa una version publicable.

## Orden de lectura

1. [Diagnostico](00-diagnostico.md)
2. [Arquitectura objetivo](01-arquitectura-objetivo.md)
3. [Mapa de comandos y skills](02-mapa-comandos-skills.md)
4. [Plan incremental](03-plan-incremental.md)
5. [Configuracion inicial del proyecto](04-release-init-configuracion.md)
6. [Guias por scope para tasks y tests](05-scope-task-guides.md)
7. [Eliminacion legacy](06-eliminacion-legacy.md)
8. [Estructura completa del plugin next-generation](07-estructura-plugin-v4.md)
9. [Corte -1.1: contratos residuales del runtime](08-corte-1-1-contratos-runtime.md)
10. [Corte -1.2: spikes de producto y runtime](09-corte-1-2-spikes-producto-runtime.md)
11. [Corte -1.2: contratos de ejecucion y cierre](10-corte-1-2-contratos-ejecucion.md)

## Tesis corregida

El plugin no necesita mas comandos de primer nivel. Necesita un runtime con:

- modelo de dominio explicito;
- schemas para config, lock, scopes, releases, release items, work packages, tasks, ChangeSets, operaciones, eventos y guias;
- protocolo `inspect -> propose -> validate -> approve -> stage -> apply -> verify -> record`;
- launcher estable que resuelve instalacion, template pack, schemas y workspace;
- scripts deterministas que leen y mutan estado estructurado;
- skills finas que orquestan, piden aprobacion y acotan el trabajo no determinista;
- decisiones humanas cuando hay ambiguedad real de producto, alcance, arquitectura o release.

La propuesta reduce el flujo publico diario a skills canonicas `init`, `config`, `release`, `item`, `task`, `check`, `report` y `decision`, con `update` como comando de mantenimiento del plugin/template pack. La forma visible final depende del namespace real del plugin y debe cerrarse con el [Corte -1.2](09-corte-1-2-spikes-producto-runtime.md). Los comandos actuales son material de referencia para rescatar capacidades, no API que deba conservarse.

La segunda revision experta aprueba avanzar al Corte -1, pero exige cerrar antes el [Corte -1.1](08-corte-1-1-contratos-runtime.md): fuente unica de scopes, guias YAML ejecutables, Release Items tipados, IDs distribuidos, eventos por archivo, revisiones por agregado, atomicidad multiarchivo, launcher raiz y bundle self-contained.

La quinta revision cierra las decisiones de producto: producto nuevo `1.0.0`, Node.js 20+, UUIDv7, display IDs deterministas e inmutables y relaciones padre-hijo inmutables. El [Corte -1.2](09-corte-1-2-spikes-producto-runtime.md) queda para ejecutar spikes y reunir evidencia, no para reabrir estas alternativas.

La cuarta revision aprueba ejecutar el Corte -1.2, pero aclara que documentar spikes no equivale a resolverlos. Antes del vertical slice productivo deben quedar cerrados los contratos de [ejecucion y cierre](10-corte-1-2-contratos-ejecucion.md): permisos de skills, launcher interno versus CLI externa, limites de agregados, lifecycle de display IDs, DSL formal, hashing RFC 8785, separacion Execution Context/Deployment Environment, state machine de operaciones y resultados verificables de cada spike.
