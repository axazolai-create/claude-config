# Phase 02 — AI Development Mode: Summary

Plan: `docs/superpowers/plans/2026-07-26-ai-development-mode.md`
Spec: `docs/superpowers/specs/2026-07-26-ai-development-mode-design.md`
Branch: `feat/ai-dev-mode-spec`. Branch base (implementation start): `bbc94ed`.
Final state per ledger: `1712113..c9d4475` (12 commits), full suite 119/119 green.

## Tasks

- Task 1: Characterization tests pinning current leanmode resolution behavior ahead of the injector refactor. (`bbc94ed..a0c7e34`)
- Task 2: Universal multi-axis rule injector — registry + hook, leanmode axis only, not yet wired into settings. (`a0c7e34..dd209d0`)
- Task 3: Injector wired into settings on both events (SessionStart + SubagentStart); `leanmode-subagent.mjs` retired; variants updated. (`23d4183..626556c`)
- Task 4: Verbosity axis resolver (`resolveVerbosityLevel`/`loadVerbosityRule`) + three tier rule files (lite/full/ultra), each carrying the anti-minification carve-out. (`626556c..703c842`)
- Task 5: Verbosity axis registered in the injector on both events; axis independence from leanmode proven (RISK-INJECT-001). (`703c842..f24ffe1`)
- Task 6: `/aidev` dial command plus lite-variant registration for the AI-dev-mode (A) files. (`f24ffe1..5696a7a`)
- Task 7: G Stage 1 — advisory `graphify-grep-nudge.mjs` on Grep/Glob, structurally cannot deny. (`5696a7a..8377b42`)
- Task 8: G Stage 2 — graph freshness signal (mtime vs. HEAD commit) wired additively into the nudge; existing autosync machinery untouched. (`8377b42..74042a6`)

## Rulings

### Per-task Deferred Minor notes (verbatim from the ledger)

- Task 2: "Deferred Minor (final review): test tmpdir cleanup not in try/finally — leaks inj-* on assert failure (low impact, brief-authored pattern; also present in leanmode-rules.test.mjs)."
- Task 3: "Deferred Minor (final cleanup wave): session-init.mjs:400 comment still names `leanmode-subagent.mjs` — behavior unaffected (now inject-axes on SubagentStart), just stale filename in prose."
- Task 4: "Deferred Minor (final wave, PRIORITY — guards RISK-VERBOSITY-001): carve-out test only matches /NOT minification/, not full text — strengthen to assert key phrases (e.g. "never shorten identifiers"). Also: no unknown-level test for loadVerbosityRule."
- Task 7: "Deferred Minor (final wave): regex term `imports` over-broad (false-positive nudges on paths containing "imports"); no isMainModule entry-guard (latent trap if a test imports the hook). Both advisory/brief-authored."
- Task 8: "Deferred Minor (final wave): git spawnSync timeout 3000ms could stall PreToolUse up to 3s on a git hang — tighten to ~1s; no explicit non-repo fail-soft assertion."

### Consolidated final-review triage list (verbatim from the ledger)

> ## Deferred Minors for final-review triage:
> - [PRIORITY, RISK-VERBOSITY-001] Task 4: carve-out test only matches /NOT minification/ — strengthen to assert key phrases (e.g. "never shorten identifiers").
> - Task 4: no unknown-level test for loadVerbosityRule.
> - Task 2: test tmpdir cleanup not in try/finally (leaks on assert failure) — in inject-axes.test.mjs AND leanmode-rules.test.mjs.
> - Task 3: session-init.mjs:400 comment still names leanmode-subagent.mjs (stale filename; behavior unaffected).
> - Task 7: nudge regex term `imports` over-broad (false-positive nudges); no isMainModule entry-guard on graphify-grep-nudge.mjs.
> - Task 8: git spawnSync timeout 3000ms → tighten ~1s; add explicit non-repo fail-soft test.
> - DOC: spec 2026-07-26...design.md §4 Stage 2 wrongly cites graphify-freshness* as prior art — correct it (freshness was done additively, not by reuse).

### Disposition (verbatim from the ledger)

> ## Final whole-branch review (opus): READY TO MERGE WITH FIXES.
> ## Final fix bundle applied (c9d4475): must-fix #1 (carve-out assertion strengthened) + #4 stale comment + #6 timeout 3s→1s + #7 spec §4 correction.
> ## OK-TO-DEFER (post-merge follow-ups): #2 unknown-level test for loadVerbosityRule; #3 try/finally tmpdir cleanup in tests; #5 nudge `imports` regex tighten + isMainModule entry-guard.

Note: the triage list's item 6 has two clauses — "tighten ~1s" (fixed, see below) and "add explicit non-repo fail-soft test" (not named in either the must-fix or the OK-TO-DEFER disposition lines; the ledger does not explicitly dispose of this second clause).

## Deviations and decisions

