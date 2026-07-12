#!/usr/bin/env node
// PostToolUse guard (matcher: Bash). Cross-platform (Node).
// Fires after Claude runs `git commit`/`push`/`tag` through the Bash tool. Thin wrapper
// around lib/graphify-global-sync-run.mjs, the shared worker that refreshes this project's
// entry in the graphify global graph - see that file's header for the full rationale (why
// this coexists with the native post-commit hook, trigger surface, no Superpowers trigger).
// No-op (exit 0, never blocks) if disabled or the command isn't a matching git operation.
// Toggle: CLAUDE_GRAPHIFY_AUTOSYNC=0.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function stdin() { try { return readFileSync(0, "utf8"); } catch { return ""; } }

let d = {};
try { d = JSON.parse(stdin() || "{}"); } catch { process.exit(0); }
if (process.env.CLAUDE_GRAPHIFY_AUTOSYNC === "0") process.exit(0);

const cmd = (((d.tool_input || {}).command) || "").replace(/\s+/g, " ");
if (!cmd) process.exit(0);
if (!/(^|[;&|\s])git(\s+-[^\s]+)*\s+(commit|push|tag)(\s|$)/.test(cmd)) process.exit(0);

const cwd = d.cwd || process.cwd();
const lib = join(dirname(fileURLToPath(import.meta.url)), "lib", "graphify-global-sync-run.mjs");
try { spawnSync(process.execPath, [lib, cwd], { cwd }); } catch { /* best-effort, never blocks */ }

process.exit(0);
