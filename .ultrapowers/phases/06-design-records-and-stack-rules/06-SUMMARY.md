> This phase spans two repositories: the bundle (`claude-config`, worktree
> `claude-config-wt-plan2`, branch `feat/design-records-stack-rules`) for Tasks 1-4, 4b and 6a's
> deploy half; and the fork (`ultrapowers`, branch `patch`/`main`) for Task 5 and the rest of
> Task 6. The two halves are kept separate below rather than folded into one numbered list.

## Tasks

- **Task 1** (bundle) — Extract `listWorkspaces` into a shared library
  (`payload/bin/lib/workspaces.mjs`), reduce the changelog skill's CLI to a thin wrapper over it;
  output proven byte-identical pre/post on two fixtures plus a scratch post-deploy check.
  `103699b..09931c0`
- **Task 2** (bundle) — Fingerprint the root **and** every workspace: `detectMarkersByWorkspace`,
  a map-based `computeStackFingerprint`, plus a deliberately pulled-forward legacy guard.
  `09931c0..7593802`
- **Task 3** (bundle) — `compare`: `checkStackRules` now returns `added`/`removed` naming what
  changed in both directions; `sourceHash`/`stackFingerprint` demoted to reported-only fields that
  decide nothing. `7593802..318aaab`
- **Task 4** (bundle) — Teach the compiler the workspace-scoped snapshot: both
  `rules-src/README.md` (full and lite) get the `markers:`/`stacks:` flow-mapping frontmatter,
  scoped rule sections, and the additive-update step. `318aaab..31045b8`
- **Task 4b — unplanned, dispatched mid-execution** (bundle) — fix
  `payload/commands/init-stack.md` so `/init-stack` hands the compiler subagent the checker's
  *whole* JSON object (`markers` verbatim) instead of only `sourceHash`/`stackFingerprint`, document
  all four statuses including `legacy`, and add a mandatory post-rebuild re-check. Exists because
  Task 4 found the four planned tasks were correct and operationally inert without it (see
  Deviations). `31045b8..8369b20`
- **Task 5** (fork, repo `ultrapowers`, branch `feat/design-records`) — Delta
  `010-design-records.patch`: four rules added to `plugins/ultrapowers/skills/brainstorming/SKILL.md`
  (design-time stack-drift check, Testing Decisions, Out of Scope, Glossary, ADR). Single commit
  `448171a`; the ledger's completion line records no base commit for this range.
- **Task 6a** (fork) — Publish the fork: revision bump, rebuild `main`, push `patch`+`main` to
  origin as `6.2.0-up.3`. Ledger records `patch` commit `5eebb14` and generated `main` `02a5213`,
  no base given for either.
- **Task 6b — deploy the bundle into `~/.claude`: RETIRED.** Superseded by the user's "NO DEPLOYS
  AT ALL" ruling (see Deviations), folded into one serialised deploy run after all four plan
  branches (this plan plus plans #1, #4, #5) land on `master`. Not performed inside this phase.

Post-review, a **fix wave** (not a plan task) addressed three final-review findings on the bundle
side, commit `f8114e8`, reviewed as `8369b20..f8114e8` — see Reviews and Deviations.

## Rulings

Every deferred/parked finding below is copied verbatim from the ledger, followed by its ruling and
the final review's triage where the ledger records one.

- Finding (Task 1): "minor (deferred): no test covers a workspace glob matching nothing, nor a
  malformed workspace manifest. Both branches moved verbatim so no regression risk here, but the
  fingerprint caller in Task 2 hits the same branches. Gap inherited from the plan's own test list."
  No individual triage recorded beyond the final review's aggregate verdict (below).

- Finding (Task 2): "open question raised for review — `localeCompare` (the plan's own code,
  matching `listWorkspaces`) makes the workspace key sort locale-dependent, so the fingerprint is
  theoretically machine-dependent. Cross-machine stability is the entire point of a fingerprint. The
  implementer flagged it and did not fix it, reasoning that a fix re-changes every fingerprint."
  Ruling, from the Task 2 review: "(4) localeCompare instability is REAL, not theoretical, and
  measured: this machine resolves to `ru-RU`; under `da-DK` `apps/aardvark` sorts after
  `apps/zebra`; under `et-EE` `packages/z-utils` sorts before `packages/tools`. Existing tests
  cannot catch it because they compare two values computed in one process on one machine. The
  implementer's reason for deferring ("it re-changes every fingerprint") does not survive item 2:
  there is no comparable stored fingerprint left to invalidate, so the fix is free NOW and expensive
  after Task 4. >>> Sent to Task 3 with the byte-order comparator and a test pinning the serialized
  hash input." Triage: resolved during execution (Task 3 replaced `localeCompare` with byte order) —
  one of the final review's "4 RESOLVED during execution".

