---
description: Rebuild the cross-project code index and its semantic vectors, so "have I already written this?" is answerable
argument-hint: "[--fast]"
---

# Rebuild the cross-project code index

Run:

```bash
node ~/.claude/bin/graph-semantic.mjs --build
```

That refreshes three things in order: the symbol index (`graph-find.mjs --build`, ~0.1 s), the
comment corpus (`graph-docs.mjs --build`, ~0.5 s), and the semantic vectors (~2-3 min, and on the
very first run it creates an isolated python environment and downloads a ~130 MB model).

With `--fast`, run only the first two and skip the vectors — name lookup and full-text search stay
current, meaning-based search keeps answering from the previous build.

Report: how many symbols were indexed, how many carried a comment, and how long the embedding took.

## When to offer this WITHOUT being asked

Only when **both** hold:

1. This machine runs ultrapowers or GSD-Core — check for `~/.claude/plugins/cache/ultrapowers`
   or `~/.claude/gsd-core`. On a plain install nobody is closing phases and the index has no
   reader worth the two minutes.
2. The session has just passed a verification gate or closed a phase — a merged branch, a green
   verification step, a phase marked complete. That is when a batch of new code became permanent
   and the index is furthest behind.

Never offer it mid-task, never during debugging, and never twice in one session. Outside those
two conditions, wait to be asked.

## What each surface answers

| Question | Command |
|---|---|
| "where is X", exact name | `node ~/.claude/bin/graph-find.mjs "X"` |
| "have I written something that does X" | `node ~/.claude/bin/graph-semantic.mjs "X"` |
| Anything about the current repo | `graphify query "<question>"` |
