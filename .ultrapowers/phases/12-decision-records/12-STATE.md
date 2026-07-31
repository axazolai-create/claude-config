---
phase: "12"
status: complete
action: null
tasks_done: 9
tasks_total: 9
branch: feat/decision-records
delivery: branch
depends_on: ["04"]
updated: 2026-07-31
---

# Phase 12 — decision-records — state

Implemented on `feat/decision-records`. The plan was written on 2026-07-28 and moved here from
`archive/plans/` when the phase was created, as the tree's own rule requires.

Shipped: `records-paths.mjs`, `risk-register.mjs`, `adr-lib.mjs` and `glossary-lib.mjs` in
`payload/bin/lib/`, the `risks`, `adr` and `glossary` CLIs, and a non-blocking
`decision-records-nudge.mjs` registered on `Bash`. The live register is normalised — 57 entries
in four sections with a regenerated contents — and three retrospective ADRs plus a glossary seed
the practice.

**Deployment is the user's keystroke, as always.** Task 9's deploy step was not run here; what
was verified instead is that every new file resolves into the shipped set for `base` and that no
`*.test.mjs` does.

The plan's measurements were stale by three phases and were re-taken before any parser was
written: 57 entries over 1178 lines, not 44 over 814. The first re-measurement was itself wrong
— it used `[A-Z]+` for the prefix and silently lost all six `NEO4J` entries — which is recorded
in the plan because it is the same mistake the cross-reference linter could have made.

Two defects were found by running tests rather than reading them. The nudge hook called `main()`
at import time, so importing one exported helper for a unit test blocked forever on an empty
stdin; it is guarded by `isMainModule` now. And `applyNuance` re-appended a migrated nuance on
every pass, so idempotence failed on the second run against real data.
