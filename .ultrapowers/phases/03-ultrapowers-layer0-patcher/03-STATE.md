---
phase: "03"
status: superseded
superseded_by: "04"
tasks_done: 1
tasks_total: 10
branch: feat/ultrapowers-rework
delivery: merged
updated: 2026-07-31
---

# Phase 03 — ultrapowers-layer0-patcher — state

Superseded by phase 04, and not to be resumed. The approach — detect drift in the cached
upstream plugin and rewrite it in place — was disproved by execution, not by
argument. A full scan of the plugin found 1504 occurrences across 111 files in
382 distinct spellings, against the plan's baseline of 119 (measured over three
directories only). Deciding 382 variants by hand cost more than the problem the
patching was meant to avoid. Phase 04 onward replaced it: fork the upstream
plugin, rename inside a copy whose identity is ours to change.

This file read `status: abandoned` until 2026-07-31. That was false in the one way that
matters: nothing here was given up, the approach was replaced by one that shipped. The
status is `superseded` and carries `superseded_by: "04"`, because a `superseded` row whose
successor is named only in prose reads as abandoned again to every parser and most readers.
`superseded` and `delivery: merged` are both true and not in tension — which is the whole
point of separating the two fields.
Task 1 was a probe run with the user and its commits are in `master`
(`e9519bd..371941b`). Task 2 was implemented (`85349ca`), reviewed "Needs fixes"
with 2 Critical, given one fix round (`bd4eb58`), then rolled back by `e6adad9`,
which removed both implementation files and left the tree identical to
`371941b`. Tasks 3–10 never ran. So the branch landed and the phase did not
ship — one artefact survived the rollback, `ultrapowers-patches/scan-inventory.mjs`,
because enumerating occurrences is still needed inside the fork, just without
the "must not touch identity" constraint that broke this approach.

There is nothing to pick up. `03-SUMMARY.md` has the three escalating rounds,
the pre-flight rulings and the plan-conflict the human decided; the successor
design is phase 04's spec. Its plan,
`.ultrapowers/archive/plans/2026-07-27-ultrapowers-layer0-patcher.md`, and the
layer-0 section of
`.ultrapowers/archive/specs/2026-07-27-ultrapowers-rework-design.md` were
declared obsolete at the moment of abandonment and are kept as record, not as
instruction.
