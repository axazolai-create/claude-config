#!/usr/bin/env node
// Best-effort VERIFICATION PROBE for the TaskCreated / TaskCompleted hook events. Public docs
// list these events, but whether they are wired in the running harness build is unconfirmed —
// so this hook does not act on their (unknown) payload schema. It only appends one line per
// firing to ~/.claude/logs/task-lifecycle-probe.log, recording the event name, the payload
// keys, and a truncated raw snapshot. After a session restart, inspect that log: if lines
// appear when a background task is created/completed, the events fire here and their schema is
// captured — then real TaskCreated-nudge / TaskCompleted handling can be wired on top.
// Fail-open: any error => exit 0, no output.
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { /* fail-open */ }
  process.exit(0);
}
