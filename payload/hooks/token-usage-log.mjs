#!/usr/bin/env node
// Two hook events, one script (dispatches on hook_event_name), same pattern as
// gsd-config-patch.mjs. Registered under BOTH PostToolUse (matcher: Agent) and Stop in
// settings.partial.json.
//
// PostToolUse:Agent -> one record per completed subagent call. All the data (tokens, resolved
// model, duration) comes straight off `tool_response` - no transcript parsing needed.
//
// Stop -> one record per main-agent turn. Stop's own input has no token/model fields, so this
// reads `transcript_path` (JSONL) from a persisted per-session byte cursor, sums `usage` across
// the new assistant entries, and reads `model` + the triggering user prompt from the same slice.
// Known lag caveat (documented by Claude Code itself): the transcript file may not yet include
// the very last message at Stop time - occasionally the last API call of a turn is picked up on
// the NEXT Stop instead of this one. Not lost, just attributed one turn late. Accepted, same risk
// class as the lock-staleness assumption already accepted for graphify-global-sync.mjs.
//
// Every record is written to BOTH a per-project log (<root>/.claude/token-usage.jsonl, kept
// forever, never pruned) and a global cross-project log (~/.claude/state/token-usage.jsonl,
// pruned per token-usage-prune.mjs's retention rule).
//
// Toggles: CLAUDE_TOKEN_USAGE_LOG=0 disables capture entirely (both events).
//          CLAUDE_TOKEN_USAGE_COST=0 keeps token capture, skips cost estimate + pricing refresh.
//          CLAUDE_TOKEN_USAGE_PRUNE=0 (read inside token-usage-prune.mjs) disables retention.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  safe, writeFile, readJSON, findRoot, projectNameOf,
  appendJSONL, readNewJSONLEntries, ensureGitignored,
} from "./lib/token-usage-shared.mjs";
import { pruneGlobalLogIfDue } from "./lib/token-usage-prune.mjs";

if (process.env.CLAUDE_TOKEN_USAGE_LOG === "0") process.exit(0);

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }

const HERE = dirname(fileURLToPath(import.meta.url));
const PRICING_FILE = join(homedir(), ".claude", "state", "model-pricing.json");
const GLOBAL_LOG = join(homedir(), ".claude", "state", "token-usage.jsonl");
const PRUNE_STATE_FILE = join(homedir(), ".claude", "state", "token-usage-prune.json");
// Shared per-root state file with session-init.mjs / gsd-config-patch.mjs - same namespace,
// just a new independent key (tokenLogCursor) so this never collides with their flags.
const PROJECT_STATE_FILE = join(homedir(), ".claude", "state", "project-init.json");

const COST_ENABLED = process.env.CLAUDE_TOKEN_USAGE_COST !== "0";
const PRICING_REFRESH_THROTTLE_MS = 24 * 60 * 60 * 1000;
const STALE_PRICING_WARN_MS = 48 * 60 * 60 * 1000;

