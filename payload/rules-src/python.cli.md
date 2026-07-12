---
paths:
  - "**/cli.py"
  - "**/__main__.py"
  - "**/scripts/**/*.py"
---

# CLI / automation (direction)
- Use typer/click for arg parsing; no hand-rolled `sys.argv` beyond trivial scripts.
- Exit codes are meaningful (0 ok, non-zero on failure); fail loud, not silent.
- Side-effecting ops (fs, network, db) are dry-runnable where feasible (`--dry-run`).
- Structured logging with a `--verbose` flag; no bare prints for diagnostics.
- Make scripts idempotent and re-entrant; check state before mutating.
- Avoid: hardcoded paths/hosts, destructive ops without confirmation, swallowed errors.
