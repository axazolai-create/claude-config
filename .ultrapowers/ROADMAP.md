---
updated: 2026-07-29
current: null
deployed_through: "05"
phases:
  - { phase: "01", slug: graphify-neo4j, status: complete, integration: merged }
  - { phase: "02", slug: ai-development-mode, status: complete, integration: merged }
  - { phase: "03", slug: ultrapowers-layer0-patcher, status: abandoned, integration: merged }
  - { phase: "04", slug: ultrapowers-planning-tree, status: complete, integration: merged }
  - { phase: "05", slug: versioning-and-changelog, status: complete, integration: merged }
  - { phase: "06", slug: design-records-and-stack-rules, status: complete, integration: branch }
---

# Roadmap

Nothing is running. Five phases are complete, one is abandoned, and one of the
complete ones is still sitting on its branch.

| Phase | Status | Where the work is |
|---|---|---|
| 01 graphify-neo4j | complete | merged; branch gone |
| 02 ai-development-mode | complete | merged; branch gone |
| 03 ultrapowers-layer0-patcher | abandoned | branch merged, nothing shipped |
| 04 ultrapowers-planning-tree | complete | merged, deployed |
| 05 versioning-and-changelog | complete | merged, deployed |
| 06 design-records-and-stack-rules | complete | `feat/design-records-stack-rules`, unmerged |

Phase 03's row is the reason `status` and `integration` are separate fields: its
probe commits and its rollback are both in `master`, and the phase still did not
ship. Each phase's own `NN-STATE.md` carries the detail and the task tally.

`deployed_through` is a waterline, not a per-phase flag: everything in `master`
through phase 05 is installed on this machine. One deploy of `master` carries
every merged phase, so recording it six times would mean six writes for one
event, and five of them would not happen.

## Next

1. Write `06-SUMMARY.md` — the only phase document still owed by a finished
   phase.
2. Merge `feat/design-records-stack-rules`.
3. Deploy from `master` after the merge, never from a feature branch.

## Not yet phases

Two pieces of work exist without a phase directory, because nothing in this tree
is scaffolded before it has content.

- **The gsd-core detector and the `base`/`lite` statusline.** Complete on
  `feat/gsd-core-detector` — ten commits ahead of `master` from base `103699b`,
  tip `86353fe` — unmerged, with no phase directory yet. Design:
  `.ultrapowers/archive/specs/2026-07-28-gsd-core-detector-and-statusline-design.md`.
  Plan: `.ultrapowers/archive/plans/2026-07-28-gsd-core-detector-and-statusline.md`.
  Two things about it are now out of date and were true when it was designed.
  Its design says "only the GSD *names* (`STATE.md`, `ROADMAP.md`) are absent"
  from this tree and routes the ultrapowers case through the SDD ledger instead;
  that premise is false as of these files. And its GSD reader parses
  `.planning/STATE.md` with regexes written against a format nobody verified —
  the plan says so itself. Neither is a defect in the branch; both are work for
  whoever teaches the statusline to read the files here.
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
  older deployed copy answers differently. The fork currently publishes
  `6.2.0-up.3`; a further revision is staged and unpublished on
  `feat/workspace-coherence`, carrying the coherence fixes and this tree's own
  state-file convention.
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
