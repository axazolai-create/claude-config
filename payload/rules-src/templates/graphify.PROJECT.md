<!-- BEGIN:graphify-project-rules -->
## Project Knowledge Graph (graphify)

This project has a local knowledge graph at `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`)
— separate from GSD's own `.planning/graphs/graph.json` if this is also a GSD project (two
unrelated tools; see `~/.claude/rules-src/gsd.md` § "graphify is two unrelated tools").

- For codebase questions, prefer `graphify query "<question>"` over raw grep once
  `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and
  `graphify explain "<concept>"` for a focused concept — these return a scoped subgraph
  instead of the full report.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source
  browsing. Read `GRAPH_REPORT.md` only for broad architecture review or when
  query/path/explain don't surface enough context.

### When to refresh (`graphify update .`)
Don't run it after every edit — only once the code has actually settled, so the graph
reflects reviewed/verified code rather than mid-edit churn:
- **GSD project** (`.planning/` exists, GSD plugin active): after `/gsd-code-review` passes
  (if `workflow.code_review` is enabled) and/or after `/gsd-verify-work` passes (if
  `workflow.verifier`/nyquist validation is enabled) — refresh at whichever of those gates
  actually runs for the phase; if both run, refresh once, after the later of the two.
- **No GSD** (no `.planning/`, or the GSD plugin isn't active this session):
  - Superpowers in use → refresh after its code-review skill completes
    (`superpowers:requesting-code-review` / `receiving-code-review`).
  - Superpowers not in use either → refresh after every commit.
- **Always, in addition to the above**: refresh after every commit the user makes directly
  (outside this session — manual `git commit` or IDE commit). Same reasoning as the global
  cross-project graph's native `post-commit` hook: manual/IDE commits aren't something a
  session-scoped rule can see happen, so don't assume they've already been covered.
<!-- END:graphify-project-rules -->
