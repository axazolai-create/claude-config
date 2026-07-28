---
name: model-selection-policy
description: When to run claude-opus-5 vs claude-sonnet-5 vs claude-haiku-4-5 and how to set reasoning effort — the executor default (Opus 5), the effort ladder, and why the cost lever is now effort rather than tier. Use when choosing a model or effort level for a task or subagent.
---

# Model Selection Policy

DEFAULT executor: **claude-opus-5**. The cost lever is now `effort`, not tier — start on Opus 5
and step effort *down*, rather than starting on a cheaper model and escalating up.

## Tier: start on Opus 5, step down only for a reason
- **claude-opus-5** — default for anything with judgment, multi-step tool use, or a costly
  wrong answer.
- **claude-sonnet-5** — step down for mechanical, high-volume, or latency-bound work.
- **claude-haiku-4-5** — no-judgment classification/extraction only; **no `effort` parameter**,
  200K window.
- **claude-fable-5** — only when the user names it (≈2× Opus 5 cost).

## Effort is the primary cost / latency control
- `low`/`medium` on Opus 5 are strong — use them widely wherever quality holds.
- Start **`xhigh`** for heavy coding / agentic work, **`high`** otherwise, then sweep *down* on
  your own evals. Do not carry effort values over from earlier models — they do not transfer.
- Re-tune per role and actually use `medium`; the useful middle of the ladder is easy to leave
  unused.
- `max` is a reserve for tasks that justify unbounded spend, not a default.
- `effort` is inert on claude-haiku-4-5.
- At `xhigh`/`max`, keep any `max_tokens` ≥ 64K — thinking and the answer share that budget.

## Opus 5 thinks and verifies itself
- Thinking is **on by default**. Do **not** add "verify" / "double-check" / "re-verify"
  scaffolding to a prompt or role — it stacks with the model's own behavior and costs tokens
  with no quality gain. Structural review owned by a *separate* agent or by CI is fine; self-check
  scaffolding is not.
- Don't disable thinking to save money: thinking-on at `low` effort beats thinking-off at
  comparable cost, and disabled thinking can leak a tool call as plain text — a lost turn in
  agentic loops. If thinking is ever off, keep effort ≤ `high` or you get a 400.
- Revisit any `max_tokens` sized for a no-thinking budget.

## Length is set by the prompt, not effort
- Lowering effort does **not** reliably shorten the visible answer — bound length in the prompt.
- Files Opus 5 writes to disk tend to run long: match document length to the task, no filler
  sections or redundant summaries.

## Review-prompt caveat
- "Report only high-severity" / "be conservative" makes the model find *less*. Ask it to report
  everything and filter in a separate pass.

## Cost reference
| Model | ID | $/1M in | $/1M out | Context | Notes |
|---|---|---|---|---|---|
| Opus 5 | `claude-opus-5` | $5 | $25 | 1M | Thinking on by default; prompt-cache min 512 tokens |
| Sonnet 5 | `claude-sonnet-5` | $3 (intro $2 → 2026-08-31) | $15 (intro $10) | 1M | Full effort ladder |
| Haiku 4.5 | `claude-haiku-4-5` | $1 | $5 | 200K | No `effort` parameter |
| Fable 5 | `claude-fable-5` | $10 | $50 | 1M | Explicit request only |

Prefer tier **aliases** (`opus`/`sonnet`/`haiku`/`fable`) over full model IDs — they don't go
stale.

## Advisor tool (Claude Code, session-level — separate axis from executor model choice)
Claude Code's advisor tool pairs the session's executor model with a stronger model consulted
mid-generation for strategy/course-correction. This is a HOST-RUNTIME setting
(`/advisor <model>`, `advisorModel`, or `--advisor`), not a per-agent choice — set once at the
session level, and every subagent an orchestrator spawns inherits the same advisor
automatically. There is no per-agent advisor control today.

This composes with, not replaces, everything above: the executor-model choice (Opus 5 by
default, stepped down where it fits) still governs cost for mechanical turns; the advisor adds a
stronger reviewer inline on top, on every turn, for the whole session.

**Worth enabling:** long, multi-step agent loops where the plan matters but most turns are
mechanical (e.g. an ultrapowers subagent-driven-development implementer/reviewer dispatch loop,
or a systematic-debugging investigation) — prompt-caching for the advisor call pays off at
roughly 3+ advisor invocations, which these long loops make.
**Skip it:** short, one-shot agents (mappers, quick audits, single-file checks) — little to
plan, added cost without a commensurate quality gain.