- **Task 8 — the plan's Stage 2 premise did not hold.** The plan assumed `payload/bin/graphify-freshness.mjs` already exposed a graph-staleness signal ("a freshness mechanism ALREADY EXISTS... does it already expose an 'is this graph stale?' signal"). The implementer read the file and its test first and found it is a PyPI CLI-version checker (installed `graphify` version vs. latest on PyPI) — a false-friend name, unrelated to `graphify-out/graph.json` staleness. The design spec itself (§4 Stage 2) also named `graphify-freshness*` as prior art, which the implementer judged "aspirational/imprecise — the code doesn't back it." Decision made on the spot: since the goal (nudge says "stale" when appropriate) was reachable additively, the implementer left `graphify-global-sync.mjs`/`graphify-global-sync-run.mjs` (the actual autosync machinery, which writes the separate *global* graph, not the per-project one the nudge checks) completely untouched, and computed staleness locally inside `graphify-grep-nudge.mjs` via `statSync` mtime vs. `git log -1 --format=%ct`. This also meant RISK-GRAPHFRESH-001's characterization-test guard was judged inapplicable ("nothing there changed"). The implementer also corrected the invocation wording from the brief's implied `--update` flag form to the actually-documented `graphify update .` command, citing the "never invent APIs/flags" convention.
- **Task 3 — an out-of-scope hardcoded test literal was found but not fixed in-task.** `variants.test.mjs:164` hardcoded the literal `"leanmode-subagent.mjs"` in a lite-hook-set assertion, outside the task's authorized file list. The implementer left it red and reported it as a named concern rather than silently editing an unauthorized file or leaving the suite red unexplained; a same-day follow-up fix (commit `626556c`, folded into Task 3's range per the ledger) corrected the literal to `"inject-axes.mjs"`.
- **Task 3 — deviation from the literal brief text, judged in-scope.** The brief said to replace `"hooks/leanmode-subagent.mjs"` with the literal `"hooks/inject-axes.mjs"` in `variants.json`. The implementer instead used the wildcard `"hooks/inject-axes*"` and additionally added `"hooks/settings-injector.test.mjs"` as a new include entry, to satisfy the classification test's "every payload file is covered by include ∪ exclude" invariant — following the file's existing wildcard precedent (`"hooks/lib/leanmode-*"`) rather than the brief's literal string.
- **Task 6 — brief's Step 4 partially already done.** The brief instructed adding both `"hooks/lib/verbosity-*"` and `"commands/aidev.md"` to `lite.include`. The implementer found `"hooks/lib/verbosity-*"`, `"hooks/inject-axes*"`, and `"hooks/lib/inject-axes.mjs"` already present from Task 4's work and added only `"commands/aidev.md"`, avoiding duplicate glob entries.
- **Task 7 — deviation from the stated commit file list, to avoid landing a red suite.** The brief's commit discipline named exactly 4 files to stage. Adding the 7th lite hook broke two pre-existing hardcoded assertions ("lite keeps exactly the 6 lite hooks") in `variants.test.mjs` and `setup-variants.e2e.test.mjs`. The implementer updated both counts (6→7) and included those two test files in the commit alongside the 4 brief-named files, reasoning from the stack rule "before commit: run the project's linter and tests" rather than leaving the suite red for a later task to discover.
- **Task 2's own report file documents a stale-content hazard that recurs at plan-summary scope.** `task-2-report.md` opens with a note that its filename previously held an unrelated report ("Lite overlay content + purity guard", commit `d4e8552`, a different session/topic) which the implementer flagged rather than silently discarding, preserving it below an "Archived below" marker in the same file.
- **Dispatch-vs-content mismatch in the fix-wave reports (this fold's own input, named per the ledger-disagreement constraint).** The dispatch instructions for this summary named four files as "the four fix-wave reports" for this plan: `final-fixes-report.md`, `final-review-fix-report.md`, `fix-wave-lite-report.md`, `fix-wave-report.md`. Only `final-fixes-report.md` (commit `c9d4475`) actually matches this plan — its content and commit hash match the ledger's "Final fix bundle applied (c9d4475)" line exactly. The other three are fix-wave reports for unrelated branches that happen to share this directory: `final-review-fix-report.md` is headed "csharp-stack-support branch" (commit `cdd04a2`, C# stack-rules-check markers), `fix-wave-lite-report.md` is headed "Branch: `feat/lite-variant`" (commits `04009b1`/`be12714`/`b02a4d2`/`60b9e6d`/`4498a78`), and `fix-wave-report.md` is headed "Branch: `feat/graphify-neo4j`" (commit `e8bd949`). None of these three branches, commits, or topics appear anywhere in `progress.md`'s AI Development Mode ledger. This is the same filename-reuse hazard the Task 2 report flags about itself (above), recurring at the fix-wave-report layer. Their content is not folded into this summary as if it were part of this plan.

## Reviews

- `git diff bbc94ed..a0c7e34`
- `git diff a0c7e34..dd209d0`
- `git diff dd209d0..23d4183`
- `git diff 23d4183..626556c`
- `git diff 626556c..703c842`
- `git diff 703c842..f24ffe1`
- `git diff f24ffe1..5696a7a`
- `git diff 5696a7a..8377b42`
- `git diff 8377b42..74042a6`
- `git diff 1712113..74042a6` (final whole-branch review, all 8 tasks)
