# Component-Update Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A centralized, non-blocking SessionStart facility that checks installer-managed components for updates, auto-applies the safe ones in the background, and signals the rest via a SessionStart note (+ a full-profile statusline segment).

**Architecture:** A pure decision/registry lib (`component-registry.mjs`) + a detached best-effort worker (`component-update-check-run.mjs`) that writes `~/.claude/state/component-updates.json`; `session-init.mjs` spawns the worker (replacing its ad-hoc `KNOWN_TOOLS` block) and, on a later session, reads that state to emit notes; `gsd-context-meter.mjs` appends an "updates" segment (full profile only). Phase 2 implements **global-scope** components (context-mode, graphify, the claude-config bundle — finally wiring its half-built check); **project-scope** components (Impeccable, Pro Max) are registry entries whose probes arrive in Phase 3.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, no external dependencies.

## Global Constraints

- Node ESM only (`.mjs`); no external deps; tests use `node:test` + `node:assert/strict`. Run one test file with `node --test <path>`.
- Config dir is always `process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")` — never hardcode `~/.claude`.
- Side-effecting hooks/workers are **best-effort**: every failure (offline, missing tool, bad JSON, exec error) is swallowed silently and never surfaces to the session. Only ever surface GOOD news (an available/applied update).
- 24h throttle per component (timestamp in the state file); a burst of sessions in one day must not re-run checks/updates.
- Toggles: `CLAUDE_COMPONENT_AUTOUPDATE=0` (global off) and `CLAUDE_COMPONENT_AUTOUPDATE_<NAME>=0` (per component, name upper-cased with `-`→`_`). For the two tools migrated out of the old block, ALSO honor the legacy `CLAUDE_TOOL_AUTOUPGRADE=0` / `CLAUDE_TOOL_AUTOUPGRADE_<LEGACY>=0` so existing opt-outs keep working.
- New shipped files must NOT be `gsd-*`-prefixed (that prefix is excluded from base/lite) — the updater ships in all three profiles. `*.test.mjs` files are dev-only (never installed), so their names don't matter.
- State file: `~/.claude/state/component-updates.json`. Shape per entry:
  `{ installed, latest, updateAvailable, class, autoUpdated, lastCheckedAt }`.

---

## File Structure

- `payload/hooks/lib/component-registry.mjs` (new) — pure data + decisions: `COMPONENTS`, `autoUpdateEnabled`, `decide`, `pendingCount`, `formatUpdateNotes`. No I/O.
- `payload/hooks/lib/component-registry.test.mjs` (new) — unit tests for the above.
- `payload/hooks/lib/config-update-check-run.mjs` (modify) — extract a pure `bundleUpdateAvailable(installedSha, remoteSha)` and export `checkBundleUpdate(claudeDir)`; keep it runnable standalone.
- `payload/hooks/lib/config-update-check-run.test.mjs` (new) — unit test for `bundleUpdateAvailable`.
- `payload/hooks/lib/gsd-context-meter-lib.mjs` (modify) — add pure `appendUpdatesSegment(text, count)`.
- `payload/hooks/lib/gsd-context-meter-lib.test.mjs` (new) — unit test for the segment.
- `payload/hooks/gsd-context-meter.mjs` (modify) — read state, call `appendUpdatesSegment` (full-only file).
- `payload/hooks/lib/component-update-check-run.mjs` (new) — the detached worker: probes + throttle + state write. Not unit-tested (side-effecting); smoke-verified.
- `payload/hooks/session-init.mjs` (modify) — replace the `KNOWN_TOOLS` block with a spawn of the worker; add a notify block reading the state file.

---

### Task 1: Registry data + decision logic (pure)

**Files:**
- Create: `payload/hooks/lib/component-registry.mjs`
- Test: `payload/hooks/lib/component-registry.test.mjs`

