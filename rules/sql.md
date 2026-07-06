---
paths:
  - "**/*.sql"
---

# SQL (Oracle + PostgreSQL)
- Always parameterize; never string-concatenate user input into SQL.
- State the dialect when it matters (Oracle vs PostgreSQL) — syntax/functions differ
  (`NVL`/`SYSDATE` vs `COALESCE`/`now()`, sequences, upsert).
- Explicit column lists, never `SELECT *` in app queries.
- Set-based over row-by-row; avoid correlated subqueries where a join/window works.
- DDL goes through reviewed, ordered migration scripts; no ad-hoc prod DDL.
- Index intentionally; check the plan (`EXPLAIN` / `EXPLAIN ANALYZE`) for hot queries.
- Avoid: implicit type/charset conversions, N+1 from app code, business logic in triggers.

## Live database access (connected DB sources / MCP)
- Any connected live database source (MCP DB connector, direct DB client, etc.) is
  READ-ONLY for schema/structure introspection by default — listing tables/columns/indexes,
  describing schema.
- No query beyond a plain `SELECT` may be executed against a connected live database — no
  INSERT/UPDATE/DELETE/MERGE/DDL/DCL/procedure calls/explicit transactions.
- Even a `SELECT` against a connected live database requires, every single time: (1) stating
  why the query is needed and what it does, and (2) explicit user approval before running.
- This holds even when an "auto" / bypass-permissions mode is active for the session — a
  blanket auto-approval mode never implies approval for a live-DB query. Ask regardless.
  (Caveat: this is advisory/prose — it cannot be a hard guarantee under bypassPermissions;
  true enforcement needs a PreToolUse hook.)
- Editing or reviewing a static `.sql` script file on disk is unaffected by this — it's about
  EXECUTING queries against a connected live database, not authoring/reading script files.
