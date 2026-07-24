# Git work execution contract

## Objetivo

Shipping Mode debe conservar las capacidades Git que hacen seguro y reproducible el trabajo asistido por agentes, pero sin imponer una estrategia de branching fija a todos los repositorios.

La frontera contractual es:

```text
Shipping Mode Git engine
        +
Host repository Git policy
        +
Scope/work execution guides
        =
Concrete Git workflow for a task/work package
```

Shipping Mode es propietario de la **mecanica Git segura**. El repositorio anfitrion es propietario de su **topologia, convenciones y estrategia Git**. Las guias por scope pueden **refinar** como esa policy se aplica al trabajo concreto, pero no redefinirla ni contradecirla silenciosamente.

## 1. Responsabilidades

### Shipping Mode — Git engine

El plugin/runtime debe implementar capacidades agnosticas y seguras para:

- detectar si el workspace usa Git;
- descubrir repository root, branch actual, remotes, upstreams y worktrees;
- consultar `status`, `diff`, `rev-parse`, commits y relaciones entre refs;
- crear/cambiar branches cuando la policy lo permita;
- crear, reutilizar y limpiar worktrees cuando la policy lo requiera;
- stagear cambios intencionalmente;
- crear commits con metadata/evidencia asociada;
- hacer push cuando la policy/autonomia lo permita;
- crear pull/merge requests mediante el provider configurado;
- verificar que source/target branch coincidan con la policy del host;
- registrar branch, worktree, commit SHA, remote, PR/MR y checks como evidencia estructurada;
- detectar working tree sucio, cambios ajenos y divergencia antes de mutar;
- evitar perdida de cambios y escrituras fuera del workspace permitido;
- coordinar concurrencia y worktrees sin asumir que existe un unico checkout;
- tratar operaciones Git mutantes como operaciones controladas por policy y aprobacion;
- no ejecutar pasos Git cuando `git.enabled: false`.

Shipping Mode **no** debe hardcodear una unica receta global del tipo `crear feature branch -> commit -> PR -> merge`.

### Repositorio anfitrion — Git policy

El host define, directa o indirectamente:

- branch de trabajo/base;
- branch de integracion;
- branch productiva;
- lanes como `main`, `hotfix`, `release`, `mobile` u otras;
- de que branch nacen ramas auxiliares;
- naming/pattern de branches;
- unidad de branch: task, work package, release item, release o manual;
- si se usan worktrees y a que granularidad;
- granularidad esperada de commits;
- reglas de commit message/signing cuando existan;
- target de PR/MR para trabajo normal;
- ruta de promocion entre branches estables;
- estrategia de merge (`merge`, `squash`, `rebase`, provider default u otra);
- si push/PR/merge pueden automatizarse;
- checks/gates requeridos antes de abrir o mergear un PR;
- restricciones de branch protection;
- ownership/review requirements.

Estas reglas pueden descubrirse desde `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, developer guides, CI/CD, CODEOWNERS, branch protection/provider metadata u otras fuentes host registradas en el Host Repository Contract.

### Scope/task guides — refinamiento operacional

Las guides pueden concretar decisiones permitidas por la Git policy global, por ejemplo:

- una branch por work package o por task;
- una task debe producir un commit atomico;
- varias tasks del mismo work package comparten branch/worktree;
- un scope requiere squash antes de integrar;
- determinados task types exigen PR temprano antes de continuar;
- checks adicionales del scope antes de push/PR.

Una guide no puede:

- cambiar la branch productiva/integracion del proyecto;
- enviar trabajo a un target distinto del permitido por la Git policy;
- saltarse branch protection, approvals o gates;
- cambiar una estrategia global sin decision/config aprobada.

## 2. Project Context Git policy

La configuracion aprobada debe modelar la estrategia sin duplicar innecesariamente las fuentes host originales.

Ejemplo conceptual:

```yaml
git:
  enabled: true
  provider: github

  branches:
    work_base: develop
    integration: develop
    production: master

  work:
    branch_unit: work_package
    branch_pattern: "<type>/<slug>"
    reuse: within_work_package

  worktrees:
    mode: optional
    unit: work_package
    cleanup: after_integration

  commits:
    granularity: task
    message_policy: host_defined

  pull_requests:
    enabled: true
    work_target: develop
    draft_by_default: true
    merge_strategy: host_default
    promotion:
      source: develop
      target: master

  automation:
    create_branch: allowed
    create_worktree: allowed
    commit: allowed
    push: approval_required
    create_pr: approval_required
    merge_pr: approval_required
```

Los nombres anteriores son modelo de dominio, no una policy obligatoria. Un repo puede usar `main`, trunk-based development, release branches, GitLab, Azure DevOps o incluso Git deshabilitado.

### Configuracion explicitamente aprobada vs discovery

Discovery propone. La configuracion aprobada decide que policy usa Shipping Mode.

Precedencia:

```text
explicit approved Project Context Git policy
    > unresolved automatic inference
