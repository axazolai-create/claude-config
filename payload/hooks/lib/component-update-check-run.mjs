#!/usr/bin/env node
// Detached, best-effort component-update worker. Spawned + unref'd by session-init.mjs, so it
// never blocks the session. Every failure is swallowed (offline, missing tool, bad JSON): it only
// ever records progress or applies a safe update. 24h throttle per component via the state file.
// Global-scope probes (PROBES) cover machine-wide CLIs; project-scope probes (projectProbe, below)
// cover per-project skills (impeccable, ui-ux-pro-max), keyed off COMPONENTS[].scope === "project"
// and rooted at --root (defaults to cwd).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { COMPONENTS, autoUpdateEnabled, decide } from "./component-registry.mjs";
import { checkBundleUpdate } from "./config-update-check-run.mjs";
import { applyPromaxGraft } from "./impeccable-promax-graft.mjs";
import { runInstaller } from "../../bin/lib/design-stack.mjs";

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

const argvRoot = (() => { const i = process.argv.indexOf("--root"); return i >= 0 ? process.argv[i + 1] : process.cwd(); })();

// Project-scope probes (impeccable, ui-ux-pro-max): per-project skill install, keyed off --root.
export function projectProbe(name, root) {
  const skillDir = join(root, ".claude", "skills", name);
  const pkg = name === "impeccable" ? "impeccable" : "ui-ux-pro-max-cli";
  return {
    present: () => existsSync(skillDir),
    check: () => {                       // best-effort; any throw is swallowed by safe() at the call site
      const installed = safe(() => JSON.parse(readFileSync(join(skillDir, "package.json"), "utf8")).version);
      if (!installed) return { installed: "unknown", latest: "unknown", updateAvailable: false }; // can't compare → assume current
      const latest = safe(() => spawnSync("npm", ["view", pkg, "version"], { encoding: "utf8" }).stdout.trim()) || installed;
      return { installed, latest, updateAvailable: !!latest && latest !== installed };
    },
    // Synchronous by design: the caller re-applies applyPromaxGraft immediately after update()
    // returns, so the child must have finished rewriting reference/*.md before the graft runs —
    // otherwise the graft would write into the pre-update files and the real update would
    // clobber it moments later (detached/async would race here; spawnSync guarantees ordering).
    // Routed through the SAME isolation wrapper as install (scratch HOME/USERPROFILE, cwd=root) —
    // never run the installer with the real HOME (Impeccable's all-harnesses footgun).
    update: () => safe(() => runInstaller("npx", ["--yes", pkg, "update"], { root })),
  };
}

// Runs the component's self-update, THEN re-applies the Pro Max graft when the component declares it.
// update() is synchronous (spawnSync) so the graft re-applies to the FRESHLY rewritten reference files
// — an async/detached update would let the graft hit stale files and then be clobbered.
export function updateAndRegraft({ probe, comp, root }) {
  probe.update();
  if (comp.afterUpdate === "promax-graft")
    safe(() => applyPromaxGraft({ skillsDir: join(root, ".claude", "skills") }));
}

async function main() {
  if (process.env.CLAUDE_COMPONENT_AUTOUPDATE === "0" && process.env.CLAUDE_TOOL_AUTOUPGRADE === "0") return;
  const state = loadState();
  for (const comp of COMPONENTS) {
    const probe = comp.scope === "project" ? projectProbe(comp.name, argvRoot) : PROBES[comp.name];
    if (!probe) continue;                 // no probe registered for this component
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
        if (action === "auto" && probe.update) { updateAndRegraft({ probe, comp, root: argvRoot }); entry.autoUpdated = true; }
      }
    }
    state[comp.name] = entry;
  }
  writeState(state);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(() => {});
