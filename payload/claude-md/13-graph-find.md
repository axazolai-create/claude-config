## CROSS-PROJECT SYMBOL LOOKUP
- "Have I written this before?" / "who else has a function like this?" →
  `node ~/.claude/bin/graph-find.mjs "<symbol>"`. Answers from an index of every repo on this
  machine in ~200 ms; the same question through `graphify explain --graph
  ~/.graphify/global-graph.json` takes ~4.5 s.
- Current-repo questions stay with `graphify query "<question>"`.
- The index refreshes itself after each commit's sync. `--build` forces a rebuild.
