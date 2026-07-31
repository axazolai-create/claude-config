---
phase: "10"
status: complete
action: null
tasks_done: 5
tasks_total: 5
branch: feat/phase-progress-segment
delivery: branch
depends_on: ["08", "09"]
updated: 2026-07-31
---

# Phase 10 — phase-progress-segment — state

Implemented on `feat/phase-progress-segment`, five tasks, not merged. Both halves of the suite
are green: 572 from the repository root and 23 in the hidden `.test/unit/`.

What shipped: `payload/hooks/lib/phase-segment.mjs` with `readPhaseState` and the pure
`renderPhaseSegment`, three display modes, five colour states across four count positions, and
the vocabulary migration that had been owed since 2026-07-29. `statusline.mjs` lost
`renderSdd`, `renderPhase`, `sddState`, `phaseSegment`, `roadmapPhases`, `frontmatter` and
`fmField`; it keeps the wiring only.

Two things were found by writing tests rather than by reading, and both are recorded in the
commits that fixed them. `08-STATE.md` had read `delivery: branch` for a day after its branch
merged — the exact staleness the status/delivery split exists to expose. And the queue formula
subtracted `tasks_dropped` from ledger-derived counts, which drives the queue negative and
costs the segment its counters; a retired task is either already among the unreported briefs or
was never written as one.

This file is the vocabulary's first live example. Rendered by the segment it describes, this
phase reads `10 phase-progress-segment` — `action` is `null` because nothing is being done in
it right now, and the bar does not invent a word for that.
