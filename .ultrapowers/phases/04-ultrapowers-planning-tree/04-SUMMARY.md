# Phase 04 — ultrapowers-planning-tree — Summary

Plan: `.ultrapowers/archive/plans/2026-07-28-ultrapowers-planning-tree.md`. 12 tasks plus one
inserted task (2b), a whole-branch review, and two fix rounds, all clean at completion.

This plan spans **two repositories**. Tasks 1-8 (plus 2b) are in the `ultrapowers` fork
(`D:\6__Work\AI_Projects\ultrapowers`, branch `feat/planning-tree`, merged fast-forward into
`patch`). Tasks 9-12 are in this bundle (`claude-config`, branch `feat/ultrapowers-planning-tree`).
Task 2b does not appear in the plan at all — it was inserted mid-run by user ruling, to fix a
TOCTOU race the plan's own Task 2 script carried by design (see Rulings, PLAN-MANDATED-1).

## Tasks

### Fork (`ultrapowers`, `feat/planning-tree` → fast-forwarded into `patch`) — Tasks 1-8, plus 2b

| Task | Deliverable | Commits |
|---|---|---|
| 1 | `forkOwned[].mode` — ship an executable fork-owned file | `a770482..3b9ef7e` |
| 2 | `phase-dir` — the planning-directory allocator | `3b9ef7e..d074e79` |
| **2b** *(not in the plan; inserted by user ruling)* | close the allocation race in `phase-dir` | `6a2bcf3..d471c15` |
| 3 | Delta `007-planning-tree` — every document path moves into `.ultrapowers/` | `d074e79..bfac7f8` |
| 4 | `summary-writer-prompt.md` — the agent that folds the ledger into a SUMMARY | `bfac7f8..669906b` |
| 5 | `verification-prompt.md` — the agent that writes VERIFICATION | `669906b..0e83391` |
| 6 | Delta `008-sdd-summary` — write the SUMMARY, keep the workspace | `0e83391..77244f6` |
| 7 | Delta `009-agent-first` — delegation becomes the default | `77244f6..6a2bcf3` |
| 8 | Rebuild and publish the fork | `d471c15..33f22cb` (on `patch`); plus generated `main` commit `f85d770` (build output, not authored) |

Note task ordering on disk: 2b's commit range (`6a2bcf3..d471c15`) chronologically follows task 7
(`77244f6..6a2bcf3`) and precedes task 8 (`d471c15..33f22cb`) — it was inserted into the sequence,
not appended after it, so that its fix shipped in the same `main` rebuild as everything else.

### Bundle (`claude-config`, `feat/ultrapowers-planning-tree`) — Tasks 9-12

| Task | Deliverable | Commits |
|---|---|---|
| 9 | Un-ignore the planning tree in claude-config | `103699b..7484d1a` |
| 10 | Fold the three `.superpowers/sdd/` strata into SUMMARYs | `7484d1a..c3911d7` |
| 11 | Move the historic documents and the risk register into the tree | `c3911d7..c59f956` (initial); `a4a28f5..37572f3` (fix round 1, dispatched after Task 12 shipped) |
| 12 | Verify the tree, and hand the one blocked edit to the user | `c59f956..a4a28f5` |

Final fix wave (whole-branch review findings 1-3, not tied to one task): `37572f3..515b522`
(round 1), `515b522..72d4d78` (correction round, round 2).

## Rulings

Every finding the ledger records as parked, with its ruling, copied verbatim from the ledger.

**Task 1 — `mode` validation.** Reviewer raised one finding: "no validation of arbitrary `mode`
strings". Controller ruling: "not a gap. The brief scoped validation out, and Task 2 is the only
consumer; it sets exactly "100755". Resolved, not deferred."

