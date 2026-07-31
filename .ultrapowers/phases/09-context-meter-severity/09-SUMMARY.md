# 09-SUMMARY.md — context-meter-severity

Branch `feat/context-meter-severity`, worktree `D:/6__Work/AI_Projects/claude-config-wt-plan9`.
Source: `.ultrapowers/sdd/phases-09-context-meter-severity/progress.md` (the ledger) and the
implementer reports `task-1-report.md` .. `task-6-report.md`, `final-fix-wave-report.md`.

## Tasks

1. The severity ladder — `severityOf({ windowPct, acProgress })` in
   `payload/hooks/lib/context-severity.mjs`, mapping window-fill percent to an ANSI colour
   (ladder 15/45/70/85/95) and autocompact-progress percent to an icon (ladder 45/70/85/95),
   on two independent scales, never throwing. `f511bc1..5da7740`
2. Expose the context metrics — extracted `contextMetrics(data)` out of `computeContext` in
   `payload/hooks/lib/statusline-lib.mjs`; `computeContext` is now a pure consumer of it.
   `5da7740..5d4d7b5`
3. Resolve and learn the autocompact point — `payload/hooks/lib/autocompact.mjs`
   (`resolveAutocompact`, `observationFrom`, `promotePending`, `autoCompactEnabledFrom`),
   imports nothing, keeping it out of the statusline's forbidden-subprocess graph.
   `5d4d7b5..b6bc870`
4. The observing hook — `payload/hooks/precompact-observe.mjs`, a `PreCompact` hook that
   reads the transcript and records where automatic compaction actually fired, into
   `state/autocompact.json` as an unkeyed `pending` record. `b6bc870..e02a152`
5. Paint the segment — `paintContext` + `contextSegment` wired into
   `payload/hooks/statusline.mjs`, joining severity, autocompact resolution and pending
   promotion into the renderer; the phase's integration task. `e02a152..39f609e`
6. Register and document — `PreCompact` entry added to `settings.partial.json`; both
   `README.md` and `README.en.md` updated with the two ladders and the resolution order.
   `39f609e..b7a00c1`

## Rulings

Parked at the five-round cap: none. Ledger vocabulary note, verbatim: "parked — a finding
adjudicated by the controller at the five-round cap, with a written ruling, rather than
fixed. Nothing in this phase reached that cap."

What follows is everything the ledger records as an adjudication, a controller/plan defect,
or a deferred minor — in the ledger's own order. Seven items in this list are numbered by
the ledger itself as a single running count of defects attributed to the plan or the
controller, never to an implementer: the count reaches "Fourth self-contradiction in this
plan" at Task 5, "(FIFTH PLAN DEFECT)" at the whole-branch review, "Sixth instruction
defect" at the fix wave, and "SEVENTH instruction defect" at the age-bound removal. They are
marked **[defect N/7]** below in that running order. A few further items are labelled
PLAN DEFECT or CONTROLLER MISTAKE in the ledger but sit outside that specific seven-count;
they are included in full because the ledger records them as real, just not as part of that
one running series.

### Task 1 — the severity ladder

**[defect 1/7]** PLAN DEFECT, not an implementer error: 09-PLAN.md Task 1 Step 3 mandates
that exact signature, and its Interfaces block mandates the contradicting invariant. The
invariant governs; the sample was wrong. Not escalated to the user — the two plan statements
conflict with each other and only one of them can be satisfied, so there is no choice to put
to them. The ladder values, which WERE the user's decision, are untouched.

Deferred minor: boundary pairs are asserted just-below/at only for floors 15 and 45; floors
70, 85 and 95 are asserted at the exact value only. The reviewer verified all three by
hand-tracing the algorithm, so the code is correct — but a future edit to the table order or
the comparator would not be caught there by regression.

Deferred minor: a field of `Infinity` fails `Number.isFinite` and degrades to grey / no icon
rather than clamping to the top tier. Does not throw, so the contract holds, but a runaway
percentage reporting as LOWEST severity is surprising.

### Task 2 — expose the context metrics

