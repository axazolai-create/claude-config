> Single repository (the bundle, `claude-config`, worktree `claude-config-wt-plan5`, branch
> `feat/gsd-core-detector`), but two unrelated halves: a detector that offers to remove a foreign
> gsd-core install (Tasks 1-2), and a statusline for the profiles that had none (Tasks 3-6). Both
> halves share one worktree and, more than once, one another's in-flight commits — see Deviations.

## Tasks

- **Task 1** — The detector library: `payload/bin/lib/gsd-core-detect.mjs`
  (`gsdCorePresent`/`buildGsdInventory`/`filterGsdHooks`), pure, no filesystem writes. `103699b..df2834d`
  (composite: initial commit `09c995f` plus one post-review fix round `df2834d`).
- **Task 2** — `setup.mjs` orchestrates, prompts, and prints the rollback: `--uninstall-gsd` flag,
  `detectForeignGsdCore()` wired after `pruneStale()`, removal through the existing
  `claude-cleanup-lib.mjs` trash/rollback machinery. `09c995f..2bc4b6c` (composite: initial commit
  `94c16ba` plus two post-review fix rounds `ad77cdb` and `2bc4b6c`).
- **Task 3** — Split the statusline library: the four profile-neutral functions move to
  `payload/hooks/lib/statusline-lib.mjs`; `gsd-context-meter-lib.mjs` keeps only the gsd-specific
  `rewriteContextBar` and re-exports the rest. `2bc4b6c..6bf3c13`
- **Task 4** — Name the pending components, do not just count them: `pendingNames(state)` in
  `component-registry.mjs`, with `pendingCount` reimplemented as `pendingNames(state).length`.
  `6bf3c13..b4952ed`
- **Task 5** — The statusline for `base` and `lite`: `payload/hooks/statusline.mjs`, a whole-line
  renderer (updates/context/state segments) for the profiles that ship no gsd-core. `b4952ed..1e6192d`
- **Task 6** — Register it for `base` and `lite`: `setup.mjs`'s statusLine block registers Task 5's
  renderer instead of deleting the key, and (beyond the brief) recognises it as "ours" on the reverse
  `base → full` transition too. `1e6192d..8de8fbf`