```

Pero provenance debe conservar las fuentes host que justifican cada regla.

Si fuentes host autoritativas entran en conflicto y la policy no puede resolverse deterministicamente, Shipping Mode debe registrar gap/decision pendiente y bloquear automatizacion Git mutante dependiente de esa conclusion.

## 3. Query operations vs mutating operations

### Query-only

Ejemplos:

```text
git status
git diff
git diff --cached
git rev-parse
git branch --show-current
git log
git show
git remote -v
git worktree list
provider PR/MR status queries
```

Pueden preaprobarse cuando el host permissions model lo permita y no cambien estado.

### Mutating

Ejemplos:

```text
git switch -c / checkout -b
git branch create/delete
git worktree add/remove
git add / restore --staged
git commit
git push
git merge
git rebase
git reset mutante
PR/MR create/update/merge
```

Estas operaciones se ejecutan solo mediante una policy resuelta, boundaries validados y el nivel de aprobacion/autonomia configurado.

Shipping Mode no debe preaprobar globalmente Git mutante desde una skill.

## 4. Task lifecycle y Git

El lifecycle de `task` pertenece a Shipping Mode:

```text
inspect -> start -> execute -> verify -> correction -> closeout
```

Git es un mecanismo subordinado a ese lifecycle, no el lifecycle mismo.

### `task inspect`

Debe resolver, sin mutar:

- task/work package/scope;
- Git policy aplicable;
- instruction hierarchy aplicable;
- branch/worktree actual;
- working tree status;
- cambios preexistentes o ajenos;
- branch/worktree esperado para la unidad de trabajo;
- gates que condicionan commit/push/PR.

### `task start`

Segun policy puede:

1. reutilizar branch/worktree valido existente;
2. proponer/crear branch desde la base configurada;
3. proponer/crear worktree aislado;
4. registrar el contexto Git asociado a la task/work package;
5. rechazar inicio si la base es incorrecta, existe divergencia peligrosa o hay cambios ajenos no resueltos.

No existe una regla global que obligue a crear una branch por task.

### Ejecucion y commits

La implementacion ocurre en el contexto Git resuelto. La policy/guide determina si:

- cada task termina en commit;
- varias tasks se acumulan en un commit del work package;
- commits parciales estan permitidos;
- la task solo produce working tree changes y el commit ocurre en otro stage.

Shipping Mode debe preservar trazabilidad entre task/work package y los commits resultantes.

### `task verify`

Antes de considerar integrable el trabajo debe verificar los gates aplicables y registrar evidencia.

La existencia de un commit no implica que la task este verificada.

### `task closeout`

Segun policy puede:

1. exigir working tree consistente;
2. crear/verificar commit final;
3. ejecutar push si esta permitido/aprobado;
4. crear o actualizar PR/MR cuando corresponda;
5. verificar source/target branch;
6. registrar URL/ID/commit/checks como evidencia;
7. limpiar worktree/branch solo cuando la policy y el estado de integracion lo permitan;
8. cerrar la task sin mergear si merge pertenece al lifecycle del work package/release.

Cerrar task, abrir PR y mergear PR son hechos distintos y no deben colapsarse en una sola transicion implicita.

## 5. Granularidad: task, work package, release item

Shipping Mode debe soportar al menos estas estrategias host sin imponer una:

### Branch por work package

```text
Release Item
  -> Work Package
       -> branch/worktree
            -> Task A -> commit
            -> Task B -> commit
            -> Task C -> commit
       -> PR
```

### Branch por task

```text
Task
  -> branch/worktree
  -> changes
  -> gates
  -> commit
  -> PR
```

### Branch compartida / integracion manual

```text
Work Package / Release Item
  -> existing host-managed branch
  -> tasks contribute commits
  -> integration managed by host policy
```

### Trunk-based

```text
short-lived branch or direct trunk contribution
  -> gates
  -> small commit
  -> provider/CI policy
```

El engine debe ser capaz de ejecutar la estrategia configurada; ninguna de estas topologias es universal.

## 6. Worktrees y concurrencia

El soporte de worktrees pertenece al Git engine porque resuelve aislamiento y concurrencia.

La policy host decide:

- si estan deshabilitados, permitidos u obligatorios;
- unidad de aislamiento (`task`, `work_package`, otra);
- location strategy;
- lifecycle/cleanup.

Guardrails minimos:

- nunca asumir que el workspace actual es el unico worktree;
- detectar la branch ya checkout en otro worktree;
- no eliminar worktree con cambios no integrados;
- no reutilizar un worktree para otra unidad si la policy exige aislamiento;
- registrar worktree path + branch + HEAD inicial/final como evidencia;
- validar base revision antes de integrar cambios.

## 7. Commits como evidencia, no como estado de dominio

Un commit es evidencia de work product, no la identidad ni el estado canonico de una Task.

La task/work package conserva referencias estructuradas como:

```yaml
git_evidence:
  branch: feature/example
  worktree: /path/to/worktree
  base_commit: abc123...
  commits:
    - sha: def456...
      role: task_delivery
  pull_request:
    provider: github
    id: 123
    url: https://...
    source: feature/example
    target: develop
