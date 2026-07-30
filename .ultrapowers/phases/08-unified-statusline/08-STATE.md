---
phase: "08"
status: planned
delivery: none
depends_on: []
updated: 2026-07-30
---

# Phase 08 — unified-statusline — state

Spec approved, not yet planned. `08-SPEC.md` is the design; there is no
`08-PLAN.md`, so there is no task tally to record yet.

The phase replaces the install-time choice between two statusline renderers with
one renderer that composes a floor plus optional segments. It deletes
`gsd-context-meter.mjs` and the wrapper machinery around gsd-core's own
`gsd-statusline.js`, adds the model segment this bundle never had, and fixes the
context denominator — `context_window.total_tokens` does not exist in the
statusLine payload, so `totalCtx` has been falling through to a hardcoded
`1_000_000` on every render regardless of the model.

Written against the status vocabulary settled on 2026-07-29, which is why this
file says `delivery` rather than `integration`. That vocabulary has no value for
"no branch exists yet" — its three values are `branch`, `merged` and `deployed` —
so `delivery: none` is used here and the gap is left for the migration to close
properly rather than papered over by claiming a branch that does not exist.

Two findings carried out of phase 07 are closed by this phase's rewrite, because
both live in the file being replaced: `statusline.mjs` has no timeout on stdin,
and `renderGsd`/`renderSdd` interpolate the literal `undefined` when called with
missing fields.

Nothing here is deployed. Phase 07's rule stands — one serialised deploy from
`master` after the branches land, gated on an audit and a written impact
assessment.
