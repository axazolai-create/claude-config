# Resume point — a standing record, opened 2026-07-29

**This file is never deleted and nothing is ever removed from it.** Work that closes is
marked closed and keeps its entry; work that opens goes to Open. The shape is fixed so a
reader can stop early: the summary answers "what now", Open answers "what is left", Done is
the audit trail behind both. `ROADMAP.md` answers which phases exist and what each one's
status is — this file answers what is owed, what was ruled, and what must not be re-decided.

## Summary

Nothing is running. Both repositories are on their production branches and pushed: this tree
at `8e785d6`, the fork published as `6.2.0-up.5`. Two things are owed that are only
keystrokes — the deploy from `master`, and `/plugin update` plus a restart — and until both
happen the five process rules added on 2026-07-31 bind nothing on this machine. The three
open items that need a decision rather than a keystroke are the phase-03 status correction,
the status/delivery vocabulary migration, and the risk-register location that only the user
can reconcile. Three phase-sized pieces of work are queued and unstarted: the statusline's
ultrapowers segment, the `.protected` mechanism, and the decision-records CLI.

## Open

- **Deploy from `master`.** Gated on an audit and a written impact assessment, from `master`
  and never from a feature branch — `setup.mjs` prunes against the previous manifest, so two
  branch deploys make each prune the other's files. **Read the deploy warning below first.**
  The deploy carries phase 09 and the two `rules-src/` rules added on 2026-07-31; until it
  runs, neither rule binds anything on this machine.
- **Install `6.2.0-up.5`.** `/plugin update` and a restart, done by the user — publishing a
  fork revision does not put it on any machine. `enabledPlugins` resolves at startup and does
  not hot-reload, so deltas 011-013 bind on the next session, not the current one.
- **Phase 03's `status: abandoned` is false.** Its own summary's first line says "abandoned
  mid-flight **and superseded by the fork design**". Nothing was given up — the
  patch-in-place approach was replaced by the fork that shipped, after a scan found 1504
  occurrences across 111 files and 382 distinct spellings against a baseline of 119 that had
  been measured over only three directories. The correct status is `superseded by 04`, and
  under the ruling below it must carry `superseded_by`.
- **The status/delivery vocabulary migration.** Ruled on 2026-07-29, never applied; the
  ruling is recorded under Rulings below. `ROADMAP.md` and every `NN-STATE.md` still use
  `integration`. This blocks nothing today but it is the vocabulary the statusline segment
  needs, so the segment's phase should not start before it.
- **One edit owed to the user.** `~/.claude/CLAUDE.md` is `CURATED:NOEDIT` and says the risk
  register lives in `.planning/` or the project root; this tree keeps it at
  `.ultrapowers/RISK_REGISTER.md`. Only the user can reconcile that.
- **Three phase-sized items, queued and unstarted.** The statusline's ultrapowers segment,
  the `.protected` mechanism, and the decision-records CLI. `ROADMAP.md` carries what each
  one is and what constrains its order.
- **The decision-records plan still owes its phase directory.** When that phase is created,
  `archive/plans/2026-07-28-decision-records.md` moves into it as `NN-PLAN.md`, the same way
  phase 07's documents moved on 2026-07-31.

### Deploy warning

This machine runs profile `base` with gsd-core 1.8.0 installed — 71 skills, 34 agents, 24
hooks. That is exactly phase 07's detector trigger. **The next deploy will offer to move that
installation to the reversible trash.** The offer is consent-gated, defaults to no, and is
undoable for seven days, but it is a decision about the user's own machine and belongs to
them at the prompt.

## Rulings that stand, and are not to be re-decided

**Payload-only.** This repository ships an *installation*. Nothing is ever developed into
`~/.claude` or into the project's own configuration; everything goes to `payload/` or to the
installer. Legitimate exceptions: `setup.mjs` and its tests, `variants.json`, the top-level
READMEs, and the repo's own records.

**Deploy only via `node setup.mjs` or `/init-stack`**, gated on an audit and a written impact
assessment, after a plan's work ends and again at the end. From `master`, never a feature
branch.

**Layout.** A phase's own spec is `NN-SPEC.md` at the phase root; supporting designs go in
`phases/NN-slug/refs/`, unprefixed and named for what they decide; artefacts belonging to
more than one phase go to `.ultrapowers/docs/`, by kind, with a subject subfolder only once a
kind outgrows a flat list. Another phase needing a spec links to it rather than copying it.

**State.** Each phase has `NN-STATE.md`; the tree has `ROADMAP.md`. Both are written when a
status they record changes — not on a did-it/didn't basis. Neither ever drops what is done:
closed work is marked closed and stays, what remains is hoisted to the top, and a short
summary sits above both so a reader can stop early. A status file that deletes its history
buys nothing and loses the one cheap check on what actually happened.

