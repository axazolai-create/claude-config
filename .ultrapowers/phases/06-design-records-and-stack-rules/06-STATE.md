---
phase: "06"
status: complete
tasks_done: 6
tasks_total: 7
branch: feat/design-records-stack-rules
integration: branch
updated: 2026-07-29
---

# Phase 06 — design-records-and-stack-rules — state

Complete and reviewed clean, and the only phase whose work is not in `master`.
The branch is six commits ahead of `master` from base `103699b`; tip `f8114e8`.
The final review, the fix wave and the re-review were all clean.

Six of seven units are done: tasks 1–5, the inserted 4b, and task 6a — the fork
publish (`patch` `5eebb14`, generated `main` `02a5213`, both pushed). Task 6b,
the bundle deploy, was deferred into a single serialised deploy after all
branches land, so it has not happened for this phase's content. That is why the
fraction is 6/7 and `integration` is `branch`.

**`06-SUMMARY.md` was never written.** It is the next thing this phase needs;
the ledger's own last line says so. The material is all on disk in
`.ultrapowers/sdd/2026-07-28-design-records-and-stack-rules/`: `progress.md`,
six task reports, the final-review and fix-wave diffs, and `final-fix-report.md`.

To pick it up cold: check out `feat/design-records-stack-rules`, dispatch the
summary writer against that workspace, then merge, then deploy — from `master`
after the merge, never from the feature branch, because `setup.mjs` prunes
against the previous manifest and deploying branch A then branch B would make
each prune the other's files.

One open item the ledger flagged and no task closed: the additive-update path's
most destructive failure mode, recorded as a ⚠️ under task 4b in `progress.md`.
It needs to be read before the summary is folded, because folding is where it
would otherwise be lost.
