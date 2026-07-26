# Design: Token Usage Log (hook + companion skill)

Date: 2026-07-08
Repo: `axazolai-create/claude-config`
Status: Approved (design), pending implementation plan

## Goal

After every main-agent turn and every subagent call, append a structured record (task, agent/
model, input/output tokens, date, estimated cost) to a log file — automatically, no manual
action. Let the user later query totals per day/model/project via a companion skill.

## Non-goals

- Not billing-grade accuracy. Token/cost figures are a local approximation, same caveat Claude
  Code's own `/usage` command carries ("estimate computed locally... may differ from actual
  bill").
- Not OpenTelemetry-based. `api_request` OTel log events carry more precise per-API-call data
  (`input_tokens`/`output_tokens`/`cost_usd`/`model` per request), but require an OTLP/console
  exporter and (for file output) a local collector — real infrastructure, at odds with this
  repo's zero-dependency, pure-Node hook model. Deliberately not chosen for v1.
- Not a full cost-accounting system. No per-user attribution, no budgets/alerts, no dashboard.

## Decisions (locked)

- **Two hook events, one script** (`hooks/token-usage-log.mjs`, dispatches on `hook_event_name`,
  same pattern as `gsd-config-patch.mjs`):
  - `PostToolUse` (matcher: `Agent`) → subagent calls. Data comes straight from
    `tool_response.usage` / `.totalTokens` / `.resolvedModel` / `.agentId` — no transcript
    parsing needed for this half.
  - `Stop` → main-agent turns. `Stop`'s own input has no token/model fields, so the hook reads
    `transcript_path` (JSONL), processing only lines newer than a persisted per-session cursor,
    sums `usage` across the new assistant entries, and reads `model` from the same entries.
- **Dual write**: every record goes to both a per-project log and a global (all-projects) log.
- **Format**: JSONL (one JSON object per line).
- **Cost estimate**: included, computed from a separately-refreshed pricing table. Best-effort,
  explicitly flagged as a risk (see Section D).
- **Companion skill**: `/token-usage`, default scope = current project, `--global` flag switches
  to the aggregate log.

## A. Record schema

```json
{
  "date": "2026-07-08T14:52:11.203Z",
  "kind": "subagent",
  "project": "claude-config",
  "session_id": "abc123",
  "task": "Find API endpoints",
  "agent": "Explore",
  "model": "claude-sonnet-5",
  "input_tokens": 8320,
  "output_tokens": 640,
  "cache_read_tokens": 12000,
  "cache_creation_tokens": 0,
  "total_tokens": 12450,
  "cost_usd": 0.0421,
  "duration_ms": 48211
}
```

- `kind`: `"main"` | `"subagent"`.
- For `kind:"main"`: `agent` = `"main"`, `task` = truncated text of the user prompt that started
  the turn (read from the transcript's preceding user entry — no separate `UserPromptSubmit`
  capture needed), `duration_ms` omitted (not reliably available without extra state).
- For `kind:"subagent"`: `agent` = `tool_input.subagent_type`, `task` =
  `tool_input.description` (fallback: truncated `tool_input.prompt`), `model` =
  `tool_response.resolvedModel`, tokens/duration from `tool_response.usage` /
  `.totalTokens` / `.totalDurationMs`.
- `cache_read_tokens`/`cache_creation_tokens` omitted when the source data doesn't have them.
- `cost_usd` omitted entirely when `CLAUDE_TOKEN_USAGE_COST=0` or when the pricing table has no
  entry for that model.

## B. Capture mechanism

### B1. Subagent calls (`PostToolUse`, matcher `Agent`)