**Task 2 — PLAN-MANDATED-1 (TOCTOU in `phase-dir`).** Finding: "TOCTOU in
`transform/fork-owned/phase-dir`. The existence scan, the next-number scan and the final
`mkdir -p` are three unlocked steps. Two concurrent calls with the same KIND and different slugs
can both read the same highest number and both succeed, producing two directories sharing one
NN- prefix — which breaks the plan's own stated invariant "the directory's NN- prefix is the
document prefix". The script is a verbatim transcription of the plan's code, so this is the
plan's design, not an implementer deviation. It matters because this very fork ships
`dispatching-parallel-agents`. To be raised with the user BEFORE Task 8 rebuilds and pushes
`main` — that is the last cheap moment." Ruling: "RULED BY USER (2026-07-29) — fix it now,
atomic mkdir with retry. This is a deliberate, authorised deviation from the plan's verbatim
script. Executed as Task 2b, inserted before Task 8 so the fix ships in the same `main` rebuild
rather than after the push."

**Task 2 — deferred minors (three), all "inherited verbatim from the plan":**
- "`%02d` + the `[0-9][0-9]-*` glob cap a kind at 99 entries; a `100-x` directory would not be
  seen by later scans. Inherited verbatim from the plan."
- "`assert.throws` in phase-dir.test.mjs asserts only that it throws, not exit code 2 nor the
  stderr text. Inherited verbatim from the plan."
- "the backslash-slug rejection and the `adhoc` kind branch have no test."

**Task 3 — "six references" prose mismatch.** "the plan's prose says "six references across four
skills"; the delta actually rewrites 8 occurrences across 5 files (still 4 skill directories).
Imprecision in the plan's own prose, not a defect in the delta. No action." (resolved by
controller)

**Task 3 — deferred minors (two):**
- "commits on this branch carry no `Co-Authored-By` trailer. The plan mandates exact `-m`
  subjects and the implementers followed it literally. From Task 4 onward the trailer is
  appended without touching the subject; Tasks 1-3 are left as-is rather than rewriting recorded
  SHAs mid-plan. Final review to triage."
- "`writing-plans/SKILL.md` now says `bash ../brainstorming/scripts/phase-dir` — correct
  relative to the skill directory, not to a session CWD. Inherited verbatim from the plan and
  consistent with the existing `scripts/sdd-workspace` convention, so not a regression."

**Task 4 — delta 009 reference could not be verified yet.** "referenced from delta 009's document
table" could not be verified because delta 009 did not exist yet. Task 7 creates it; the
reference is verified there." (resolved by controller)

**Task 4 — deferred minors (two), both "plan-mandated verbatim text":**
- "summary-writer-prompt's "Read the ledger first, then every report" omits the plan from the
  read order, though the plan is listed as an INPUT and is the only source for a task's one-line
  deliverable. Plan-mandated verbatim text."
- "`## Rulings` mandates writing `None.` when empty; `## Deviations and decisions` has no
  equivalent fallback though it is just as likely to be empty. Plan-mandated."

**Task 5 — deferred minor.** "verification-prompt routes `unverifiable:` claims into `## Gaps`,
whose own definition ("what the plan promised and the branch does not contain") does not
obviously cover them. Plan-mandated verbatim text."

**Task 7 — plan prose error (not a defect).** "the plan predicts `Offer: direct, or an agent`
appears 3 times; the real count is 2, and the plan's own diff block contains it on exactly 2
lines. Nothing was lost. Content kept verbatim rather than inventing a third occurrence." Later
confirmed at review: "the plan's `3` prediction is a miscount in the plan's own verification
step — both the plan's block and the shipped patch contain the string exactly twice."

**Task 2b — deferred minors (five):**
- "» 99 phases with DIFFERENT slugs silently share prefix `100` — `100-a` and `100-b` are
  distinct names, both mkdirs succeed, and `[0-9][0-9]-*` matches neither, so numbering silently
  restarts. Pre-existing, out of scope, belongs in the risk register." (Later shipped as
  `RISK-PHASEDIR-001`.)
- "`sleep 0.01` is a new external dependency. Verified fine on git-bash (GNU coreutils), Linux
  and macOS; on strict-POSIX/busybox it aborts loudly under `set -e` holding no lock. Acceptable
  failure mode, recorded not changed."
- "the same-slug test is a probabilistic stress test (~81% RED against the unfixed script), not
  a discriminator. NOT a flaky-test-rule violation — it repeats inside one assertion to amplify a
  signal and is deterministically green against the fixed script — but the different-slug test
  is the load-bearing regression gate."