- Finding (Task 2): "⚠️ open for Task 6 — confirm `payload/bin/lib/workspaces.mjs` ships in every
  variant that ships `payload/hooks/lib/stack-rules-check.mjs`, or the SessionStart hook breaks at
  import time on that profile." No individual triage recorded in the ledger; Task 6's deploy half
  (Task 6b) that would have verified this was retired (see Outstanding).

- Finding (Task 2): "minor (deferred): CLI still emits root-only `detectMarkers(root)` beside a
  workspace-aware fingerprint; a compiler run between now and Task 3 stamps a root-only `markers:`
  that Task 3 then rejects as legacy. Self-healing in the safe direction; Task 3 Step 4 owns the
  fix." No individual triage recorded beyond the aggregate verdict; Task 3's CLI-block rewrite
  (`markers` now comes from `checkStackRules` itself) subsumed it.

- Finding (Task 2): "minor (deferred): test named "an unreadable root" actually passes a nonexistent
  path; EACCES is not covered. Redundant `notEqual(status,"stale")` beside
  `equal(status,"legacy")`." No individual triage recorded beyond the aggregate verdict.

- Finding (Task 4): "minor (deferred): `rules-src/README.md`'s opening bullet still says drift
  detection was removed, while the new step tells the compiler what to do on `stale`." No individual
  ledger triage; the Task 4b report separately records fixing the contradiction ("Concern 2
  resolved, one sentence") — see Deviations for the ledger-vs-report distinction.

- Finding (Task 4b): "⚠️ open, and it is the most destructive failure mode in scope — the
  additive-update path's section-preservation has NO committed regression test. Only the checker's
  DETECTION of staleness is unit-tested. The evidence is one unreproducible manual run. Predates
  this diff; carried to the final whole-branch review as a candidate follow-up." Ruling, from the
  final whole-branch review: "Ruling on the open ⚠️ (additive-update preservation): CAN STAND for
  merge, but DO NOT close it and do not treat the re-check gate as covering it. `checkStackRules`
  compares `markers` only, so a snapshot that dropped every rule section but stamped `markers`
  correctly still reads `ok` — the gate gives FALSE assurance against precisely the destructive
  mode. The right deliverable is a mechanical guard, not a test: snapshot to
  `.claude/stack-rules.md.prev` before an additive update, then diff the `## ` heading sets and fail
  when a heading present before is absent after and its workspace is not in `removed`. Log under
  RISK-STACKRULES-001." Triage: CAN STAND, explicitly not closed.

- Finding (Task 4b): "minor (deferred): nothing ties the literal phrase "Updating an existing
  snapshot after drift" in the command to the two READMEs' headings; a rewording of either would
  silently desync." Triage: resolved in the post-review fix wave (Finding 3 there adds a
  whitespace-normalising test pinning the phrase across `init-stack.md` and both READMEs) — one of
  the "4 RESOLVED during execution" or folded into the fix wave; the ledger does not disambiguate
  which.

- Finding (Task 4b): "NEW concern, out of scope, worth its own task — `detect()` in
  `payload/bin/lib/stack-markers.mjs` is workspace-blind for some markers. A real detector
  inconsistency, routed around here rather than fixed." No individual triage recorded beyond the
  aggregate verdict; stays open (see Outstanding).

