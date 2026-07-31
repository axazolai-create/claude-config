---
phase: "09"
status: complete
delivery: branch
integration: branch
branch: feat/context-meter-severity
depends_on: ["08"]
tasks_done: 6
tasks_total: 6
updated: 2026-07-31
---

# Phase 09 — context-meter-severity — state

Complete on `feat/context-meter-severity`, unmerged and undeployed, in the worktree
`D:/6__Work/AI_Projects/claude-config-wt-plan9`. Executed subagent-driven: one implementer
per task, a task-scoped review after each, a whole-branch review on the most capable model,
one fix wave, and a goal-backward verification. `09-VERIFICATION.md` reads ACHIEVED with
every global constraint HELD and no violations. 499 tests pass.

The phase gives the statusline's context segment a severity it never had: a colour
that tracks the figure printed beside it, and an icon that tracks how close automatic
compaction is. Both ladders derive from the current model's window, so the same code
reads correctly on a 200K model and a 1M one.

The ladder is `15/45/70/85/95`. Colour follows percent of the model window; the icon
follows percent of the way to automatic compaction, and appears from 45 up as
`💡 ⚠️ 🔥 💀`. The two scales coincide under the default configuration and separate
only when `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is lowered — which is the case the split
exists for.

## Picking this up cold

Read `.ultrapowers/sdd/phases-09-context-meter-severity/progress.md` — the ledger, not
this file, is the recovery map. It carries the task commits, the review findings and
their rulings, and the three facts settled before the phase that must not be
re-litigated.

`09-SPEC.md` and `09-PLAN.md` are committed on the branch. The spec was corrected twice
while the plan was being written, and both corrections are in it rather than left as a
divergence: the observation cannot be keyed on the transcript's model id, and
`computeContext` keeps its signature.

## What is settled and must not be reopened

- The window size arrives as `context_window_size`. `total_tokens` is absent from live
  payloads — see `RISK-STATUSLINE-001`, closed by observation on 2026-07-30. The
  `?? total_tokens` arm stays as insurance against a rename, deliberately.
- `PreCompact` carries no `context_window`, so the compaction point cannot be read
  where it fires. It is observed from the transcript's last assistant `usage`.
- The transcript's `message.model` is `claude-opus-5`; the payload's `model.id` is
  `claude-opus-5[1m]`. Not the same key — hence the pending/promote split, where the
  hook writes an unkeyed observation and the statusline promotes it.
- The default autocompact point is the full window, never a guessed reserve. This is
  the phase's one accepted risk: `💀` cannot appear before a first compaction has been
  observed.

## Open

- `RISK-STATUSLINE-002` is to be filed when the phase closes: the autocompact point is
  assumed until a compaction is observed. Acceptance check — after one automatic
  compaction, `~/.claude/state/autocompact.json` holds a `models` entry whose `tokens`
  is below `windowSize`, and no `pending` key remains.
- `ROADMAP.md` is stale and is rewritten when this phase closes: `deployed_through`
  still reads `05` although `master` was deployed at `51a65d0` on 2026-07-30, phase 08
  is merged rather than awaiting merge, and the `Next` list's first two items are done.