- "the mtime arithmetic is not base-10-forced, unlike the `NN` prefix parse, so an epoch mtime
  with a leading zero and an 8/9 digit would misparse as octal. Requires a pre-2001 clock;
  practically unreachable."
- "`phase-dir` has no env override for retry count or poll interval, which is why the two
  exhaustion tests take ~10s each (run concurrently). An override would let them assert the same
  behaviour in milliseconds."

**Task 12 — commit subject vs. `STATE.md` body mismatch.** "the implementer corrected STATE.md's
factual claims (the plan's draft said four of seven designs remain unplanned and named plan #2
as next; in fact all five plans are written and three are already underway) but was bound to the
plan's exact commit subject, so the subject line "four designs remain" now contradicts the
corrected body. Flagged, not silently changed. To be resolved at the final whole-branch review."
The ledger does not record this item's individual disposition at the final review — only the
aggregate triage below. It is not separately named as CAN STAND, RESOLVED, or MUST FIX.

**Final whole-branch review — triage of the deferred pile.** "FINAL WHOLE-BRANCH REVIEW (opus):
Ready to merge WITH FIXES. Deferred pile triaged 18 items: 16 CAN STAND, 1 RESOLVED, 1 MUST
FIX. Goal clauses 1 and 2 ACHIEVED (verified by probe, not by reading); clause 3 ACHIEVED as text
but PARTIAL in effect — see FORK-1 below." The ledger gives this verdict only in aggregate; it
does not name which of the 18 items landed in which bucket.

**Final whole-branch review — three fork findings, open for the user.** "OPEN FOR THE USER —
three findings that live in the ALREADY-PUBLISHED fork, each undercutting what plan 1 shipped.
Per-task review structurally could not see any of them."
- "FORK-1 (Important): `finishing-a-development-branch` Option 1 runs `git worktree remove`,
  which recursively deletes the worktree INCLUDING the ignored `.ultrapowers/sdd/` workspace
  that delta 008 promises to keep. The reviewer built a throwaway repo and confirmed git does
  not refuse. The layout spec listed that skill among those that "produce none" — considered and
  dismissed as irrelevant, when it is the one skill that deletes the retained artifact."
- "FORK-2 (Important): `NN-PLAN.md` collapses `sdd-workspace`'s uniqueness guarantee. The slug is
  `basename "$plan" .md`, so `.ultrapowers/phases/01-a/01-PLAN.md` and
  `.ultrapowers/tasks/01-b/01-PLAN.md` both resolve to `.ultrapowers/sdd/01-PLAN/`. `phase-dir`
  numbers each kind independently, so a first phase and a first task BOTH get 01 — the common
  case. Briefs and reports collide silently with no guard."
- "FORK-3 (Important): the document table claims `NN-REVIEW.md` is written by
  `code-reviewer.md`, which takes no destination and writes no file. Already public in
  6.2.0-up.2/3."

Ruling: "USER RULING (2026-07-29) on the three fork findings: FIX NOW — a fork revision
6.2.0-up.4, all three, rather than a follow-up plan. Reason accepted: the fork is open, the
context is fresh, and two of the three undercut what plan 1 shipped." This ruling was recorded
as a decision, not executed inside this plan — see Outstanding.

## Deviations and decisions

**The prescribed lock mechanism was built, measured, and did not fix the defect (Task 2b).** The
brief's literal design was: re-scan, compute next, plain `mkdir` on the *target* `NN-<slug>`
path, retry on failure. The implementer built exactly that as a scratch script and ran the
different-slug race against it, 12 racers × 6 trials: 5 of 6 trials collided completely (11 of
12 directories sharing one prefix, `trialsWithCollision=6` overall counting the earlier probe).
The reason is structural, not a tuning problem: a plain `mkdir` on an existing directory guarantees
exactly one winner only when every racer targets *the same name* — a lock directory provides that,
a slug-suffixed target does not, because `mkdir 01-slug-0` and `mkdir 01-slug-1` never contend.
The fix moved the lock to cover the whole allocation (one shared `.phase-dir.lock` directory, one
winner, losers retry), which then measured clean at up to 96 concurrent racers with zero
collisions. The teaching point: the brief's own justifying sentence — "a plain POSIX `mkdir` on
an existing directory fails; exactly one racer can win" — was true of the mechanism in isolation
and false of the design built from it, because it locked the *name* the racers computed, not the
*number* they were computing it from.