- Finding (final whole-branch review, Important 1): "the command says `markers` must be stamped "as
  the ONE-LINE flow mapping the check printed" — the check prints `JSON.stringify(..., null, 2)`,
  multi-line. A compiler following it literally produces a block `parseFlowMap` cannot match, and
  the snapshot reads `legacy` forever. Inside `/init-stack` the re-check gate makes it visible;
  OUTSIDE it — and step 0 sanctions a rebuild on request — nothing checks. The existing doc test
  compares `Object.keys()` only." Triage: dispatched to the fix wave, then "ALL FINDINGS ADDRESSED,
  no new breakage" on re-review.

- Finding (final whole-branch review, Important 2): "FOUR documents of record still describe the
  pre-branch mechanism — `RISK-STACKRULES-002` and both top-level READMEs. That entry's residual has
  genuinely changed: the new accepted trade is that every existing project stays silent until
  rebuilt once." Triage: dispatched to the fix wave, then "ALL FINDINGS ADDRESSED, no new breakage"
  on re-review.

- Finding (final whole-branch review, Important 3): "Important 3 -> HANDED TO THE USER, not fixable
  here: the fork half is PUBLISHED ahead of the bundle half. `6.2.0-up.3` instructs every design
  session to run the deployed checker and act on `stale` — and the deployed pre-branch checker is
  still the mtime-driven one. Measured now: claude-config reports `stale` from the deployed copy
  purely on `sourceHash`, nothing about its stack changed. Locally installed ultrapowers is still
  `6.2.0-up.1`, so it is latent. ORDERING CONSTRAINT: deploy the bundle BEFORE updating the
  ultrapowers plugin past 6.2.0-up.2." Triage: not part of the fix wave (not code-fixable); left as a
  standing ordering constraint for whoever runs the deferred deploy — see Outstanding.

Aggregate verdict, quoted in full because no other line in the ledger enumerates the count: "15
deferred items triaged — 4 RESOLVED during execution, the rest CAN STAND."

## Deviations and decisions

**The central finding of the phase: four correct tasks, one operationally inert plan.** Task 4
shipped a compiler that produces a comparable snapshot, but the dispatcher that invokes it did not
change with it. Task 4's own report records the discovery: "`payload/commands/init-stack.md` is now
behind the CLI contract, and no task in this plan owns it." The ledger escalates it in the same
terms: "LOAD-BEARING GAP, no task in this plan owns it -> dispatched as Task 4b. …A compiler given
only those two [`sourceHash`/`stackFingerprint`] cannot stamp `markers:`, so every rebuild driven
through `/init-stack` reproduces exactly the permanently-legacy snapshot this task exists to remove.
Leaving it means the plan's four tasks are correct and operationally inert." Task 4b's own
end-to-end proof made the stakes concrete rather than argued: on a real pnpm+Nest fixture, the old
instruction ("reuse step 1's `stacks` list instead of re-detecting") would have compiled a monorepo
snapshot with no backend rules at all, because `/init-stack`'s own detection step reports
`stacks:["next"]` and misses the Nest service entirely — `detect()` checks `nest-cli.json` at the
root only, while the checker's `markers` correctly names `apps/api: [nest, node]`. The ledger:
"THE MEASUREMENT that justifies the fix better than the original argument did… The gap was worse
than 'the frontmatter lacks a field'." Task 4b closed the loop with a mandatory re-check rather than
trusting prose alone — the reviewer's framing: "Prose reduces the chance of a bad stamp but cannot
prevent it. The mandatory re-check gate does… That converts the named failure mode from silent into
visible."

**The controller's own correction was itself wrong, and the implementer caught it rather than
trusting either version.** Task 2's dispatch told the Task 2 implementer that the legacy guard
belonged to Task 2, not Task 3 as planned — a disclosed "CONTROLLER ERROR" — and then predicted
Task 3's RED step would show "two already pass; only the three added/removed cases fail." Task 3's
own RED run found a third answer: "of the brief's five cases, exactly one was already GREEN and
four were RED," because the controller's correction had not accounted for the brief's case 1
deliberately stamping a `sourceHash` that could never match. The implementer ran the test before
trusting either the plan or the correction.

