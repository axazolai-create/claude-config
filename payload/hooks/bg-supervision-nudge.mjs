#!/usr/bin/env node
// PreToolUse guard (matcher: Bash). When a long-running command is launched with
// run_in_background AND it is neither already supervised nor an obvious long-lived server,
// inject a non-blocking reminder to wrap it in supervise-bg.mjs — so a hang becomes a real
// completion event instead of an invisible stall. Never blocks. Fail-open: any error => exit 0.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Already bounded/supervised — no nudge needed.
const SUPERVISED = [/supervise-bg\.mjs/, /\bgh\s+run\s+watch\b/, /\btimeout\s+\d/];
// Long-lived servers/watchers — a wall-clock/staleness watchdog would wrongly kill them.
const LONG_LIVED = [/\bdev\b/, /\bserve\b/, /\bstart\b/, /--watch\b/, /\bwatch\b/, /\bnodemon\b/, /\bvite\b/, /next\s+dev/];

export function shouldSuperviseBg(toolInput) {
  if (!toolInput || !toolInput.run_in_background) return { nudge: false };
  const cmd = String(toolInput.command || "");
  if (!cmd.trim()) return { nudge: false };
  if (SUPERVISED.some((re) => re.test(cmd))) return { nudge: false, reason: "already supervised" };
  if (LONG_LIVED.some((re) => re.test(cmd))) return { nudge: false, reason: "long-lived server" };
  return { nudge: true };
}

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return; }
  const { nudge } = shouldSuperviseBg(d.tool_input || {});
  if (!nudge) return;
  const msg =
    "This background job has no hang guard. Wrap bounded jobs so a stall becomes a completion " +
    "event: node ~/.claude/bin/supervise-bg.mjs --stale 300 --timeout 1800 --label <name> -- '<command>'. " +
    "(A hung job never exits, so run_in_background never re-invokes me — the wrapper's timeout/staleness " +
    "watchdog kills it and exits, restoring the notification.)";
  process.stdout.write(JSON.stringify({
    systemMessage: "bg job without hang guard — consider supervise-bg",
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: msg },
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { /* fail-open */ }
  process.exit(0);
}
