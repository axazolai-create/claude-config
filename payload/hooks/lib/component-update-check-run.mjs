#!/usr/bin/env node
// Detached, best-effort component-update worker. Spawned + unref'd by session-init.mjs, so it
// never blocks the session. Every failure is swallowed (offline, missing tool, bad JSON): it only
// ever records progress or applies a safe update. 24h throttle per component via the state file.
// Phase 2 implements global-scope probes only; project-scope probes (impeccable, ui-ux-pro-max)
// are added in Phase 3, keyed off COMPONENTS[].scope === "project".
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { COMPONENTS, autoUpdateEnabled, decide } from "./component-registry.mjs";
import { checkBundleUpdate } from "./config-update-check-run.mjs";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const STATE = join(CLAUDE_DIR, "state", "component-updates.json");
const THROTTLE_MS = 24 * 60 * 60 * 1000;
const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const detached = (cmd, args) => safe(() => spawn(cmd, args, { detached: true, stdio: "ignore" }).unref());
const toolPresent = (cmd) => { const r = safe(() => spawnSync(cmd, ["--version"], { encoding: "utf8" })); return !!r && !r.error && r.status === 0; };

// Global-scope probes. "upgrade-only" tools have no version signal: run their self-upgrade on the
// throttle (cheap no-op when current), same behavior as the old session-init KNOWN_TOOLS block.
const PROBES = {
  "context-mode": { present: () => toolPresent("context-mode"), upgrade: () => detached("context-mode", ["upgrade"]) },
  "graphify":     { present: () => toolPresent("graphify") && toolPresent("uv"), upgrade: () => detached("uv", ["tool", "upgrade", "graphifyy"]) },
  "claude-config":{ present: () => true, check: () => checkBundleUpdate(CLAUDE_DIR) },
};

function loadState() { return existsSync(STATE) ? (safe(() => JSON.parse(readFileSync(STATE, "utf8"))) || {}) : {}; }
function writeState(s) { safe(() => mkdirSync(dirname(STATE), { recursive: true })); safe(() => writeFileSync(STATE, JSON.stringify(s, null, 2) + "\n")); }
const fresh = (entry) => entry && entry.lastCheckedAt && (Date.now() - Date.parse(entry.lastCheckedAt) < THROTTLE_MS);

// TODO(phase3): parse --root <path> (defaults to cwd) for project-scope probes (impeccable, ui-ux-pro-max)
async function main() {
  if (process.env.CLAUDE_COMPONENT_AUTOUPDATE === "0" && process.env.CLAUDE_TOOL_AUTOUPGRADE === "0") return;
  const state = loadState();
  for (const comp of COMPONENTS) {
    const probe = PROBES[comp.name];
    if (!probe) continue;                 // project-scope probes arrive in Phase 3
    if (fresh(state[comp.name])) continue;
    if (!safe(() => probe.present())) continue;
    const entry = { ...(state[comp.name] || {}), class: comp.updateClass, lastCheckedAt: new Date().toISOString() };
    if (comp.kind === "upgrade-only") {
      if (autoUpdateEnabled(comp.name)) probe.upgrade();
      entry.updateAvailable = false;      // no version signal for these
    } else {
      const res = await safe(() => probe.check());
      if (res) {
        entry.installed = res.installed; entry.latest = res.latest; entry.updateAvailable = res.updateAvailable;
        const action = decide({ updateClass: comp.updateClass, updateAvailable: res.updateAvailable, autoUpdateEnabled: autoUpdateEnabled(comp.name) });
        if (action === "auto" && probe.update) { probe.update(); entry.autoUpdated = true; }
      }
    }
    state[comp.name] = entry;
  }
  writeState(state);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(() => {});
