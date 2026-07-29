# State

**Now:** four of the five plans from 2026-07-28 are finished and reviewed clean. Plans #1 (the
planning tree) and #4 (versioning and changelog) are merged into `master` and deployed to this
machine; plans #2 (design records and stack rules) and #5 (the gsd-core detector and the
`base`/`lite` statusline) are complete on their branches and not yet merged. The fork publishes
`6.2.0-up.3`; a further revision is staged and unpublished on `feat/workspace-coherence`, carrying
three coherence fixes and the layout-convention extension below.

**Next:** merge plans #2 and #5, publish the fork revision, then run plan #3 — the decision records
CLI: glossary, ADRs, and the four-section risk register. Plan #3 is the only one of the five never
started. It must run after the others land, because `resolveRecordPaths` only resolves to
`.ultrapowers/adr/` once the tree exists, and its normaliser should rewrite a register that already
contains plan #5's entries.

**Layout, as of 2026-07-29:** a phase's own specification is `NN-SPEC.md` at the phase root;
supporting designs that fed it live in `phases/NN-slug/refs/`, unprefixed and named for what they
decide; artefacts belonging to more than one phase go to `.ultrapowers/docs/`, by kind, with a
subject subfolder only once a kind outgrows a flat list. Another phase needing a spec links to it
rather than copying it.

**Resume from:** `.ultrapowers/archive/plans/2026-07-28-decision-records.md` for plan #3, and
`.ultrapowers/archive/plans/2026-07-28-EXECUTION-ORDER.md` for the schedule and the reasoning
behind it — note that the four executed plans have since moved into their phase directories as
`NN-PLAN.md`, so that document's paths for them are historical. `.ultrapowers/phases/` holds what
has landed; each phase's `NN-SUMMARY.md` carries its rulings verbatim.

**Open, and not carried by any plan:** the register entries filed during execution
(`RISK-PHASEDIR-001`, `RISK-PLANTREE-001`, `RISK-CHANGELOG-001/002`, `RISK-VARIANT-005`,
`RISK-SETUP-001`); the one edit handed to the user, because `~/.claude/CLAUDE.md` is
`CURATED:NOEDIT` and says the risk register lives in `.planning/` or the project root; and the
ordering constraint that the bundle must be deployed before the ultrapowers plugin is updated past
`6.2.0-up.2`, since the published fork tells design sessions to run a checker the older deployed
copy answers differently.
