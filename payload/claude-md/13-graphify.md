## CODEBASE KNOWLEDGE GRAPH (graphify)
- For architecture / "where is X / what connects X to Y" / cross-repo questions PREFER the
  code graph over grepping: global graph `~/.graphify/global-graph.json`, per-project
  `graphify-out/`. Query for the subgraph, never paste dumps.
- The CLI is the interface — there is no `/graphify` command and this bundle installs no
  graphify skill: `graphify query "<question>"`, `graphify path "A" "B"`,
  `graphify explain "X"`, and `graphify update <path>` after changing code. Setup and
  autosync are already automatic: `hooks/session-init.mjs` runs `graphify claude install`
  once per project (CLAUDE.md section + PreToolUse hooks) and keeps the global graph synced.
