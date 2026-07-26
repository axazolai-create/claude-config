#!/usr/bin/env node
// PreToolUse advisory: when a graphify graph exists and a Grep/Glob looks architectural, suggest
// `graphify query` first. Advisory ONLY — never sets a permission decision. Off via CLAUDE_GRAPHIFY_NUDGE=0.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
if (process.env.CLAUDE_GRAPHIFY_NUDGE === "0") process.exit(0);

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }
if (d.tool_name !== "Grep" && d.tool_name !== "Glob") process.exit(0);

const cwd = d.cwd || process.cwd();
if (!existsSync(join(cwd, "graphify-out", "graph.json"))) process.exit(0);

const pattern = (d.tool_input && d.tool_input.pattern) || "";
const q = `${pattern} ${(d.tool_input && d.tool_input.path) || ""}`.toLowerCase();
const architectural = /where is|what calls|who calls|how does .* work|depends on|imports|call graph|architecture|entry ?point|data flow/.test(q);
if (!architectural) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: `graphify-out/graph.json exists here. For an architectural question prefer \`graphify query "${pattern.slice(0, 80)}"\` — it answers from the code graph within a token budget instead of grepping. Grep is fine if the graph is stale or empty.`,
  },
}));
