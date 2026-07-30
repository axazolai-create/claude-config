---
phase: "08"
status: complete
delivery: branch
branch: feat/unified-statusline
depends_on: []
tasks_done: 7
tasks_total: 8
updated: 2026-07-30
---

# Phase 08 — unified-statusline — state

Complete on `feat/unified-statusline`, unmerged and undeployed. Executed
subagent-driven: one implementer per task, a task-scoped review after each, a
whole-branch review on the most capable model, and one fix wave. The
whole-branch re-review's verdict is *ready to merge*; `08-VERIFICATION.md` reads
ACHIEVED with all seven global constraints held.

The phase replaced the install-time choice between two statusline renderers with
one renderer composing a floor plus optional segments. `gsd-context-meter.mjs`
and the machinery wrapping gsd-core's own `gsd-statusline.js` are gone; the model
segment this bundle never had is in; the context denominator is read from the
field that exists; and the work in flight is selected deterministically instead of
by file mtime, which had let a checkout change what the bar claimed.

**`tasks_done: 7 / 8` is a real outstanding task, not a retired one — there is no
`tasks_dropped` here.** Plan task 1 captures a live statusLine payload to settle
whether the context-window size arrives as `context_window_size` or
`total_tokens`. It needs a Claude Code restart no subagent can perform and was
deferred by user ruling. Nothing else depended on the answer: the reader is
`context_window_size ?? total_tokens ?? 1_000_000` and is correct under either
name. Filed as `RISK-STATUSLINE-001` so it survives this phase, with the
deploy-gate acceptance check written down: a wrong denominator shows up as an
internally inconsistent segment, because the token figure and the percentage come
from different payload fields.

## Picking this up cold

Read `.ultrapowers/sdd/phases-08-unified-statusline/progress.md` — the ledger, not
this file, is the recovery map. It records every deviation, twenty-one parked
findings with their rulings, the fix rounds inside tasks 6 and 7, and the
adjudication of the final wave's residuals. `08-SUMMARY.md` folds it; the review
packages named there reconstruct every diff from git even after the workspace is
cleared.

Three of this phase's defects were the plan's, not the implementers', and all
three were caught by implementers pushing back rather than by review afterwards:
test helpers the plan named but the file did not have, a code sample that would
have shipped `✔0/0` for an unplanned phase while its own unit test passed for the
wrong reason, and a review-suggested assertion that could not detect the guard it
was meant to test. The controller was also factually wrong about `$` and `\r`
under `/m` and was corrected by an implementer with an empirical check. All are
recorded verbatim in the summary's rulings section.

## Open, and carried out of this phase

- `RISK-STATUSLINE-001` — the window-size field name is documented, not observed.
- `RISK-TESTUNIT-001` — `.test/unit/` is gitignored, so the merge-gate fix in
  `ensureStatuslineOverride` ships with its only regression test outside the
  branch. This one needs a user decision, not a mitigation.
- One tracked follow-up, parked deliberately: the prune-time warning added by the
  fix wave has no committed test. The re-review's recommended pin is a ~10-line
  source-level assertion in the style of the no-subprocess test, not a TTY e2e
  case.

Nothing here is deployed. Phase 07's rule stands — one serialised deploy from
`master` after the branches land, gated on an audit and a written impact
assessment.
