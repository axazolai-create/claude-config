#!/usr/bin/env node
// Probe D (Ultrapowers layer 0): records which hook events actually fire around a plugin change.
// The documented event list contains no plugin-lifecycle event, and `/reload-plugins` emits
// nothing of its own - so ConfigChange, UserPromptSubmit and FileChanged are the only candidates
// that might reach us. This script answers "which of them fires, with what payload" empirically
// instead of by inference.
//
// Temporary: registered by hand in ~/.claude/settings.json, removed once the probe is recorded.
// Fail-open by construction - a throw here must never affect the session.
//
// Usage (from a hook registration): node probe-d-event-log.mjs <EventNameForLabel>
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const OUT = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "probe-d.jsonl");

try {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { /* no stdin attached */ }

  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { unparsed: raw.slice(0, 400) }; }

  mkdirSync(dirname(OUT), { recursive: true });
  appendFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(),
    label: process.argv[2] || "(no label)",
    event: payload.hook_event_name || "(absent)",
    keys: Object.keys(payload).sort(),
    payload,
  }) + "\n", "utf8");
} catch { /* fail open */ }

process.exit(0);