// Longest-prefix match against the pricing table (see token-usage-pricing-refresh.mjs for why
// prefix, not exact id: it lets an undated table entry like "claude-sonnet-4-5" match a real
// resolved model id that may carry a date suffix).
function costFor(model, usage) {
  if (!COST_ENABLED || !model || !usage) return undefined;
  if (!existsSync(PRICING_FILE)) return undefined;
  const table = safe(() => readJSON(PRICING_FILE));
  if (!table || !Array.isArray(table.prices)) return undefined;
  const entry = table.prices
    .filter((p) => model.startsWith(p.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!entry) return undefined;
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || usage.cache_read_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || usage.cache_creation_tokens || 0;
  const cost =
    (inTok / 1_000_000) * (entry.inputPerMTok || 0) +
    (outTok / 1_000_000) * (entry.outputPerMTok || 0) +
    (cacheRead / 1_000_000) * (entry.cacheReadPerMTok || 0) +
    (cacheWrite / 1_000_000) * (entry.cacheWritePerMTok || 0);
  return Math.round(cost * 1e6) / 1e6;
}

function maybeRefreshPricing() {
  if (!COST_ENABLED) return;
  const table = existsSync(PRICING_FILE) ? safe(() => readJSON(PRICING_FILE)) : null;
  const last = table && table.fetchedAt ? Date.parse(table.fetchedAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < PRICING_REFRESH_THROTTLE_MS) return;
  const script = join(HERE, "lib", "token-usage-pricing-refresh.mjs");
  if (!existsSync(script)) return;
  safe(() => spawn(process.execPath, [script], { detached: true, stdio: "ignore" }).unref());
}

function maybeWarnStalePricing() {
  if (!COST_ENABLED || !existsSync(PRICING_FILE)) return undefined;
  const table = safe(() => readJSON(PRICING_FILE));
  if (!table || !table.fetchedAt) return undefined;
  const age = Date.now() - Date.parse(table.fetchedAt);
  if (age > STALE_PRICING_WARN_MS)
    return "token-usage-log: model pricing table is stale (last refreshed " + table.fetchedAt + ") - cost_usd estimates may be inaccurate.";
  return undefined;
}

function finish() {
  const warn = maybeWarnStalePricing();
  if (warn) { try { process.stdout.write(JSON.stringify({ systemMessage: warn })); } catch { /* ignore */ } }
  process.exit(0);
}

function writeRecord(root, record) {
  const projectLog = join(root, ".claude", "token-usage.jsonl");
  appendJSONL(projectLog, record);
  ensureGitignored(root, "token-usage.jsonl");

  appendJSONL(GLOBAL_LOG, record);
  pruneGlobalLogIfDue(GLOBAL_LOG, PRUNE_STATE_FILE);
}

const root = findRoot(d.cwd || process.cwd());
const project = projectNameOf(root);

if (d.hook_event_name === "PostToolUse") {
  if (d.tool_name !== "Agent") process.exit(0);
  const resp = d.tool_response;
  // "async_launched" (backgrounded subagents, run_in_background) have no final usage yet at this
  // point - only a "completed" foreground call carries real numbers here.
  if (!resp || resp.status !== "completed") process.exit(0);

  const input = d.tool_input || {};
  const usage = resp.usage || {};
  const model = resp.resolvedModel;
  const record = {
    date: new Date().toISOString(),
    kind: "subagent",
    project,
    session_id: d.session_id,
    task: input.description || (input.prompt ? String(input.prompt).slice(0, 200) : undefined),
    agent: input.subagent_type,
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: resp.totalTokens,
    duration_ms: resp.totalDurationMs,
  };
  if (usage.cache_read_input_tokens !== undefined) record.cache_read_tokens = usage.cache_read_input_tokens;
  if (usage.cache_creation_input_tokens !== undefined) record.cache_creation_tokens = usage.cache_creation_input_tokens;
  const cost = costFor(model, usage);
  if (cost !== undefined) record.cost_usd = cost;

  writeRecord(root, record);
  maybeRefreshPricing();
  finish();
}

if (d.hook_event_name === "Stop") {
  const transcriptPath = d.transcript_path;
  if (!transcriptPath || !d.session_id) process.exit(0);

  let state = existsSync(PROJECT_STATE_FILE) ? (safe(() => readJSON(PROJECT_STATE_FILE)) || {}) : {};
  if (!state[root]) state[root] = {};
  const cursor = state[root].tokenLogCursor;
  // A different session_id means a different (new) transcript file entirely - a stored offset
  // from a past session is meaningless for it, so start that one from byte 0.
  const fromOffset = (cursor && cursor.sessionId === d.session_id) ? cursor.offset : 0;

  const { entries, newOffset } = readNewJSONLEntries(transcriptPath, fromOffset);
  state[root].tokenLogCursor = { sessionId: d.session_id, offset: newOffset };
  writeFile(PROJECT_STATE_FILE, JSON.stringify(state, null, 2) + "\n");

  // isSidechain filters out subagent-internal reasoning IF it were ever inlined into the main
  // transcript (defensive - PostToolUse:Agent already captures subagent usage separately, this
  // guards against double-counting it here too).
  const assistantEntries = entries.filter((e) => e && e.type === "assistant" && !e.isSidechain && e.message && e.message.usage);
  if (!assistantEntries.length) process.exit(0); // nothing to log this turn (e.g. only tool-call round trips landed since last cursor, no new assistant usage)

  const totals = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let model;
  for (const e of assistantEntries) {
    const u = e.message.usage || {};
    totals.input_tokens += u.input_tokens || 0;
    totals.output_tokens += u.output_tokens || 0;
    totals.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    totals.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    if (e.message.model) model = e.message.model;
  }

  // Real user prompt text only: plain string content, not a tool_result array, not an isMeta
  // wrapper (e.g. slash-command expansion caveats) - verified against a real transcript file.
  let task;
  for (const e of entries) {
    if (e && e.type === "user" && !e.isMeta && typeof (e.message && e.message.content) === "string")
      task = e.message.content.slice(0, 200);
  }

  const record = {
    date: new Date().toISOString(),
    kind: "main",
    project,
    session_id: d.session_id,
    task,
    agent: "main",
    model,
    input_tokens: totals.input_tokens,
    output_tokens: totals.output_tokens,
    total_tokens: totals.input_tokens + totals.output_tokens + totals.cache_read_input_tokens + totals.cache_creation_input_tokens,
  };
  if (totals.cache_read_input_tokens) record.cache_read_tokens = totals.cache_read_input_tokens;
  if (totals.cache_creation_input_tokens) record.cache_creation_tokens = totals.cache_creation_input_tokens;
  const cost = costFor(model, totals);
  if (cost !== undefined) record.cost_usd = cost;

  writeRecord(root, record);
  maybeRefreshPricing();
  finish();
}

process.exit(0);
