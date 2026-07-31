---
phase: "11"
status: planned
action: planning
tasks_done: 0
tasks_total: 0
branch: null
delivery: null
depends_on: []
updated: 2026-07-31
---

# Phase 11 — protected-paths — state

Specified, not yet planned. `11-SPEC.md` is approved; the two questions phase 09 left open are
answered in it — `cp` is judged by direction with an unparseable command denied, and the
denial message is one text for every case.

One answer created a consequence worth reading before the plan: a `.protected` hidden by
`.gitignore` denies every write in its scope, which would lock its own repair, so `.gitignore`
and `.protected` files stay writable in that mode.
