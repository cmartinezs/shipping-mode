---
description: Check Shipping Mode schema validity, query-only.
argument-hint: schema
disable-model-invocation: true
allowed-tools: Bash(shipping-mode check schema:*)
---

Run `shipping-mode check schema` to validate `config.yml`, `plugin.lock.yml`,
and `scopes/**` against their JSON Schemas. Query-only: never mutates state,
never triggers recovery. Reports `NOT_INITIALIZED` if `.planning/` doesn't
exist yet. `release/item/work-package/task/report` and
`check health|guides|gates` are not implemented in Corte 0.