**Interfaces:**
- Produces:
  - `COMPONENTS: Array<{ name, scope: "global"|"project", kind: "version"|"upgrade-only", updateClass: "safe"|"reinit", legacyEnv: string|null }>`
  - `autoUpdateEnabled(name: string, env = process.env): boolean`
  - `decide({ updateClass, updateAvailable, autoUpdateEnabled }): "auto"|"notify"|"skip"`

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/component-registry.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPONENTS, autoUpdateEnabled, decide } from "./component-registry.mjs";

test("COMPONENTS: known entries with required fields", () => {
  const byName = Object.fromEntries(COMPONENTS.map((c) => [c.name, c]));
  assert.equal(byName["context-mode"].kind, "upgrade-only");
  assert.equal(byName["context-mode"].legacyEnv, "CONTEXT_MODE");
  assert.equal(byName["graphify"].kind, "upgrade-only");
  assert.equal(byName["claude-config"].kind, "version");
  assert.equal(byName["claude-config"].updateClass, "reinit");
  for (const c of COMPONENTS) {
    assert.ok(["global", "project"].includes(c.scope), `${c.name} scope`);
    assert.ok(["safe", "reinit"].includes(c.updateClass), `${c.name} class`);
  }
});

test("decide: routes on class + availability + toggle", () => {
  assert.equal(decide({ updateClass: "safe", updateAvailable: true, autoUpdateEnabled: true }), "auto");
  assert.equal(decide({ updateClass: "safe", updateAvailable: true, autoUpdateEnabled: false }), "notify");
  assert.equal(decide({ updateClass: "reinit", updateAvailable: true, autoUpdateEnabled: true }), "notify");
  assert.equal(decide({ updateClass: "safe", updateAvailable: false, autoUpdateEnabled: true }), "skip");
});

