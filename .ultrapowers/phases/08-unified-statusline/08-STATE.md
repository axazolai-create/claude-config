---
phase: "08"
status: running
delivery: branch
branch: feat/unified-statusline
depends_on: []
tasks_done: 7
tasks_total: 8
updated: 2026-07-30
---

# Phase 08 — unified-statusline — state

Running on `feat/unified-statusline`, executed subagent-driven. `08-SPEC.md` is
the design, `08-PLAN.md` the eight tasks, and
`.ultrapowers/sdd/phases-08-unified-statusline/progress.md` the ledger — read the
ledger to resume, not this file.

The phase replaces the install-time choice between two statusline renderers with
one renderer that composes a floor plus optional segments. It deletes
`gsd-context-meter.mjs` and the wrapper machinery around gsd-core's own
`gsd-statusline.js`, adds the model segment this bundle never had, and fixes the
context denominator — `context_window.total_tokens` does not exist in the
statusLine payload, so `totalCtx` has been falling through to a hardcoded
`1_000_000` on every render regardless of the model.

**Task 1 is deferred, not dropped.** It captures a live statusLine payload to
confirm the window-size field name, and it needs a Claude Code restart no
subagent can perform. Nothing else depends on the answer: the
`context_window_size ?? total_tokens ?? 1_000_000` read order is correct under
either name. `tasks_done` will reach 7 of 8 with Task 1 still outstanding, and
that is a real outstanding task rather than a retired one — no `tasks_dropped`
here.

Written against the status vocabulary settled on 2026-07-29, which is why this
file says `delivery` rather than `integration`. That vocabulary has no value for
"no branch exists yet", which is why `delivery: none` appeared here before the
branch existed; the gap is left for the migration to close properly.

Two findings carried out of phase 07 are closed by this phase's rewrite, because
both live in the file being replaced: `statusline.mjs` has no timeout on stdin,
and `renderGsd`/`renderSdd` interpolate the literal `undefined` when called with
missing fields.

Nothing here is deployed. Phase 07's rule stands — one serialised deploy from
`master` after the branches land, gated on an audit and a written impact
assessment.
