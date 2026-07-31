---
phase: "07"
status: complete
tasks_done: 6
tasks_total: 7
branch: feat/gsd-core-detector
delivery: merged
updated: 2026-07-29
---

# Phase 07 — gsd-core-detector-and-statusline — state

Complete and merged. Six tasks, a whole-branch review and one fix wave, all
clean. The seventh task — deploy and verify end to end — was retired by user
ruling and folded into a single deploy from `master`, so `tasks_done` is 6 of 7
rather than 7 of 7 and stays that way.

Two halves. On `base` and `lite`, `setup.mjs` now offers to move a foreign
gsd-core installation to the reversible cleanup trash and de-register its hooks.
And those profiles gained a statusline at all, where previously `setup.mjs`
deleted the key outside `full`.

**Not yet deployed.** This machine runs profile `base` with gsd-core 1.8.0
installed — 71 skills, 34 agents, 24 hooks — which is exactly the detector's
trigger. The first deploy carrying this phase will offer to move that
installation to the trash. The offer is consent-gated, reversible for seven
days, and defaults to no, but it is a decision about the user's own machine and
belongs to them at the prompt rather than to whoever runs the deploy.

`07-SUMMARY.md` is being written; if it is absent, that is where to resume.