Read `tool_input` (task/description/subagent_type) and `tool_response` (status, usage,
totalTokens, resolvedModel, agentId, totalDurationMs) directly off stdin JSON. No transcript
access needed. Skip (`process.exit(0)`) when `tool_response.status !== "completed"` (e.g.
`"async_launched"` background subagents — their usage isn't final yet at this point).

### B2. Main-agent turns (`Stop`)

1. Resolve project root the same way `gsd-config-patch.mjs` does (`findRoot()`: walk up looking
   for `.planning`, `.git`, `package.json`, etc.).
2. Read a persisted cursor from the shared per-root state file
   (`~/.claude/state/project-init.json`, new key e.g. `tokenLogCursor: {session_id: byteOffset}`
   or line count) — same state file other hooks in this repo already use for one-time/idempotent
   markers.
3. Read `transcript_path` from that byte offset onward. Parse JSONL entries.
4. Sum `usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`
   across every `type:"assistant"` entry in the new slice; take `model` from the same entries
   (should be a single model per turn in the common case). Find the last `type:"user"` entry in
   the new slice for the `task` field.
5. Advance the cursor to end-of-file, write the record, persist the new cursor.
6. If the new slice has zero assistant entries (e.g. a turn that only used the Stop hook's own
   feedback loop), skip writing — nothing to log.

**Known lag caveat** (documented by Claude Code itself): the transcript file may not yet include
the very last message at `Stop` time. Effect here: occasionally the last API call of a turn gets
picked up on the *next* `Stop` instead of this one — not lost, just attributed one turn late.
Accepted, same risk class as the lock-staleness assumption already accepted for
`graphify-global-sync.mjs`.

## C. Storage

- Per-project: `<repo-root>/.claude/token-usage.jsonl`. On first write per project, idempotently
  ensure `.claude/.gitignore` contains a `token-usage.jsonl` line (mirrors the existing
  per-project one-time touch `session-init.mjs` already does for `.claude/settings.json`). Note:
  in *this* repo specifically, `.claude/` is already blanket-ignored at the root `.gitignore`, so
  the auto-append is a no-op here — it matters for other projects that commit `.claude/`.
- Global: `~/.claude/state/token-usage.jsonl` — identical record plus it always carries
  `project`, so it doubles as the cross-project aggregate.
- Toggle: `CLAUDE_TOKEN_USAGE_LOG=0` disables both hook registrations' effect entirely (checked
  first, cheap exit).

## D. Cost estimate subsystem (flagged risk)

- Pricing table: `~/.claude/state/model-pricing.json`, global, shape
  `{ fetchedAt: ISO8601, prices: { "<model-id>": { inputPerMTok, outputPerMTok, cacheReadPerMTok,
  cacheWritePerMTok } } }`.
- Refresh: throttled to once per 24h, same pattern as the existing `KNOWN_TOOLS` auto-upgrade
  loop in `session-init.mjs` (own state key, detached background job, doesn't block the
  session). The job fetches Anthropic's public pricing page and parses it — **there is no
  official pricing API**, so this is HTML scraping, not a stable contract.
- Fallback: on fetch/parse failure, or if the parsed result is missing expected known models,
  keep the last-known-good file untouched. If `fetchedAt` is older than 48h, hook output includes
  a `systemMessage` warning that cost figures may be stale/inaccurate.
- `cost_usd` per record = looked up from this table at write time; absent if the model has no
  entry.
- Toggle: `CLAUDE_TOKEN_USAGE_COST=0` skips cost calculation AND the pricing refresh job
  entirely (raw token counts only).
- **Risk logged as `RISK-TOKENLOG-001`** in `RISK_REGISTER.md`: scraping-based pricing can break
  silently if Anthropic changes page structure; cost figures are best-effort, not billing-grade.

## E. Companion skill `/token-usage`

New `skills/token-usage/SKILL.md` + `skills/token-usage/scripts/report.mjs`, structured like the
existing `update-changelog` skill (SKILL.md + scripts/ subfolder, plain Node, no deps).

Two independent, combinable flag axes:

- **Scope** — `/token-usage` (no args): reads the **current project's**
  `.claude/token-usage.jsonl`. `/token-usage --global`: reads `~/.claude/state/token-usage.jsonl`
  instead.
- **Period** — `--24h` (**default**, also what you get with no period flag), `--week`,
  `--month`, `--all` (entire log, no time filter). Mutually exclusive with each other.

Examples: `/token-usage` = project, last 24h. `/token-usage --global --month` = global log, last
month. `/token-usage --all` = current project, full history.

Output: totals grouped by day, by model, by agent, plus top-N most expensive individual tasks in
the queried window. Exact output formatting is an implementation detail for the plan, not locked
here.

## F. Known limitations (accepted for v1)

1. **Transcript lag** (Section B2) — accepted, self-healing via persistent cursor.
2. **Nested subagents**: undocumented whether a parent subagent's `totalTokens` is inclusive or
   exclusive of any sub-subagents it itself spawns via the `Agent` tool. Naively summing every
   `kind:"subagent"` row for a "grand total" may double-count in that edge case. Not resolved in
   v1 — flagged as an open question, not guessed at.
