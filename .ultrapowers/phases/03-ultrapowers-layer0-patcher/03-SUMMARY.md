# Phase 03 summary — ultrapowers layer0 patcher

Plan: `.ultrapowers/archive/plans/2026-07-27-ultrapowers-layer0-patcher.md`
Branch: `feat/ultrapowers-rework` — Start HEAD `e9519bd`

## Tasks

This phase was abandoned mid-flight and superseded by the fork design (upstream plugin forked as `ultrapowers`, renamed inside our own copy, driven by a `transform/` delta engine) — it did not ship.

- **Task 1** (probe D — controller-run, no implementer subagent): measured whether any hook event gives an instant trigger for reloading the patched plugin cache. Complete. Range `e9519bd..371941b`.
- **Task 2** (pure classifier: buckets and rewrite): implemented, reviewed, one fix round begun, then abandoned along with the whole patch-in-place approach; rolled back. Never reached a completed state. Range `371941b..e6adad9` (implementer delivery `85349ca`, fix-round-1 commit `bd4eb58`, rollback `e6adad9` removes both implementation files, restoring the tree to `371941b`).
- **Tasks 3–10 never ran.**

## Rulings

### Pre-flight (2 conflicts, both resolved by the user)

- Tasks 1 and 10 are not subagent-executable (session restart + slash command).
  Ruling: probe D runs first with the user, subagents take 2-9, task 10 last with the user.
- Plan mandated the drift detector return "green" on internal error; a reviewer would
  call that a defect (broken and healthy report the same word).
  Ruling: fourth state "unknown". Plan amended in ce1a860 before any dispatch.

### Task 1

- Unplanned finding: one settings.json edit fired ConfigChange in TWO live sessions (this repo
  and D:\Work\SMB-Sync), 20 ms apart. Config events broadcast machine-wide; any future
  handler must key on its own cwd and be idempotent. Same hazard as приложение С.
- Task 8 Step 5 is pre-answered: record the negative, open no follow-up.

### Task 2 — deferred minors

- Task 2: minor (deferred): artifact rule lacks a trailing boundary - docs/superpowers/plansomething
  -> .ultrapowers/phasesomething. Add (?![\w-]).
- Task 2: minor (deferred): flags.replace("g","") is a substring replace and the i flag survives
  into the replacement, so Docs/Superpowers/Plans case-flattens. Build the flag set explicitly.
- Task 2: minor (deferred): flags.includes("g") ternary at :29 is dead - every rule already carries g.
- Task 2: minor (deferred): ALL-CAPS forms (SUPERPOWERS_DEBUG) land in unclassified and therefore
  hard-block the whole patcher. Intended behaviour, but one env-var constant upstream would stop
  everything. Decide in Task 10 against the real corpus rather than guessing now.

### Task 2 — plan conflict escalated to the human

- Task 2: plan-conflict escalated to the human — the histogram counted rule matches while the
  layer's acceptance sum counts word occurrences (119, measured by grep -o). Both halves came
  from the plan, so the plan contradicted itself. Ruling 2026-07-27: change the counter, not the
  acceptance rule — count occurrences inside each span, and replace the vacuous invariant test
  with a fixture where one span swallows two occurrences.

### Awaiting

Awaiting: verified facts on local plugin sources, own-marketplace schema, namespace collision
and release detection before the new spec is written.

## Deviations and decisions

The plan assumed a detect-drift-then-patch approach was viable. Execution disproved it in three escalating rounds, recorded in the ledger as "APPROACH ABANDONED 2026-07-27, twice over, then replaced":

1. **Enumerate-and-protect classifier** (commit `85349ca`). Task 2's own report (`task-2-report.md`) declared this DONE — 7/7 tests passing, "no concerns," a clean self-review claiming full coverage against the brief. The opus review over `371941b..85349ca` did not agree: verdict "Needs fixes," 2 Critical + 4 Important findings, and proved by execution that the enumeration cannot be completed — four shapes fell through to the `brand` bucket and were silently rewritten into paths that never resolve. The report and the ledger disagree here: the report's self-review found no problems; the ledger's independent review found critical ones. Both stand as written — this summary does not pick a winner.
2. Fix round 1 of a planned 5 was dispatched against the critical/important findings; the implementer committed `bd4eb58`, then was stopped mid-round.
3. **Inverted default** was considered as a second approach — safer, but still "a machine guessing intent" — and was never implemented.
4. **Interactive filter-building pass**, one question asked, got as far as a full scan of the plugin (all directories, not just the three the plan's "119" baseline was measured over). That scan found 1504 occurrences in 111 files, 382 distinct exact spellings — the plan's own 119 baseline was wrong, having been measured only over skills/hooks/scripts/. Deciding 382 variants by hand was judged more expensive than the problem the patch approach was meant to avoid — this is the point at which the phase was abandoned.

Decision made on the spot: stop patching the cached plugin in place and fork the upstream plugin as `ultrapowers` instead, renaming inside a copy whose identity is ours to change; upstream tracking becomes "watch for a new release," not "detect drift in a cache we patched." Rollback commit `e6adad9` removed both Task 2 implementation files, leaving the tree identical to `371941b`. Layer 0's plan and the spec's layer 0 section were declared obsolete and marked for rewrite. One artifact survived the rollback: `ultrapowers-patches/scan-inventory.mjs` — enumerating occurrences is still needed inside the fork, just without the "must not touch identity" constraint that broke this approach.

## Reviews

- `git diff 371941b..85349ca`