PLAN DEFECT — my error as the plan's author, though it needs no code fix. The full-suite
command, `find payload .test/unit -name '*.test.mjs'`, covers FEWER tests in a worktree than
in the main checkout. `.gitignore:13` ignores `.test/`, so a fresh worktree has no
`.test/unit/` at all: 50 payload files and 0 unit files here, against 49 and 2 on master.
That is why task 2 reported 468 where master reported 484 before the phase began. Nothing is
failing and nothing is hidden — the two absent files belong to phase 08's
`ensureStatuslineOverride` and are unrelated to this phase — but "run the full suite" means
something smaller here than the phrase implies. This is phase 08's RISK-TESTUNIT-001 biting
a second time. Flag it to the final whole-branch review; the fix belongs to whoever owns
that risk, not to this phase.

Important: the doc block ended up above `contextMetrics`, leaving `computeContext`
undocumented, and its opening line describes the formatted string only `computeContext`
produces. So the comment did not merely move — it became false where it landed.

**[defect 2/7]** ADJUDICATION on the plan-mandated finding, not escalated to the user. The
brief contradicts itself — its prose requires the doc comment stay above `computeContext`
while its Step 3 sample leaves it in its original file position, which after the split is
above `contextMetrics`. Both cannot hold. Ruled for the constraint's purpose over its
letter: the parsing rationale belongs above `contextMetrics` where the parsing now is, and
`computeContext` gets its own line carrying the segment-string example. Nothing the user
decided is affected — the ladder, colours, icons and field names are untouched; this is
comment placement. The user was told the ruling and offered the alternative (move the block
wholesale) in the same turn.

Deferred minor (recovered): the plan's full-suite `find` command prints
`find: '.test/unit': No such file or directory` in a worktree. Test invocation output should
be pristine. Root cause is the plan's command, not the implementation.

### Task 3 — resolving the autocompact point

CONTROLLER MISTAKE, recorded because it cost a round. Important 1 is the same `= {}` / null
defect already found and fixed in Task 1. After Task 1 I fixed the instance and never swept
the plan for the class, so it shipped again here in two places. It is also present in Task
5's `paintContext` sample and will be pre-empted in that dispatch rather than discovered by
review. The lesson generalises: a defect found in a plan's code sample is evidence about the
plan, not about one task.

Important 2 is a genuine gap in the design, not an implementer deviation — 09-SPEC and
09-PLAN never specified a read-side clamp. Fixed forward in the code; the spec text is left
as-is because the phase summary records the correction and rewriting a committed spec
mid-phase would obscure what was actually designed versus what review caught.

Deferred minor: the discard test asserts `next.models === undefined`, which holds trivially
because `state.models` was never set — it does not pin that pre-existing entries for other
models survive the discard branch. The reviewer verified by execution that they do; the test
does not guard the regression.
Deferred minor: no test for a record whose `message` key is absent entirely (only
`message: {}` is covered), though the junk-tolerance checklist names it.
Deferred minor: no test pins that `promotePending` leaves the caller's original state object
unmutated.
Deferred minor: `env = process.env` as a default makes the result depend on live global
state when a caller omits `env`, in tension with the "pure" framing. Matches the existing
convention in component-registry.mjs:20, and every call site passes env explicitly, so it is
a wording nit rather than a defect.

CORRECTION to an earlier ledger line, from the whole-branch review. The Task 3 note
justifying `env = process.env` said "every call site passes env explicitly". That is
factually wrong: statusline.mjs does NOT pass `env` and relies on the default, which is the
correct behaviour there and is exactly why the test harness deletes both variables. The code
is right; my stated reasoning for it was not.

### Task 4 — the observing hook

**[defect 3/7]** Important: literal `null` on stdin throws and exits non-zero.
`JSON.parse("null")` does not throw — it returns the primitive null, so the catch never
fires, and the next line's `d.trigger` throws a TypeError outside any try. Reproduced in
isolation: TypeError, exit 1. The brief mandated that line verbatim while also calling
never-exiting-non-zero the file's single most important property; both cannot hold, so the
invariant governs.

CONTROLLER MISTAKE. The implementer raised this exact concern in its report and I dismissed
it from the armchair, telling the user the construct was "closed on all sides with nothing
able to escape". That was wrong, and the reviewer's reproduction settled it. The implementer
was right to flag rather than deviate; my judgement was the weak link.

This is the THIRD variant of one family in this plan — a `null` slipping past a guard
written for `undefined`. First `= {}` in Task 1, again twice in Task 3, now `JSON.parse`
returning null. The pattern is the finding, not the instances.

PRE-EXISTING DEFECT FOUND, NOT OURS TO FIX HERE — `payload/hooks/token-usage-log.mjs`
carries the identical construct at lines 60-61 and reaches `d.cwd` at line 133, so it has the
identical null-stdin flaw. Confirmed by the implementer at my request; the file was not
touched. That hook is already deployed on this machine. File it as a risk when this phase
closes; do not widen this phase.

