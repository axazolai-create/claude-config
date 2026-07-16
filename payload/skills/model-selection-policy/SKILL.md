---
name: model-selection-policy
description: When to run claude-sonnet-5 vs claude-opus-4-8 and how to set reasoning effort — the executor default, escalation triggers (high cost-of-error, deep reasoning, large context, parallel agents), and the sonnet@ExtraHigh≈opus@medium effort rule. Use when choosing a model or effort level for a task or subagent.
---

# Model Selection Policy

DEFAULT executor: claude-sonnet-5
HIGH-ACCURACY / heavy reasoning: claude-opus-4-8

## Use sonnet-5 for
agentic coding, multi-step tool use, debug on brownfield, sustained tasks, knowledge work,
high-throughput / latency-sensitive loops.

## Use opus-4-8 for
high cost-of-error tasks, deep research, complex judgment, large context, parallel agents,
serious cyber-adjacent work (sonnet-5 weak here).
Prefer when a wrong answer is expensive to recover from.

## Effort rule
sonnet-5 @ ExtraHigh ~= opus-4-8 @ medium-high on OSWorld-Verified / BrowseComp.
If sonnet-5 at high effort stalls or under-delivers on an accuracy-critical task,
escalate sonnet-5 -> opus-4-8 rather than grinding sonnet-5 further.
Reserve max-effort sonnet-5 for throughput cases where opus latency/limits are the constraint.

## Advisor tool (Claude Code, session-level — separate axis from executor model choice)
Claude Code's advisor tool pairs the session's executor model with a stronger model consulted
mid-generation for strategy/course-correction. This is a HOST-RUNTIME setting
(`/advisor <model>`, `advisorModel`, or `--advisor`), not a per-agent choice — set once at the
session level, and every subagent an orchestrator spawns inherits the same advisor
automatically. There is no per-agent advisor control today.

This composes with, not replaces, everything above: the executor-model choice (sonnet vs
opus) still governs cost for mechanical turns; the advisor adds a stronger reviewer inline on
top, on every turn, for the whole session.

**Worth enabling:** long, multi-step agent loops where the plan matters but most turns are
mechanical (e.g. `/gsd-execute-phase`, `/gsd-debug`) — prompt-caching for the advisor call
pays off at roughly 3+ advisor invocations, which these long loops make.
**Skip it:** short, one-shot agents (mappers, quick audits, single-file checks) — little to
plan, added cost without a commensurate quality gain.
