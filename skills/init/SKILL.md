---
description: Initialize a Shipping Mode project context.
argument-hint: --name <name> [--base-branch <branch>] [--vcs git|none]
disable-model-invocation: true
allowed-tools: Bash(shipping-mode init:*), Bash(shipping-mode changeset validate:*), Bash(shipping-mode changeset approve:*), Bash(shipping-mode changeset apply:*)
---

Run `shipping-mode init --name <name> --vcs <git|none> --actor <actor>` to
propose the workspace bootstrap ChangeSet, then
`shipping-mode changeset validate <operation-id>`,
`shipping-mode changeset approve <operation-id> --actor <actor> --allow-self-approval`,
and `shipping-mode changeset apply <operation-id> --actor <actor>` to create
`config.yml`, `plugin.lock.yml`, and `.gitignore`. Do not write
`.planning/**` directly.