**A blanket path substitution corrupted the archive's own account of itself (Task 11).** The
Step 2a substitution (`docs/superpowers/` → `.ultrapowers/archive/`) ran across 41 files including
the archived plan documents themselves. The implementer's own inspection filter,
`git diff -U0 <old> <new> | grep "^[+-]" | grep -v "^[+-][+-]"`, was meant only to drop the
`---`/`+++` diff file headers, but it also silently dropped every *removed* markdown list item —
a deleted line `- Move: ...` renders as `-- Move: ...`, which matches the same `^[+-][+-]`
pattern. That is why the implementer's self-review found exactly one instance of corrupted prose
(a `Move: X → X` no-op line), called it "cosmetic", and stopped searching — the filter had hidden
every other case from the same tool that was supposed to find them. The review re-enumerated by
comparing parent and child blobs line by line instead of filtering a diff, and found 97 changed
lines across 41 files, of which 27 lines in 7 files needed restoring — eight more than the
reviewer itself had first enumerated. Restoration was done from the parent blobs, not by an
inverse substitution, because at least six lines legitimately contain *both* paths (e.g. the
substitution's own `before.split(old).join(new)` source line, and prose reading "substitution of
X → Y") — an inverse substitution would have collapsed each of those to `X → X` in the other
direction, silently reintroducing the same bug in reverse. The rule the review set, and the
sub-rule the implementer added while applying it: a reference to where a document *lives* points
at the new path; a passage that *quotes* the old path as data (a search string, a census, a
literal historical command, a test fixture) must read as it did before — and a path containing a
placeholder (`YYYY-MM-DD`, `<topic>`, `x.md`, `a.md`) is a pattern, not a pointer, so it is never
a "where it lives" reference regardless of which side of the substitution it names.

**The plan's own `git mv` would have nested a tree one level too deep (Task 11).** Step 1 as
written was `mkdirSync('.ultrapowers/archive')` then `git mv docs/superpowers .ultrapowers/archive`.
By the time this task ran, `.ultrapowers/archive/` already existed (Task 10 had put rescued
reports there), so `git mv` would move *into* the existing directory, producing
`.ultrapowers/archive/superpowers/plans` instead of `.ultrapowers/archive/plans` — directly
contradicting the plan's own File Structure table. The bug was latent in the plan (it only
surfaces when the destination pre-exists) and was certain to trigger here because Task 10 made
it pre-exist. The implementer moved the three subdirectories individually instead
(`git mv docs/superpowers/plans .ultrapowers/archive/plans`, etc.), verified as 60 renames with
zero deletions and zero additions.

**Several plan predictions did not match the plan's own content.** Task 3: the plan's prose
claimed "six references across four skills"; the delta the plan itself specifies rewrites 8
occurrences across 5 files. Task 7: the plan predicted the string `Offer: direct, or an agent`
would appear 3 times in the built file; the plan's own diff block contains that exact string on
only 2 lines, so there was no third occurrence to lose in the first place. Task 11: the plan's
header text asserted `docs/superpowers/` held "15 plans, 31 specs ... 46 documents"; the real
counts were 21 plans and 59 documents total (the plan's own threshold, "≥ 15", still passed —
only the narrative count was stale). Task 12: the brief's STATE.md draft asserted "four of the
seven designs approved on 2026-07-28 remain unplanned" and named plan #2 as **Next**; the
implementer traced this through the actual merge commit, the execution-order document, and
`git worktree list`, and found all seven designs already had a plan (three landed with this plan,
three more already underway on separate branches), with plan #3 — not plan #2 — being the only
one with no branch and no commits.

