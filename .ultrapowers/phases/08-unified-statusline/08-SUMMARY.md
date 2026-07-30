# Phase 08 — Unified Statusline — Summary

Plan: `.ultrapowers/phases/08-unified-statusline/08-PLAN.md`. Branch `feat/unified-statusline`,
worked in the main checkout, not a worktree.

## Tasks

- **Task 1 — Capture a live statusLine payload.** **Outstanding — never executed.** Deferred by
  user ruling at the plan's pre-flight scan: the task needs a live Claude Code restart, which no
  subagent can perform. Non-blocking per the plan itself — Task 3's
  `context_window_size ?? total_tokens ?? 1_000_000` read order is correct under either field
  name, and the shape of the `context_window` block was already proven by the pre-existing code.
- **Task 2 — One renderer for every profile.** Deletes `gsd-context-meter.mjs` and its lib/test,
  repoints every registration site (`gsd-statusline-registration.mjs`, `settings.partial.json`,
  `setup.mjs`) at `hooks/statusline.mjs`. `7563412..cb9d259` (review clean)
- **Task 3 — The context segment on the real field names.** Replaces
  `computeUsedTokenMetrics`/`usedTokensOf`/`appendUpdatesSegment` with one
  `computeContext(data) -> string` reading `context_window_size` first. `cb9d259..b5f4b65`
  (review clean)
- **Task 4 — Model and project segments; the git segment goes.** `render()` now joins six
  independent named segments (updates, model, context, project, gsd, up); `renderGit` and
  `plainState` deleted outright, `execFileSync`/git subprocess gone entirely.
  `523ee39..746f8ef` (review clean)
- **Task 5 — The ultrapowers segment is suppressed on lite.** `installedProfile(claudeDir)` gates
  the `up` segment off only when the installed profile is exactly `"lite"`; any other value, or
  no manifest at all, fails open. `d4d5049..53ed7cf` (review clean)
- **Task 6 — Deterministic selection of the work in flight.** `renderPhase`/`roadmapPhases`/
  `upState`/`gsdActive` replace mtime-based `sddState` selection with `ROADMAP.md`'s `current` →
  a single `running` phase → the SDD ledger as last resort; the gsd segment now also requires
  `gsd-core/VERSION` to exist. `281f15b..dd22044` (review clean after one fix round)
- **Task 7 — The renderer cannot hang and cannot print "undefined".** Adds an unref'd
  stdin-timeout guard plus an explicit `stdin.destroy()` in `finish()`, and null/undefined
  guards in `renderGsd`/`renderSdd`. `7837ef3..9d1ed58` (review clean after two fix rounds)
- **Task 8 — Documentation.** Both READMEs and `statusline.mjs`'s header comment rewritten to
  describe the single renderer and its six segments; stale `gsd-context-meter` mentions removed
  outside `docs/` and `.ultrapowers/` history. `8c113dc..7551abd` (review clean)

- **Out-of-band — orphaned `.test/unit/` repair.** Task 2's deletion of `gsd-context-meter-lib.mjs`
  left three tests failing in the gitignored, untracked `.test/unit/` directory (one file failing
  at import, two stale-path assertions in `gsd-statusline-registration.test.mjs`), invisible to
  Task 2's own "501/501 pass" claim because that sweep never reaches an untracked directory. Fixed
  on disk (23/23 after). No commit exists or should exist: `.test/unit/` was deliberately
  untracked by commit `496eb1b`, and the fix agent declined `git add -f` to reverse that decision
  unilaterally.
- **Out-of-band — final fix wave.** One dispatch, four commits `0ebf26e..01aeaf0` (opus), all six
  findings from the final whole-branch review addressed: two merge gates, one interactive
  combination that stranded a deleted path, and three surviving mutants. Scoped re-review verdict:
  ready to merge, no Critical or Important breakage.

## Rulings

Every finding the ledger records as parked or deferred, copied verbatim, in ledger order.

### Task 2

> Task 2: minor (deferred): `gsd-statusline-registration.mjs:24-25` — `isOurs` now matches
> both the old and new command strings and short-circuits to `reason: "already set"`
> before comparing against `wanted`, so a machine still carrying the old
> `gsd-context-meter` command is reported as "already set" when its command is in fact
> stale. Not a functional regression — the real migration happens in `setup.mjs`, which
> the reviewer confirmed actively rewrites on either historical value — but the
> diagnostic string that `gsd-defaults-sync.mjs:36` prints is misleading. Fix would be
> to compare against `wanted` before returning "already set".

