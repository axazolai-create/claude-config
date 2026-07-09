#!/usr/bin/env node
// Detached worker for the claude-config bundle release check - spawned by session-init.mjs and
// immediately unref'd, so it never blocks the session that triggered it.
//
// Best-effort only: EVERY failure mode (offline, GitHub API down/rate-limited, a corporate proxy
// blocking the request) is swallowed silently. This must never surface as "couldn't download" or
// "command blocked" to the user - same policy as every other background check in this bundle
// (context-mode/graphify self-upgrade, graphify-global-sync). It only ever reports GOOD news (a
// real update is available); failures just mean "try again next throttle window".
//
// Reads ~/.claude/state/bundle-manifest.json for the SHA setup.mjs last installed, compares it to
// GitHub's current master SHA (public API, no auth, no data sent), and writes the result to
// ~/.claude/state/update-check.json. session-init.mjs's SYNCHRONOUS main path reads THAT file on
// a LATER session to decide whether to surface a notification - this worker never emits anything
// to the session that spawned it (decoupled trigger/notify, same reasoning as the tool-upgrade
// check next to it in session-init.mjs).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const CDIR = join(homedir(), ".claude");
const MANIFEST = join(CDIR, "state", "bundle-manifest.json");
const STATE = join(CDIR, "state", "update-check.json");

function writeState(state) {
  safe(() => mkdirSync(dirname(STATE), { recursive: true }));
  safe(() => writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n"));
}

async function main() {
  let state = existsSync(STATE) ? (safe(() => JSON.parse(readFileSync(STATE, "utf8"))) || {}) : {};
  // Record the attempt regardless of outcome, so the 24h throttle in session-init.mjs holds even
  // when the network call below fails - otherwise a blocked/offline machine would retry every
  // single session instead of once a day.
  state.lastCheckedAt = new Date().toISOString();

  const manifest = existsSync(MANIFEST) ? (safe(() => JSON.parse(readFileSync(MANIFEST, "utf8"))) || {}) : {};
  const installedSha = manifest.installedSha;
  if (!installedSha) { writeState(state); return; } // no baseline yet - next setup.mjs run sets one

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch("https://api.github.com/repos/axazolai-create/claude-config/commits/master",
      { signal: ctrl.signal, headers: { "User-Agent": "claude-config-update-check" } });
    clearTimeout(t);
    if (res.ok) {
      const j = await res.json();
      if (j && typeof j.sha === "string") {
        state.remoteSha = j.sha;
        state.installedSha = installedSha;
        state.updateAvailable = j.sha !== installedSha;
      }
    }
  } catch { /* offline / blocked / rate-limited - keep prior state, retry next throttle window */ }

  writeState(state);
}

main();
