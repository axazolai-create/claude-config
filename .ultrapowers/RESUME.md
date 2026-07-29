# Resume point — 2026-07-29, written before a context clear

This file exists because the session that did the work is about to lose its memory.
`ROADMAP.md` says where each phase stands; this says what to do next and what is
mid-flight. Delete it once the work below is finished — it is a handover, not a
record.

## Done and on `master`

Four plans from 2026-07-28 executed, reviewed and merged: the `.ultrapowers`
planning tree, versioning and changelog, design records and stack rules, and the
gsd-core detector with the `base`/`lite` statusline. `master` is at 508 passing
tests. Phases 04 and 05 are also **deployed**; 06 and 07 are merged but not.

## Mid-flight when this was written

Nothing is running. `06-SUMMARY.md` and `07-SUMMARY.md` were written and
verified before the clear: five sections each, no diff content, 20.8 KB and
23.3 KB. Every phase directory now holds what it should.

**The fork is published at `6.2.0-up.4`** (2026-07-29). `feat/workspace-coherence`
fast-forwarded into `patch`, `transform/config.json` revision 3 → 4, 73/73 tests
green, `build-cli.mjs check` clean (59 files, 10 deltas, 0 refusals), `main`
rebuilt to tree `2feadcf`, `drift` confirms `main` is exactly what original +
patch produce, and both branches are pushed — `patch` at `2e06627`, `main` at
`0ce6bfa`. The revision carries three coherence fixes (the workspace surviving
`git worktree remove`, the `NN-PLAN.md` slug collision, and a false
`NN-REVIEW.md` claim), the `refs/` and `.ultrapowers/docs/` layout convention,
the `STATE.md` trigger, and the two-file state model.

## Next, in order

1. Audit the live config dir, write the impact assessment, deploy from `master`.
   **Read the warning below first.**
2. Run the new phase the user opened: enforced state, transparent statuses,
   `/up-resume`. It must go brainstorming → spec → plan → execution, by their
   ruling. Details in `.ultrapowers/sdd/2026-07-28-ultrapowers-planning-tree/progress.md`,
   near the end. A reference `.planning/` tree from a real GSD project was copied
   to `.reference/` and assessed on 2026-07-29. That directory is gitignored and
   local to this machine — a fresh clone will not have it, and the assessment is
   input to the brainstorm rather than a decision already taken.
3. Only then plan #3 — decision records CLI — so it runs under the corrected
   status vocabulary rather than needing a second migration. Its plan is at
   `.ultrapowers/archive/plans/2026-07-28-decision-records.md`.

## Warning that decides step 3

This machine runs profile `base` with gsd-core 1.8.0 installed — 71 skills, 34
agents, 24 hooks. That is exactly phase 07's detector trigger. **The next deploy
will offer to move that installation to the reversible trash.** The offer is
consent-gated, defaults to no, and is undoable for seven days, but it is a
decision about the user's own machine and belongs to them at the prompt.

There is also an ordering constraint: **deploy the bundle before updating the
ultrapowers plugin past `6.2.0-up.2`.** The installed plugin is still `up.1`, so
the order is currently right. The published fork tells design sessions to run a
checker whose deployed copy is older and answers differently.

## Rules established this session, binding on what follows

- **Payload-only.** This repository ships an *installation*. Nothing is ever
  developed into `~/.claude` or into the project's own configuration; everything
  goes to `payload/` or to the installer. Legitimate exceptions: `setup.mjs` and
  its tests, `variants.json`, the top-level READMEs, and the repo's own records.
- **Deploy only via `node setup.mjs` or `/init-stack`**, gated on an audit and a
  written impact assessment, after a plan's work ends and again at the end.
  Deploy from `master`, never from a feature branch — `setup.mjs` prunes against
  the previous manifest, so two branch deploys make each prune the other's files.
- **Layout.** A phase's own spec is `NN-SPEC.md` at the phase root; supporting
  designs go in `phases/NN-slug/refs/`, unprefixed and named for what they
  decide; artefacts belonging to more than one phase go to `.ultrapowers/docs/`,
  by kind, with a subject subfolder only once a kind outgrows a flat list.
  Another phase needing a spec links to it rather than copying it.