test("autoUpdateEnabled: default on, global/per-name/legacy off", () => {
  assert.equal(autoUpdateEnabled("impeccable", {}), true);
  assert.equal(autoUpdateEnabled("impeccable", { CLAUDE_COMPONENT_AUTOUPDATE: "0" }), false);
  assert.equal(autoUpdateEnabled("ui-ux-pro-max", { CLAUDE_COMPONENT_AUTOUPDATE_UI_UX_PRO_MAX: "0" }), false);
  // legacy env still honored for a migrated tool (context-mode -> CONTEXT_MODE)
  assert.equal(autoUpdateEnabled("context-mode", { CLAUDE_TOOL_AUTOUPGRADE: "0" }), false);
  assert.equal(autoUpdateEnabled("context-mode", { CLAUDE_TOOL_AUTOUPGRADE_CONTEXT_MODE: "0" }), false);
  assert.equal(autoUpdateEnabled("graphify", { CLAUDE_TOOL_AUTOUPGRADE_GRAPHIFY: "0" }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/component-registry.test.mjs`
Expected: FAIL — `Cannot find module './component-registry.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// payload/hooks/lib/component-registry.mjs
// Pure registry + decision logic for the centralized component-update checker.
// No I/O: the worker (component-update-check-run.mjs) and session-init.mjs supply state
// and env; this module only classifies and formats. See
// docs/superpowers/specs/2026-07-26-component-update-checker-design.md.

// kind: "version"     -> has a check() that yields installed/latest/updateAvailable
//       "upgrade-only" -> no version signal; just runs its self-upgrade on the throttle
// scope: "global"     -> machine-wide CLI/tool
//        "project"     -> per-project skill (probe arrives in Phase 3: impeccable, ui-ux-pro-max)
export const COMPONENTS = [
  { name: "context-mode",  scope: "global",  kind: "upgrade-only", updateClass: "safe",   legacyEnv: "CONTEXT_MODE" },
  { name: "graphify",      scope: "global",  kind: "upgrade-only", updateClass: "safe",   legacyEnv: "GRAPHIFY" },
  { name: "claude-config", scope: "global",  kind: "version",      updateClass: "reinit", legacyEnv: null },
  { name: "impeccable",    scope: "project", kind: "version",      updateClass: "safe",   legacyEnv: null },
  { name: "ui-ux-pro-max", scope: "project", kind: "version",      updateClass: "safe",   legacyEnv: null },
];

const envKey = (name) => name.toUpperCase().replace(/-/g, "_");

export function autoUpdateEnabled(name, env = process.env) {
  if (env.CLAUDE_COMPONENT_AUTOUPDATE === "0") return false;
  if (env[`CLAUDE_COMPONENT_AUTOUPDATE_${envKey(name)}`] === "0") return false;
  const legacy = (COMPONENTS.find((c) => c.name === name) || {}).legacyEnv;
  if (legacy) {
    if (env.CLAUDE_TOOL_AUTOUPGRADE === "0") return false;
    if (env[`CLAUDE_TOOL_AUTOUPGRADE_${legacy}`] === "0") return false;
  }
  return true;
}

export function decide({ updateClass, updateAvailable, autoUpdateEnabled }) {
  if (!updateAvailable) return "skip";
  if (updateClass === "safe" && autoUpdateEnabled) return "auto";
  return "notify";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/component-registry.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/component-registry.mjs payload/hooks/lib/component-registry.test.mjs
git commit -m "feat(updater): component registry + update decision logic"
```

---

### Task 2: Presentation helpers — pendingCount + formatUpdateNotes (pure)

**Files:**
- Modify: `payload/hooks/lib/component-registry.mjs`
- Test: `payload/hooks/lib/component-registry.test.mjs` (append)

**Interfaces:**
- Consumes: state object `{ [name]: { installed, latest, updateAvailable, class, autoUpdated } }`.
- Produces:
  - `pendingCount(state): number` — entries with `updateAvailable === true`.
  - `formatUpdateNotes(state): string[]` — one human line per pending entry.

- [ ] **Step 1: Write the failing test**

```js
// append to payload/hooks/lib/component-registry.test.mjs
import { pendingCount, formatUpdateNotes } from "./component-registry.mjs";

const STATE = {
  "impeccable":    { installed: "4.0.2", latest: "4.1.0", updateAvailable: true,  class: "safe",   autoUpdated: true },
  "graphify":      { installed: "1.0.0", latest: "1.0.0", updateAvailable: false, class: "safe",   autoUpdated: false },
  "claude-config": { installed: "abc123", latest: "def456", updateAvailable: true, class: "reinit", autoUpdated: false },
};

test("pendingCount: counts only updateAvailable entries", () => {
  assert.equal(pendingCount(STATE), 2);
  assert.equal(pendingCount({}), 0);
});

test("formatUpdateNotes: safe-applied says restart; reinit says the command", () => {
  const notes = formatUpdateNotes(STATE);
  assert.equal(notes.length, 2);
  const safe = notes.find((n) => n.startsWith("impeccable"));
  assert.match(safe, /4\.0\.2.*4\.1\.0/);
  assert.match(safe, /restart/i);
  const reinit = notes.find((n) => n.startsWith("claude-config"));
  assert.match(reinit, /setup\.mjs|installer/i);
  assert.doesNotMatch(reinit, /restart to apply now/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/component-registry.test.mjs`
Expected: FAIL — `pendingCount is not a function` / `formatUpdateNotes is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to payload/hooks/lib/component-registry.mjs
export function pendingCount(state) {
  if (!state || typeof state !== "object") return 0;
  return Object.values(state).filter((e) => e && e.updateAvailable === true).length;
}

// claude-config is the only reinit entry that is re-applied by the installer, not /init-stack.
function reinitCommand(name) {
  return name === "claude-config" ? "re-run the installer (setup.mjs)" : "run /init-stack to apply";
}

export function formatUpdateNotes(state) {
  if (!state || typeof state !== "object") return [];
  const out = [];
  for (const [name, e] of Object.entries(state)) {
    if (!e || e.updateAvailable !== true) continue;
    const ver = e.latest ? ` ${e.latest}` : "";
    if (e.class === "safe" && e.autoUpdated) {
      out.push(`${name}: updated ${e.installed}→${e.latest} (active next session — restart to apply now).`);
    } else if (e.class === "safe") {
      out.push(`${name}:${ver} available (auto-update off — update it manually or re-enable).`);
    } else {
      out.push(`${name}:${ver} available — ${reinitCommand(name)}.`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/component-registry.test.mjs`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/component-registry.mjs payload/hooks/lib/component-registry.test.mjs
git commit -m "feat(updater): pending count + update-note formatting"
```

---

### Task 3: Bundle probe — refactor config-update-check-run for reuse

**Files:**
- Modify: `payload/hooks/lib/config-update-check-run.mjs`
- Test: `payload/hooks/lib/config-update-check-run.test.mjs` (new)

**Interfaces:**
- Produces:
  - `bundleUpdateAvailable(installedSha: string, remoteSha: string): boolean` — pure.
  - `checkBundleUpdate(claudeDir): Promise<{ installed, latest, updateAvailable } | null>` — reads the manifest, fetches the master SHA; `null` when no baseline / offline.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/config-update-check-run.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleUpdateAvailable } from "./config-update-check-run.mjs";

test("bundleUpdateAvailable: true only when both SHAs present and differ", () => {
  assert.equal(bundleUpdateAvailable("aaa", "bbb"), true);
  assert.equal(bundleUpdateAvailable("aaa", "aaa"), false);
  assert.equal(bundleUpdateAvailable("", "bbb"), false);
  assert.equal(bundleUpdateAvailable("aaa", ""), false);
  assert.equal(bundleUpdateAvailable(undefined, undefined), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/config-update-check-run.test.mjs`
Expected: FAIL — `bundleUpdateAvailable is not a function` (the file currently exports nothing and self-runs `main()`).

- [ ] **Step 3: Write minimal implementation**

Refactor the existing file so the SHA compare is a pure export and the fetch is reusable, and only auto-run `main()` when executed directly (not when imported by the worker):

```js
// add near the top of payload/hooks/lib/config-update-check-run.mjs
import { fileURLToPath } from "node:url";

export function bundleUpdateAvailable(installedSha, remoteSha) {
  return !!installedSha && !!remoteSha && installedSha !== remoteSha;
}

export async function checkBundleUpdate(claudeDir) {
  const manifestPath = join(claudeDir, "state", "bundle-manifest.json");
  const manifest = existsSync(manifestPath) ? (safe(() => JSON.parse(readFileSync(manifestPath, "utf8"))) || {}) : {};
  const installed = manifest.installedSha;
  if (!installed) return null; // no baseline yet
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch("https://api.github.com/repos/axazolai/claude-config/commits/master",
      { signal: ctrl.signal, headers: { "User-Agent": "claude-config-update-check" } });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const latest = j && typeof j.sha === "string" ? j.sha : null;
    if (!latest) return null;
    return { installed, latest, updateAvailable: bundleUpdateAvailable(installed, latest) };
  } catch { return null; }
}
```

Then gate the existing `main();` at the bottom so importing the module for the two exports above does not fire the legacy standalone write:

```js
// replace the bare `main();` at the end of payload/hooks/lib/config-update-check-run.mjs
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
```

(Leave `main()` itself intact for back-compat — it still writes the legacy `update-check.json` when run directly, but nothing spawns it anymore; the worker uses `checkBundleUpdate`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/config-update-check-run.test.mjs`
Expected: PASS (1 test). The import no longer triggers a network call because `main()` is now guarded.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/config-update-check-run.mjs payload/hooks/lib/config-update-check-run.test.mjs
git commit -m "refactor(updater): export bundleUpdateAvailable + checkBundleUpdate, guard main()"
```

---

### Task 4: Statusline "updates" segment (pure) + wire the meter

**Files:**
- Modify: `payload/hooks/lib/gsd-context-meter-lib.mjs`
- Test: `payload/hooks/lib/gsd-context-meter-lib.test.mjs` (new)
- Modify: `payload/hooks/gsd-context-meter.mjs`

**Interfaces:**
- Produces: `appendUpdatesSegment(text: string, count: number): string` — appends ` │ ⬆<count>` (yellow) before any trailing newline; returns `text` unchanged when count < 1 or text isn't a string.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/gsd-context-meter-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendUpdatesSegment } from "./gsd-context-meter-lib.mjs";

test("appendUpdatesSegment: appends when count>0, no-op otherwise", () => {
  assert.equal(appendUpdatesSegment("bar", 0), "bar");
  assert.equal(appendUpdatesSegment("bar", undefined), "bar");
  assert.equal(appendUpdatesSegment(null, 2), null);
  const out = appendUpdatesSegment("bar", 2);
  assert.match(out, /⬆2/);          // ⬆2
  assert.ok(out.startsWith("bar"));
});

test("appendUpdatesSegment: inserts before a trailing newline", () => {
  const out = appendUpdatesSegment("bar\n", 1);
  assert.ok(out.endsWith("\n"));
  assert.match(out, /⬆1[^\n]*\n$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/gsd-context-meter-lib.test.mjs`
Expected: FAIL — `appendUpdatesSegment is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to payload/hooks/lib/gsd-context-meter-lib.mjs
/** Append a compact ` │ ⬆<count>` segment (yellow) before any trailing newline. */
export function appendUpdatesSegment(text, count) {
  if (typeof text !== "string" || !Number.isFinite(count) || count < 1) return text;
  const seg = ` │ \x1b[33m⬆${count}\x1b[0m`;
  return text.replace(/(\r?\n)?$/, (nl) => seg + (nl || ""));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/gsd-context-meter-lib.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the meter to read state and append the segment**

In `payload/hooks/gsd-context-meter.mjs`, extend the imports and the `end` handler (best-effort, never break the statusline):

```js
// update the import line
import { computeUsedTokenMetrics, rewriteContextBar, appendUpdatesSegment } from "./lib/gsd-context-meter-lib.mjs";
import { pendingCount } from "./lib/component-registry.mjs";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

// inside the process.stdin "end" handler, AFTER the existing rewriteContextBar block:
  try {
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    const statePath = join(claudeDir, "state", "component-updates.json");
    if (existsSync(statePath)) {
      const st = JSON.parse(readFileSync(statePath, "utf8"));
      output = appendUpdatesSegment(output, pendingCount(st));
    }
  } catch { /* never break the statusline over an update hint */ }

  process.stdout.write(output);
```

- [ ] **Step 6: Verify the meter wiring by hand**

Run (Git Bash):
```bash
mkdir -p /c/_Temp/claude/cuc-fixture/state
printf '{"claude-config":{"installed":"a","latest":"b","updateAvailable":true,"class":"reinit"}}' \
  > /c/_Temp/claude/cuc-fixture/state/component-updates.json
echo '{"model":{"display_name":"Opus"},"context_window":{"remaining_percentage":80}}' \
  | CLAUDE_CONFIG_DIR=/c/_Temp/claude/cuc-fixture node payload/hooks/gsd-context-meter.mjs | cat -v
```
Expected: output ends with a `⬆1` segment (shown as `M-bM-^BM-^F1` under `cat -v`). Re-run with the state file removed and confirm no segment appears. Then `rm -rf /c/_Temp/claude/cuc-fixture`.

- [ ] **Step 7: Commit**

```bash
git add payload/hooks/lib/gsd-context-meter-lib.mjs payload/hooks/lib/gsd-context-meter-lib.test.mjs payload/hooks/gsd-context-meter.mjs
git commit -m "feat(updater): statusline updates segment (full profile)"
```

---

### Task 5: The detached worker

**Files:**
- Create: `payload/hooks/lib/component-update-check-run.mjs`

**Interfaces:**
- Consumes: `COMPONENTS`, `autoUpdateEnabled`, `decide` (registry); `checkBundleUpdate` (bundle probe).
- Produces: writes `~/.claude/state/component-updates.json`. Reads optional CLI arg `--root <path>` (defaults to cwd) for future project-scoped probes.

- [ ] **Step 1: Write the worker**

```js
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
main();
```

- [ ] **Step 2: Smoke-verify it writes state and never throws**

Run (Git Bash), against an isolated config dir so nothing real is touched:
```bash
rm -rf /c/_Temp/claude/cuc-worker && mkdir -p /c/_Temp/claude/cuc-worker/state
# no bundle-manifest.json -> checkBundleUpdate returns null; context-mode/graphify may be absent
CLAUDE_CONFIG_DIR=/c/_Temp/claude/cuc-worker node payload/hooks/lib/component-update-check-run.mjs
echo "exit:$?"
cat /c/_Temp/claude/cuc-worker/state/component-updates.json
```
Expected: exit 0; a JSON file exists with `lastCheckedAt` stamps for whichever global components were present (at minimum `claude-config`, whose entry has no `installed` because there's no manifest baseline). Re-run immediately and confirm the throttle skips (timestamps unchanged). Then `rm -rf /c/_Temp/claude/cuc-worker`.

- [ ] **Step 3: Commit**

```bash
git add payload/hooks/lib/component-update-check-run.mjs
git commit -m "feat(updater): detached component-update worker (global-scope probes)"
```

---

### Task 6: Wire session-init — spawn the worker + emit notes

**Files:**
- Modify: `payload/hooks/session-init.mjs`

**Interfaces:**
- Consumes: `formatUpdateNotes` (registry); the worker script path; `state/component-updates.json`.

- [ ] **Step 1: Replace the `KNOWN_TOOLS` self-upgrade block with a worker spawn**

In `payload/hooks/session-init.mjs`, delete the entire `KNOWN_TOOLS` array and its
`if (process.env.CLAUDE_TOOL_AUTOUPGRADE !== "0") { ... }` block (the tool-upgrade loop, lines
~316-349 — it is superseded by the registry worker, which still honors the same legacy toggles via
`autoUpdateEnabled`). Replace it with:

```js
// ---- centralized component-update checker (registry-driven; supersedes the old KNOWN_TOOLS
// block). Detached + unref'd so it never blocks; it self-throttles per component (24h) and is
// best-effort. Notes are emitted from the state a PRIOR run wrote, below. Master toggle honored
// inside the worker; keep the legacy CLAUDE_TOOL_AUTOUPGRADE=0 escape here too so a full opt-out
// short-circuits before we even spawn. ----
if (process.env.CLAUDE_COMPONENT_AUTOUPDATE !== "0") {
  const worker = join(dirname(fileURLToPath(import.meta.url)), "lib", "component-update-check-run.mjs");
  if (existsSync(worker))
    safe(() => spawn(process.execPath, [worker, "--root", root], { detached: true, stdio: "ignore" }).unref());
}
```

- [ ] **Step 2: Add the notify block (reads the state a prior worker wrote)**

Near the other `notes.push(...)` sections (e.g. just before the `emit([...])` at the end), add:

```js
// ---- surface component updates the worker recorded on an earlier session (decoupled
// trigger/notify, same pattern as the bundle check). Best-effort; never blocks. ----
if (process.env.CLAUDE_COMPONENT_AUTOUPDATE !== "0") {
  const statePath = join(CLAUDE_DIR, "state", "component-updates.json");
  if (existsSync(statePath)) {
    const st = safe(() => JSON.parse(readFileSync(statePath, "utf8")));
    if (st) for (const line of formatUpdateNotes(st)) notes.push(`Component update: ${line}`);
  }
}
```

- [ ] **Step 3: Add the import**

At the top of `payload/hooks/session-init.mjs`, add:

```js
import { formatUpdateNotes } from "./lib/component-registry.mjs";
```

- [ ] **Step 4: Syntax-check + verify the notify path by hand**

Run (Git Bash):
```bash
node --check payload/hooks/session-init.mjs && echo "syntax ok"
rm -rf /c/_Temp/claude/cuc-si && mkdir -p /c/_Temp/claude/cuc-si/state
printf '{"impeccable":{"installed":"4.0.2","latest":"4.1.0","updateAvailable":true,"class":"safe","autoUpdated":true}}' \
  > /c/_Temp/claude/cuc-si/state/component-updates.json
echo '{"cwd":"'"$PWD"'"}' | CLAUDE_CONFIG_DIR=/c/_Temp/claude/cuc-si node payload/hooks/session-init.mjs
echo "exit:$?"
```
Expected: exit 0; the emitted JSON's `additionalContext` contains `Component update: impeccable: updated 4.0.2→4.1.0 (active next session — restart to apply now).`. Then `rm -rf /c/_Temp/claude/cuc-si`.

- [ ] **Step 5: Run the full hook test suite to confirm no regression**

Run: `node --test payload/hooks/lib/component-registry.test.mjs payload/hooks/lib/config-update-check-run.test.mjs payload/hooks/lib/gsd-context-meter-lib.test.mjs`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/session-init.mjs
git commit -m "feat(updater): spawn component worker + emit update notes from session-init"
```

---

## Self-Review

**Spec coverage:**
- §2 reuse of KNOWN_TOOLS / config-update-check-run / gsd-context-meter → Tasks 6, 3, 4. ✅
- §3 registry model (name/scope/kind/updateClass/legacyEnv; installed-gating) → Task 1 (`COMPONENTS`, probe presence gating in Task 5). ✅
- §4 classification safe/reinit → Task 1 (`decide`). ✅
- §5 auto-update default + toggles (+ legacy) → Task 1 (`autoUpdateEnabled`), Task 5 (worker applies). ✅
- §6 worker + state file shape → Task 5. ✅
- §7 statusline segment (full-only) → Task 4. ✅
- §8 files touched → matches the File Structure section. ✅
- §10 Phase-3 coupling (project scope, afterUpdate) → registry `scope:"project"` entries present but probe-less (Task 1/5); afterUpdate is a Phase-3 addition to `PROBES` (documented, not built). ✅
- Resolved OI-3 (all three profiles) → non-`gsd-*` filenames (Task 1/3/5 files) ship in base/lite; statusline (gsd-*) is full-only per §7. ✅

**Placeholder scan:** No TBD/TODO; every code + test step has concrete content; verification steps give exact commands + expected output. ✅

**Type consistency:** `COMPONENTS` fields (name/scope/kind/updateClass/legacyEnv) used identically in Tasks 1/5; `decide`/`autoUpdateEnabled`/`pendingCount`/`formatUpdateNotes` signatures match across Tasks 1/2/4/6; `checkBundleUpdate`/`bundleUpdateAvailable` (Task 3) consumed in Task 5; `appendUpdatesSegment` (Task 4) consumed in the meter wiring (Task 4). ✅

## Deferred to Phase 3 (not in this plan)

- Project-scope probes for `impeccable` / `ui-ux-pro-max` (per-`root` `check`/`update`, keyed off `scope:"project"`), plus the `afterUpdate` hook that re-applies the Pro Max content-graft after an Impeccable update (the `gsd-agent-patches.mjs` pattern). See `docs/superpowers/specs/2026-07-26-component-update-checker-design.md` §10 and the memory `impeccable-promax-facts`.