Deferred minor (recovered): the file's header line restates the filename rather than
explaining a non-obvious why. Brief-mandated, not the implementer's addition.
Deferred minor (recovered): the state file is written without a trailing newline, where one
sibling writer in token-usage-log.mjs adds one and another does not — a pre-existing
inconsistency in the codebase, not newly introduced.

### Task 5 — paint the segment

**[defect 4/7]** Important — `severityOf`/`paintContext` at :207 sat outside `safe()`, so a
severity failure would delete the segment instead of printing it uncoloured, contradicting
the spec's explicit "never a precondition for printing it". Plan-mandated: the brief's own
Step 3 sample has the same gap. Fourth self-contradiction in this plan.

The implementer applied the guard and DECLARED that no honest test could drive the catch
branch — both functions are total against JSON-native input, and forcing a throw would need
node:test's `mock.module()` behind `--experimental-test-module-mocks`, which this project
does not pass. It was instructed not to contort the design or write a test that asserts
nothing, and to declare the gap instead. It did exactly that.

CONTROLLER PROBE of that claim, worth keeping. `severityOf` is NOT unconditionally total:
`severityOf({ windowPct: Symbol.iterator })` throws TypeError, because `Number(Symbol)`
throws by language spec. Eight other adversarial shapes — null, undefined, 42, "x", [],
true, {}, and an object holding {} and [] — all degrade to {colour:"2", icon:""}. A Symbol
cannot survive JSON.parse, so it cannot arrive from the payload, which makes the
implementer's QUALIFIED claim ("total against any JSON-native input") exactly right rather
than an excuse. It also strengthens the reviewer's argument for the guard: the function can
throw, just not by a route reachable today, which is precisely the "invariant held by
another module" hazard the finding named.

Fix round 1 re-review also ruled the no-test declaration LEGITIMATE after searching for an
alternative itself: `contextSegment` is unexported so only the entry point reaches it and
JSON cannot encode a Symbol or a throwing getter; `safe` is an unexported local const; and
the try/catch mechanism is already proven in the same suite against real triggerable
failures (malformed stdin JSON, malformed state file). A dedicated test would have asserted
nothing new.

Deferred minor (recovered): `writeFileSync` is non-atomic on a per-prompt path; a kill
mid-write truncates autocompact.json. Self-healing on the next render.
Deferred minor (recovered): the icon-leads-colour test asserts `includes("\x1b[32m")` and
`includes("💡")` separately, where the cold test uses the stronger exact-substring form.
Deferred minor (recovered): no test asserts that a render without a pending observation
leaves the state file untouched — the guarantee that keeps a per-prompt renderer from
becoming a per-prompt writer.
Deferred minor (recovered): an empty `modelId` writes a `models[""]` key. Task 5 is the
first caller able to supply "".
Deferred minor (recovered): the file header no longer describes the file — the renderer now
persists to disk, and the header still calls it a pure composition.
Deferred minor (recovered): `if (!m) return text;` is unreachable, because computeContext
returns "" whenever contextMetrics is null.

### Task 6 — register and document

Critical (reviewer, upheld by controller): the banned 16.5% reserve figure reappeared in
prose in BOTH READMEs, as an accurate historical aside the brief never asked for. The
number's provenance is real (09-SPEC.md:20-22 records it), so this was reintroduction rather
than fabrication — a distinction the reviewer drew explicitly before accusing. Still
Critical: the paragraph exists precisely to establish that no such number governs behaviour
any more, and a skimming reader carries away the figure rather than the point.

Fix round 1 ruling: the instruction explicitly forbade substituting a differently-worded
history, which is the usual way this fix fails — number gone, argument still there.