**The status model, ruled 2026-07-29 — recorded here, not yet applied.** A real GSD
`.planning/` tree read side by side with this one mixes five status vocabularies that share
no values: a ROADMAP checkbox, a prose `**Status**: ✅ Complete`, a STATE frontmatter verb
(`planning`), the risk register's `Open|Mitigated|Accepted|Closed`, and a validation table's
`⬜ ✅ ❌ ⚠️`. The lesson is a separation, not a file layout:

- **`status`** — the phase's life cycle, and nothing else: `planned`, `running`, `blocked`,
  `complete`, `superseded`, `abandoned`.
- **`delivery`** replaces `integration` — branch and merge state is a delivery fact, not a
  status: `branch`, `merged`, `deployed`. `deployed_through` stays a waterline on the
  roadmap; it is not a per-phase flag.
- **`depends_on` / `blocked_by`** — lists, not prose. A dependency a reader has to infer from
  a sentence is not a dependency a checker can hold you to.

Two of them are hard, because both failures already exist in this tree:

- **`superseded` must carry `superseded_by`.** Without it phase 03 reads as abandoned again,
  and the reason it was replaced lives only in a summary nobody loads.
- **A dropped task is a field, not a sentence.** `07-STATE.md` says `tasks_done: 6 /
  tasks_total: 7` and explains the seventh in prose, so every parser — the status bar
  included — will report 86%.

## Done

Compressed once paid: name, one line, the date. The reasoning that got each one done is in
its commit — these lines exist so a reader can see it happened at all.

- **Both repositories on their production branches** — this tree merged at `8e785d6` and
  pushed; the fork's `patch` and `main` pushed. 2026-07-31.
- **The fork published at `6.2.0-up.5`** — revision 4 → 5, deltas 011-013, 73/73 tests green,
  `drift` confirms `main` is exactly what original + patch produce. Not installed anywhere
  yet. 2026-07-31.
- **Every phase directory is complete** — phase 07's spec and plan moved out of the archive.
  2026-07-31.
- **All four phase-09 process rules landed, plus a fifth** — the
  `null`-past-an-`undefined`-guard footgun and the clock-dated-fixture rule in
  `payload/rules-src/`; the two planning rules as delta 011; the ledger read-back check as
  delta 012. 2026-07-31.
- **Status files keep their history** — ruled by the user mid-session and shipped as delta
  013, which replaced the "rewrite, never append" instruction that caused the failure.
  2026-07-31.
- **`master`'s red suite is green again** — two lite assertions had not learned about phase
  09's PreCompact observer; 577/2 became 579/0. 2026-07-31.
- **Phases 08 and 09 ran and merged** — the unified statusline, then the context segment's
  severity. These were the "new phase the user opened" this file first listed as next.
  2026-07-30 and 2026-07-31.
- **The first audit and deploy from `master`** — at `51a65d0`, setting `deployed_through: 08`.
  2026-07-30.
- **The bundle-before-plugin ordering constraint is satisfied** — both halves hold, so
  publishing a new fork revision is unblocked. The earlier note here, "the installed plugin
  is still `up.1`", was true on 2026-07-29 and is superseded. 2026-07-30.
- **The fork published at `6.2.0-up.4`** — revision 3 → 4, both branches pushed, `main`
  confirmed to be exactly what original + patch produce. 2026-07-29.
- **Four plans from 2026-07-28 executed, reviewed and merged** — the `.ultrapowers` planning
  tree, versioning and changelog, design records and stack rules, and the gsd-core detector
  with the `base`/`lite` statusline. 2026-07-29.

## Measurements that still constrain the statusline segment

Taken 2026-07-29, before phases 08 and 09 rebuilt the bar. The floor the user set: it always
shows pending component updates, and context fill as **both a token count and a percentage**.
Phase 09 delivered the context half. What remains open is which tree the segment reads, how
it reports a milestone, and what it does when two trees disagree.

- The GSD reader's regexes are **correct** against a real `.planning/STATE.md` (rendered
  `v1.0 [██░] 92% · Phase 13 planning`). The "format nobody verified" caveat in phase 07's
  plan is discharged.
- That 92% is **wrong anyway**. The source file states progress three times and disagrees
  with itself: frontmatter `11/12`, roadmap checkboxes `14/15`, plans `95/95`, with
  `current_phase: 13` exceeding `total_phases: 12`. A reader that trusts one field silently
  publishes a false number.
- Against **this** tree the bar was simply wrong: it rendered a stale SDD ledger
  (`2026-07-28-ultrapowers-planning-tree ✔12 →13`) for a phase that was complete and merged,
  because `gsdState` requires `.planning/config.json` and `sddState` intercepts first.
  `.ultrapowers/ROADMAP.md` and `NN-STATE.md` were never read. `sddState` also picks the
  "plan in flight" by file mtime, so a checkout changes what the bar claims. Phases 08 and 09
  rebuilt the renderer; whether this particular defect survives is a question for the
  segment's own phase, not an assumption either way.
