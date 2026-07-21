# Considering `claude_orchestration` for a GSD project

This doc is what `/init-stack` (step 7) points at before asking whether to enable
`claude_orchestration.enabled` in a project's `.planning/config.json`. It exists so the
command doesn't have to inline a full decision framework into its own prose.

## Why `Workflow`, not a recursive `Agent` call

This is the answer to "can a GSD wave decompose more than one level deep." A 2026-07 test series
(see `gsd.md`'s "Depth boundary" section for the full finding) tried three ways to get a third
dispatch level out of the `Agent` tool — a dedicated coordinator agent, the orchestrator recursing
into itself, and a freshly-written role with no anti-recursion text. Each hit either a principled
refusal (any worker whose prompt carried a guardrail against recursive spawning) or a silent
async/background stuck state a headless run can never wake from; none produced a working third
level. `Workflow`'s `parallel()`/`pipeline()` sidesteps the whole failure class because branching
is fixed by a generated script the tool executes, not a decision an agent makes about itself at
inference time — as far as this series established, the only reliable path to dispatch depth beyond
2, not merely a nicer alternative to one that already works.

## What actually changes

When enabled, `/gsd-execute-phase` resolves a dispatch-backend decision before each wave: either it
emits a generated script routed through the Workflow tool (`parallel()` stage barriers, one
`agent()` call per plan, `resumeFromRunId`, an optional `budget()` cap), or — on any gate miss —
falls back to exactly today's inline dispatch. The fallback is fail-closed by construction: a
disabled capability, a non-Claude runtime, an unrecognized or below-floor Agent SDK version, or a
malformed manifest all resolve to the same inline path that runs today. Enabling the key cannot make
dispatch worse — the only question is whether it activates at all on a given install.

## Check the gate before expecting anything from this

The most common reason this capability does nothing after being enabled: the live host can't supply
a known Agent SDK version, so the version-floor gate never opens. There is no way to tell this from
the config alone — run the backend-detection check and read its `reason` field. If it reports an
unknown/missing SDK version, enabling the key stays harmless (fail-closed to inline), but don't
expect the Workflow path to activate until that changes.

## What it actually buys you

Parallel dispatch of a wave's plans into isolated worktrees already happens today via the inline
path — several `Agent(..., isolation="worktree")` calls in one message already run concurrently.
This capability does **not** unlock parallelism that doesn't exist; the incremental value is
narrower:

- **`resumeFromRunId`** — if a wave's Workflow-dispatched run is interrupted mid-flight (before a
  plan's own commit/artifact would otherwise prove it finished), the same run id lets a
  re-invocation skip already-completed calls instead of redispatching them. GSD's own per-plan
  commit + `SUMMARY.md` already gives coarse, dispatch-mechanism-agnostic resume — this is a
  finer-grained, Workflow-script-scoped complement, not a replacement.
- **`budget(tokens)`** — a hard aggregate token ceiling checked when a *new* `agent()` call would
  start. It does not preempt or cap a single already-running call that balloons on its own; it stops
  the wave from dispatching *further* work once the pool is spent. Real cost governance for a
  multi-plan wave, but not a fix for one runaway worker mid-call.

If the actual pain point is a single wave taking far longer than expected, check dependency
provisioning first (see below) — usually the bigger lever, and orthogonal to this capability.

## A real, separate risk this capability does not create or fix

Parallel worktree dispatch — whichever backend runs it — means N independent filesystem checkouts.
If each one independently reinstalls/rebuilds an unchanged shared dependency instead of the
orchestrator provisioning it once and copying it in, a wave can take hours instead of minutes (and
can outright fail on Windows under concurrent installs against a shared package-manager store). This
is mitigated separately, in `rules-src/gsd.md`'s "Parallel worktree waves" section and in
`gsd-executor.md`'s own hardening patches — it isn't specific to `claude_orchestration`, and
enabling or disabling the key doesn't change it.

## A complementary, unrelated lever: the session-level advisor

Claude Code's session-level advisor tool (a stronger model consulted mid-generation by the executor
model, set once via `/advisor <model>` and inherited by every subagent an orchestrator spawns) is
worth considering for the same long, multi-step loops this capability targets (`execute-phase`,
`debug`). It's a host-runtime feature layered on top of whichever executor model GSD's own tiering
picks, not a GSD setting itself, and composes independently of whether `claude_orchestration` is
enabled. Skip it for short, one-shot agents where there's little to plan.

## Recommendation

Pilot, don't flip on by default:

1. Run the backend-detection check and read `reason` before doing anything else. If it shows the
   SDK-version gate is the blocker, decide whether that's worth chasing before continuing.
2. Enable for one wave with a few genuinely independent plans, with the backend forced (rather than
   left on `auto`) so a gate miss shows up loudly in the reason field instead of silently falling
   back.
3. Judge success by resumability and cost-capping behavior, not by wall-clock speedup — the speedup,
   if any, is likely already priced in by the inline path.
