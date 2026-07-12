---
paths:
  - "**/*.py"
  - "**/pyproject.toml"
  - "**/requirements*.txt"
---

# Python (base)
- Target 3.14. Type hints on all public functions; check with mypy/pyright.
- Tooling: uv for envs/deps (not bare pip). Lint+format with ruff
  (`ruff check` + `ruff format`). Run `uv run pytest` before commit.
- Explicit over implicit: no bare `except:`; catch specific exceptions; no mutable defaults.
- I/O at the edges; keep core logic pure and testable. No sync blocking calls in async paths.
- Logging via `logging`, not `print`, in anything non-trivial.
- Oracle: `oracledb`/`cx_Oracle` with a dict rowfactory; PostgreSQL: psycopg3.
- Avoid: wildcard imports, global mutable state, business logic in `__init__.py`.
