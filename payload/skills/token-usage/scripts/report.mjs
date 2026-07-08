#!/usr/bin/env node
// Reads a token-usage.jsonl log and prints aggregate token/cost totals for a time window.
// Self-contained (no import from hooks/lib/ - skills/ and hooks/ install to sibling directories
// under ~/.claude, and this repo's convention is to duplicate small helpers rather than reach
// across top-level install dirs; see hooks/lib/token-usage-shared.mjs's own header comment for
// the same reasoning applied the other direction).
//
// Usage:
//   node report.mjs                       # current project, last 24h
//   node report.mjs --global               # global (cross-project) log, last 24h
//   node report.mjs --week|--month|--all   # change the time window
//   node report.mjs --root <dir>           # project-scope only: search from <dir> instead of cwd
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";

const argv = process.argv.slice(2);
const GLOBAL = argv.includes("--global");
const PERIOD =
  argv.includes("--week") ? "week" :
  argv.includes("--month") ? "month" :
  argv.includes("--all") ? "all" : "24h";
const rootArgIdx = argv.indexOf("--root");
const rootArg = rootArgIdx !== -1 ? argv[rootArgIdx + 1] : undefined;

const safe = (fn) => { try { return fn(); } catch { return undefined; } };

function findRoot(start) {
  let cur = resolve(start);
  for (let i = 0; i < 40; i++) {
    for (const m of [".git", ".planning", "package.json", "pyproject.toml", "go.mod", "build.gradle.kts"])
      if (existsSync(join(cur, m))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(start);
}

function readJSONLRecords(path) {
  if (!existsSync(path)) return [];
  const text = safe(() => readFileSync(path, "utf8")) || "";
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rec = safe(() => JSON.parse(line));
    if (rec) out.push(rec);
  }
  return out;
}

const logPath = GLOBAL
  ? join(homedir(), ".claude", "state", "token-usage.jsonl")
  : join(findRoot(rootArg || process.cwd()), ".claude", "token-usage.jsonl");

if (!existsSync(logPath)) {
  console.log("token-usage report - scope: " + (GLOBAL ? "global" : "project") + ", period: " + PERIOD);
  console.log("no log found at " + logPath + " (nothing recorded yet).");
  process.exit(0);
}

const PERIOD_MS = { "24h": 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, month: 30 * 24 * 60 * 60 * 1000, all: Infinity };
const cutoff = PERIOD === "all" ? -Infinity : Date.now() - PERIOD_MS[PERIOD];

const all = readJSONLRecords(logPath);
const records = all.filter((r) => {
  const t = Date.parse(r && r.date);
  return Number.isFinite(t) && t >= cutoff;
});

function emptyTotals() { return { count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, hasCost: false }; }
function add(totals, r) {
  totals.count++;
  totals.input_tokens += r.input_tokens || 0;
  totals.output_tokens += r.output_tokens || 0;
  totals.total_tokens += r.total_tokens || 0;
  if (typeof r.cost_usd === "number") { totals.cost_usd += r.cost_usd; totals.hasCost = true; }
}

const overall = emptyTotals();
const byDay = new Map(), byModel = new Map(), byAgent = new Map();
for (const r of records) {
  add(overall, r);
  const day = (r.date || "").slice(0, 10) || "unknown";
  const model = r.model || "unknown";
  const agent = r.agent || "unknown";
  if (!byDay.has(day)) byDay.set(day, emptyTotals());
  if (!byModel.has(model)) byModel.set(model, emptyTotals());
  if (!byAgent.has(agent)) byAgent.set(agent, emptyTotals());
  add(byDay.get(day), r);
  add(byModel.get(model), r);
  add(byAgent.get(agent), r);
}

const topTasks = [...records]
  .filter((r) => typeof r.cost_usd === "number")
  .sort((a, b) => b.cost_usd - a.cost_usd)
  .slice(0, 5);

function fmtCost(totals) { return totals.hasCost ? ("$" + totals.cost_usd.toFixed(4)) : "n/a"; }
function fmtRow(label, totals) {
  return "  " + label.padEnd(22) + String(totals.count).padStart(6) + " recs  " +
    String(totals.input_tokens).padStart(10) + " in  " +
    String(totals.output_tokens).padStart(10) + " out  " +
    fmtCost(totals).padStart(10);
}

console.log("token-usage report - scope: " + (GLOBAL ? "global" : "project") + ", period: " + PERIOD);
console.log("log: " + logPath);
console.log("");
console.log(fmtRow("TOTAL", overall));
console.log("");
console.log("by day:");
for (const [day, totals] of [...byDay.entries()].sort()) console.log(fmtRow(day, totals));
console.log("");
console.log("by model:");
for (const [model, totals] of [...byModel.entries()].sort((a, b) => b[1].total_tokens - a[1].total_tokens)) console.log(fmtRow(model, totals));
console.log("");
console.log("by agent:");
for (const [agent, totals] of [...byAgent.entries()].sort((a, b) => b[1].total_tokens - a[1].total_tokens)) console.log(fmtRow(agent, totals));
console.log("");
console.log("top " + topTasks.length + " most expensive tasks:");
for (const r of topTasks) {
  console.log("  $" + r.cost_usd.toFixed(4) + "  " + (r.date || "").slice(0, 19) + "  [" + (r.kind || "?") + "/" + (r.agent || "?") + "]  " + (r.task || "(no task label)").slice(0, 80));
}
