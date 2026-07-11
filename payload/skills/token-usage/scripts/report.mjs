#!/usr/bin/env node
// Reads a token-usage.jsonl log and prints aggregate token/cost totals for a time window.
// Self-contained (no import from hooks/lib/ - skills/ and hooks/ install to sibling directories
// under ~/.claude, and this repo's convention is to duplicate small helpers rather than reach
// across top-level install dirs; see hooks/lib/token-usage-shared.mjs's own header comment for
// the same reasoning applied the other direction).
//
// Usage:
//   node report.mjs                              # current project, last 24h
//   node report.mjs --global                      # global (cross-project) log, last 24h
//   node report.mjs --5h|--week|--month|--all      # change the time window
//   node report.mjs --root <dir>                  # project-scope only: search from <dir> instead of cwd
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";

const argv = process.argv.slice(2);
const GLOBAL = argv.includes("--global");
const PERIOD =
  argv.includes("--5h") ? "5h" :
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

const PERIOD_MS = { "5h": 5 * 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, month: 30 * 24 * 60 * 60 * 1000, all: Infinity };
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

const dayOf = (r) => (r.date || "").slice(0, 10) || "unknown";
const modelOf = (r) => r.model || "unknown";
const agentOf = (r) => r.agent || "unknown";
const projectOf = (r) => r.project || "non-project";

function totalsOf(recs) {
  const t = emptyTotals();
  for (const r of recs) add(t, r);
  return t;
}

function breakdown(recs, keyFn) {
  const map = new Map();
  for (const r of recs) {
    const key = keyFn(r);
    if (!map.has(key)) map.set(key, emptyTotals());
    add(map.get(key), r);
  }
  return map;
}

function topTasksOf(recs, n) {
  return [...recs]
    .filter((r) => typeof r.cost_usd === "number")
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, n);
}

function fmtCost(totals) { return totals.hasCost ? ("$" + totals.cost_usd.toFixed(4)) : "n/a"; }
function fmtRow(label, totals) {
  return "  " + label.padEnd(22) + String(totals.count).padStart(6) + " recs  " +
    String(totals.input_tokens).padStart(10) + " in  " +
    String(totals.output_tokens).padStart(10) + " out  " +
    fmtCost(totals).padStart(10);
}

function printBreakdown(title, map, sortByTokens) {
  console.log(title + ":");
  const entries = [...map.entries()].sort(sortByTokens ? (a, b) => b[1].total_tokens - a[1].total_tokens : undefined);
  for (const [key, totals] of entries) console.log(fmtRow(key, totals));
  console.log("");
}

function printReport(recs) {
  console.log(fmtRow("TOTAL", totalsOf(recs)));
  console.log("");
  printBreakdown("by day", breakdown(recs, dayOf), false);
  printBreakdown("by model", breakdown(recs, modelOf), true);
  printBreakdown("by agent", breakdown(recs, agentOf), true);
  const topTasks = topTasksOf(recs, 5);
  console.log("top " + topTasks.length + " most expensive tasks:");
  for (const r of topTasks) {
    console.log("  $" + r.cost_usd.toFixed(4) + "  " + (r.date || "").slice(0, 19) + "  [" + (r.kind || "?") + "/" + (r.agent || "?") + "]  " + (r.task || "(no task label)").slice(0, 80));
  }
}

console.log("token-usage report - scope: " + (GLOBAL ? "global" : "project") + ", period: " + PERIOD);
console.log("log: " + logPath);
console.log("");
printReport(records);

if (GLOBAL) {
  const byProject = breakdown(records, projectOf);
  const projectsByTokens = [...byProject.entries()].sort((a, b) => b[1].total_tokens - a[1].total_tokens).map(([p]) => p);
  for (const project of projectsByTokens) {
    const recs = records.filter((r) => projectOf(r) === project);
    console.log("");
    console.log("=".repeat(60));
    console.log("project: " + project);
    console.log("=".repeat(60));
    console.log("");
    printReport(recs);
  }
}