Fix round 2, user-directed, not a review finding — treated as decided rather than weighed.
The user called it directly: the surviving Russian read `Дефолт — именно полное окно,
никогда угаданный резерв`, an unmarked contrast that is a calque of the idiomatic English
`never a guessed reserve`. Replacement `а не угаданный резерв`. The scoped re-review, running
in parallel and unaware of the dispatch, independently proposed the identical wording — so
the choice is obvious rather than a matter of taste. The dispatch also asked for a wider pass
over the whole added Russian block for the same class of calque, with "checked, nothing
further" named as an acceptable result so the implementer is not pushed into inventing
edits. Result (2 addressed, 0 open): `никогда угаданный резерв` → `а не угаданный резерв`,
and the wider pass found one more calque, `двум разным лесенкам` → `двум разным шкалам` —
`лесенка` is a diminutive with literal staircase semantics where the text needs the term
`шкала`. README.en.md untouched, as instructed: the two files must agree in meaning, not in
phrasing. The re-review was asked symmetrically — whether edits were invented AND whether
house style was used as cover for doing nothing — because those are the two opposite ways
this task fails and asking only about one pushes toward the other. Verdict: genuine. The
implementer verified `резолвится` against six existing uses in the same README and `дефолт`
against the bundle-variant section before declining to touch either, and declined a third
stylistic change as a preference rather than a defect. That is the discrimination the round
was for.

Deferred minor (recovered): the READMEs' resolution order omits autocompact.mjs's `enabled`
short-circuit, which lands on the full window anyway.
Deferred minor (recovered): the removed historical aside was the only one of six segment
descriptions that argued a design decision rather than describing behaviour. Resolved by its
removal in fix round 1.

### The eleven deferred minors, and the failure to itemise them

CONTROLLER FAILURE, caught by the whole-branch review — ELEVEN deferred minors were counted
in this ledger but never itemised, so nobody could triage them. Only Tasks 1 and 3 had their
minors written out as `minor (deferred)` lines; Tasks 2, 4, 5 and 6 had counts only. That is
precisely the silent discard the deferral rule exists to prevent, and I caused it. (The
eleven, recovered from the review reports, are listed above under Tasks 2, 4, 5 and 6.)

### Whole-branch review and the closing fix waves

WHOLE-BRANCH REVIEW (opus, 51a65d0..b7a00c1) — Ready to merge WITH FIXES. 0 Critical, 2
Important, 9 Minor, plus a triage of the deferred list (the ledger records the count and the
two Important findings below; it does not record a separate per-item verdict on each of the
eleven beyond what is already itemised above).

Important 1: `promotePending` ignored `pending.model`, so the first render after a
compaction claimed the observation regardless of model. Reproduced: 180000 tokens seen on
sonnet, promoted onto claude-opus-5[1m] with a 1M window, printing green `175.0K/1M 18%`
with a 💀 — durable until that model next compacts. Worse than the honest "assumed" default
it displaced, because the number is observed AND wrong. RISK-STATUSLINE-001's failure mode
arriving through another door.

**[defect 5/7]** Important 2 (FIFTH PLAN DEFECT): the spec names
CLAUDE_CODE_AUTO_COMPACT_WINDOW as the very case the two ladders exist for, and the code
never read it.

The reviewer verified the write's gating by mtime across two renders, its ordering, and its
self-healing behaviour by execution rather than reading, and measured the PreCompact hook at
317 ms on a synthetic 35.7 MB transcript. It also caught that eleven deferred minors were
counted but never itemised in this ledger.

FIX WAVE (single, as the rule allows) — commits b7a00c1..aacebb8, 499/499 passing. All four
findings addressed. **[defect 6/7]** The implementer CAUGHT A CONTRADICTION BETWEEN MY OWN
TWO INSTRUCTIONS and reported it instead of silently choosing: finding 3 said "collapse the
ladders whenever source is assumed", but after finding 2 landed, `assumed` is also the
answer when CLAUDE_CODE_AUTO_COMPACT_WINDOW narrows capacity with no observation yet — so the
literal instruction would have erased exactly the divergence finding 2 created. It narrowed
the condition to `assumed && ac.tokens === windowSize`. The scoped re-review worked both
cases through and ruled the deviation correct. Sixth instruction defect of mine this phase,
and the third caught by an implementer rather than by review.

RE-REVIEW OF THE FIX WAVE — all four addressed, production logic clean, but it found a NEW
Important: a wall-clock time bomb in the test fixtures. Five tests hardcode
`at: "2026-07-30T18:00:00Z"` and rely on the default `now = Date.now()`; the new six-hour age
bound makes them fail permanently from 2026-07-31T00:00:00Z. Verified by me directly rather
than taken on trust: at 2026-07-30T21:09Z the suite was 85/85 green with two hours
fifty-one minutes left before the cutoff.