- **Task 7 — deploy and verify: RETIRED.** Superseded by the user's "NO DEPLOYS AT ALL" ruling, then
  by the later DEPLOY RULE that folds it into one serialised deploy after all plan branches land on
  `master`. Not performed inside this phase. ("PLAN 5: tasks 1-6 complete; Task 7 (deploy) retired by
  user ruling.")

A **final whole-branch review** and a **post-review fix wave** (not plan tasks) followed Task 6:
commit `86353fe`, addressing two review findings plus filing two risk-register entries (one asked
for, one found unprompted) — see Deviations and Outstanding.

## Rulings

Every deferred/open/parked finding recorded in the ledger, copied verbatim, with its ruling and
final disposition where the ledger records one. Unlike the design-records-and-stack-rules ledger,
this one records no single aggregate count of deferred items triaged by a final review — each is
tracked individually below.

- Finding (Task 1, carried forward): "Task 1: carry to Task 2 — a `null` element inside a hook-event
  array, or a non-array `settings.hooks`, throws uncaught. Mirrors the existing assumption in
  `setup.mjs`'s `mentionsOurs`, so not a new regression, but Task 2's call site must be wrapped the
  way other settings.json reads are." Disposition: resolved in the post-review fix wave. The ledger's
  own later reference: "PROMPT CORRECTION, and it matters: my stated window for Finding 2 was wrong.
  An UNPARSEABLE `settings.partial.json` does not skip the merge — it crashes before anything moves.
  The real window is a MISSING partial. The finding itself is right, and the implementer reproduced
  the exact harm: batch created, gsd-core gone, rollback never printed." Fixed by wrapping the read in
  `safe()`, commit `86353fe`.

- Finding (Task 2): "Task 2: OPEN DECISION for the user, raised by (c). If `pruneStale()` declines —
  non-TTY, or no bulk flag — the detector can move this bundle's own ex-`full` `gsd-*` files into the
  batch. Mislabelled as foreign, but reversible. A one-line hardening exists and was deliberately NOT
  taken because it contradicts the plan's "paths in the CURRENT manifest are subtracted" invariant."
  Ruling, from the Task 2 review: "I4 — the deviation-3 residual, DECIDED: take the hardening.
  "Current manifest" is a proxy; the property the plan actually states is "the detector can never
  consume a file this bundle owns", and a file in the previous manifest is still ours. Reviewer
  established reachability concretely: ~12 bundle-owned paths on a full->base downgrade, moved under
  a banner calling them foreign, and bypassing pruneStale's `modified since install` gate. Durable fix
  requested (pruneStale returns what it considered), not the minimum, which only survives one run."
  Disposition: taken, found insufficient by the implementer, hardened further, and proven durable by
  mutation testing — full chain under Deviations.

- Finding (Task 2, minor deferred): "Task 2: minor (deferred): the new `CLAUDE_CONFIG_DIR="..." node
  ...` prefix is not valid PowerShell. Affects relocated config dirs only; a proper fix needs a
  `--dir` flag on `claude-cleanup.mjs`, which belongs to another task." Disposition: resolved in the
  post-review fix wave ("Finding 1"), which also rejected the `--dir`-flag alternative in favour of a
  two-shell printed line — see Deviations.

- Finding (Task 2, minor deferred): "Task 2: minor (deferred): `everOurs` is wrapped in
  `safe(...) || []`, so a throw in variants resolution would silently remove the protection with no
  warning line." Disposition: RESOLVED — "Both optional items taken: `everOurs` no longer degrades
  silently... " (fix round 2, commit `ad77cdb..2bc4b6c`).

- Finding (Task 2, minor deferred): "Task 2: minor (deferred): two uncovered shapes — the documented
  arg-mention over-reach, and a space-preceded relative path `node hooks/gsd-foo.js`, which the
  leading character class misses. Neither is a shape gsd-core uses; the second is not a regression."
  Disposition: PARTIALLY RESOLVED — "The space-preceded relative path was a one-character
  inconsistency and is fixed; the arg-mention over-reach is pinned as the documented residual." The
  residual is an accepted trade, not an open defect.

- Finding (Task 2, minor deferred, recorded after Task 4 in the ledger due to concurrent dispatch):
  "Task 2: minor (deferred): the `everOurs` fail-safe branch has no test — no test forces variants
  resolution to throw. Asserted by code reading only." Disposition: no later ledger entry revisits
  this — stays open (Outstanding).

- Finding (Task 2, minor deferred): "Task 2: minor (deferred): `pruneStale` permanently re-nags about
  `gsd-defaults.partial.json` — a declined, unconditionally-added candidate. Pre-existing,
  undocumented anywhere; risk-register candidate." Disposition: RESOLVED by documentation — "Final fix
  wave: ... RISK-VARIANT-005 filed for the pruneStale re-nag, as asked." Status in the register:
  "Open (accepted, 2026-07-29)"; no code fix, mitigation judged unnecessary for safety.

- Finding (Task 3): "Task 3: ⚠️ noted — the byte-comparison harness (stub script, fixtures, stash
  captures) was not preserved, so that specific claim cannot be re-audited. Compensated: the moved
  code is provably identical and the user-facing wrapper was not edited at all, so its behaviour is
  preserved by construction as long as the module graph resolves, which the tests confirm."
  Disposition: no later ruling recorded — stands as noted (Outstanding).

- Finding (Task 4, minor deferred): "Task 4: minor (deferred): no test passes a bare primitive
  (`undefined`, a string, a number, `[]`) directly. All handled correctly by the one-line guard, just
  not asserted." Disposition: no later ruling recorded — Outstanding.

- Finding (Task 5, minor deferred, real): "Task 5: minor (deferred, real): stdin that never closes
  hangs indefinitely — no timeout on the data/end listener chain. The plan names "a hang" as a
  first-class failure mode, so this is a real gap against its own language, but it is inherited
  verbatim from the already-shipped `gsd-context-meter.mjs`, which has the same missing guard.
  Disclosed, not hidden. A cheap follow-up would be an unref'd timeout that force-flushes and exits."
  Disposition: no later ruling recorded — Outstanding.

- Finding (Task 5, minor deferred): "Task 5: minor (deferred): `renderGsd`/`renderSdd` interpolate the
  literal "undefined" if called directly with missing fields — unreachable via the entry point, latent
  because both are exported." Disposition: no later ruling recorded — Outstanding.

- Finding (Task 6): "Task 6: concerns — `--skip-all` over an existing settings.json skips the merge,
  so `base` ends up with no statusline (pre-existing, uniform); the restart window shows an empty
  line after a downgrade; and nothing launches Claude Code to confirm the command renders, which
  belonged to the retired Task 7." Disposition: no ruling recorded; the one item that had an owner
  (launching Claude Code to confirm rendering) lost it when Task 7 was retired — Outstanding.

- Two judgements explicitly re-examined and reaffirmed rather than changed, per the final fix wave:
  "It agreed with both leave-it-alone judgements (the backup's placement inside the batch, and
  `statusline.mjs` shipping unregistered on `full`) and touched neither." (The backup lives inside the
  7-day trash batch rather than outliving it; `hooks/statusline.mjs` ships dormant on `full` rather
  than being excluded, to protect the byte-identical settings round trip.)

## Deviations and decisions

**The richest thread: a fix built to spec, proven insufficient by measurement, then hardened, then
proven durable by mutation rather than assertion.** Task 2's review demanded a durable version of the
"never claim a file this bundle owns" guarantee (finding I4, above) and prescribed a specific
mechanism: have `pruneStale()` return the rels it considered. The implementer built exactly that and
then measured it failing on its own terms: "The implementer showed that alone is not durable either:
`pruneStale`'s candidates also come from the OLD manifest, so on run 2 `considered` is empty and the
files are claimed again. It added a third, manifest-independent set — every rel any profile ships —
which is what actually closes it. The requested mechanism was kept as well and stands independently."
The re-review did not take this on faith: "The I4 correction was CONFIRMED BY EXPERIMENT: the reviewer
ran the two-run downgrade in a throwaway config dir and reproduced the hole — on run B `pruneStale`'s
only candidate was `gsd-defaults.partial.json`, the eleven bundle-owned rels were NOT in `prunedRels`,
and all eleven still survived, which only `everOurs` explains." A second review round then found the
new guard's own regression test was toothless — "The new e2e case is a "run 1" shape and passes on
`prunedRels` alone: delete the `everOurs` term and it stays green. The very mechanism added because the
specified one was insufficient is the one nothing would catch the removal of" — and the fix that
followed was proven by mutation, not by reading: "The durability guard is now PROVEN BY MUTATION: with
`everOurs` deleted the test fails ON RUN 2 with `bundle-owned file claimed as foreign on run 2:
hooks/gsd-context-meter.mjs`, while run 1's assertions still pass — the direct demonstration that the
old shape could never have caught it." The re-review repeated the mutation independently rather than
reading the diff: "The reviewer copied the worktree to a scratch dir, removed `everOurs`, and reran: it
fails at the run-2 assertion... Restoring it makes both pass."

**Six defects were found in the plan's own verbatim code, two of them silent-breakage class.**

1. *Rollback destroys the backup it restores from (Task 2).* The brief printed `restore` before `cp`;
   `restoreBatch` deletes the entire batch directory — including `settings.json.pre-gsd-uninstall` —
   on a clean restore. "The brief prints restore first, then `cp`; by the time the user runs the `cp`,
   its source is gone." Fixed by printing `cp` first, with an assertion (`cpAt < restoreAt`) pinning
   the order.
2. *The rollback command's syntax is wrong.* The brief wrote `--restore <ts>`; the CLI takes
   `restore --ts <ts>`. As written it silently degrades to the `scan` subcommand and prints a JSON
   plan instead of restoring anything.
3. *The brief's own Step 2 and Step 3 placements are mutually exclusive* — in the real file the
   settings merge runs before `pruneStale()`, the reverse of what the brief assumed. Resolved in
   favour of Step 3's position, argued not asserted: "The Step 3 position is materially safer.
   `buildGsdInventory` subtracts *this run's* manifest. On a `full` → `base` switch the bundle's own
   `hooks/gsd-context-meter.mjs`... are no longer in the manifest, so a detector running before
   `pruneStale()` would claim them as foreign."
4. *`--profile base` does not exist* (Task 2 and again in Task 6) — the real flag is `--variant=base`.
5. *Four defects in Task 5's `renderGsd`/state-scraping code*: the bar formula contradicts the brief's
   own test (`Math.round(percent/34)` renders 40% as `[█░░]`, but the brief's test and Interfaces
   table both demand `[██░]` — implemented to the test, with saturating quantization so a full bar
   means complete and an empty bar means zero); the `phase:` regex matches no real GSD project (real
   files write `current_phase`/`active_phase`, not `phase:`); percent would always render `0%` (real
   `STATE.md` files carry no `%` character; now derived from `completed_phases/total_phases`, bar
   omitted when unknown); and the unrounded `${m.used}%` would have printed
   `33.16766467065869%`.
6. *An ownership predicate widened in only one branch of a condition, so the reverse profile
   transition would have kept the wrong renderer forever (Task 6).* "Step 1's snippet cannot satisfy
   its own Step 2 — it widens ownership only in the `else if`, so on `base` -> `full` the `full`
   branch's `isOurs` (`includes("gsd-context-meter")`) does not recognise the base renderer and `full`
   silently keeps it forever." Not merely argued: "Proven by reverting just that arm" — the implementer
   patched only the `full` branch back to the brief's literal predicate and re-ran the round-trip test,
   which failed exactly as predicted (`actual: 'node ".../hooks/statusline.mjs"'`, expected the
   gsd-context-meter path). Fixed with one `ourStatusLine` predicate shared by both branches. The
   implementer's own report calls this "the sixth wrong step in this plan."

A closely related defect outside that count, also silent-breakage class: **the hook de-registration
matcher could not see a single real gsd-core registration.** `REFERENCES_GSD_HOOK` read only `h.args`,
but all 15 of the real gsd-core hooks on the audited live machine register as a bare `command` string
with no `args` key at all. "On a real machine the de-registration is a silent no-op while the six hook
files are still moved to trash — every later session fires hooks whose files are gone." Confirmed
against the live `settings.json` before and after the fix (0 matched, then 15).

**A controller-level ruling on what counts as an escalation versus a fix.** Task 1's review found that
`buildGsdInventory`'s manifest subtraction only matched by exact path equality, which cannot exclude a
bundle-owned *directory*-shaped category (`skills/gsd-*`) even though the plan's own manifest lists
only files. The controller reasoned explicitly rather than defaulting to either extreme: "The plan's
Global Constraints state the invariant absolutely ("the detector can never consume a file this bundle
owns"); the plan's own verbatim code does not achieve it for directory-shaped categories. The plan
contradicts itself, and the stated invariant governs over a sample implementation of it. Making the
code meet the plan's own constraint is a fix, not a deviation." Dormant in practice only because the
bundle ships zero `skills/gsd-*` today — "that is luck, not design."

**One review finding was retracted by the controller as false — recorded exactly, not softened.**
"Task 5: review clean (Approved) — with ONE FINDING RETRACTED BY THE CONTROLLER as false. The
reviewer reported an Important: "running `node --test` from the repo root mutates five tracked files
as a side effect of some other test" — `README.en.md`, `README.md`, `setup-variants.e2e.test.mjs`,
`setup.mjs`, `variants.test.mjs` — and said the worktree needed a manual `git checkout --`. VERIFIED
FALSE. Those five files are EXACTLY the five that Task 6's commit `8de8fbf` touches. The reviewer was
reading Task 6's uncommitted work mid-flight and misattributed it to a test side-effect... CONTROLLER
ERROR, and the same one twice: I dispatched this review into the worktree where Task 6 was
implementing. The reviewer's instinct was right even with the wrong diagnosis — it re-anchored on
`git show HEAD:` rather than the working tree, which is immune to exactly this, and it correctly
refused to run `git checkout --` under a read-only mandate."

**Concurrent writers to one worktree, repeatedly, across three different task pairs.** Task 1's own
post-review fix commit (`df2834d`) landed inside the worktree while Task 2 was mid-implementation; Task
2's report: "A concurrent commit landed on this branch mid-task... two agents writing the same worktree
is a race; had the edit landed between my RED and GREEN runs I would have attributed its effects to my
own change." Later, Task 2's second fix round landed while Task 3 was running: Task 3's own
"CONTROLLER ERROR — I told this implementer it was the only agent in the worktree while the Task 2 fix
round was still live there. It saw files change under it and one transient test failure, correctly
traced the failure to the concurrent work rather than to its own split, and staged only its four
files. My sequencing was wrong, not its work." No work was lost in either case; each agent staged only
its own files.

**An unasked-for risk, filed rather than silently fixed or silently dropped.** While establishing the
real reachability window for Finding 2, the fix-wave implementer found that `safe()` returns
`undefined` on a parse failure while the code downstream checks `=== null`, making the intended "failed
to parse `settings.partial.json`" handler dead code and causing the installer to crash instead of
degrading. Filed as RISK-SETUP-001, documentation-only, explicitly not fixed: "I filed it rather than
only mentioning it because this report and the ledger both live under git-ignored scratch and would not
survive a clone, and because the standing rule is to log risks with stable IDs rather than inline."

**Deploy policy, stated identically to the sibling design-records-and-stack-rules ledger (shared
cross-plan decisions).** An initial deploy authorisation was superseded by "USER RULING... NO DEPLOYS
AT ALL. Merges to master only," which explicitly retired this plan's own Task 7 by name, then was
itself superseded by a "DEPLOY RULE... supersedes the no-deploy ruling: Deploy only via the standard
`node setup.mjs` and `/init-stack`. After a plan's work ends, run an audit and a preliminary impact
assessment; deploy only if it shows the remaining work will not be interrupted and no working data is
at risk." A live-config audit taken under that rule found this exact machine is `base` profile with
gsd-core installed — precisely this phase's own detector trigger — so deploying this plan's work here
will surface a real, consent-gated removal prompt rather than a no-op; see Outstanding.

## Reviews

- `git diff 103699b..09c995f` — Task 1, initial
- `git diff 09c995f..df2834d` — Task 1, post-fix re-review
- `git diff df2834d..94c16ba` — Task 2, initial
- `git diff 94c16ba..ad77cdb` — Task 2, fix round 1 re-review
- `git diff ad77cdb..6bf3c13` — Task 2 fix round 2 re-review, combined with the Task 3 review (this
  range's head is Task 3's completion commit; the two were reviewed together, a consequence of the
  concurrent-worktree dispatch noted above)
- `git diff 6bf3c13..b4952ed` — Task 4
- `git diff b4952ed..1e6192d` — Task 5
- `git diff 1e6192d..8de8fbf` — Task 6
- `git diff 103699b..8de8fbf` — final whole-branch review

No separate re-review diff exists for the post-review fix wave (commit `86353fe`); the ledger records
its outcome ("426/426... both new tests confirmed RED first") but not a second review pass over it,
unlike the sibling design-records-and-stack-rules phase.

## Outstanding

- Task 7 (deploy and verify) retired; no test in this phase launches a real Claude Code session, so
  whether the registered `base`/`lite` statusline actually renders, and whether the detector's prompt
  fires correctly, remain unverified against a live install.
- The live-config audit found this machine is `base` + gsd-core installed — this phase's own detector
  trigger. Deploying will surface a real removal prompt for the user to answer; not a defect, but a
  live decision point created by this work, not yet reached.
- RISK-VARIANT-005 filed (accepted, unmitigated by design): `pruneStale` re-offers
  `gsd-defaults.partial.json` on every non-`full` run after a decline, because it is never
  manifest-tracked.
- RISK-SETUP-001 filed (documentation only, not fixed): `safe()` returns `undefined` where the
  downstream guard tests `=== null`, so the "failed to parse `settings.partial.json`" handler is dead
  code and an unparseable partial crashes the installer instead of degrading.
- RISK-ULTRAPOWERS-009 (rewritten, accepted residual): the hook matcher drops any registration whose
  command line *mentions* a `hooks/gsd-*` path, including one that merely passes it as an argument to
  an unrelated script — documented over-reach, not narrowed.
- RISK-ULTRAPOWERS-010 filed per the plan's Step 6, status Active, deliberately not fixed: `/gsd-update`
  can reinstall gsd-core at any time, and the detector only observes divergence at the next
  `setup.mjs` run.
- The `everOurs` fail-safe branch (reports and removes nothing if the bundle's own file list cannot be
  resolved) has no test forcing that throw path — asserted by code reading only.
- Task 3's byte-comparison behaviour-preservation harness (stub script, fixtures, stash captures) was
  not preserved, so that specific claim cannot be independently re-audited later.
- `pendingCount`/`pendingNames` untested against bare primitives (`undefined`, a string, a number,
  `[]`) directly, though the existing guard is believed to handle them.
- `statusline.mjs` has no hang guard on stdin (inherited, pre-existing property also present in
  `gsd-context-meter.mjs`); `renderGsd`/`renderSdd` will interpolate the literal string `"undefined"`
  if ever called directly with missing fields, unreachable today but latent because both are exported.
- `--skip-all` over an existing `settings.json` skips the whole merge, so a `base`/`lite` install run
  that way gets no statusline; the empty-line window during the restart after a profile downgrade is
  also unaddressed. Both pre-existing and uniform across settings keys, not unique to this phase's
  work.
