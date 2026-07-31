---
updated: 2026-07-31
current: null
deployed_through: "08"
phases:
  - { phase: "01", slug: graphify-neo4j, status: complete, delivery: merged }
  - { phase: "02", slug: ai-development-mode, status: complete, delivery: merged }
  - { phase: "03", slug: ultrapowers-layer0-patcher, status: superseded, superseded_by: "04", delivery: merged }
  - { phase: "04", slug: ultrapowers-planning-tree, status: complete, delivery: merged }
  - { phase: "05", slug: versioning-and-changelog, status: complete, delivery: merged }
  - { phase: "06", slug: design-records-and-stack-rules, status: complete, delivery: merged }
  - { phase: "07", slug: gsd-core-detector-and-statusline, status: complete, delivery: merged }
  - { phase: "08", slug: unified-statusline, status: complete, delivery: merged }
  - { phase: "09", slug: context-meter-severity, status: complete, delivery: merged }
  - { phase: "10", slug: phase-progress-segment, status: complete, delivery: merged }
---

# Roadmap

Nothing is running and nothing is awaiting merge. Phase 09 merged into `master` at
`4918208` on 2026-07-31, and the phase-09 debts followed at `8e785d6` the same day; both
are pushed. Eight phases are complete, one is superseded by phase 04, everything through phase 08 is
deployed, and phase 09 is merged but not yet deployed. Phase 10 was specified on 2026-07-31
, implemented and merged the same day. Nine phases are complete, one is superseded, everything
through phase 08 is deployed, and phases 09 and 10 are merged but not deployed. The one thing
standing between the tree and a clean slate is that deploy.

Every row carries `delivery`; `integration` is gone. Phase 10 migrated the vocabulary as its
first step, because the segment it builds reads these fields. `delivery` records branch and
merge state only — deployment stays the `deployed_through` waterline above, since one deploy
carries every merged phase at once.

`current` is `null` because naming a merged phase would say a false thing. The cost is
known and accepted: with no phase named, the ultrapowers segment falls through to the
newest SDD ledger and renders a finished plan's task tally, which is accurate about the
tally and misleading about the phase. That is a display defect in the segment, and the
queued redesign below is where it gets fixed — it is not a reason to leave a stale
`current` in place.

| Phase | Status | Where the work is |
|---|---|---|
| 01 graphify-neo4j | complete | merged; branch gone |
| 02 ai-development-mode | complete | merged; branch gone |
| 03 ultrapowers-layer0-patcher | superseded by 04 | branch merged, nothing shipped |
| 04 ultrapowers-planning-tree | complete | merged, deployed |
| 05 versioning-and-changelog | complete | merged, deployed |
| 06 design-records-and-stack-rules | complete | merged, deployed |
| 07 gsd-core-detector-and-statusline | complete | merged, deployed |
| 08 unified-statusline | complete | merged at `82deacb`, deployed |
| 09 context-meter-severity | complete | merged at `4918208`, not deployed |
| 10 phase-progress-segment | complete | merged, not deployed |

Phase 03's row is the reason `status` and `integration` are separate fields: its probe
commits and its rollback are both in `master`, and the phase still did not ship. It reads
`superseded`, not `abandoned`, and carries `superseded_by: "04"`: the patch-in-place
approach was replaced by the fork that shipped, and a `superseded` row without the field
naming its successor decays back into looking like something that was given up. Each
phase's own `NN-STATE.md` carries the detail and the task tally.

`deployed_through` is a waterline, not a per-phase flag: everything in `master` through
phase 08 is installed on this machine, from the deploy of `51a65d0` on 2026-07-30. One
deploy of `master` carries every merged phase, so recording it per phase would mean many
writes for one event, and most of them would not happen.

## Next

1. Deploy from `master` — the audit ran on 2026-07-31 and its written impact assessment is
   `docs/2026-07-31-deploy-impact-through-phase-09.md`, so what is left is the keystroke,
   never from a feature branch. Measured against the merged tree after phase 10: 4 created,
   4 updated, nothing pruned, plus one additive `PreCompact` registration in `settings.json`
   and a curated `CLAUDE.md` conflict that needs an explicit `replace` to land. Two acceptance
   checks can only be settled by a real deploy and a real session, and both are recorded as
   risks rather than assumed: that the context segment renders coloured at the current fill
   level, and that after one genuine automatic compaction
   `~/.claude/state/autocompact.json` holds a `models` entry whose `tokens` is below its
   `windowSize` with no `pending` left. The deploy also carries the two new `rules-src/`
   rules, which bind nothing until it runs.
2. Install `6.2.0-up.5` — `/plugin update` and a restart, done by the user. `enabledPlugins`
   resolves at startup and does not hot-reload, so the three new rules bind on the next
   session, not this one.
Done, kept as a line each:

- **Merge phase 10 — 2026-07-31.** Merged with `--no-ff` and pushed; both suites green on the
  merged result, 572 from the root plus 23 in the hidden `.test/unit/`. The deploy assessment
  was re-measured against the merged tree and now reads 4 created, 4 updated, nothing pruned.
- **Phase 03's status corrected — 2026-07-31.** `abandoned` → `superseded` with
  `superseded_by: "04"`, in this file's frontmatter, its table row and `03-STATE.md`. The
  first application of the status model ruled on 2026-07-29; the rest of that vocabulary
  migration still belongs to the statusline segment's phase.