CONTROLLER DECISION, deliberately exceeding the "no second fix wave" rule, recorded because
it is a deviation. The rule exists to stop endless fix cycles on judgement calls, not to
ship a branch that self-destructs within three hours. The finding is verified, the deadline
is hard, the fix is mechanical, and no production code is touched. A second, tightly scoped
fixer was dispatched for the five fixtures only, with two traps named: it must not weaken
the age bound to make the problem go away, and autocompact.test.mjs:107 must still exercise
the size-clamp path rather than passing because the age purge happens to produce a similar
shape. The user was told the rule was being exceeded and why.

**[defect 7/7]** AGE BOUND REMOVED ENTIRELY — user ruling, and the right one. The user asked
where a time dependency had come from, since nothing in the design used time. Tracing it:
09-SPEC and 09-PLAN never had one. The `pending` record's `at` field was provenance only.
The BOUND entered an hour earlier, in MY fix-wave instruction, as a suggestion from the
whole-branch review that I passed through without weighing it. On examination it does not
survive scrutiny. The mechanism gets very few chances to learn — one observation per
automatic compaction per model — and discarding an unclaimed pending after six hours throws
away a hard-won data point to save about a hundred bytes. After the model-matching fix an
unclaimed record is inert rather than dangerous, since no other model can take it. And the
justification offered for it, guarding against an observation gone stale across Claude Code
versions, is real but is not what six hours measures: six hours measures a lunch break. So
the bound is gone, the clock dependency with it, and the whole class of wall-clock test
failures with that. `at` stays written as provenance; the spec's record shape is unchanged.
SEVENTH instruction defect of mine this phase, and a different kind from the other six — not
a contradiction but an unexamined borrowing of someone else's suggestion. A reviewer
proposing something is not the same as that something being warranted, and a controller that
forwards suggestions verbatim into mandates is not adjudicating, only relaying. Sequencing
note: commit 20ab0d6 (making five fixtures clock-independent) landed before the redirect
reached the implementer, so it is in history and is superseded rather than reverted. Also
recorded because it is a small failure of mine: my list of five affected tests came from the
review report rather than from my own grep, and the implementer found three more fixtures
with a hardcoded `at` that my list had missed. Moot now, but the method was wrong — I should
have run the search myself before naming a closed list.

## Deviations and decisions

