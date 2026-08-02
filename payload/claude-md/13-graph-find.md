## CROSS-PROJECT CODE LOOKUP
- **By name** — "where is X", "who else has a function called X":
  `node ~/.claude/bin/graph-find.mjs "<symbol>"`. ~200 ms across every repo on this machine.
  The index refreshes after each commit's sync; `--build` forces it.
- **By meaning** — "have I already written something that does X?": `ctx_search` over the
  corpus that `node ~/.claude/bin/graph-docs.mjs --build` writes to
  `~/.graphify/global-docs.md`, indexed once with `ctx_index`. It carries the comment above
  each code symbol, so it finds work whose name you cannot guess. About one symbol in five
  has a comment; the rest are name-only, so fall back to `graph-find`. Matching is lexical:
  a query whose keyword is common in an unrelated domain will surface that domain instead.
- **Current repo** — `graphify query "<question>"`.
