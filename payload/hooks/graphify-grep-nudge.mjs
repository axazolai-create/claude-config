#!/usr/bin/env node
// PreToolUse advisory: when a graphify graph exists and a Grep/Glob looks architectural, suggest
// `graphify query` first. Advisory ONLY — never sets a permission decision. Off via CLAUDE_GRAPHIFY_NUDGE=0.
//
// Freshness (G stage 2): `payload/bin/graphify-freshness.mjs` is a different concern (installed
// graphify CLI version vs. PyPI) and exposes no graph-staleness signal, so it isn't reused here.
// Rather than touch the working autosync (payload/hooks/graphify-global-sync*.mjs), this computes
// staleness locally and additively: graphify-out/graph.json's mtime vs. the repo's HEAD commit
// time. Fail-soft — any git error (not a repo, no HEAD, git missing) is treated as "unknown",
// never reported as stale.
import { readFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
if (process.env.CLAUDE_GRAPHIFY_NUDGE === "0") process.exit(0);

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }
if (d.tool_name !== "Grep" && d.tool_name !== "Glob") process.exit(0);

const cwd = d.cwd || process.cwd();
const graphPath = join(cwd, "graphify-out", "graph.json");
if (!existsSync(graphPath)) process.exit(0);

const pattern = (d.tool_input && d.tool_input.pattern) || "";
const q = `${pattern} ${(d.tool_input && d.tool_input.path) || ""}`.toLowerCase();
const architectural = /where is|what calls|who calls|how does .* work|depends on|imports|call graph|architecture|entry ?point|data flow/.test(q);
if (!architectural) process.exit(0);

function isGraphStale(root, path) {
  const st = safe(() => statSync(path));
  if (!st) return false;
  const head = safe(() => spawnSync("git", ["-C", root, "log", "-1", "--format=%ct"], { encoding: "utf8", timeout: 1000 }));
  if (!head || head.error || head.status !== 0 || !head.stdout) return false; // not a repo / no HEAD -> unknown, not stale
  const headMs = parseInt(head.stdout.trim(), 10) * 1000;
  if (!Number.isFinite(headMs)) return false;
  return st.mtimeMs < headMs;
}

const staleNote = isGraphStale(cwd, graphPath)
  ? ` The graph looks stale (older than the latest commit) — run \`graphify update .\` first.`
  : "";

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: `graphify-out/graph.json exists here. For an architectural question prefer \`graphify query "${pattern.slice(0, 80)}"\` — it answers from the code graph within a token budget instead of grepping. Grep is fine if the graph is stale or empty.${staleNote}`,
  },
}));
