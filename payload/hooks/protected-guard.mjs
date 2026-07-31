#!/usr/bin/env node
// PreToolUse guard (matcher: Edit|Write|MultiEdit|NotebookEdit|Bash). Refuses to edit, delete
// or move any path a .protected file lists; reading and copying FROM stay allowed. Every
// decision lives in lib/protected-lib.mjs - this file only reads stdin and sets the exit code.
// Block = exit 2 (stderr fed back to Claude). Anything it cannot understand => allow (exit 0):
// a guard that breaks the session when its input surprises it is worse than one that misses.
import { readFileSync } from "node:fs";
import { decide } from "./lib/protected-lib.mjs";

let d;
try { d = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
// JSON.parse("null") returns null and JSON.parse("[]") an array; both would throw on the
// property reads below. RISK-HOOKSTDIN-001, guarded here rather than inherited.
d = (d && typeof d === "object" && !Array.isArray(d)) ? d : {};

const input = (d.tool_input && typeof d.tool_input === "object") ? d.tool_input : {};
let verdict = null;
try {
  verdict = decide({
    root: d.cwd || process.cwd(),
    tool: d.tool_name || "",
    path: input.file_path || input.notebook_path || "",
    command: input.command || "",
  });
} catch { process.exit(0); }

if (verdict) { process.stderr.write(verdict.message + "\n"); process.exit(2); }
process.exit(0);
