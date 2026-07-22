#!/usr/bin/env node
// PreToolUse advisory (matcher: ScheduleWakeup). ScheduleWakeup exists ONLY for /loop dynamic
// pacing, but the recurring misuse observed across sessions is scheduling a wakeup to "wait"
// for a harness-tracked background agent/task — whose completion re-invokes the model
// automatically, so the wakeup is pure waste. The rule lives in one project's memory and the
// tool's own description, and both keep being missed in other projects' sessions — this makes
// the reminder deterministic machine-wide. Never blocks (permissionDecision stays "allow");
// `stop: true` (ending a loop) passes silently. Fail-open: any error => exit 0.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function shouldNudge(toolInput) {
  if (!toolInput || toolInput.stop === true) return false; // ending a loop is always fine
  return true; // rare tool — an always-on reminder is cheap and avoids brittle intent-guessing
}

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return; }
  if (!shouldNudge(d.tool_input || {})) return;
  const msg =
    "schedulewakeup-loop-only: ScheduleWakeup is ONLY for /loop dynamic pacing. If this wakeup " +
    "is meant to wait for a background agent/task the harness tracks, don't schedule it — the " +
    "completion notification re-invokes you automatically, and polling wakeups only burn turns " +
    "(a known, recurring misuse). Legitimate uses: pacing an active /loop, or watching EXTERNAL " +
    "state the harness can't see (a CI run, a deploy, a remote queue). If no /loop is active and " +
    "you are waiting on tracked work, skip this call and simply end the turn.";
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: msg },
  }));
}

// Symlink-robust entry-point check: Node realpaths import.meta.url, but process.argv[1]
// keeps the (possibly symlinked) invocation path — so a symlinked ~/.claude makes the naive
// equality FALSE and main() never runs. Match the raw OR the realpath'd argv[1] (covers the
// default resolver and --preserve-symlinks).
function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  if (import.meta.url === pathToFileURL(a).href) return true;
  try { return import.meta.url === pathToFileURL(realpathSync(a)).href; } catch { return false; }
}

if (isMainModule()) {
  try { main(); } catch { /* fail-open */ }
  process.exit(0);
}