**Three coordinator corrections landed in Task 3, all evidence-based overrides of the plan's literal
code.** (1) The plan's Step 1 block, applied verbatim, is a `SyntaxError` — it redeclares an
`import` and a `snapshot()` helper that already exist; the implementer reused both rather than
duplicating. (2) `localeCompare` was replaced with a byte-order comparator; the implementer did not
merely accept the instruction but proved the difference — the byte-order test was silently GREEN
under this machine's `ru-RU` collation with lowercase fixtures, so the implementer added
`packages/Web` (case folding diverges under every locale at primary strength) to make the test
genuinely discriminate, recording: "That is the difference between a test and a decoration, and it
was caught by the implementer, not by me." (3) The fixed 800/2000-byte frontmatter read window was
replaced with slicing at the closing `---`, proven with an 80-workspace fixture whose frontmatter is
asserted to exceed 2000 bytes before the status assertion runs, so the test cannot silently shrink
below the threshold it exists to cross.

**Task 4's implementer measured rather than accepted a factual claim from the controller's own
dispatch.** The dispatch stated this repository's `stackFingerprint` is SHA-1 of the empty string.
It is not: `computeStackFingerprint` hashes `JSON.stringify(detectMarkersByWorkspace(root))`, i.e.
the string `{".":[]}`, giving `sha1({"​.":[]}) = 7984ab39f5926fc6`, not `sha1("") = da39a3ee5e6b4b0d`
(the value the *old*, flat-list snapshot recorded). The ledger credits this directly: "The
implementer measured rather than accepted it," and the Task 3 review had already independently
"recomputed the sha1 correction by hand and confirmed the implementer was right and my dispatch was
wrong."

**Task 5's implementer found the plan's own verification step unsatisfiable, substituted a working
one, and still proved the actual constraint three independent ways.** The plan's Step 4b expects
`grep -n "seam" .../testing.md || echo "testing.md untouched, as designed"` to print the fallback.
It cannot: `testing.md` has contained the word "seams" since before this plan existed (a pre-existing
"integration seams" bullet), so the grep always succeeds and the echo never fires — an expectation
"wrong, and never could have been met, independently of this task." The implementer substituted a
grep for text unique to the new rule (`"Testing Decisions\|intent to verify"`), confirmed it prints
the expected fallback, and separately confirmed the underlying non-duplication constraint by (a)
diffing `git show HEAD:payload/rules-src/testing.md` for the seams text, (b) a fork-wide
`grep -rln` sweep showing the new rule exists in exactly one built file, and (c) a sweep of
`claude-config/payload/rules-src/` showing zero occurrences.

**The fix wave rejected part of its own dispatch instruction.** Asked to have the CLI emit
paste-ready `markers:` *and* `stacks:`, the implementer refused the `stacks:` half: "The check
cannot emit `stacks:`. `stacks:` is the *compiler's own* per-workspace rule selection… the check
only performs *detection* and returns `markers`. There is no `stacks` anywhere in `checkStackRules`'
return value." It also weighed and rejected a second design (`markersLine` as a JSON field) because
the escaped-quote rendering is "exactly the shape that gets mis-pasted," choosing a raw appended
line instead, after confirming nothing in the repo parses the CLI's stdout as JSON.

**A self-caught false negative, flagged for its own sake.** Task 6a's first byte-exactness check
reported all four added rules as `MISSING` from the built fork tree. The cause: `grep -Fxq
"$line"` parsed the leading `- ` of a markdown bullet as an option flag. The 7th line (the HTML
comment, the only one not starting with `-`) passed, which was the tell. Re-run with `grep -Fxq --
"$line"`, all seven lines matched. The report generalises the lesson: "when a check says the work
failed, first ask whether the check is sound — but always re-verify rather than assume."