- **The risk register's location reconciled — 2026-07-31.** Recorded in `.claude/CLAUDE.md`,
  where project scope outranks the user-scope file that names a different path and is
  `CURATED:NOEDIT`. The register does not move. That file was gitignored, so the rule was
  narrowed to `.claude/*` with `!.claude/CLAUDE.md` and the record now travels with a clone;
  the generated `stack-rules.md` and the settings files stay ignored.
- **Push `master` — 2026-07-31.** Done. The entry that claimed 25 commits behind `51a65d0`
  was itself stale by two pushes, which is the failure it was written to warn about.
- **Give phase 07 its spec and plan — 2026-07-31.** Moved out of the archive into the phase
  directory. `08-SPEC.md` and `EXECUTION-ORDER.md` keep the old paths: closed records say
  where a file was.

## Not yet phases

Work that exists without a phase directory, because nothing in this tree is scaffolded
before it has content.

- **The `.protected` mechanism.** Specified by the user during phase 09; requirements are
  recorded in that phase's ledger. A `.protected` file in `.gitignore` format marks paths
  that may not be edited, deleted or moved — copying stays allowed — binding at its own
  level and every level below, with nested files able to extend or override what they
  inherit. It must be a hook, not prose: the user's own global `CLAUDE.md` reserves
  enforcement for hooks and managed policy. Two rulings are already taken: `.protected`
  itself may be edited but never deleted, and that rule is intrinsic rather than a list
  entry; and Bash interception denies anything suspicious rather than matching exactly,
  because a false positive costs a rephrase and a missed deletion costs a file.
- **Became phase 10 on 2026-07-31 — the statusline's ultrapowers segment.** Specified during
  phase 09, designed on 2026-07-31 as `phases/10-phase-progress-segment/10-SPEC.md`. Its
  blocker is answered there: a separate `action` field beside `status`, with the live SDD
  ledger — read structurally, by counting briefs against reports, never by parsing prose —
  taking over mode selection and the counters whenever tasks are actually executing, so a
  stale `action` can only mislead in the quieter modes. The status/delivery migration is the
  phase's first step rather than a debt owed to it.
- **The decision-records CLI.** Never started. Plan:
  `.ultrapowers/archive/plans/2026-07-28-decision-records.md`. It runs last by its own
  constraint: `resolveRecordPaths` only resolves to `.ultrapowers/adr/` once the tree
  exists, and its normaliser should rewrite a register that already contains the statusline
  work's entries.
- **Done 2026-07-31 — the four process rules, agreed during phase 09.** Two shipped in
  `payload/rules-src/` (`node.base.md`, `testing.md`) and two in the fork's `writing-plans`
  skill as delta 011. A fifth rule joined them on the way: the ledger read-back check, delta
  012. Neither half binds anything yet — the `rules-src/` pair waits on the deploy, the fork
  pair on `/plugin update`.

`.ultrapowers/archive/plans/2026-07-28-EXECUTION-ORDER.md` holds the schedule the older
items came from and the reasoning behind it. Its paths for the executed plans are
historical — those plans now live in their phase directories as `NN-PLAN.md`.

## Open, and carried by no phase

- **Done 2026-07-30 — the ordering constraint between the bundle and the plugin.** The rule
  was that the bundle must be deployed before the plugin moves past the revision the
  deployed copy was built against. Satisfied, which unblocked publishing `6.2.0-up.5` on
  2026-07-31. That revision carries deltas 011-013 and is on GitHub but not on this
  machine; the installed copy is still `6.2.0-up.4`.
- **Done 2026-07-31 — the risk register's location.** `~/.claude/CLAUDE.md` is
  `CURATED:NOEDIT` and says the register lives in `.planning/` or the project root; this tree
  keeps it at `.ultrapowers/RISK_REGISTER.md`. Settled by the user's ruling that the
  exception belongs in project scope, which outranks user scope on conflict: it is written in
  `.claude/CLAUDE.md`, the protected file is untouched and no file moved. The root
  `CLAUDE.md` could not hold it — it carries the `CURATED:NOEDIT` marker too.
- **Risks filed during execution** live in `.ultrapowers/RISK_REGISTER.md` with stable IDs.
  Phase 09 added `RISK-STATUSLINE-002` (the autocompact point is assumed until observed,
  with its acceptance check written down) and `RISK-HOOKSTDIN-001` (`token-usage-log.mjs`
  throws on a literal `null` on stdin — found by phase 09, not caused by it, and already
  deployed). Earlier IDs: `RISK-PHASEDIR-001`, `RISK-PLANTREE-001`, `RISK-CHANGELOG-001`,
  `RISK-CHANGELOG-002`, `RISK-ULTRAPOWERS-009`, `RISK-ULTRAPOWERS-010`,
  `RISK-STATUSLINE-001` (closed by observation), `RISK-TESTUNIT-001`.
- **`RISK-TESTUNIT-001` bit a second time in phase 09.** `.gitignore` excludes `.test/`, so
  a fresh worktree has no `.test/unit/` and the suite silently covers less there than on
  `master` — 499 against a fuller count. Nothing failed, and the absent files belong to
  phase 08, but "run the full suite" means something smaller in a worktree than the phrase
  implies. The register entry still awaits the user's decision on which way to settle it.
- **Two IDs the old root `STATE.md` claimed were filed are not in the register.**
  `RISK-VARIANT-005` appears only as an expected output of a verification step in the
  decision-records plan, so it is anticipated rather than filed; `RISK-SETUP-001` appears
  nowhere else in the tree at all. Carried across as a correction rather than copied,
  because a state file that names records which do not exist is the failure this format
  replaced.