```

No modelar el estado principal como `COMMITTED`, `PUSHED` o `PR_OPEN` si esos hechos pueden representarse como evidencia/metadata del lifecycle real.

## 8. Pull requests y promocion

Shipping Mode debe diferenciar:

```text
work integration
```

de:

```text
stable/productive promotion
```

Ejemplo de host policy:

```text
auxiliary branch -> develop

develop -> master
```

El primer flujo integra trabajo cotidiano. El segundo promociona un conjunto estable y puede exigir gates, approvals y evidencia distintos.

Shipping Mode no debe inferir que `master`/`main` es siempre productivo ni que el default branch es necesariamente el target del trabajo diario.

## 9. Provider integration

`provider: github|gitlab|azure-devops|none|custom` determina capacidades externas disponibles, pero la semantica base permanece agnostica:

- branch/ref;
- push remote;
- review request;
- checks/status;
- merge/promotion evidence.

Provider APIs complementan Git; no sustituyen el estado local ni las validaciones del runtime.

## 10. Aprobaciones y autonomia

Separar siempre:

```text
host tool permission
runtime approval
host Git policy
```

Una herramienta puede estar permitida por Claude Code y aun asi una operacion no estar autorizada por Shipping Mode.

Policy minima recomendada:

```yaml
approvals:
  git:
    create_branch: policy_driven
    create_worktree: policy_driven
    commit: policy_driven
    push: approval_required
    create_pr: approval_required
    merge_pr: approval_required
    destructive_rewrite: explicit_approval_required
```

Operaciones destructivas como force-push, reset que descarte cambios, branch deletion con trabajo no integrado o history rewrite requieren policy explicita; no deben derivarse de una autorizacion generica para ejecutar Git.

## 11. Host sources para Git policy

Discovery debe considerar, segun disponibilidad:

```text
CONTRIBUTING.md
README.md
AGENTS.md
CLAUDE.md
.github/copilot-instructions.md
developer guides
engineering standards
CI/CD workflows
CODEOWNERS
provider branch protection/rulesets
repository default branch metadata
existing branch/worktree conventions
```

El estado actual de Git demuestra estructura/existencia, pero no reemplaza una policy declarada. Si por ejemplo el default branch es `develop` pero una decision durable declara otro promotion flow, la contradiccion debe resolverse como drift/configuration decision.

## 12. Scope guide contract

`task-guide.yml` puede expresar refinamientos compatibles con la policy, por ejemplo:

```yaml
git_workflow:
  branch_unit: work_package
  commit_granularity: task
  require_clean_start: true
  open_pr_after:
    - work_package_verified
  required_gates_before_push:
    - build
    - unit-tests
```

Estas reglas deben tener provenance hacia las fuentes host que las originaron.

Si el project-level Git policy define `work_target: develop`, la guide no puede declarar `work_target: master`; eso es conflicto de autoridad y debe fallar validacion.

## 13. Invariantes

Shipping Mode debe mantener como invariantes propias:

1. no perder cambios del usuario;
2. no mezclar trabajo ajeno silenciosamente;
3. no mutar Git sin policy resuelta;
4. no ejecutar pasos Git cuando Git esta deshabilitado;
5. no asumir `main`/`master` como branch semantica universal;
6. no asumir default branch como work target;
7. no asumir branch por task;
8. no asumir que commit, push, PR y merge ocurren juntos;
9. validar source/target antes de push/PR/merge;
10. no saltar gates/approvals mediante comandos Git directos;
11. registrar evidencia suficiente para reproducir que trabajo termino en que branch/commit/PR;
12. detectar y manejar worktrees concurrentes;
13. no borrar branch/worktree con trabajo no integrado;
14. no force-push/rewrite history sin policy y aprobacion explicitas;
15. las skills no duplican recetas Git: invocan el runtime/policy evaluator.

## 14. Relacion con v3

Las capacidades de Git trabajadas en v3 no se eliminan; se separan correctamente:

```text
v3
plugin hardcodes workflow

next-generation
plugin Git engine
  + host Git policy
  + scope guide refinements
  + task lifecycle
```

Se rescatan la disciplina de branch/worktree, commits, validacion e integracion, pero dejan de ser decisiones globales embebidas en el plugin.

## 15. Definition of Done del contrato

Antes de considerar completa la implementacion Git del runtime deben existir fixtures/tests al menos para:

- `git.enabled: false`;
- default branch distinto de work target;
- integration y production branches distintas;
- auxiliary branch nacida desde base incorrecta;
- working tree limpio/sucio con cambios ajenos;
- branch ya checkout en otro worktree;
- branch por task;
- branch por work package;
- worktree por work package;
- commit por task;
- PR con target correcto/incorrecto;
- promotion PR distinta de work PR;
- provider sin API externa;
- push/PR bloqueados por approval;
- merge bloqueado por gate;
- cleanup seguro de worktree;
- recovery tras fallo entre commit, push y PR;
- evidencia Git reproducible en report/history.

El objetivo no es reconstruir un GitFlow fijo dentro de Shipping Mode, sino ejecutar de forma segura y trazable la estrategia Git real del repositorio anfitrion.
