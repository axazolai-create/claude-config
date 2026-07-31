---
updated: 2026-07-31
current: null
deployed_through: "08"
phases:
  - { phase: "01", slug: graphify-neo4j, status: complete, integration: merged }
  - { phase: "02", slug: ai-development-mode, status: complete, integration: merged }
  - { phase: "03", slug: ultrapowers-layer0-patcher, status: abandoned, integration: merged }
  - { phase: "04", slug: ultrapowers-planning-tree, status: complete, integration: merged }
  - { phase: "05", slug: versioning-and-changelog, status: complete, integration: merged }
  - { phase: "06", slug: design-records-and-stack-rules, status: complete, integration: merged }
  - { phase: "07", slug: gsd-core-detector-and-statusline, status: complete, integration: merged }
  - { phase: "08", slug: unified-statusline, status: complete, integration: merged }
  - { phase: "09", slug: context-meter-severity, status: complete, integration: merged }
---

# Roadmap

Nothing is running and nothing is awaiting merge. Phase 09 merged into `master` at
`4918208` on 2026-07-31. Eight phases are complete, one is abandoned, everything through
phase 08 is deployed, and phase 09 is merged but not yet deployed.

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
| 03 ultrapowers-layer0-patcher | abandoned | branch merged, nothing shipped |
| 04 ultrapowers-planning-tree | complete | merged, deployed |
| 05 versioning-and-changelog | complete | merged, deployed |
| 06 design-records-and-stack-rules | complete | merged, deployed |
| 07 gsd-core-detector-and-statusline | complete | merged, deployed |
| 08 unified-statusline | complete | merged at `82deacb`, deployed |
| 09 context-meter-severity | complete | merged at `4918208`, not deployed |

Phase 03's row is the reason `status` and `integration` are separate fields: its probe
commits and its rollback are both in `master`, and the phase still did not ship. Each
phase's own `NN-STATE.md` carries the detail and the task tally.

`deployed_through` is a waterline, not a per-phase flag: everything in `master` through
phase 08 is installed on this machine, from the deploy of `51a65d0` on 2026-07-30. One
deploy of `master` carries every merged phase, so recording it per phase would mean many
writes for one event, and most of them would not happen.

## Next

1. Push `master`. Corrected 2026-07-31: it carries one commit `origin/master` does not, not
   the 25 this list claimed — the remote is at `4918208`, the phase 09 merge itself, so a
   machine bootstrapped from GitHub already gets phase 09 and only misses this tree's own
   bookkeeping. The 25/`51a65d0` figures were written before the push that followed them and
   were never corrected, which is the same stale-fact failure the entry was warning about.
2. Deploy from `master` — gated on an audit and a written impact assessment, never from a
   feature branch. Two acceptance checks can only be settled by a real deploy and a real
   session, and both are recorded as risks rather than assumed: that the context segment
   renders coloured at the current fill level, and that after one genuine automatic
   compaction `~/.claude/state/autocompact.json` holds a `models` entry whose `tokens` is
   below its `windowSize` with no `pending` left.

**Done 2026-07-31 — give phase 07 its spec and plan.** Moved out of the archive into the
phase directory. `08-SPEC.md` and `EXECUTION-ORDER.md` keep the old paths: closed records say
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
- **The statusline's ultrapowers segment.** Also specified during phase 09. Three display
  modes — task counters while executing, a named action otherwise, and a phase tally
  between phases — with five colour states and a phase id kept alongside the phase name.
  Its blocker is not rendering: `NN-STATE.md` has no vocabulary for "planning" or "review",
  so a current-action field has to be designed and the SDD process has to maintain it, or
  the segment will name an action that finished an hour ago.
- **The decision-records CLI.** Never started. Plan:
  `.ultrapowers/archive/plans/2026-07-28-decision-records.md`. It runs last by its own
  constraint: `resolveRecordPaths` only resolves to `.ultrapowers/adr/` once the tree
  exists, and its normaliser should rewrite a register that already contains the statusline
  work's entries.
- **Four process rules, agreed during phase 09. Two landed 2026-07-31.** The
  `= {}`-does-not-catch-`null` footgun is now in `payload/rules-src/node.base.md` and the
  clock-dated-fixture rule in `payload/rules-src/testing.md`, so `setup.mjs` carries both to
  every machine; neither binds anywhere until the next deploy, and neither is in
  `~/.claude/rules-src/` by hand. Two planning rules are still owed — run every command a
  plan prescribes before writing it down, and check each stated invariant against the plan's
  own sample code. They go to the ultrapowers fork's `writing-plans` skill, because a rule
  compiled only into
  `stack-rules.md` binds nothing until `/init-stack` has run. The ledger read-back check
  goes to the fork's `subagent-driven-development` skill; it was trialled once on phase 09
  and earned its place by finding a gap the ledger's own author could not see.

`.ultrapowers/archive/plans/2026-07-28-EXECUTION-ORDER.md` holds the schedule the older
items came from and the reasoning behind it. Its paths for the executed plans are
historical — those plans now live in their phase directories as `NN-PLAN.md`.

## Open, and carried by no phase

- **The ordering constraint between the bundle and the plugin is satisfied.** The rule was
  that the bundle must be deployed before the ultrapowers plugin moves past the revision
  the deployed copy was built against. Both halves now hold: `master` was deployed at
  `51a65d0`, and the installed plugin is already `6.2.0-up.4`. Publishing a new fork
  revision — which the four rules above require — is unblocked.
- **One edit still owed to the user.** `~/.claude/CLAUDE.md` is `CURATED:NOEDIT` and says
  the risk register lives in `.planning/` or the project root; this tree keeps it at
  `.ultrapowers/RISK_REGISTER.md`. Only the user can reconcile that.
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