**Four orphaned reports were rescued from a deletion the plan authorised on reasoning that did
not cover them (Task 10).** The plan justified `rm -rf .superpowers/sdd/` with: "every remaining
byte is either a diff that `git diff` reproduces exactly, or a brief that `scripts/task-brief`
regenerates." That premise was false for four flat-root files. Reading each header identified:
`fix-wave-report.md` (belongs to phase 01 / graphify-neo4j, but sits in the flat root rather than
under `archive-graphify-neo4j/`, so the fold dispatch's glob missed it and it had to be
re-dispatched), `final-review-fix-report.md` (belongs to the `csharp-stack-support` plan, which
has no phase and no ledger), and `fix-wave-lite-report.md` (belongs to `feat/lite-variant`,
likewise no phase or ledger). While folding phase 01, the summary writer found two *more* orphans
that had not been anticipated at all: `task-6h-report.md` and `task-fu-report.md`, sitting in
`archive-graphify-neo4j/` but documenting a bootstrap-hardening effort whose commits (354b160,
518bd2f, 8510d23, 9380b6e) appear nowhere in that phase's own ledger — directory name reuse
across separate plan runs had put them there. All four were rescued verbatim into
`.ultrapowers/archive/reports/` with a README recording why, rather than folded into invented
phase directories, because the plan's own assumption #2 forbids retrofitting phases that never
existed.

