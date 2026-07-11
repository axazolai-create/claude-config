---
name: token-usage
description: Reports token/cost usage recorded by the token-usage-log hook (main-agent turns and subagent calls, per project + a global cross-project aggregate). Use whenever the user runs /token-usage, or asks things like "how many tokens did this session use", "what's my spend today/this week/this month", "which agent/model cost the most", "show token usage across all projects". Reads pre-recorded `.claude/token-usage.jsonl` (per-project) or `~/.claude/state/token-usage.jsonl` (global) - it does not itself measure anything live, it summarizes what the hook already logged. If neither log has any records yet, say so plainly rather than guessing at numbers.
---

# Token Usage Report

Summarizes token and estimated-cost usage recorded by `hooks/token-usage-log.mjs` (fires on
every main-agent turn and every completed subagent call - see that hook's own header comment for
exactly what it captures and its known limitations, e.g. nested-subagent double-counting and the
Workflow-spawned-agent coverage gap).

## Flags

Two independent, combinable axes - parse them out of the user's `/token-usage ...` invocation or
their natural-language request:

- **Scope**: `--global` reads the cross-project aggregate
  (`~/.claude/state/token-usage.jsonl`); no flag reads the **current project's own**
  `.claude/token-usage.jsonl`.
- **Period**: `--5h`, `--week`, `--month`, or `--all` (full history, no time filter). No period
  flag defaults to the **last 24 hours**.

Examples: `/token-usage` → project, last 24h. `/token-usage --5h` → project, last 5 hours.
`/token-usage --global --month` → global log, last month. `/token-usage --all` → current
project, full history.

## Running the report

```
node <SKILL_DIR>/scripts/report.mjs [--global] [--5h|--week|--month|--all]
```

Run it from the project root (or pass nothing extra - the script walks up from `cwd` looking for
`.git`/`.planning`/`package.json`/etc. to find the project root itself, same logic the hook
uses). Prints: overall totals, a breakdown by day / by model / by agent, and the top 5 most
expensive individual tasks in the window (skipped if no records carry a `cost_usd` - the pricing
table hasn't refreshed yet, or `CLAUDE_TOKEN_USAGE_COST=0` is set).

When `--global` is set, the leading block is headed `COMBINED` (banner line, same style as the
per-project headers below it), then the same full report (totals + by day/model/agent + top 5)
repeats **once per project** under a `project: <name>` header, sorted by that project's total
tokens descending - every record already carries a `project` marker (basename of the project
root); records logged before that field existed group under `non-project`.

## Reporting back

Relay the script's own output - it's already formatted as a plain-text report, don't re-summarize
it into prose or drop rows. This applies per project block too: when `--global` is set, paste
**every** block in full - `COMBINED` and each `project: <name>` block alike (TOTAL + by day + by
model + by agent + top 5) - never collapse a section (e.g. "by agent") into a comma-separated
prose list just because there are several projects to relay. If the script says "no log found,"
tell the user plainly that nothing has been recorded yet for that scope (a fresh project/machine,
or the hook has been disabled via `CLAUDE_TOKEN_USAGE_LOG=0`) rather than presenting empty/zero
data as if it were meaningful.

If the user asks about the "$" figures specifically, remind them these are a **local best-effort
estimate** (scraped pricing table, refreshed at most once/day) - not billing-grade, same caveat
Claude Code's own `/usage` command carries.