3. **Workflow-spawned agents**: `agent()` calls made from inside a `Workflow` script are not
   confirmed to fire `PostToolUse:Agent` the same way top-level `Agent`-tool calls do. Possible
   under-counting gap for workflow-heavy sessions. Out of scope for v1.
4. **Status-bar token counter** (the "↓ 1.9k tokens" spinner text) has no documented/exposed
   data source. This design's `total_tokens` is the authoritative usage-block figure for the
   completed turn, not a verified match to that UI number, though they should track closely in
   practice.

## G. Toggles (env vars, consistent with existing hooks)

- `CLAUDE_TOKEN_USAGE_LOG=0` — disable capture entirely (both events).
- `CLAUDE_TOKEN_USAGE_COST=0` — keep token capture, skip cost estimate + pricing refresh job.
- `CLAUDE_TOKEN_USAGE_PRUNE=0` — disable retention pruning (Section H); global log grows
  forever, same as per-project logs.

## H. Retention (global log only — per-project logs are never pruned, kept forever)

Revised rule (supersedes an earlier draft that skipped pruning entirely on a dormant log — that
special case is gone; pruning now always runs, but with floors that keep it safe on sparse/old
logs). Applies **only** to `~/.claude/state/token-usage.jsonl`. Per-project
`.claude/token-usage.jsonl` is never touched by this, regardless of any of the below — always
kept in full, forever.

A record is **kept** if it satisfies at least one of three independent conditions (their union);
everything else is deleted:

1. **3-month window**: `record.date >= lastDate - 3 calendar months`, where `lastDate` = the max
   `date` across all records currently in the file (after any new record for this run has been
   appended). Anchored to the log's own newest entry, not to wall-clock "now".
2. **Penultimate day floor**: group all records by UTC calendar day, sort distinct days
   descending. Day `[0]` is the newest (trivially already covered by rule 1). Day `[1]` — the
   *second*-most-recent distinct calendar day with any activity, however old — is always kept in
   full. This is what stops a long-dormant-then-resumed log from losing all trace of "when was
   the last session before this one," even when that day is far outside the 3-month window.
3. **Count floor**: the 10 most recent records by date are always kept, regardless of age. On a
   log with ≤10 records total, this alone keeps everything.

"3 calendar months" = `Date.setUTCMonth(d.getUTCMonth() - 3)` (plain `Date`, no library), applied
in UTC to match the UTC ISO timestamps already used for `date`.

Worked examples (all verified against this formula):

| Newest entry | Prior entries | Result |
| --- | --- | --- |
| today | — | delete anything older than 3 months ago |
| last month | — | delete anything older than 4 months ago (cutoff anchored to last month, minus 3) |
| 4 months ago | — | delete anything older than 7 months ago |
| new record now | last entry was 2 months ago, log is sparse | 3-month cutoff applies, but count floor keeps ≥10 records even if that reaches further back |
| one record/month for 5 months | — | all 5 kept — count floor (≤10 total) keeps everything even though 2 of them are outside the 3-month window |
| new record now | previous cluster was ~6 months ago | 3-month cutoff would delete the whole old cluster, but the penultimate-day floor keeps that one boundary day intact; nothing else old survives |

**When it runs**: pruning is real file I/O (read + filter + rewrite), cheap enough to run
synchronously, but not on every single hook invocation. Throttled to once per 24h via a small
dedicated state file (`~/.claude/state/token-usage-prune.json`, `{ lastRun: ISO8601 }` — global,
not per-project, so it doesn't belong in the existing per-root `project-init.json`).

**Amendment 2026-07-13**: moved to run exclusively from `SessionStart` (`session-init.mjs`),
not from the write path anymore. Originally this section described pruning as checked from the
shared "write to global log" helper used by both `SubagentStop` and `Stop` (this paragraph
still said `PostToolUse:Agent` from an even earlier draft, already stale by the time of this
amendment — see `token-usage-log.mjs`'s own header for why that event was replaced with
`SubagentStop`), so either hook path could trigger the throttled prune. That tied a retention
sweep to per-event write hooks instead of session start; `token-usage-log.mjs` now only
appends, never prunes. The 24h throttle above is unchanged - `pruneGlobalLogIfDue()` is simply
called once per session instead.

Toggle: `CLAUDE_TOKEN_USAGE_PRUNE=0` (see Section G) — global log grows forever, same as
per-project logs.
