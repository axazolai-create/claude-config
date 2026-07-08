---
paths:
  - "**/*.sh"
  - "**/*.bash"
  - "**/*.ps1"
---

# Shell (bash + PowerShell)
## bash
- Start with `set -euo pipefail`; quote all expansions (`"$var"`).
- Idempotent and re-runnable; guard before mutating system state.
- `command -v` to check deps; fail with a clear message if missing.
- Prefer functions + a `main`; `trap` cleanup on `EXIT`. Keep it shellcheck-clean.
## PowerShell
- `Set-StrictMode -Version Latest`; `$ErrorActionPreference = 'Stop'`.
- Approved verbs for functions; `[CmdletBinding()]` + typed params; support `-WhatIf`
  for destructive ops.
## both
- No secrets inline; read from env or prompt. Log what changed.
- Avoid: unquoted vars, parsing fragile command output, partial-failure-with-exit-0.