- **Task 4, the brief's verbatim verification command did not reproduce in this
  environment.** Per `task-4-report.md`: the brief's Step 3 shell snippet, run verbatim on
  Git Bash/Windows, produced a false negative (no `autocompact.json` written) — not because
  of a defect in the hook. Root cause: MSYS2 auto-converts a bare env-var argument like
  `CLAUDE_CONFIG_DIR="$TMP"` into a Windows path for the child process, but it does not
  convert a POSIX-style path embedded inside a larger string (the JSON piped via `echo`), so
  `transcript_path` arrived at Node as the literal string `/tmp/tmp.XXXXXX/t.jsonl`, which
  Node on Windows resolves as drive-relative rather than to Git Bash's `/tmp` mount — same
  code path as "missing transcript." The implementer abandoned running the command as
  written and substituted a `cygpath -w`-based rewrite of the transcript path, everything
  else identical to the brief's intent; on a real POSIX shell the brief's command would have
  worked as written. The ledger records only the outcome ("the reviewer... confirmed the
  Git-Bash path workaround changes only the path representation, not any assertion"); the
  MSYS2 diagnosis itself exists only in the report.

- **Task 5, the implementer rejected the plan's `paintContext` signature before review
  caught anything.** Per `task-5-report.md`: the brief specified
  `paintContext(text, { colour, icon } = {})`. The implementer wrote
  `const { colour, icon } = opts || {};` instead, so `paintContext(text, null)` returns
  `text` unpainted rather than throwing — the same `= {}`-only-guards-`undefined` footgun
  the ledger later calls the plan's null/undefined family (Tasks 1, 3 twice, 4). This is the
  one instance in that family an implementer pre-empted rather than a reviewer catching it;
  the implementer pinned it with its own null-argument test rather than waiting to be told.

- **Task 5, the implementer declined to write a test it judged dishonest, and said so.**
  Fixing the `severityOf`/`paintContext` seam to fall back to `text` on failure left no real
  way to drive the catch branch: `severityOf` and `paintContext` are both total against every
  JSON-native input reachable through the pipeline (`task-5-report.md`'s "On testing it
  honestly" section walks each function's guards to support this), and forcing the branch to
  fire would require `node:test`'s `mock.module()` under `--experimental-test-module-mocks`,
  a flag this project's invocation does not carry anywhere else. Rather than add that flag
  for one seam, or write an assertion that would pass regardless of whether the guard did
  anything, the implementer stated the gap in the report instead of manufacturing coverage.
  The controller's own probe (Symbol-as-input) later showed the claim was correct as
  qualified — total against JSON-native input, not unconditionally total — which is exactly
  the distinction the implementer had drawn.

- **The fix-wave implementer caught a contradiction between two of the controller's own fix
  instructions.** Per `final-fix-wave-report.md`, Finding 3: a literal reading of the brief
  ("when the resolved source is assumed, pass windowPct through") would also have silenced
  the very divergence Finding 2 exists to create — when `CLAUDE_CODE_AUTO_COMPACT_WINDOW`
  narrows capacity below the window and no observation exists yet, the source is *also*
  `"assumed"`, which is exactly the case the two ladders are meant to disagree in. Applying
  Finding 3 as written would have undone Finding 2 in the same edit. The implementer narrowed
  the collapse condition to `assumed && ac.tokens === windowSize` instead of silently picking
  one instruction over the other, and reported the contradiction; the scoped re-review worked
  both cases through and ruled the narrower condition correct.

- **The final fix pass reversed itself on the age-bound test fixtures.** Per
  `final-fix-wave-report.md`'s second section: a first pass made five hardcoded-`at` test
  fixtures clock-independent (commit 20ab0d6) to survive the six-hour age bound the
  whole-branch review had suggested. Before that redirect reached the implementer, the
  controller and user determined the age bound itself had no design basis and should be
  removed rather than worked around, so the six fixtures were reverted to their literal
  hardcoded `at` values and the age-bound logic (the `PENDING_MAX_AGE_MS` constant, the `now`
  parameter, two tests that existed only to cover it) was deleted outright. The report is
  explicit that this is a reversal, not an extension, of the first pass: "(No functional
  change; `at` is now inert provenance, not used by logic)." The ledger records the same
  event as the user's ruling and as the seventh instruction defect; the report supplies the
  file-by-file mechanics (which lines reverted, which tests were deleted, why the suite count
  moved from 499 to 497).

## Reviews

`.ultrapowers/sdd/phases-09-context-meter-severity/review-f511bc1..0c9c118.diff` — `git diff f511bc1..0c9c118` (Task 1, review 1)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-0c9c118..5da7740.diff` — `git diff 0c9c118..5da7740` (Task 1, fix round 1 re-review)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-5da7740..e6e6e66.diff` — `git diff 5da7740..e6e6e66` (Task 2, review 1)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-e6e6e66..5d4d7b5.diff` — `git diff e6e6e66..5d4d7b5` (Task 2, fix round 1 re-review)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-5d4d7b5..d7db245.diff` — `git diff 5d4d7b5..d7db245` (Task 3, review 1)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-d7db245..b6bc870.diff` — `git diff d7db245..b6bc870` (Task 3, fix round 1 re-review)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-b6bc870..e16f69a.diff` — `git diff b6bc870..e16f69a` (Task 4, review 1)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-e16f69a..e02a152.diff` — `git diff e16f69a..e02a152` (Task 4, fix round 1 re-review)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-e02a152..1734271.diff` — `git diff e02a152..1734271` (Task 5, review 1)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-1734271..39f609e.diff` — `git diff 1734271..39f609e` (Task 5, fix round 1 re-review)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-39f609e..145874d.diff` — `git diff 39f609e..145874d` (Task 6, review 1)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-145874d..bb0879d.diff` — `git diff 145874d..bb0879d` (Task 6, fix round 1 re-review)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-bb0879d..b7a00c1.diff` — `git diff bb0879d..b7a00c1` (Task 6, fix round 2 re-review)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-51a65d0..b7a00c1.diff` — `git diff 51a65d0..b7a00c1` (whole-branch review, all six tasks)
`.ultrapowers/sdd/phases-09-context-meter-severity/review-b7a00c1..aacebb8.diff` — `git diff b7a00c1..aacebb8` (re-review of the fix wave)

Note: the workspace directory also holds `review-51a65d0..e5f8194.diff`, dated after both
`progress.md`'s and `final-fix-wave-report.md`'s last-modified times. No entry in the ledger
narrates a review at that range — the ledger's own narrative ends at the age-bound removal,
without a commit hash for that change or a review of it. This file is named here rather than
silently included or silently dropped; its content was not read, per this document's
instructions not to open diffs, so what it found is not represented above.
