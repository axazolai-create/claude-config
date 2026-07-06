#!/usr/bin/env node
// PostToolUse guard (matcher: Bash). Cross-platform (Node).
// Fires after Claude runs `git commit` through the Bash tool. Thin wrapper around
// lib/graphify-global-sync-run.mjs, the shared worker that refreshes this project's
// entry in the graphify global graph.
//
// Why this exists ALONGSIDE the native <repo>/.git/hooks/post-commit hook that
// session-init.mjs installs per-project: this one needs no per-repo install step,
// so it covers Claude-driven commits from session one, even before the native hook
// has been installed. It structurally CANNOT see `--amend` done by hand, IDE
// commits, or anything not run through Claude's own Bash tool - Claude Code hooks
// only fire on tool calls Claude itself makes. The native git hook is what covers
// those; this hook is the zero-setup fallback for the Claude-driven case.
// No-op (exit 0, never blocks) if disabled or the command isn't `git commit`.
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
if (!/(^|[;&|\s])git(\s+-[^\s]+)*\s+commit(\s|$)/.test(cmd)) process.exit(0);

const cwd = d.cwd || process.cwd();
const lib = join(dirname(fileURLToPath(import.meta.url)), "lib", "graphify-global-sync-run.mjs");
try { spawnSync(process.execPath, [lib, cwd], { cwd }); } catch { /* best-effort, never blocks */ }

process.exit(0);
