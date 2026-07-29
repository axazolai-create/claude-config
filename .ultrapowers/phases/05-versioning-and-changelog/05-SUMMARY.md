# Phase 05 — versioning-and-changelog — Summary

Plan: `.ultrapowers/phases/05-versioning-and-changelog/05-PLAN.md` (the controller's own
ledger calls this run "Plan 4"; worktree `D:\6__Work\AI_Projects\claude-config-wt-plan4`, branch
`feat/versioning-changelog`, branched from `master`). 7 tasks, one whole-branch review, one fix
wave and one fix re-review, all clean at completion. Task 7 did not run — see below.

## Tasks

| Task | Deliverable | Commits |
|---|---|---|
| 1 | Real classifier: `levelForCommit`/`accumulate` derive the bump level from Conventional Commits; `classifyBump` left byte-for-byte untouched | `103699b..f85e0e7` |
| 2 | The queue line carries `<hash> <level>` and `resolveDrain` collapses a batch to one maximum level | `f85e0e7..fa002c7`, plus fix `17a244d..e4a9ad0` |
| 3 | Post-commit hook passes `--classify` so `queue.mjs` classifies each commit as it lands | `fa002c7..be4c498` |
| 4 | `write-changelog.mjs --version-only` — bumps `package.json`/`version.json` with no changelog write, for a part with no changelog UI | `be4c498..17a244d` |
| 5 | `SKILL.md` rewritten: React/Next gate moved off versioning onto rendering only, bump-once policy, monorepo fan-out contradiction resolved, root version added | `e4a9ad0..12166f7` (single commit `12166f7`) |
| 6 | `lint-versions.mjs` reports drift, unclassifiable commits and pending major proposals; folded the `SKILL.md` bump-table `lint` row into this task's own dispatch | `12166f7..47d2ca6`, plus risk-register follow-up `47d2ca6..5e50d6f` |
| 7 | Deploy and verify end to end | **retired by user ruling — no deploys on this work, only merges** |

Two facts the table above flattens:

- **Task 7 never ran.** The plan's own Task 7 was `node setup.mjs` plus a live scratch-repo
  loop. A later, superseding user ruling — "NO DEPLOYS AT ALL. Merges to master only. Nothing
  runs `node setup.mjs` against the real `~/.claude`" — retired it outright, alongside the
  equivalent deploy step in two sibling plans. The exact commands were handed to the user
  instead of run. What Task 7 would have proven end to end was instead proven live, without
  deploying, by the final whole-branch review (see Reviews).
- **Task 6 absorbed an edit no task owned.** Task 5's own report flagged that `SKILL.md`'s
  bump-table `lint` row named a script that did not exist yet, and that neither Task 6's nor
  Task 7's brief touched `SKILL.md` to correct it once it did. The controller resolved this by
  folding the row's correction into Task 6's dispatch rather than leaving it to memory; Task 6's
  commit `47d2ca6` carries both the linter and that one `SKILL.md` row edit.

## Rulings

Every finding the ledger records as parked or deferred, copied verbatim, grouped by the task that
raised it. Resolutions the ledger itself records inline are quoted alongside. Where no per-item
resolution is recorded, the aggregate final-review verdict at the end of this section applies.

**Task 1**

> ⚠️ resolved by controller — "major proposed on a branch carrying many `feat:` commits" is NOT
> implemented, here or anywhere in the plan's 7 tasks. The Global Constraint is permissive ("the
> tool MAY propose one"), and the plan's own Self-Review credits the major path to Tasks 1, 6 and
> §4, all of which key off the explicit breaking marker only. So this is an unimplemented optional
> clause in the plan, not a dropped requirement of Task 1. Recorded for the final review.

> ⚠️ resolved by controller — the subject/body splitter is Task 3's: the plan's Task 3 body runs
> `git log -1 --pretty=%s` and `--pretty=%b` and feeds `levelForCommit`. Not a gap.

> minor (deferred): nested-paren scopes (`refactor(utils(math)):`) fail the SUBJECT regex and fall
> to unrecognised. Inherited verbatim from the plan.

> minor (deferred): the Conventional Commits alias `BREAKING-CHANGE:` is not matched, only
> `BREAKING CHANGE:`. Matches what the plan literally specified.

