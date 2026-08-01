# Phase 13 — graphify → Neo4j autosync: what actually happened

**Goal:** every commit refreshes the global graph and carries it to Neo4j, with nobody typing a
flag and no LLM key required.

**Outcome:** met, with one external defect left standing and filed. The chain now fires from a
commit and reaches Neo4j on its own. What it cannot do is *report* that it finished, because
`graphify export neo4j --push` never returns — `RISK-GRAPHPUSH-003`.

## The numbers

| Measurement | Value |
|---|---|
| Suite before the phase | 654 passing |
| Suite after tasks 1–8 | 671 passing |
| Suite after the spawn fix | 685 tests, 684 passing, 1 skipped, 0 failing |
| Mass sync, this run | 131 projects in 6 min 21 s, **0** API-key errors |
| Mass sync, 3 July run (for contrast) | **111** `no LLM API key found` errors |
| Global graph | 84,640 nodes across 99 repositories |
| In Neo4j after the push | **84,640 nodes, 77,343 edges, 99 repositories**, `claude-config` among them |
| Prior Neo4j baseline named by the plan | 269 nodes |

## What the live verification proved, and what it broke

Step 5 was written to prove the chain fires by itself. On its first run it proved the opposite,
and that is the phase's most valuable result.

**The commit fired the hook, the hook took the lock, the spawn returned — and nothing ran.** No
extract, no push, no log, and the lock was never released. A six-variant probe found the cause:
node escapes the quotes inside the command string as `\"` when it builds a Windows command line,
`cmd.exe` has no such escape, and the mangled line makes cmd exit without executing a single step.
With `stdio: "ignore"` on a detached process it failed in complete silence.

Only `windowsVerbatimArguments: true` and `shell: true` ran at all; the shape the worker had used
— and had used since long before this phase — ran nothing. **The per-commit autosync has therefore
never worked on Windows.** July's `no LLM API key found` failures came from `graphify-sync-all.mjs`,
which calls `graphify` directly and needs no `cmd` wrapper, which is why they were visible at all
while the worker's silence was not.

The fix moved the spawn options into `buildSyncCommand` for the same reason task 1 moved the
command there: the worker's effects cannot be tested and a returned object can. Three tests pin it,
one of them naming the failure so the flag is not quietly dropped later.

**Re-run of step 5, after the fix:** the commit at 02:03 refreshed `claude-config` in the global
graph (its entry date moved from 2026-07-31 to 2026-08-01 UTC), `graphify-neo4j-push.log` was
created, and `graphify-neo4j-push.lock` was taken by the push script itself. Nobody typed a push
command. That is the phase's thesis, demonstrated.

## The defect that remains

`graphify export neo4j --push` writes everything and then does not exit. Measured over 23 hours:
no TCP connections, all 24 threads in `UserRequest`, 47 seconds of CPU across the whole period,
while Neo4j held the complete 84,640 nodes. The log's last line is
`[neo4j-push] pushing global graph to bolt://…`; the `Pushed to Neo4j: <n> nodes, <m> edges` line
that the script relies on never arrives.

The ten-minute TTL in `state-lock.mjs` is what keeps this from being fatal: a wedged push holds its
lock forever, since `process.on("exit")` cannot fire in a process that never exits, but `isHeld`
judges by mtime and ignores the lock after ten minutes. Without that TTL one wedge would have
disabled every future push permanently. Full detail and the proposed fix are in
`RISK-GRAPHPUSH-003`.

## Deviations from the plan

- **Task 8.** The plan said to replace a sentence naming `graphify-sync-all --neo4j-push`. Neither
  README contained it — the flag was not mentioned at all — so the text was added instead. Both
  files also still described the worker as running a plain `extract`, which task 2 had made false.
- **Task 9.** The plan deployed from the phase branch; the tree's ruling is that a deploy comes
  from `master`. Both branches were merged first and the deploy ran from `master`, on a green suite.
- **Task 9, unplanned.** The first deploy fired by accident: `node setup.mjs --help` is not a help
  invocation, since the script ignores unknown flags, so it installed. The impact assessment that
  the ruling requires beforehand was written afterwards and says so, in
  `docs/2026-08-01-deploy-impact-through-phase-13.md`. The second deploy, carrying the spawn fix,
  was preceded by its dry run.
- **Task 9, added.** `fix/autosync-spawn-verbatim` is not in the plan. It exists because step 5
  found the chain did not run, and shipping a phase whose headline claim is false was not an option.
