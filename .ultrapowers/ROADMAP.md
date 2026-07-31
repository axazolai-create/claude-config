---
updated: 2026-07-31
current: "13"
deployed_through: "12"
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
  - { phase: "11", slug: protected-paths, status: complete, delivery: merged }
  - { phase: "12", slug: decision-records, status: complete, delivery: branch }
  - { phase: "13", slug: graphify-neo4j-autosync, status: running, delivery: branch }
---

# Roadmap

Phase 13 is running: the graphify chain reaches Neo4j on its own, or it does not reach it at
all — investigation found it broken in four places and frozen since 3 July. Twelve phases are
complete and one is superseded by phase 04. Everything
through phase 08 is deployed; phases 09, 10 and 11 are merged and undeployed, and phase 12 sits
on `feat/decision-records` awaiting its merge. Phases 10, 11 and 12 were all specified and
implemented on 2026-07-31 — the statusline segment, the `.protected` mechanism and the decision
records — which is why the queue below is finally empty. The one thing standing between the
tree and a clean slate is the deploy.

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
| 09 context-meter-severity | complete | merged, deployed |
| 10 phase-progress-segment | complete | merged, deployed |
| 11 protected-paths | complete | merged, deployed |
| 12 decision-records | complete | merged, deployed |
| 13 graphify-neo4j-autosync | running | specified, on `feat/graphify-neo4j-autosync` |

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

1. **Restart Claude Code.** Hooks load at startup, so `protected-guard`,
   `decision-records-nudge` and the `PreCompact` observer are installed but inert until then.
   After the restart, `/hooks` should show `PreToolUse` x9 and `PreCompact` x1.
2. Install `6.2.0-up.5` — `/plugin update` and a restart, done by the user.
3. Watch for the one acceptance check a deploy cannot settle: after the first genuine automatic
   compaction, `~/.claude/state/autocompact.json` must hold a `models` entry whose `tokens` is
   below its `windowSize`, with no `pending` left. The file does not exist yet.

Done, kept as a line each:

- **Deploy from `master` — 2026-07-31.** Ran at `ebfba7d`. 14 files created, 4 updated, nothing
  pruned; `settings.json` merged additively with three new registrations. Two things needed a
  second pass and are recorded because the reason generalises: `node setup.mjs` asks nothing
  without a TTY, and Claude Code's `!` prefix does not provide one — so the curated `CLAUDE.md`
  came back `kept` and the corrected rules did not land. `--replace-all` finished it after a
  dry run proved it would touch that one file and nothing else, `settings.json` having already
  been merged. The default model was left at `opus[1m]` deliberately: the installer calls it
  superseded, but changing it would cost the 1M window.
- **The deploy found a defect the tests had not.** `node ~/.claude/bin/adr.mjs lint` reported
  all three ADRs as missing their `status` while the same code passed from the repository
  minutes earlier — git had checked the files out with CRLF in between. Fixed and redeployed.

The superseded entry below is kept because the assessment it names is still the standing record:

1. ~~Deploy from `master`~~ — the audit ran on 2026-07-31 and its written impact assessment is
   `docs/2026-07-31-deploy-impact-through-phase-12.md`, so what is left is the keystroke,
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

- **Became phase 11 on 2026-07-31 — the `.protected` mechanism.** Specified during phase 09,
  designed and shipped the same day as `phases/11-protected-paths/`. The two questions that
  phase left open are answered in its spec: `cp` is judged by direction with an unparseable
  command denied, and one denial text serves every case. The mechanism ships unarmed — no
  `.protected` file exists in this repository, and creating one is what turns it on.
- **Became phase 10 on 2026-07-31 — the statusline's ultrapowers segment.** Specified during
  phase 09, designed on 2026-07-31 as `phases/10-phase-progress-segment/10-SPEC.md`. Its
  blocker is answered there: a separate `action` field beside `status`, with the live SDD
  ledger — read structurally, by counting briefs against reports, never by parsing prose —
  taking over mode selection and the counters whenever tasks are actually executing, so a
  stale `action` can only mislead in the quieter modes. The status/delivery migration is the
  phase's first step rather than a debt owed to it.
- **Became phase 12 on 2026-07-31 — the decision-records CLI.** Its 2026-07-28 plan moved out
  of `archive/plans/` into `phases/12-decision-records/12-PLAN.md`, as the tree's rule requires.
  It did run last, and its own constraint is why: the normaliser rewrote a register that by then
  carried the statusline and `.protected` work's entries. The plan's measurements were three
  phases stale and were re-taken before any parser was written.
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
