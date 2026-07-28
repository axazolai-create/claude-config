# Delta 008 — SDD writes a SUMMARY instead of deleting the workspace

Date: 2026-07-28
Status: approved, not yet planned

Target: `plugins/ultrapowers/skills/subagent-driven-development/SKILL.md` in the fork.
File: `transform/deltas/008-sdd-summary.patch`.

## The claim being corrected

`## Finish` (line 418) reads:

> When the final whole-branch review is clean and its fixes are merged, delete this plan's
> workspace (`rm -rf <workspace>`) — **the git history is the record now**.

The premise is false. Git history holds commits and diffs. It does not hold:

- **rulings** — which review findings were parked as non-blocking, and on what grounds;
- **implementer reasoning** — why an approach was abandoned, what was tried, where the plan was
  wrong.

Measured on this repository: 159 KB of irreplaceable content against 725 KB of diffs that *are*
in git. Deleting the workspace destroys the first to be rid of the second.

## What changes

### Hunk A — the process diagram (lines 76, 105, 106)

`"Final review clean: delete this plan's workspace"` becomes
`"Final review clean: write NN-SUMMARY, keep the workspace"`.

### Hunk B — the `## Finish` section (lines 416-423)

Replaced with: write `phases/NN-slug/NN-SUMMARY.md`, and leave the workspace alone. Clearing
`sdd/` becomes a separate janitorial act, not the closing move of every plan — nothing in it is
lost, which is exactly why it need not happen on a schedule.

The SUMMARY carries:

- tasks with their commit ranges — chronology plus an entry point into `git log`;
- rulings, **verbatim**, not paraphrased — they are the least flattering and most valuable content
  and are the first thing a fold would smooth away;
- from the reports: deviations from the plan and decisions taken along the way, extracted rather
  than copied;
- for each review, **both** references: `sdd/<plan>/review-A..B.diff` and `git diff A..B`. The path
  is faster while the work is live; the range still resolves after the scratch is cleared. One
  alone rots or wastes what is sitting next to you.

Never archived into git: the diffs themselves, and the task briefs — both regenerable, and 83% of
the tree by size.

### Hunk C — the ledger's contract (around line 127)

Today the ledger is written for its own author to re-read after a compaction. Under the
agent-first design a *different* agent folds it into the SUMMARY, so it must be readable cold:
task, commit range, ruling, deviation. This hunk states that requirement where the ledger is
first described.

## Dependencies

- `.ultrapowers/` layout design — supplies the destination path `phases/NN-slug/NN-SUMMARY.md`.
  Until that exists, this delta has nowhere to write.
- agent-first design — supplies `summary-writer-prompt.md`, the agent that performs the fold. The
  main session must not read 40k tokens of drafts itself.

Sequencing therefore: layout first, then this delta together with the summary-writer prompt.

## Format constraints

Same as delta 007: validate with the fork's `parsePatch` + `applyPatch`, not `git apply`. Hunk A
touches three separate lines of a dot graph — three small hunks are safer than one large one,
since upstream edits diagrams more often than prose.

## Out of scope

- Migrating the existing `.superpowers/sdd/` strata — separate, one-off work.
- Changing what the implementer reports contain.
- Automatic deletion of `sdd/` on any schedule.
