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
happen the five process rules added on 2026-07-31 bind nothing on this machine. Two of the
three items that needed a decision rather than a keystroke were settled by the user on
2026-07-31 — phase 03's status is corrected and the risk register's location is reconciled —
leaving the status/delivery vocabulary migration, which belongs inside the statusline
segment's phase. Three phase-sized pieces of work are queued and unstarted: the statusline's
ultrapowers segment, the `.protected` mechanism, and the decision-records CLI.

## Open

- **Deploy from `master`.** The gate is satisfied: the audit ran on 2026-07-31 and its
  written impact assessment is `docs/2026-07-31-deploy-impact-through-phase-09.md`. What is
  left is the keystroke, `node setup.mjs` in a terminal, from `master` and never from a
  feature branch — `setup.mjs` prunes against the previous manifest, so two branch deploys
  make each prune the other's files. The measured delta is small: 3 files created, 4 updated,
  149 unchanged, **nothing pruned**, plus one additive `PreCompact` registration in
  `settings.json`. An interactive run will also offer to replace the default model
  `opus[1m]` with `claude-opus-5` — a separate decision, not part of the bundle. Until the
  deploy runs, the two `rules-src/` rules bind nothing on this machine.
- **Install `6.2.0-up.5`.** `/plugin update` and a restart, done by the user — publishing a
  fork revision does not put it on any machine. `enabledPlugins` resolves at startup and does
  not hot-reload, so deltas 011-013 bind on the next session, not the current one.
- **The status/delivery vocabulary migration.** Ruled on 2026-07-29, never applied; the
  ruling is recorded under Rulings below. It now has a home: phase 10's first step, because
  the segment that phase builds reads the fields being renamed, and renaming them from
  outside would touch every state file twice. `ROADMAP.md`'s frontmatter is mixed until then
  — phase 10's row carries `delivery`, the earlier rows still carry `integration`.
- **Two phase-sized items still queued, and one now specified.** The statusline's ultrapowers
  segment became phase 10 on 2026-07-31 and has an approved spec but no plan. The `.protected`
  mechanism and the decision-records CLI remain unstarted. `ROADMAP.md` carries what each one
  is and what constrains its order.
- **The decision-records plan still owes its phase directory.** When that phase is created,
  `archive/plans/2026-07-28-decision-records.md` moves into it as `NN-PLAN.md`, the same way
  phase 07's documents moved on 2026-07-31.

### Deploy warning — withdrawn 2026-07-31, and kept here because it was acted on

This warning read: *this machine runs profile `base` with gsd-core 1.8.0 installed — 71
skills, 34 agents, 24 hooks; the next deploy will offer to move that installation to the
reversible trash.* The audit of 2026-07-31 measured the machine and found no gsd-core:
`~/.claude/gsd-core` is absent, there are zero `gsd-*` entries under `skills/`, `agents/`,
`commands/` and `hooks/`, and `~/.claude/.cleanup-trash` does not exist — so this installer
never moved it and no restore window is open. Only `~/.gsd/defaults.json` and one
`Bash(npx gsd-core *)` permission remain, both out of the installer's reach. The detector
prints nothing and there is no consent prompt to answer. The evidence is in
`docs/2026-07-31-deploy-impact-through-phase-09.md`.

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

Two of them are hard, because both failures already existed in this tree; the first was
fixed on 2026-07-31, the second still stands:

- **`superseded` must carry `superseded_by`.** Without it phase 03 reads as abandoned again,
  and the reason it was replaced lives only in a summary nobody loads. Applied to phase 03 on
  2026-07-31 — the rule holds for every future `superseded` row.
- **A dropped task is a field, not a sentence.** `07-STATE.md` says `tasks_done: 6 /
  tasks_total: 7` and explains the seventh in prose, so every parser — the status bar
  included — will report 86%.

## Done

Compressed once paid: name, one line, the date. The reasoning that got each one done is in
its commit — these lines exist so a reader can see it happened at all.

- **Three shipped rules corrected, and the class filed** — the register's location, a `graphify`
  skill that exists nowhere and that nothing in the bundle installs, and `/ctx-doctor` where the
  plugin's trigger is `/context-mode:ctx-doctor`. `rules-src/` swept the same way and clean. The
  class — shipped prose naming artefacts nothing verifies — is `RISK-CLAUDEMD-002`, with a test
  proposed and not built. 2026-07-31.
- **Phase 03's status corrected** — `abandoned` → `superseded` with `superseded_by: "04"`, in
  `ROADMAP.md`'s frontmatter and table and in `03-STATE.md`. Ruled by the user; the first
  piece of the 2026-07-29 status model to be applied. 2026-07-31.
- **The risk register's location reconciled** — the exception is written in
  `.claude/CLAUDE.md`, where project scope outranks the `CURATED:NOEDIT` user-scope file that
  names `.planning/` or the project root. Nothing moved; the root `CLAUDE.md` could not hold
  it, being marked `CURATED:NOEDIT` itself. `.gitignore` excluded `.claude/` outright, which
  would have left the record binding this machine and nothing else, so the user un-ignored
  that one file: `.claude/*` plus `!.claude/CLAUDE.md`, because git cannot re-include a file
  whose parent directory is excluded. The compiled `stack-rules.md` snapshot and both
  settings files stay local. 2026-07-31.
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
