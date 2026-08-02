## CROSS-PROJECT CODE LOOKUP
- **By name** — "where is X": `node ~/.claude/bin/graph-find.mjs "<symbol>"`, ~200 ms across
  every repo on this machine. The index refreshes after each commit's sync.
- **By meaning** — "have I already written something that does X?":
  `node ~/.claude/bin/graph-semantic.mjs "<question>"`, ~1 s. Finds work whose name you cannot
  guess. Needs `/graphify-build-docs` to have run at least once.
- **Current repo** — `graphify query "<question>"`.
- Offer `/graphify-build-docs` unprompted ONLY on a machine running ultrapowers or GSD-Core, and
  only right after a verification gate or a closed phase. Never mid-task, never twice a session.
