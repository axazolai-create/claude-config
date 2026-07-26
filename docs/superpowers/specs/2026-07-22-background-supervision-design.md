# Background-task supervision — design

**Date:** 2026-07-22
**Status:** Implemented (branch `feat/bg-supervision`); Task* layer pending post-restart verification.

## Problem

Background work (a `run_in_background` Bash job, a backgrounded Agent) signals the model by a
**push**: when it *exits*, the harness re-invokes the model. Two gaps follow from that:

1. **A hang emits no event.** A stuck/looping job never exits, so the push never fires — the
   model waits forever with no signal. There is no wall-clock timer hook to catch it (the full
   hook-event set is lifecycle/tool-driven; none fire periodically).
2. **CI/deploy has no push either.** After `git push`, whether CI passed is external state the
   harness does not track — nothing re-invokes the model when the run finishes.

A recurring failure mode compounds this: the *polling reflex* — reaching for a self-scheduled
wakeup (`ScheduleWakeup`) to "come back and check." That tool is for `/loop` self-pacing only;
using it to poll harness-tracked work is waste. See the `feedback-schedulewakeup-misuse` memory.

## Enforcement reality (why this shape)

- **No hook can force the in-session model to act on a wall clock.** Hooks are event-gated on
  tool calls / lifecycle; they can block a call or inject `additionalContext`, but cannot emit a
  tool call or arm a timer.
- **The Stop hook cannot see live background jobs** (its payload has no task fields), so a
  "you have a job running" nudge cannot be made conditional there.
- **The only true wall-clock guarantee is a cron routine** — but its minimum interval is 1 hour,
  so it cannot do a 5–10 minute health check anyway. Rejected for this use.
- Therefore the design **converts the conditions into exit events** (push) and makes the
  *launch* of those watchers **deterministically nudged** by hooks.

## Design — convert hangs/CI into exit events, nudge deterministically at launch

### 1. `supervise-bg.mjs` — the actual hang guarantee
A wrapper that runs a bounded command under a wall-clock timeout **and** an output-staleness
watchdog. On breach it kills the child and **exits** (code 124) with a greppable `HANG` marker.
Because the wrapper process always exits — on normal completion *or* on hang-kill — the
`run_in_background` re-invocation fires in both cases. A hang (a non-event) becomes a completion
signal. Runs the wrapped command as a single shell string (`sh -c` convention) to avoid
argv/metacharacter mangling. Pure decision logic (arg parse, hang check) lives in
`lib/supervise-lib.mjs` and is unit-tested.

Usage: `node ~/.claude/bin/supervise-bg.mjs --stale 300 --timeout 1800 --label <name> -- '<command>'`
launched with `run_in_background: true`.

### 2. `bg-supervision-nudge.mjs` — PreToolUse launch nudge
Fires when a command is launched with `run_in_background`. If it is neither already supervised
(`supervise-bg`, `gh run watch`, `timeout …`) nor an obvious long-lived server (`dev`, `serve`,
`--watch`, `nodemon`, `vite`, `next dev` — where a watchdog would wrongly kill it), it injects a
non-blocking reminder to wrap the job. Deterministic (fires exactly at launch), low-noise, never
blocks. Replaces the originally-considered Stop-hook nudge, which cannot see live jobs.

### 3. `ci-watch-nudge.mjs` — PostToolUse CI nudge
After a `git push` in a repo with `.github/workflows`, injects a reminder to launch
`gh run watch "$(gh run list -L1 --json databaseId -q '.[0].databaseId')" --exit-status` in the
background — which **exits** when CI finishes (pass/fail), re-invoking the model with the result.
Turns "did CI pass?" into a guaranteed push event.

### 4. `task-lifecycle-probe.mjs` — best-effort Task* verification
Public docs list `TaskCreated` / `TaskCompleted` hook events, but whether they are wired in the
running harness build is unconfirmed. This probe logs each firing (event name + payload keys +
truncated raw) to `~/.claude/logs/task-lifecycle-probe.log`. After a session restart, inspect
that log: if lines appear when a background task is created/completed, the events fire here and
their schema is captured — then real TaskCreated-nudge / TaskCompleted handling can be wired on
top (a cleaner surface than PreToolUse for the launch nudge).

## Guarantee ladder (honest)

| Layer | Guarantee |
|-------|-----------|
| `supervise-bg` wrapper | **Hard** for wrapped jobs — a hang becomes an exit event. |
| `gh run watch --exit-status` (backgrounded) | **Hard** for CI completion — exit = signal. |
| PreToolUse / PostToolUse nudges | **Deterministic reminder** to arm the above; cannot act for the model. |
| Task* probe | Verification only, until the events are confirmed in this harness. |

Nothing here *forces* the model to wrap a job — that is not achievable with hooks. The wrapper +
deterministic launch nudge is the strongest buildable combination on confirmed primitives.

## Wiring

`settings.partial.json`: PreToolUse Bash → `bg-supervision-nudge`; PostToolUse Bash →
`ci-watch-nudge`; `TaskCreated`/`TaskCompleted` → `task-lifecycle-probe`. Deployed by `setup.mjs`
(additive, idempotent, ownership-based dedup by hook filename).

## Related

- Risks: `RISK-SUP-001..003` in `RISK_REGISTER.md`.
- Memory: `feedback-schedulewakeup-misuse` (the polling-reflex root cause this design addresses).
