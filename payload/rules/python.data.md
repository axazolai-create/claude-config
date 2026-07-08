---
paths:
  - "**/*.ipynb"
  - "**/{notebooks,pipelines,etl,jobs}/**/*.py"
---

# Data / ETL (direction)
- Pipelines are idempotent and re-runnable; no partial-state surprises on retry.
- Read from Oracle/PostgreSQL with parameterized queries; stream/batch large reads,
  don't load everything into memory.
- pandas: vectorize, avoid `iterrows`; set explicit dtypes; chunk big files.
- Separate extract / transform / load stages; log row counts and durations per stage.
- Secrets/connection strings in env or a vault, never in notebooks.
- Notebooks are for exploration; promote anything reused into a tested module.
- Avoid: hidden state across cells, unparameterized SQL, silent dtype coercion.