- **State.** Each phase has `NN-STATE.md`; the tree has `ROADMAP.md`. Both are
  written when a status they record changes — not on a did-it/didn't basis.

## One phase directory is incomplete, and knowingly

`07-gsd-core-detector-and-statusline` holds only `07-STATE.md` and
`07-SUMMARY.md`. Its plan and design are still in `.ultrapowers/archive/` —
`2026-07-28-gsd-core-detector-and-statusline.md` and its `-design.md` — because
the move of plans into phase directories happened before phase 07 existed. Give
it `07-PLAN.md` and `07-SPEC.md` the same way phases 04–06 got theirs, and repair
the references the move breaks. The same is owed to the decision-records plan
when its phase is created.

## Known wrong, deliberately left for the new phase

- `status: abandoned` on phase 03 is **false**. Its own summary's first line says
  "abandoned mid-flight **and superseded by the fork design**". Nothing was given
  up — the patch-in-place approach was replaced by the fork that shipped, after a
  scan found 1504 occurrences across 111 files and 382 distinct spellings against
  a baseline of 119 that had been measured over only three directories. The
  correct status is `superseded by 04`.
- The unmerged-at-the-time statusline design asserts `STATE.md` and `ROADMAP.md`
  are absent from this tree. That is now false and must become a rule rather than
  something someone remembers.

## Settled 2026-07-29, to be applied by the new phase

The user ruled on the status model after a real GSD `.planning/` tree was read
side by side with this one. It mixes five status vocabularies that share no
values — a ROADMAP checkbox, a prose `**Status**: ✅ Complete`, a STATE
frontmatter verb (`planning`), the risk register's `Open|Mitigated|Accepted|
Closed`, and a validation table's `⬜ ✅ ❌ ⚠️`. The lesson taken is not a file
layout but a separation:

- **`status`** — the phase's life cycle, and nothing else: `planned`, `running`,
  `blocked`, `complete`, `superseded`, `abandoned`.
- **`delivery`** replaces `integration` — branch and merge state is a delivery
  fact, not a status: `branch`, `merged`, `deployed`. `deployed_through` stays a
  waterline on the roadmap; it is not a per-phase flag.
- **`depends_on` / `blocked_by`** — lists, not prose. A dependency a reader has
  to infer from a sentence is not a dependency a checker can hold you to.

Two rules are hard, because both failures already exist in this tree:

- **`superseded` must carry `superseded_by`.** Without it phase 03 reads as
  abandoned again, and the reason it was replaced lives only in a summary nobody
  loads.
- **A dropped task is a field, not a sentence.** `07-STATE.md` says
  `tasks_done: 6 / tasks_total: 7` and explains the seventh in prose, so every
  parser — the status bar included — will report 86%.

The status bar needs real design work rather than a patch. The floor the user
set: it always shows pending component updates, and context fill as **both a
token count and a percentage**. Everything above that floor — which tree it
reads, how it reports a milestone, what it does when two trees disagree — is
open. Three findings constrain it, all measured on 2026-07-29:

- The GSD reader's regexes are **correct** against a real `.planning/STATE.md`
  (rendered `v1.0 [██░] 92% · Phase 13 planning`). The "format nobody verified"
  caveat in phase 07's plan is discharged.
- That 92% is **wrong anyway**. The source file states progress three times and
  disagrees with itself: frontmatter `11/12`, roadmap checkboxes `14/15`, plans
  `95/95`, with `current_phase: 13` exceeding `total_phases: 12`. A reader that
  trusts one field silently publishes a false number.
- Against **this** tree the bar is simply wrong: it renders a stale SDD ledger
  (`2026-07-28-ultrapowers-planning-tree ✔12 →13`) for a phase that is complete
  and merged, because `gsdState` requires `.planning/config.json` and `sddState`
  intercepts first. `.ultrapowers/ROADMAP.md` and `NN-STATE.md` are never read.
  `sddState` also picks the "plan in flight" by file mtime, so a checkout
  changes what the bar claims.
