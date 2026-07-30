---
updated: 2026-07-30
current: "08"
deployed_through: "05"
phases:
  - { phase: "01", slug: graphify-neo4j, status: complete, integration: merged }
  - { phase: "02", slug: ai-development-mode, status: complete, integration: merged }
  - { phase: "03", slug: ultrapowers-layer0-patcher, status: abandoned, integration: merged }
  - { phase: "04", slug: ultrapowers-planning-tree, status: complete, integration: merged }
  - { phase: "05", slug: versioning-and-changelog, status: complete, integration: merged }
  - { phase: "06", slug: design-records-and-stack-rules, status: complete, integration: merged }
  - { phase: "07", slug: gsd-core-detector-and-statusline, status: complete, integration: merged }
  - { phase: "08", slug: unified-statusline, status: running, delivery: branch }
---

# Roadmap

Phase 08 is running. Six phases are complete, one is abandoned, and everything
merged past phase 05 is still undeployed.

| Phase | Status | Where the work is |
|---|---|---|
| 01 graphify-neo4j | complete | merged; branch gone |
| 02 ai-development-mode | complete | merged; branch gone |
| 03 ultrapowers-layer0-patcher | abandoned | branch merged, nothing shipped |
| 04 ultrapowers-planning-tree | complete | merged, deployed |
| 05 versioning-and-changelog | complete | merged, deployed |
| 06 design-records-and-stack-rules | complete | merged |
| 07 gsd-core-detector-and-statusline | complete | merged, not deployed |
| 08 unified-statusline | running | `feat/unified-statusline`, 7/8 tasks |

Phase 03's row is the reason `status` and `integration` are separate fields: its
probe commits and its rollback are both in `master`, and the phase still did not
ship. Each phase's own `NN-STATE.md` carries the detail and the task tally.

`deployed_through` is a waterline, not a per-phase flag: everything in `master`
through phase 05 is installed on this machine. One deploy of `master` carries
every merged phase, so recording it six times would mean six writes for one
event, and five of them would not happen.

## Next

1. Finish phase 08 — `08-PLAN.md`, executed subagent-driven; resume from
   `.ultrapowers/sdd/phases-08-unified-statusline/progress.md`.
2. Deploy from `master` — gated on an audit and a written impact assessment,
   never from a feature branch. Phases 06 and 07 are merged and waiting on it,
   and `master` is 48 commits ahead of the published `origin/master`, which is
   why a machine bootstrapped from GitHub installs neither of them.
3. Give phase 07 its `07-SPEC.md` and `07-PLAN.md` by moving
   `.ultrapowers/archive/{specs,plans}/2026-07-28-gsd-core-detector-and-statusline*.md`
   into its directory, and repair the references the move breaks.

## Not yet phases

One piece of work exists without a phase directory, because nothing in this tree
is scaffolded before it has content.

- **The decision-records CLI.** Never started. Plan:
  `.ultrapowers/archive/plans/2026-07-28-decision-records.md`. It runs last by
  its own constraint: `resolveRecordPaths` only resolves to `.ultrapowers/adr/`
  once the tree exists, and its normaliser should rewrite a register that already
  contains the statusline work's entries.

`.ultrapowers/archive/plans/2026-07-28-EXECUTION-ORDER.md` holds the schedule
these two came from and the reasoning behind it. Its paths for the four executed
plans are historical — those plans now live in their phase directories as
`NN-PLAN.md`.

## Open, and carried by no phase

- **Deploy before the plugin moves.** The bundle must be deployed before the
  ultrapowers plugin is updated past the revision the deployed copy was built
  against, because the published fork tells design sessions to run a checker the
  older deployed copy answers differently. The fork publishes `6.2.0-up.4` as of
  2026-07-29 — the coherence fixes and this tree's own state-file convention are
  in it — while the installed plugin is still `up.1`. Nothing is staged
  unpublished. The gap is now three revisions wide, so this ordering constraint
  binds harder than when it was written.
- **One edit still owed to the user.** `~/.claude/CLAUDE.md` is `CURATED:NOEDIT`
  and says the risk register lives in `.planning/` or the project root; this tree
  keeps it at `.ultrapowers/RISK_REGISTER.md`. Only the user can reconcile that.
- **Risks filed during execution** live in `.ultrapowers/RISK_REGISTER.md` with
  stable IDs — `RISK-PHASEDIR-001`, `RISK-PLANTREE-001`, `RISK-CHANGELOG-001`
  and `RISK-CHANGELOG-002`. They are indexed there, not here; this line exists
  so nobody has to rediscover the file.
- **Two IDs the old root `STATE.md` claimed were filed are not in the register.**
  `RISK-VARIANT-005` appears only as an expected output of a verification step in
  the decision-records plan, so it is anticipated rather than filed;
  `RISK-SETUP-001` appears nowhere else in the tree at all. Either they were
  never written, or they were written under other IDs. Carried across as a
  correction rather than copied, because a state file that names records that do
  not exist is the failure this format replaced.
