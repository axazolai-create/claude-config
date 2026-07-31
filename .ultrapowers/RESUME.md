# Resume point — a standing record, opened 2026-07-29

**This file is never deleted and nothing is ever removed from it.** Work that closes is
marked closed and keeps its entry; work that opens goes to Open. The shape is fixed so a
reader can stop early: the summary answers "what now", Open answers "what is left", Done is
the audit trail behind both. `ROADMAP.md` answers which phases exist and what each one's
status is — this file answers what is owed, what was ruled, and what must not be re-decided.

## Summary

Nothing is running. Everything through phase 08 is deployed; phase 09 is merged and awaits a
deploy, and two process rules landed on 2026-07-31 that the same deploy will carry. The three
open items that need a decision rather than a keystroke are the phase-03 status correction,
the status/delivery vocabulary migration, and the risk-register location that only the user
can reconcile. Three phase-sized pieces of work are queued and unstarted: the statusline's
ultrapowers segment, the `.protected` mechanism, and the decision-records CLI.

## Open

- **Deploy from `master`.** Gated on an audit and a written impact assessment, from `master`
  and never from a feature branch — `setup.mjs` prunes against the previous manifest, so two
  branch deploys make each prune the other's files. **Read the deploy warning below first.**
  The deploy carries phase 09 and the two rules added on 2026-07-31; until it runs, neither
  rule binds anything on this machine.
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

- **Every phase directory is complete — 2026-07-31.**
  `07-gsd-core-detector-and-statusline` held only `07-STATE.md` and `07-SUMMARY.md`, because
  the move of plans into phase directories happened before phase 07 existed. Its design and
  plan are now `07-SPEC.md` and `07-PLAN.md` in that directory, moved from
  `.ultrapowers/archive/{specs,plans}/` with history preserved. The documents that still name
  the archive paths — `08-SPEC.md` and `archive/plans/2026-07-28-EXECUTION-ORDER.md` — are
  closed records and keep them: a historical document says where a file was, and only current
  documents are repointed. The same move is still owed to the decision-records plan when its
  phase is created.
- **Two of the four phase-09 process rules landed — 2026-07-31.** The
  `= {}`-does-not-catch-`null` footgun is in `payload/rules-src/node.base.md`; the
  clock-dated-fixture rule is in `payload/rules-src/testing.md`. Neither binds until the next
  deploy. The two planning rules and the ledger read-back check belong to the ultrapowers
  fork and are tracked in `ROADMAP.md`.
- **`master`'s red suite is green again — 2026-07-31.** Phase 09 registered
  `precompact-observe.mjs` in `settings.partial.json` and updated neither `variants.json` nor
  the two lite assertions, so `master` carried 577 pass / 2 fail from that commit. The tests
  were wrong, not the installer: lite installs `statusline.mjs` and `lib/autocompact.mjs`,
  the statusline reads `state/autocompact.json`, and this hook is the only writer. 579/579.
- **Phases 08 and 09 ran and merged — 2026-07-30 and 2026-07-31.** These are the "new phase
  the user opened" that this file originally listed as next. Phase 08 unified the statusline;
  phase 09 gave the context segment a severity. Both are in `master`; 09 is not yet deployed.
- **The first audit and deploy from `master` — 2026-07-30.** Deployed at `51a65d0`, which set
  `deployed_through: 08`. A second deploy is owed for phase 09 and is listed under Open.
- **The bundle-before-plugin ordering constraint is satisfied — 2026-07-30.** The rule was
  that the bundle must be deployed before the ultrapowers plugin moves past the revision the
  deployed copy was built against. Both halves hold: `master` was deployed at `51a65d0` and
  the installed plugin is `6.2.0-up.4`. Publishing a new fork revision is unblocked. The
  earlier note here — "the installed plugin is still `up.1`, do not pass `6.2.0-up.2`" — was
  true when written on 2026-07-29 and is superseded.
- **The fork published at `6.2.0-up.4` — 2026-07-29.** `feat/workspace-coherence`
  fast-forwarded into `patch`, `transform/config.json` revision 3 → 4, 73/73 tests green,
  `build-cli.mjs check` clean (59 files, 10 deltas, 0 refusals), `main` rebuilt to tree
  `2feadcf`, `drift` confirms `main` is exactly what original + patch produce, both branches
  pushed — `patch` at `2e06627`, `main` at `0ce6bfa`. The revision carries three coherence
  fixes (the workspace surviving `git worktree remove`, the `NN-PLAN.md` slug collision, and
  a false `NN-REVIEW.md` claim), the `refs/` and `.ultrapowers/docs/` layout convention, the
  `STATE.md` trigger, and the two-file state model.
- **Four plans from 2026-07-28 executed, reviewed and merged — 2026-07-29.** The
  `.ultrapowers` planning tree, versioning and changelog, design records and stack rules, and
  the gsd-core detector with the `base`/`lite` statusline. `06-SUMMARY.md` and `07-SUMMARY.md`
  were written and verified: five sections each, no diff content, 20.8 KB and 23.3 KB.

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