> minor (deferred): an unrecognised-but-well-shaped type with `!` (`nonsense!: x`) is treated as a
> major proposal rather than flagged unrecognised. Defensible per the bump table's row order, and
> named explicitly by the implementer — worth the plan owner's sign-off.

> minor (deferred): "any type with `!`" is only tested for `feat!:`; no test covers `fix!:` or a
> footer on a no-bump type. Correct by trace. The test file was specified verbatim by the plan.

**Task 2**

> ⚠️ open for Task 3 — "existing projects must not have versions moved retroactively on first
> contact" is a property of the trigger installer, not of queue.mjs. Verify at Task 3's review that
> the installed hook never backfills pre-install commits.

Resolved at Task 3's review: "No-retroactive-backfill CONFIRMED: `ensurePostCommitHook` only
writes a hook, nothing walks `git log` at install time, so installing on an existing project
cannot enqueue a commit that predates installation. That closes Task 2's first open ⚠️."

> ⚠️ open for a later task — locking around the real drain sequence (lock -> drain -> bump ->
> clear -> unlock) lives in a caller outside this diff. `drain` itself never locks, per the plan.

No later task closed this one explicitly; it stands under the final review's aggregate verdict.

> minor (deferred): a whitespace-only queue line survives `.filter(Boolean)` and parses to an
> empty hash; harmless (one wasted lookup, counted unrecognised) but `.filter(l => l.trim())` fixes
> it.

> minor (deferred): `serialise([])` returns `"\n"`, not `""` — currently safe only because every
> caller guards it. A latent trap for the next call site.

> minor (deferred): no test covers an absent `.claude` directory, and `isLocked`/`lock`/`unlock`
> have no tests at all. Pre-existing; that code is unchanged.

> minor (deferred): the try block also wraps `levelForCommit`, so a genuine bug in the pure
> classifier would be swallowed and misreported as "could not classify".

**Task 3**

> known limitation, accepted — an already-installed hook does not auto-upgrade to `--classify`,
> because `ensurePostCommitHook` never rewrites an existing block. Harmless: Task 2's
> `resolveDrain` classifies bare-hash entries at drain time, which is exactly the backward
> compatibility that requirement exists for.

> minor (deferred): the new install-trigger test leaks its mkdtemp directory, unlike the two
> sibling tests in the same file. Inherited verbatim from the plan's snippet.

> minor (deferred): the feature is inert for every pre-existing installation indefinitely — no
> version marker on the hook block forces a rewrite. Sanctioned by the plan.

**Task 4**

> minor (deferred): that same test therefore gives weaker regression protection than it looks like
> it does — it should assert on the `{error: ...}` payload.

> minor (deferred): `--version-only` combined with `--entries-file` silently discards the entries
> file, with no guard or warning.

> minor (deferred, pre-existing): a missing `package.json` crashes with an unhandled ENOENT rather
> than the script's usual `{error: ...}` JSON convention.

This one did not stay parked: the final whole-branch review independently rediscovered the same
defect as its own Finding 2 ("false scope claim + unguarded `package.json` read") and the fix wave
closed it — see Deviations and decisions.

**Task 5**

> minor (deferred): §M6/§M7's repository-root version has no baseline story when the root
> package.json is private or unversioned — `write-changelog.mjs` exits 1 with no `version` field.
> No code path in this plan exercises the root-version write yet.

**Task 6**

