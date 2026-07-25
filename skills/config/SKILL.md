---
description: Configure a Shipping Mode project context and its scope catalog.
argument-hint: set --name <name> | scope add --key <slug> --label <label> --kind code|non_code --path <path>
disable-model-invocation: true
allowed-tools: Bash(shipping-mode config:*), Bash(shipping-mode changeset validate:*), Bash(shipping-mode changeset approve:*), Bash(shipping-mode changeset apply:*)
---

Use `shipping-mode config set --name <name> --actor <actor>` or
`shipping-mode config scope add --key <slug> --label <label> --kind code|non_code --path <path> --actor <actor>`
to propose a ChangeSet, then the same
`changeset validate/approve/apply` cycle as `init`. Do not write
`.planning/**` directly.
