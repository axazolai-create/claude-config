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

One thing is unfinished, and it lives only in a branch:

- **The fork has EIGHT unpublished commits** on branch `feat/workspace-coherence`
  in `D:\6__Work\AI_Projects\ultrapowers`. It currently publishes `6.2.0-up.3`;
  `patch` and `main` are clean and pushed at that revision. The branch carries:
  three coherence fixes (the workspace surviving `git worktree remove`, the
  `NN-PLAN.md` slug collision, and a false `NN-REVIEW.md` claim), the `refs/` and
  `.ultrapowers/docs/` layout convention, the `STATE.md` trigger, and the
  two-file state model. Publishing means: fast-forward `patch`, bump
  `transform/config.json` revision 3 → 4, `build-cli.mjs check`, commit,
  `build-cli.mjs commit`, `drift`, then `git push origin patch main`.

## Next, in order

1. Publish the fork revision `6.2.0-up.4`.
2. Audit the live config dir, write the impact assessment, deploy from `master`.
   **Read the warning below first.**
3. Run the new phase the user opened: enforced state, transparent statuses,
   `/up-resume`. It must go brainstorming → spec → plan → execution, by their
   ruling. Details in `.ultrapowers/sdd/2026-07-28-ultrapowers-planning-tree/progress.md`,
   near the end.
4. Only then plan #3 — decision records CLI — so it runs under the corrected
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
- `integration` is **not** a status axis. Branch and merge state is a delivery
  fact. Keep the fact, stop calling it a status.
- The agreed vocabulary, not yet applied: `planned`, `running`, `blocked`,
  `complete`, `superseded`, `abandoned`. Phases and plans also need explicit
  dependencies.
- The unmerged-at-the-time statusline design asserts `STATE.md` and `ROADMAP.md`
  are absent from this tree. That is now false and must become a rule rather than
  something someone remembers.