> Task 2: minor (deferred): the new e2e test omits the old test's `installed()` check that
> the file a registered command points at exists on disk for the `base` case. Plan-mandated
> (the brief's Step 1 code specifies it that way); independently covered by
> `variants.test.mjs`'s unmodified `basenames.has("statusline.mjs")` assertion.

### Task 3

> Task 3: ⚠️ resolved by controller — the reviewer could not verify `render()` from the diff
> because Task 3 does not touch it. Not a gap: `render()` is replaced wholesale by Task 4,
> and the joined output is covered by the entry-point tests that did run.

> Task 3: minor (deferred): `statusline-lib.mjs:92-96` — no numeric guard on
> `used_percentage`, so a non-numeric value would render literally as `NaN%` rather than
> being dropped the way `null`/`undefined` are. Cannot throw, so `safe()` never engages.
> Documented payload type is `number | null`, so this is a trusted-boundary precondition;
> `Number.isFinite(pct) ? pct : null` would close it cheaply.

> Task 3: minor (deferred): no test for a negative `used_percentage` (renders cosmetically
> wrong, does not crash) or for `current_usage` fields arriving as numeric strings
> (already handled by `Number(...)`, just unverified).

### Task 4

> Task 4: parked — ruling: accepted. The implementer reworded a comment inside `gsdState`,
> a function my dispatch reserved for Tasks 5-6. Logic byte-identical; the old comment
> referenced `plainState`, which this task deletes, so leaving it would have left a
> dangling reference to a deleted concept. My "must not change" meant bodies and logic,
> not stale prose about code the same task removes. Task 5's diff absorbs it harmlessly.

### Task 5

> Task 5: minor (deferred): the `installedProfile` unit test covers a valid manifest and a
> missing file but not malformed JSON or a manifest parsing to a non-object. Behaviour is
> correct by inspection (`safe()` catches the parse throw, the `m &&` guard prevents
> property access on a primitive), and the brief did not ask for the case.

### Task 6

> CORRECTION to the entry below, established after the fix ran: **the branch was never
> broken.** `.gitignore` excludes `.test/` entirely and commit `496eb1b` deliberately
> untracked those three files, recording that they stay on disk and run via `node --test`.
> So the failures were in untracked local files — absent from the branch and from any fresh
> clone — and task 2's "501/501 pass" was honest about everything git actually holds. The
> fixes are applied on disk and verified (23/23 with the two remaining files named
> explicitly); there is no commit and there should not be one. The fix agent declined
> `git add -f` rather than silently reverse `496eb1b`, which was the right call.
> Open question for the human, not blocking: untracked tests rot unnoticed, which is exactly
> what happened here. Either `.test/unit/` returns to git or it is accepted as a local
> sandbox.

> Task 6: minor (deferred): `statusline.mjs:122` — `fmField`'s `^[ \t]*${key}` tolerates
> arbitrary indentation and `.exec` takes the first match, so a nested key could outrank the
> intended top-level one. Not reachable today (all frontmatter read here is flat), but gsd
> states do nest. Anchoring to column 0 removes the class.

> Task 6: minor (deferred): `statusline.test.mjs:379,386` — `doesNotMatch(/✔/)` is not scoped
> to the phase segment, and `renderSdd` also emits `✔`, so the assertion cannot distinguish
> "no phase segment" from "no segments at all". `/0[78] ✔/` would say what is meant.

> Task 6: minor (deferred): the two falls-through gsd tests assert `startsWith(<project>)` plus
> "no undefined", which a guessed-garbage segment would also satisfy; exact equality would
> pin the fall-through. Pre-existing shape, not introduced by this task.

> Task 6: minor (deferred): the determinism test (`statusline.test.mjs:456-460`) depends on a
> gsd fixture but still runs on `EMPTY_CLAUDE_DIR`, so the line it round-trips no longer
> contains the gsd segment. Cannot fail; moving it to `GSD_CLAUDE_DIR` restores its reach.

> Task 6: minor (deferred): `statusline.mjs:2-3` — the module header still says "full keeps
> gsd-context-meter.mjs", a module task 2 deleted. Task 8 owns documentation and should take it.

### Task 7

> Task 7: minor (deferred): the release-stdin rationale is stated twice in near-identical
> wording around `finish()`; could be one comment.

> Task 7: minor (deferred): `Number(process.env.CLAUDE_STATUSLINE_STDIN_MS) || 1500` treats an
> explicit `"0"` as unset. Harmless — a 0 ms guard is not a meaningful value — but worth a
> note if that seam is ever surfaced for debugging.

### Task 8

> Task 8: minor (deferred), **and it is mine**: the worked example `⬆ ultrapowers context-mode`
> in both READMEs uses "ultrapowers" as though it were a trackable component. It is not —
> `component-registry.mjs`'s `COMPONENTS` lists only context-mode, graphify, claude-config,
> impeccable, ui-ux-pro-max, and `pendingNames` can surface nothing else. I wrote that example
> into the dispatch prompt. A false example in shipped documentation, so worth the one-word
> fix: `⬆ context-mode graphify`, which is what the test suite itself uses. Flagged to the
> final whole-branch review for triage rather than fixed in the controller session.
>
> (Disposition: fixed in the final fix wave, Finding 2 — see below.)

> Task 8: minor (deferred): `README.md`'s `(m) merge` bullet repeats the retention explanation a
> second time and has no English counterpart, so the Russian document is measurably more
> detailed there. Pre-existing asymmetry, not caused by this task.

### Final whole-branch review and adjudication

> FINAL WHOLE-BRANCH REVIEW (opus, 20 commits, 7a7e919..0ebf26e): **ready to merge with fixes.**
> Verified all suites green on this checkout and ran a 22-mutant sweep against a temp copy of
> `payload/hooks/` — 20 killed, including every load-bearing one. Removing the stdin
> `setTimeout` fails 31 tests; removing `stdin.destroy()` hangs the runner to timeout.
> Confirmed the spec's "Out of scope" list was honoured in both directions, and that
> `setup.mjs`'s migration ordering is correct: the statusLine value is written at the settings
> merge (~line 1028) and `pruneStale()` runs later (line 1247), so no single run can delete the
> wrapper before repointing the command.
> Two merge gates and three surviving mutants dispatched as ONE fix wave. Triage of the ten
> deferred minors: #1 and #9 must fix; #4 and #8 not an issue; the rest defer.
> Correction the reviewer made to my own ledger reasoning: `pendingNames` does NOT filter by
> `COMPONENTS` — it returns any key with `updateAvailable === true`. The `⬆ ultrapowers`
> example is false because nothing ever *writes* that key, not because the reader rejects it.

> FINAL FIX WAVE: one dispatch, four commits 0ebf26e..01aeaf0 (opus), all six findings addressed.
> Scoped re-review (opus) verdict: **ready to merge**, no Critical or Important breakage.
> Both merge gates closed — `ensureStatuslineOverride` now actually migrates a retired
> registration, and the false `⬆ ultrapowers` example is gone from both READMEs.

Residuals of that wave, adjudicated by the controller, no second wave by process:

> parked — ruling: **merge without it.** Finding 3's warning has no committed test. The thing at
> risk of vanishing is a log line, not a repair: the warning never fixes settings, and every
> path except the `(s)`-plus-prune combination already repoints correctly, so a regression costs
> one diagnostic message in a rare case, not a broken machine. The re-reviewer's third option is
> the right follow-up — a ~10-line source-level pin in the style of the no-subprocess test,
> asserting the function is defined and called after `pruneStale()` in `main()`. Not a TTY e2e
> case: that would widen a 52-second suite at the last gate. Tracked, not gating.

> parked — ruling: **accepted as written.** The warning's repair advice ("re-run and answer
> (r)/(m)") is inapplicable to one case it can fire on: a genuinely custom command naming a
> missing file under CDIR is never taken over by any re-run or bulk flag, so that user must edit
> `settings.json` by hand. The factual claim stays true; only the remedy is wrong for a case
> that is itself pathological. Log-only, narrow.

> parked — ruling: **accepted, consistent with the installer.** A user-appended argument on our
> own renderer (`node "…/statusline.mjs" --flag`) is now rewritten away, where the old code left
> it. `setup.mjs:1026` already does exactly this, and the function reports the change through
> `reason`, so it is not silent. Divergence between the CLI and installer paths would be worse.

> **surfaced to the human, not parked:** finding 1 is a merge gate whose entire regression
> coverage lives in `.test/unit/gsd-statusline-registration.test.mjs`, which is gitignored and
> untracked. So the branch ships a merge-gate fix with no test inside it. Same structural gap as
> the `.test/unit/` rot found earlier. This is a repo-convention decision, not mine.

## Deviations and decisions

**Task 2 — the brief named test helpers that do not exist.** The brief's Step 1 replacement test
called `freshHome()` and `runSetup()` as "this file's existing helpers"; neither is defined
anywhere in `setup-variants.e2e.test.mjs`. The implementer kept the brief's exact assertions and
test name but built the body on the file's real helpers — `mkdtempSync(join(tmpdir(), "cc-xxx-"))`
and `run(dir, args)` (a `spawnSync` wrapper) with `--replace-all` for non-interactive, deterministic
repeat runs — and confirmed the test failed first, then passed. Separately, the implementer found
one more `existsSync` assertion (pre-edit line 490, in the "bundle-owned file survives a declined
stale-prune" test) checking a file this same task deletes, sitting outside the brief's Step 7 line
list; dropped it as dead rather than substitute, since `hooks/gsd-config-patch.mjs` already sits in
the same array providing the same full-only coverage.

**Task 4 — the brief's "one wins" composition was structurally replaced, not extended.** The old
renderer chose one detail source (`gsdState() || sddState() || plainState()`); the new one emits
the project name unconditionally and appends gsd and up independently. This made the pre-existing
entry-point test "gsd wins over sdd when a project has both" describe behaviour that no longer
exists — the implementer renamed it to "gsd and up both render when a project has both" rather than
leave a title contradicting the brief's own new unit test. The reviewer then audited every changed
test individually: 5 removed because the behaviour was removed, 2 added, 3 renamed in place with
assertions still exact-match, arithmetic matching the head count with no weakened assertion found
anywhere.

**Task 6 — the plan's own code sample would have shipped `✔0/0` for an unplanned phase, and its own
unit test passed for the wrong reason.** `fmField` returns `null` for an absent frontmatter key, and
`Number(null)` is a finite `0`, so a phase with no plan yet rendered `08 ✔0/0 planned` — exactly the
output the brief's prose forbids. The brief's own unit test never caught this because it omitted the
keys entirely, exercising `undefined` (which correctly yields `NaN`), not the `null` shape
`phaseSegment` actually produces. Root-caused and fixed with `total == null ? NaN : Number(total)`
(same for `done`), confirmed by mutation to fail exactly three tests when reverted. The implementer's
own lesson: the first mutation pass checked that tests catch implementation changes but never that a
test's *inputs* match what production supplies — a mutant confined to the `null` branch is invisible
to a test that only ever passes omitted keys.

**Task 6 — the dispatching instructions were factually wrong about JavaScript's `$` and `\r`.** The
brief told the implementer that under `/m` the `$` anchor does not see `\r`, so `fmField` would
capture a trailing carriage return, and that `.trim()` was needed to strip it. This is not how
ECMAScript works: CR *is* a LineTerminator, so `$` matches before `\r` exactly as it does before
`\n`, and `.` (without `s`) never matches `\r` either — no `\r` is ever captured. The implementer
verified this empirically against three regex probes, corrected the code comment to state the real
reason (`.trim()` is required for trailing spaces/tabs, which *are* captured because the
quote-stripping regex has no `m` flag), and added a trailing-whitespace test to cover the case
`.trim()` genuinely protects. Separately, mutation testing also caught a second toothless test: the
brief's `sel-many` fixture listed phases 07 and 08 as `running` but only created a state directory
for 08, so a mutant loosening `running.length !== 1` to `< 1` survived — the wrong pick resolved 07,
found no directory, and returned `null` anyway. Fixed by giving every listed phase a readable
`STATE.md`.

**Task 7 — a review-suggested assertion could not detect the guard it was meant to test.** Fix round
1's brief relayed the reviewer's proposed assertion, `assert.equal(renderGsd({ milestone: null }),
"")`, as a fix for a coverage gap. The implementer checked it by mutation before committing and
found it did not falsify: `renderGsd`'s body routes `milestone` through
`[milestone, bar].filter(Boolean)`, which drops a lone `null` exactly as it drops `undefined`
whether or not the explicit `if (!milestone) return ""` guard is present, when `phase` is also
absent. The implementer built the fix exactly as scoped rather than silently substituting a
different assertion, and flagged the gap explicitly. The controller acknowledged relaying the
reviewer's shape without checking it first — "the same class of mistake the finding was about" — and
fix round 2 replaced the assertion with `renderGsd({ milestone: null, phase: "3", status: "x" })`,
which the implementer confirmed mutation-sensitive with a real before/after run: it passes with the
guard present and fails at that exact line with the guard deleted.

**Task 2 / final fix wave — a literal `git add -A` conflicted with concurrent controller
bookkeeping.** Tasks 2 and 3 both declined the brief's literal `git add -A`, staging only their own
files by explicit path, because the working tree also held the controller's uncommitted ROADMAP/
STATE bookkeeping and an untracked `graphify-sync.log`. Flagged as a defect affecting every
remaining task (4-8 also say `git add -A`); mitigated at the controller by committing bookkeeping
before each dispatch and gitignoring the stray log, rather than editing the plan.

**Fix-orphaned-unit-tests — the brief's literal `git rm`/commit instruction assumed tracked files
that are not tracked.** `.test/unit/` is entirely gitignored; commit `496eb1b` deliberately removed
these exact three files from the index while keeping them on disk, on the stated rationale that they
"remain on disk and the tests still run via `node --test`." The implementer made the fixes on disk,
verified them (23/23), and declined to force-add or commit — reversing a documented repo convention
was judged out of scope for a fix task, and was left as an explicit open question for the human
rather than acted on unilaterally.

**Final fix wave — two deliberate departures from the reviewer's proposed Finding-1 fix.** The
reviewer's proposed patch was taken almost verbatim, but the implementer changed the `reason` string
to name the old command rather than "the retired renderer" (the only caller prints it verbatim, so
naming the actual value is more useful), and changed the recognise-and-repoint condition to
`currentCmd !== wanted` rather than "names `gsd-context-meter`" specifically — deliberately chosen
so the CLI migration path stays as permissive as `setup.mjs`'s own inline block, which already
normalises unconditionally whenever `ourStatusLine(curCmd)` holds. The implementer considered the
more conservative "only migrate the retired wrapper" variant and rejected it explicitly: diverging
would have made the CLI path quietly weaker than the installer path.

**Final fix wave — Finding 3's call-site placement was a deliberate, argued choice.**
`warnStatuslineNamesMissingFile()` was placed after `pruneStale()` in `main()` rather than inside the
prune's own report, because `pruneStale()` returns early when there are no candidates — exactly the
condition on a re-run by a user staring at a blank statusline, which is precisely when the warning
must fire. The implementer traced the full failure path (the settings merge at
`setup.mjs:915-1030` runs before `pruneStale()` at `setup.mjs:1247`, so answering `(s)` at the
settings diff discards the repointed value and the later prune deletes the file it names) and then
reproduced the exact interactive combination end-to-end through the e2e suite's forced-TTY driver,
rather than stopping at reasoning alone.

## Reviews

- `.ultrapowers/sdd/phases-08-unified-statusline/review-7563412..cb9d259.diff` — `git diff 7563412..cb9d259` (Task 2)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-cb9d259..b5f4b65.diff` — `git diff cb9d259..b5f4b65` (Task 3)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-523ee39..746f8ef.diff` — `git diff 523ee39..746f8ef` (Task 4)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-d4d5049..53ed7cf.diff` — `git diff d4d5049..53ed7cf` (Task 5)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-281f15b..b99fe6b.diff` — `git diff 281f15b..b99fe6b` (Task 6, initial)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-b99fe6b..dd22044.diff` — `git diff b99fe6b..dd22044` (Task 6, fix-round re-review)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-7837ef3..0b94891.diff` — `git diff 7837ef3..0b94891` (Task 7, initial)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-0b94891..9d1ed58.diff` — `git diff 0b94891..9d1ed58` (Task 7, fix rounds 1-2 re-review)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-8c113dc..7551abd.diff` — `git diff 8c113dc..7551abd` (Task 8)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-7a7e919..0ebf26e.diff` — `git diff 7a7e919..0ebf26e` (final whole-branch review, 20 commits)
- `.ultrapowers/sdd/phases-08-unified-statusline/review-0ebf26e..01aeaf0.diff` — `git diff 0ebf26e..01aeaf0` (final fix wave re-review)