**Implementers corrected the controller's own instructions, more than once.** In the Task 2b fix
round, the implementer's original report had asserted an untrapped `SIGTERM` would skip the
`EXIT` trap entirely; the reviewer probed this directly and found it false — bash does run the
`EXIT` trap on an untrapped `SIGTERM`. The `INT TERM` trap was kept anyway, but for a different,
correct reason (exit status, not lock release), and the report's stale-lock risk assessment was
revised because it had been leaning on the false premise. The same fix round also corrected the
report's own claim that "above 99 phases the `mkdir` now fails loudly" — true only for the
same-slug case; for *different* slugs above 99 the allocator silently shares the prefix `100`,
which is the more dangerous half and the one that made it into `RISK-PHASEDIR-001`. In the final
fix wave, the implementer verified the controller's dispatch prompt against the code before
acting on it and found three things wrong in it: the lock's trap does **not** cover `SIGHUP` (only
`EXIT` and `INT TERM`); the claim "no longer auto-maintained" overstates the effect on this
specific repository, because the register step is gated on `.planning/` existing and this
repository has none; and the prose half of the finding **is** fixable in-repo, because the rule
ships from the editable `payload/claude-md/06-collaboration.md`, not from the hook-protected file
itself (left alone anyway, as out of the fix wave's scope). In the fix wave's correction round,
the implementer found that the controller's own instruction — "record the `listRegisters()`
duplication decision in your report" — would have lost the decision entirely, because
`.ultrapowers/sdd/` is gitignored by a bare `*` and the report is therefore untracked; the
decision was moved into the tracked risk register's Mitigation instead. That same correction
round also found and fixed two further defects in its own prior sentence (the resolver was
misnamed, and correcting only the factual claim would have left a structurally incoherent
sentence with a dangling clause).

**An implementer's self-review was directly contradicted by review (Task 11).** The task's own
self-review table originally answered "No" to "Anything rewritten outside intended scope" — the
correct answer, established by the subsequent review and the post-review fix, was that 27 lines
across 7 documents had been wrongly rewritten. The report records the correction in place rather
than editing the original claim away: "Originally answered "No". That was an overclaim and review
caught it."

**Controller-level deviations from the plan's stated Global Constraints, decided at the start or
mid-run.** Recorded in the ledger's opening "Controller decisions" and later ruling lines: feature
branches were used instead of the plan's `patch`/`master` (fork = `feat/planning-tree`, bundle =
`feat/ultrapowers-planning-tree`), which is why Task 8 had to fast-forward `patch` before
rebuilding; pushing the fork to origin was authorised; a real `node setup.mjs` deploy into
`~/.claude` was authorised mid-run, then **superseded** by a later, opposite ruling —
"USER RULING (2026-07-29, supersedes the earlier deploy authorisation): NO DEPLOYS AT ALL. Merges
to master only." That later ruling retires the deploy halves of this plan and two others
outright (plan #2 Task 6b, plan #4 Task 7, plan #5 Task 7) rather than deferring them, with "the
exact commands... handed to the user at the end instead." A separate sequencing ruling directed
doing all remaining planning-overhaul work first and merging to `master` in one pass, because
`resolveRecordPaths` (plan #3) and this plan's two new register entries have an ordering
dependency on each other.

## Reviews

- Task 1 review: `git diff a770482..3b9ef7e`
- Task 2 review: `git diff 3b9ef7e..d074e79`
- Task 3 review: `git diff d074e79..bfac7f8`
- Task 4 review: `git diff bfac7f8..669906b`
- Task 5 review: `git diff 669906b..0e83391`
- Task 6 review: `git diff 0e83391..77244f6`
- Task 7 review: `git diff 77244f6..6a2bcf3`
- Task 2b review, round 1: `git diff 6a2bcf3..384ddb0`
- Task 2b review, fix round (final): `git diff 384ddb0..d471c15`
- Task 8 review (fork): `git diff d471c15..33f22cb`
- Task 9 review (bundle): `git diff 103699b..7484d1a`
- Task 11 review, initial: `git diff c3911d7..c59f956`
- Task 11 review, fix round (dispatched after Task 12): `git diff a4a28f5..37572f3`
- Final whole-branch review: `git diff 103699b..37572f3`
- Final fix wave re-review, round 1: `git diff 37572f3..515b522`
- Final fix wave re-review, correction round: `git diff 515b522..72d4d78`

(Task 10 and Task 12 have no dedicated per-task review diff. Task 10's summaries were read
directly by the controller — "this is the one place it mandates a controller read". Task 12 was
folded into the final whole-branch review's scope instead of being reviewed individually.)

## Outstanding

- **`RISK-PHASEDIR-001`** (filed in `.ultrapowers/RISK_REGISTER.md`) — `phase-dir` caps a kind at
  99 entries (past which different slugs silently share the prefix `100`), and a leaked
  `.phase-dir.lock` (SIGKILL, power loss, or an untrapped SIGHUP) is never collected. Status:
  Open (accepted, 2026-07-29).
- **`RISK-PLANTREE-001`** (filed in the same register) — the risk register moved to
  `.ultrapowers/RISK_REGISTER.md`, outside the locations this bundle's tooling used to probe.
  Status: code half fixed (both `session-init.mjs` and `add-risk.mjs` now probe
  `.ultrapowers/RISK_REGISTER.md`, pinned by `payload/hooks/session-init.test.mjs`); prose half
  outstanding (the hook-protected `~/.claude/CLAUDE.md` still teaches only `.planning/` or the
  project root, and the planned `resolveRecordPaths` in the not-yet-executed decision-records
  plan never probes `.planning/` at all).
- **One hook-protected prose edit, handed to the user, not attempted.** Verbatim message
  relayed at Task 12: "`~/.claude/CLAUDE.md` — COLLABORATION CONTRACT — currently says the risk
  register goes to `.planning/` if a GSD project exists, otherwise the project root. This
  repository now keeps it at `.ultrapowers/RISK_REGISTER.md`. The line needs a third case:
  *"otherwise `.ultrapowers/` if that tree exists, otherwise the project root."* The file is
  hook-protected, so this edit is yours to make."
- **Three fork-side defects found by the final whole-branch review, not fixed in this plan.**
  FORK-1 (`finishing-a-development-branch`'s `git worktree remove` deletes the retained
  `.ultrapowers/sdd/` workspace), FORK-2 (`NN-PLAN.md`'s slug-only naming lets a first phase and
  a first task collide in `.ultrapowers/sdd/`), FORK-3 (the document table credits
  `code-reviewer.md` with writing `NN-REVIEW.md`, which it does not do). User ruling: fix all
  three now, as fork revision 6.2.0-up.4, rather than a follow-up plan — that ruling is recorded
  in the ledger but its execution is not part of this plan's own commit ranges.
- **Deploy commands not run, by ruling.** "NO DEPLOYS AT ALL" superseded an earlier deploy
  authorisation; the deploy halves of this plan and two sibling plans (plan #2 Task 6b, plan #4
  Task 7, plan #5 Task 7) were retired outright, with the exact `setup.mjs` / `/init-stack`
  commands to be handed to the user separately rather than run here.