**Deploy policy reversed twice in the same session, all recorded as user rulings.** An initial deploy
authorisation was superseded by "USER RULING (2026-07-29, supersedes the earlier deploy
authorisation): NO DEPLOYS AT ALL. Merges to master only… This retires the deploy halves outright
rather than deferring them" — naming plan #2's Task 6b, plan #4's Task 7 and plan #5's Task 7 by
name, while explicitly leaving the fork push unaffected ("publication of a git branch, not an
install into `~/.claude`"). That in turn was superseded by a "DEPLOY RULE (user, 2026-07-29,
supersedes the no-deploy ruling): Deploy only via the standard `node setup.mjs` and `/init-stack`.
After a plan's work ends, run an audit and a preliminary impact assessment; deploy only if it shows
the remaining work will not be interrupted and no working data is at risk. After all work ends,
repeat the audit and, if clean, do the final deploy." Alongside this the user also stated a standing
project rule scoping what may ever be written outside `payload/`/`payload-lite/`/the installer,
audited clean across all four branches at the time it was stated, with one open question flagged for
a later plan (see Outstanding).

## Reviews

- `git diff 103699b..09931c0` — Task 1 (bundle)
- `git diff 09931c0..7593802` — Task 2 (bundle)
- `git diff 7593802..318aaab` — Task 3 (bundle)
- `git diff 318aaab..31045b8` — Task 4 (bundle)
- `git diff 31045b8..8369b20` — Task 4b (bundle)
- `git diff 33f22cb..448171a` — Task 5 (fork)
- `git diff 103699b..8369b20` — final whole-branch review (bundle)
- `git diff 8369b20..f8114e8` — final fix-wave re-review (bundle)

## Outstanding

- RISK-STACKRULES-001 filed, unimplemented: the additive-update path can drop every `## ` rule
  section while still restamping `markers` correctly and reading back `ok` — no mechanical guard
  exists yet (the `.claude/stack-rules.md.prev` + heading-diff design was scoped, not built).
- RISK-STACKRULES-002 updated, accepted rather than closed: every snapshot stamped before the
  `markers:` line reads `legacy` forever until its project is explicitly rebuilt once; nothing
  prompts that rebuild at session start, by design (flagging it broadly is what disabled the
  original check).
- Task 6b (bundle deploy) retired for this phase, folded into one serialised deploy after plans #1,
  #2, #4 and #5 all land — so this phase's own deploy-time checks (workspace-import resolution under
  the real `~/.claude`, `payload/bin/lib/workspaces.mjs` shipping in every profile that ships the
  hook lib, the CLI reporting `legacy` against the real repo) remain unverified against a real
  install as of this ledger.
- Ordering constraint from Important 3, still live: the fork is published as `6.2.0-up.3` but the
  bundle is not yet installed; deploying the bundle must happen before any machine updates its local
  ultrapowers plugin past `6.2.0-up.2`, or the design step will point brainstorming sessions at a
  hook lib (`~/.claude/hooks/lib/stack-rules-check.mjs`) that does not yet exist there.
- `detect()` in `payload/bin/lib/stack-markers.mjs` remains workspace-blind for some markers (e.g.
  `nest-cli.json` checked at the root only, unlike the recursive `next` check) — routed around by
  preferring `markers` for attribution in `/init-stack`, not fixed at the source; flagged as "worth
  its own task."
- The `## Not detected` line in a compiled snapshot is prose-only: nothing verifies a real compile
  actually emits it or that scoped `## <workspace> — <stack>` headings appear; the round-trip tests
  prove the frontmatter contract only, not the body's shape.
- The CLI's stdout is no longer pure JSON (a `# stamp this line verbatim` comment plus a bare
  `markers:` line now follow the JSON block). Confirmed harmless today — no code in the repo parses
  the CLI's stdout — but noted as a latent trap if anything ever pipes it through `jq`.
- Open question stated by the user, unresolved as of this ledger: whether plan #3's ADRs and
  glossary, written into this repository via `resolveRecordPaths`, count as the project's own
  decision records (like `RISK_REGISTER.md`) or as a shipped capability under the payload-only
  rule — needs confirmation before plan #3 runs.