> Task 6: "drift" is under-specified in the plan — the plan says lint reports it, the brief's
> Interfaces line names a `pendingSince` param, and the brief's code implements neither. `{entries,
> lookup}` carries no version number, so numeric drift is not computable from those inputs. The two
> computable drift signals were implemented and the signature left alone.

Corroborated independently at review: "Task 7's own brief states '`--version-only` has no
changelog to check it against… `lint` only sees the queue', written by the same plan, corroborating
that numeric drift was never in scope."

**Final review — aggregate triage**

The final whole-branch review did not triage each parked item individually; it gave one verdict
for the whole pile:

> FINAL WHOLE-BRANCH REVIEW (opus): Ready to merge WITH FIXES. 19 deferred items triaged, ALL CAN
> STAND — nothing on the deferred list blocks. The blockers are three new findings, all
> documentation.

## Deviations and decisions

**The plan's own verification steps were wrong, four separate times.** Each is a different failure
mode, not a repeat of the same mistake:

1. *Task 1* — the plan predicted the RED run would fail with `levelForCommit is not a function`
   (a per-test `TypeError`). What actually happened was a module-load `SyntaxError` on the missing
   `accumulate` export, because a static `import` of a non-existent named export fails before any
   test body runs. The underlying cause matched what the plan anticipated; the failure's shape
   did not. Teaches: predicting a RED message by reasoning about the code, not by running it,
   misses how the runtime actually reports a missing-export failure.
2. *Task 4* — the plan predicted 3 of 4 tests would fail before implementation. Only 2 did. The
   third (`--version-only rejects a malformed version`) uses `assert.throws()` with no matcher,
   which only checks that *something* threw — and the pre-implementation script already threw, for
   the wrong reason (missing `--entries-file`, not the malformed-version check). The test still
   exercises the right behavior once the flag exists; the RED count did not. Teaches: an
   unqualified `assert.throws` is a weaker gate than it looks, and can pass vacuously against code
   that doesn't yet do what the test claims to check.
3. *Task 5* — Step 6's verification grep predicted the string `dropped everywhere` in the
   pre-edit `SKILL.md`. The file never contained that string; §M3 actually said "no entry in any
   part." Both greps still produced the brief's expected output, so the step was harmless, but the
   prediction was imprecise. Teaches: a verification grep is only as reliable as the writer's
   memory of the exact prose it is checking for — worth pulling the literal string from the file,
   not from recall.
4. *Task 6* — the brief's Step 5 predicted `exit=0` with no output. The real run returned
   `exit=1`. The tool was right and the plan was wrong: this worktree's gitignored
   `.claude/changelog-queue` held a fabricated `deadbeef…` hash left over from an earlier task's
   manual verification, and `lint`'s first real run against a real queue found real garbage in it.
   Teaches: a plan's "expected: silent, exit 0" step assumes a clean environment that a shared,
   long-lived worktree does not actually guarantee.

**Implementers corrected the controller and the reviewer, not just the plan, on their own
findings.**

- *Task 6, Step 3's brief crashes on an unresolvable hash.* The brief's own sample code called
  `lookup(e.hash)` inside a bare `.filter()`, with no guard. `resolveDrain`, written one task
  earlier in the very same file family, wraps the identical call in `try/catch`. The implementer
  did not copy the brief verbatim; it added the guard, and — because an unresolvable hash and an
  unrecognised-type commit are different problems with different fixes — split them into two
  reported problem types instead of folding the guarded case silently into "unrecognised." The
  final whole-branch review verified this "crash/guard claim" independently, calling it the one
  most likely to hide a fabrication, and it held.
- *Task 6's own cost claim, retracted after being measured.* The implementer had claimed its
  single-pass `lint` design "halves the brief's cost" versus the brief's two-pass sketch. Writing
  the risk-register entry for a related concern forced a re-check, and the claim turned out wrong
  in the common case: the brief's code short-circuits on `!e.level`, so once every queue entry
  carries a recorded level (i.e., once the classify-at-commit-time trigger is installed) the
  brief's version spends *nothing*, while the implementer's spends two `git log` spawns per entry
  unconditionally. The implementer's version is cheaper only against a legacy, all-level-less
  queue. The correction was written into `RISK-CHANGELOG-002` rather than left as a private
  realization.
- *Final fix wave, Finding 1 — the instruction was executed, its stated reason was not.* The
  reviewer's Finding 1 asked for `SKILL.md` to stop claiming `drain` could disclose a major
  proposal or an unrecognised commit, when the code structurally cannot: `resolveDrain`
  short-circuits any level-carrying entry to hardcoded `false`s. Two fixes were possible — drop the
  short-circuit so `drain` always re-reads (a code fix), or document the split (a docs fix). The
  implementer chose the docs fix, and did so for a different reason than either the controller or
  the reviewer had offered: dropping the short-circuit would make the level recorded by commits
  `fa002c7` and `be4c498` (the queue carrying a level, and the trigger recording it) dead
  storage — nothing would read it. At re-review, the reviewer independently confirmed the premise
  by grepping for every reader of `.level` in the codebase and finding exactly one
  (`resolveDrain`'s own short-circuit), and recorded the outcome precisely: "What the implementer
  overrode was my stated REASON, not the fix; the instruction itself was executed to the letter."

**Two open decisions were resolved during execution.**

- *One changelog entry per drain.* The plan states the version moves once per drain by the
  accumulated maximum, but says nothing about how many `changelog.json` entries that one move
  should produce. Task 5's implementer inferred "one entry" from "one version," rewrote §5 on that
  basis, flagged it explicitly as its own inference rather than the plan's text, and sent it to
  review for a recommendation. The controller adopted one entry per drain on the reviewer's
  recommendation, rejecting the alternative (several `changelog.json` entries stamped with the
  identical version) because that alternative renders as duplicate version headers for one release
  in the UI the skill writes for. The follow-up this leaves is recorded, not required now:
  `write-changelog.mjs` does not enforce the convention — it will happily accept multiple entries
  with arbitrary versions — so it rests on `SKILL.md` being followed, not on code.
- *Closing the `SKILL.md` ownership gap.* Task 5's implementer found that the bump table's fifth
  row named `lint`, a script that did not exist yet, and that neither Task 6's nor Task 7's brief
  touched `SKILL.md` to correct the row once it landed — the same failure mode that made Task 5
  necessary in the first place. The controller resolved this by folding the row's correction into
  Task 6's own dispatch instead of leaving it to memory; Task 6's report confirms the row now names
  `lint-versions.mjs`.

**Where the plan's design turned out to be wrong, and what was decided on the spot (Task 5).**
The Monorepo-mode opening promised that a part with no changelog UI still shows up, abstracted, in
other parts' logs; §M3 then stated flatly that there is no cross-part fan-out and a commit
belonging to no part is dropped everywhere — the design that was written was not the design that
was implemented. The implementer judged §M3, not the opening, to be the wrong half: the
source/destination distinction in the opening only means something if sources actually reach other
parts' logs, and §M3's rule was also a silent data-loss hole (a root-level commit belonging to no
workspace was dropped entirely). §M3 was rewritten to make fan-out real (reduced-form entries,
filtered by relevance not softened wording), and §M6 gained a repository-root version to close the
data-loss hole. Downstream, Task 5 also introduced and then reversed a second contradiction during
its own self-review: the plan's `isReactOrNext: false` bullet is written in monorepo vocabulary but
sits in §0's single-project branch; the implementer's first draft applied the monorepo placement
rule to single projects too, caught that this directly contradicted the plan's verbatim bullet for
that same case, and reversed it in favor of the bullet as written.

**A shared worktree caused real cross-task contamination (Task 4).** While implementing Task 4,
unstaged edits to `queue.mjs`/`queue.test.mjs` appeared mid-session that the implementer had not
made — a concurrent agent (Task 2's fix round) writing to the same worktree directory at the same
time, not the isolated per-task worktree the brief describes. The implementer's own commit was
verified clean (`git diff --cached --stat` before committing showed only its own two files), but
flagged the hazard explicitly: a `git add -A` or `git commit -a` by either agent could have
captured the other's in-flight work under the wrong commit message. The ledger records this
confirmed "from a second angle," and the remaining Task 4/5/6 work was serialized in this worktree
from that point on.

**A cross-task bug found by review, fixed by the other task's owner (Task 2, discovered at Task
3's review).** Task 2's `append --classify` CLI path had no `try/catch` around its two `git log`
calls. This was unreachable when Task 2 was written — nothing called `append --classify` yet — but
Task 3 then wired `--classify` into the post-commit hook itself, making the unguarded path run on
every commit on every install. A `git log` failure (bad object, shallow history, any transient git
error) would have thrown out of the CLI handler before `appendHash` ran, permanently and silently
dropping the commit from the queue with no fallback. Task 3's review dispatched the finding back to
Task 2's implementer, who added the guard: on failure the commit is still queued, level-less (like
a legacy line), with one stderr line, and `resolveDrain`'s existing drain-time classification
recovers it later.

**Final fix wave — two of the reviewer's own findings were refined during implementation, not
just fixed.** Finding 2 ("false scope claim, unguarded `package.json` read") specified a
"two-line guard" without specifying where; the implementer placed it *before* the
`changelog.json` write rather than at the old read site, and proved the distinction mattered with
a RED test showing the old ordering left `changelog.json` written even after the ENOENT — guarding
at the read site alone would not have prevented that. Finding 5 ("`drain` leaked git's stderr")
turned out broader than stated: the `append --classify` lookup in `queue.mjs` leaked git's
`fatal: bad object` too, and that leak is worse because it surfaces inside a `post-commit` hook's
output on every commit the classifier can't resolve. Both call sites were fixed and covered,
consolidated into one shared `gitLookup(root)` export.

## Reviews

- Task 1 review: `git diff 103699b..f85e0e7`
- Task 2 review (initial): `git diff f85e0e7..fa002c7`
- Task 3 review: `git diff fa002c7..be4c498`
- Task 4 review: `git diff be4c498..17a244d`
- Task 2 fix re-review: `git diff 17a244d..e4a9ad0`
- Task 5 review: `git diff e4a9ad0..12166f7`
- Task 6 review: `git diff 12166f7..47d2ca6`
- Final whole-branch review: `git diff 103699b..5e50d6f`
- Final fix wave re-review: `git diff 5e50d6f..de202ce`

The final whole-branch review closed most of retired Task 7 itself, without deploying: it built
two scratch repositories and ran the real loop end to end — installed hook, real `git commit`,
queue file, drain, lint, `--version-only` write — plus a legacy bare-hash queue and a mixed/CRLF
queue.

## Outstanding

- **`RISK-CHANGELOG-001`** (filed, Open) — the post-commit hook skips `релиз:`/`патч:` subjects,
  but manual mode commits `v<X.Y.Z>` (and, in a monorepo, `web: v0.4.7, backend: v1.9.2, …`),
  neither of which the hook's skip pattern covers — so a manual bump commit gets enqueued.
  `classify-bump.mjs`'s `SUBJECT` regex is ASCII-only and cannot match Cyrillic either, so absent
  `lint`'s dedicated case these commits would surface as "no recognised type," which is misleading
  rather than merely noisy. `lint` now names both known shapes; the monorepo manual-bump shape
  still falls through to "no recognised type," left unfixed deliberately because widening the
  pattern risks misfiling genuine commits.
- **`RISK-CHANGELOG-002`** (filed, Open) — `lint`'s per-entry `git log` lookups cost `2N`
  subprocesses per run. Filed on the premise that this was fine "while the CLI is invoked by
  hand"; the final fix wave made drain step 2 call `lint` unconditionally, which is a second,
  non-deferred consumer (once per drain, not once per commit, so the register's real worry — an
  every-`git commit` hook — is still untouched, but the premise as written is now stale).
- **One risk the retired deploy leaves genuinely unverifiable**: whether the absolute path baked
  into the generated post-commit hook still resolves when the hook is generated from a **symlinked**
  `~/.claude` — which is what this machine has, and the exact condition the realpath shims in all
  five scripts exist to survive. The final whole-branch review named this the first thing to check
  whenever an install does happen, precisely because nothing in this plan deployed.
- **One goal clause the final review rated PARTIAL**: "the version moves once, by the maximum."
  The maximum *is* computed once, in code (`accumulate`/`resolveDrain`), but nothing in any of the
  eleven scripts *applies* it — there is no bump helper anywhere; the model does the SemVer
  arithmetic by hand and types the result into `write-changelog.mjs --final-version`, which never
  checks that value against what `drain` computed. The review located this as a gap in the plan's
  own File Structure table, not an omission by any individual task.
- **One register amendment the fix wave identified but deliberately did not make**:
  `RISK-CHANGELOG-002`'s text says lint's `2N` git spawns are acceptable "while the CLI is invoked
  by hand." Drain step 2 now runs `lint` unconditionally, making it a second, non-deferred
  consumer — worth a one-line amendment reflecting that the "invoked by hand" premise no longer
  fully holds. The implementer deliberately left the register untouched from the fix-wave
  worktree, since it is modified concurrently in the main worktree and editing it there would
  conflict.
