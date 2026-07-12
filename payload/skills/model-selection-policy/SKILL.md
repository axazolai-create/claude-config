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
