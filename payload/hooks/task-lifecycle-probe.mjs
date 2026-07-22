#!/usr/bin/env node
// Best-effort VERIFICATION PROBE for the TaskCreated / TaskCompleted hook events. Public docs
// list these events, but whether they are wired in the running harness build is unconfirmed —
// so this hook does not act on their (unknown) payload schema. It only appends one line per
// firing to ~/.claude/logs/task-lifecycle-probe.log, recording the event name, the payload
// keys, and a truncated raw snapshot. After a session restart, inspect that log: if lines
// appear when a background task is created/completed, the events fire here and their schema is
// captured — then real TaskCreated-nudge / TaskCompleted handling can be wired on top.
// Fail-open: any error => exit 0, no output.
import { readFileSync, appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function probeRecord(d, nowIso) {
  const event = d && typeof d === "object" && d.hook_event_name ? d.hook_event_name : "unknown";
  const keys = d && typeof d === "object" ? Object.keys(d).sort() : [];
  return { ts: nowIso, event, keys };
}

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return; }
  const rec = probeRecord(d, new Date().toISOString());
  try {
    const dir = join(homedir(), ".claude", "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "task-lifecycle-probe.log"),
      JSON.stringify({ ...rec, raw: JSON.stringify(d).slice(0, 2000) }) + "\n",
    );
  } catch { /* ignore */ }
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
