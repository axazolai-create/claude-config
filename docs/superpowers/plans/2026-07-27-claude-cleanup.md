# Intelligent `~/.claude` Cleanup (`/claude-cleanup`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user-invoked, reversible janitor for the live `~/.claude` (+ session temp root) that trashes stale sessions, old plugin-cache versions, old backups, and ephemeral runtime dirs — never touching venvs, active config, `memory/`, or the running session.

**Architecture:** A pure engine (`claude-cleanup-lib.mjs`) builds a *plan* over an **allowlist of category roots** (it never considers a path outside an enumerated category, so "never touch" is by construction). A thin CLI (`claude-cleanup.mjs`) exposes `scan`/`apply`/`empty-trash`/`restore`/`purge-retention`. A prose command (`claude-cleanup.md`) drives the interactive dry-run → list-checker → confirm → apply flow. Apply *moves* items to a timestamped trash batch with a manifest (reversible); batches older than 7 days are hard-purged.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert`, `node:fs`. No new deps.

## Global Constraints

- ESM `.mjs`. Reuse existing patterns: `isMain()` symlink-robust entry guard and `CLAUDE_CONFIG_DIR || join(homedir(),".claude")` resolution (copy from `hooks/lib/stack-rules-check.mjs`).
- **Allowlist safety:** the scan ONLY ever proposes paths under enumerated category roots. It must never walk or propose `memory/`, `state/`, `security/`, `context-mode/`, `settings*.json`, `CLAUDE.md`, `hooks/`, `bin/`, `skills/`, `agents/`, `commands/`, `rules-src/`, `setting-templates/`, `references/`, or the `.cleanup-trash/` root itself.
- **Age = recursive newest mtime** for directories (`newestMtime`), never the dir's own mtime (a stale-looking dir may hold live task output). File age = its own mtime.
- Windows `mtimeMs` throughout; days converted via `86_400_000`. Constants: `KEEP_DAYS=7`, `AUTO_DAYS=14`, `RETENTION_DAYS=7`.
- **Running-session protection:** primary guard is the `<KEEP_DAYS` window + a TOCTOU mtime-changed skip at apply; `--exclude-session <uuid>`/`--exclude-slug <slug>` is a secondary explicit exclude (a session can span multiple temp uuid dirs, so age is the real guard).
- **Plugin prune fail-safe:** if `installed_plugins.json` is missing/unparseable, skip the plugin category entirely (never guess the active version).
- All-profiles membership needs NO `variants.json` edit (denylist default; `**.test.mjs` already globally excluded).

---

## File Structure

**New**
- `payload/bin/lib/claude-cleanup-lib.mjs` — pure engine (age, sizing, categorize, plan, plugin-prune, trash, manifest, restore, retention)
- `payload/bin/lib/claude-cleanup-lib.test.mjs`
- `payload/bin/claude-cleanup.mjs` — CLI dispatch (scan/apply/empty-trash/restore/purge-retention)
- `payload/commands/claude-cleanup.md` — interactive orchestration (prose)

**Modified**
- `RISK_REGISTER.md` — one risk (irreversible-deletion exposure) + mitigations/residuals

---

### Task 1: Lib primitives — age, mtime, sizing, constants

**Files:**
- Create: `payload/bin/lib/claude-cleanup-lib.mjs`
- Test: `payload/bin/lib/claude-cleanup-lib.test.mjs`

**Interfaces — Produces:** `KEEP_DAYS`, `AUTO_DAYS`, `RETENTION_DAYS`, `DAY_MS`, `newestMtime(path)→ms`, `dirSize(path)→bytes`, `ageBucket(mtimeMs, nowMs)→"keep"|"list"|"auto"`.

- [ ] **Step 1: Write the failing tests**

```javascript
// payload/bin/lib/claude-cleanup-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEP_DAYS, AUTO_DAYS, DAY_MS, newestMtime, dirSize, ageBucket } from "./claude-cleanup-lib.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "cc-"));
const setMtime = (p, ms) => utimesSync(p, new Date(ms), new Date(ms));

test("constants", () => {
  assert.equal(KEEP_DAYS, 7); assert.equal(AUTO_DAYS, 14); assert.equal(DAY_MS, 86_400_000);
});

test("ageBucket edges (now-relative)", () => {
  const now = 1_000 * DAY_MS;
  assert.equal(ageBucket(now - 6 * DAY_MS, now), "keep");   // < 7d
  assert.equal(ageBucket(now - 8 * DAY_MS, now), "list");   // 7–14d
  assert.equal(ageBucket(now - 15 * DAY_MS, now), "auto");  // > 14d
  assert.equal(ageBucket(now - 7 * DAY_MS, now), "list");   // exactly 7d → not keep
  assert.equal(ageBucket(now - 14 * DAY_MS, now), "list");  // exactly 14d → not yet auto
});

test("newestMtime returns the newest file mtime, recursively (not the dir's own)", () => {
  const d = tmp();
  const sub = join(d, "a"); mkdirSync(sub);
  const old = join(sub, "old.txt"); writeFileSync(old, "x"); setMtime(old, 1000 * DAY_MS);
  const neu = join(sub, "new.txt"); writeFileSync(neu, "y"); setMtime(neu, 2000 * DAY_MS);
  assert.equal(newestMtime(d), 2000 * DAY_MS);
  rmSync(d, { recursive: true, force: true });
});

test("dirSize sums file bytes recursively", () => {
  const d = tmp();
  writeFileSync(join(d, "a"), "12345");           // 5
  mkdirSync(join(d, "s")); writeFileSync(join(d, "s", "b"), "678"); // 3
  assert.equal(dirSize(d), 8);
  rmSync(d, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail** — `node --test payload/bin/lib/claude-cleanup-lib.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement (append to `claude-cleanup-lib.mjs`)**

```javascript
// payload/bin/lib/claude-cleanup-lib.mjs
// Pure engine for /claude-cleanup. Allowlist-based: only ever proposes paths under enumerated
// category roots, so "never touch" (memory/, config, venvs) holds by construction.
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, renameSync, rmSync,
  writeFileSync, copyFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

export const DAY_MS = 86_400_000;
export const KEEP_DAYS = 7;
export const AUTO_DAYS = 14;
export const RETENTION_DAYS = 7;

export function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

export function newestMtime(path) {
  let newest = 0;
  const walk = (p) => {
    let st; try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) {
      if (st.mtimeMs > newest) newest = st.mtimeMs; // dir itself, in case it's empty
      let ents = []; try { ents = readdirSync(p); } catch { return; }
      for (const e of ents) walk(join(p, e));
    } else if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  walk(path);
  return newest;
}

export function dirSize(path) {
  let total = 0;
  const walk = (p) => {
    let st; try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) { let ents = []; try { ents = readdirSync(p); } catch { return; } for (const e of ents) walk(join(p, e)); }
    else total += st.size;
  };
  walk(path);
  return total;
}

// < KEEP_DAYS → keep; [KEEP_DAYS, AUTO_DAYS] → list; > AUTO_DAYS → auto
export function ageBucket(mtimeMs, nowMs) {
  const ageDays = (nowMs - mtimeMs) / DAY_MS;
  if (ageDays < KEEP_DAYS) return "keep";
  if (ageDays <= AUTO_DAYS) return "list";
  return "auto";
}
```

- [ ] **Step 4: Run to verify pass** — `node --test payload/bin/lib/claude-cleanup-lib.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `git add payload/bin/lib/claude-cleanup-lib.mjs payload/bin/lib/claude-cleanup-lib.test.mjs && git commit -m "feat(cleanup): lib primitives (age/mtime/size)"`

---

### Task 2: Plugin-version prune candidates (pure)

**Files:** Modify `payload/bin/lib/claude-cleanup-lib.mjs`; add tests.

**Interfaces:**
- Consumes: `claudeDir()` (Task 1)
- Produces: `activeInstallPaths(claudeDirPath) → Set<string>` (all `installPath` from `installed_plugins.json`, any scope; `null` if unreadable), `pluginPruneCandidates(claudeDirPath) → string[]` (absolute version-dir paths safe to trash; `[]` if manifest unreadable — fail-safe).

- [ ] **Step 1: Write the failing tests**

```javascript
import { mkdirSync as mkd, writeFileSync as wf } from "node:fs";
import { activeInstallPaths, pluginPruneCandidates } from "./claude-cleanup-lib.mjs";

test("pluginPruneCandidates keeps active installPaths, trashes the rest, keeps project-scope", () => {
  const d = tmp();
  const cache = join(d, "plugins", "cache", "mkt", "sp");
  for (const v of ["6.1.1", "6.2.0"]) mkd(join(cache, v), { recursive: true });
  const projCache = join(d, "plugins", "cache", "mkt", "kotlin-lsp", "1.0.0");
  mkd(projCache, { recursive: true });
  mkd(join(d, "plugins"), { recursive: true });
  wf(join(d, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: {
    "sp@mkt": [{ scope: "user", installPath: join(cache, "6.2.0") }],
    "kotlin-lsp@mkt": [{ scope: "project", installPath: projCache }],
  }}));
  const cand = pluginPruneCandidates(d);
  assert.deepEqual(cand, [join(cache, "6.1.1")]);          // only the stale version
  rmSync(d, { recursive: true, force: true });
});

test("pluginPruneCandidates fail-safe: missing manifest → [] (never guess)", () => {
  const d = tmp(); mkd(join(d, "plugins", "cache", "mkt", "sp", "6.2.0"), { recursive: true });
  assert.deepEqual(pluginPruneCandidates(d), []);
  assert.equal(activeInstallPaths(d), null);
  rmSync(d, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement (append)**

```javascript
export function activeInstallPaths(dir = claudeDir()) {
  const f = join(dir, "plugins", "installed_plugins.json");
  let parsed; try { parsed = JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
  const set = new Set();
  const plugins = parsed && parsed.plugins;
  if (plugins && typeof plugins === "object") {
    for (const entries of Object.values(plugins)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) if (e && e.installPath) set.add(e.installPath);
    }
  }
  return set;
}

// Version dirs under plugins/cache/<mkt>/<plugin>/ whose full path is NOT an active installPath.
export function pluginPruneCandidates(dir = claudeDir()) {
  const active = activeInstallPaths(dir);
  if (active === null) return []; // fail-safe: never prune when we can't tell what's active
  const cacheRoot = join(dir, "plugins", "cache");
  const out = [];
  let mkts = []; try { mkts = readdirSync(cacheRoot); } catch { return out; }
  for (const mkt of mkts) {
    let plugs = []; try { plugs = readdirSync(join(cacheRoot, mkt)); } catch { continue; }
    for (const plug of plugs) {
      const plugDir = join(cacheRoot, mkt, plug);
      let vers = []; try { vers = readdirSync(plugDir); } catch { continue; }
      for (const ver of vers) {
        const verPath = join(plugDir, ver);
        let st; try { st = statSync(verPath); } catch { continue; }
        if (st.isDirectory() && !active.has(verPath)) out.push(verPath);
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(cleanup): plugin-version prune candidates (fail-safe)"`

---

### Task 3: `buildPlan` — the scan engine

**Files:** Modify `payload/bin/lib/claude-cleanup-lib.mjs`; add tests.

**Interfaces:**
- Consumes: Task 1 + Task 2.
- Produces: `buildPlan({ dir, tempRoot, nowMs, excludeUuids }) → { items, listCheck, totals }` where each item is `{ absPath, size, category, reason, mtimeMs, bucket }`. `items` = everything to trash now (ephemeral + age>AUTO + auto sessions/temp + plugin candidates); `listCheck` = 7–14d sessions/temp for the user to decide; `totals={count,bytes}`.

**Category roots (allowlist):**
- Ephemeral (trash directory *contents*): `paste-cache`, `shell-snapshots`, `logs`, `cache`, `session-env`, `daemon`.
- Age dirs (each immediate child, `>AUTO`): `file-history`, `jobs`, `tasks`, `backups`, `gsd-user-files-backup`, `gsd-migration-journal`.
- Sessions: under `projects/<slug>/`, each uuid (`.jsonl` + optional matching dir), skipping literal `memory/`.
- Temp: under `<tempRoot>/<slug>/`, each uuid dir.
- Plugins: `pluginPruneCandidates` (always trash; version staleness is the age proxy).

- [ ] **Step 1: Write the failing tests** (fixture `~/.claude`-shaped tree)

```javascript
import { buildPlan } from "./claude-cleanup-lib.mjs";
const UUID = "05b6d095-deef-4e70-875e-8fcff99484fe";
const UUID2 = "11111111-2222-3333-4444-555555555555";

function fakeTree() {
  const d = tmp(); const now = 1000 * DAY_MS;
  const mk = (p) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, "x"), p);
  const age = (p, days) => setMtime(p, now - days * DAY_MS);
  // ephemeral
  age(mk(join(d, "paste-cache", "p1")), 1);
  // memory MUST be preserved
  mk(join(d, "projects", "slug", "memory", "MEMORY.md"));
  // sessions: one old (auto), one mid (list), one fresh (keep)
  age(mk(join(d, "projects", "slug", `${UUID}.jsonl`)), 30);       // auto
  age(mk(join(d, "projects", "slug", UUID, "data")), 30);          // its dir
  age(mk(join(d, "projects", "slug", `${UUID2}.jsonl`)), 10);      // list
  age(mk(join(d, "projects", "slug", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl")), 2); // keep
  return { d, now };
}

test("buildPlan: auto sessions trashed, mid listed, fresh kept, memory never touched, ephemeral trashed", () => {
  const { d, now } = fakeTree();
  const plan = buildPlan({ dir: d, tempRoot: join(d, "__notemp"), nowMs: now, excludeUuids: [] });
  const paths = plan.items.map((i) => i.absPath);
  assert.ok(paths.some((p) => p.endsWith(join("paste-cache", "p1"))), "ephemeral trashed");
  assert.ok(paths.some((p) => p.endsWith(`${UUID}.jsonl`)), "auto session .jsonl trashed");
  assert.ok(paths.some((p) => p.endsWith(join("slug", UUID))), "auto session dir trashed");
  assert.ok(!paths.some((p) => p.includes(`${sep}memory${sep}`) || p.endsWith("memory")), "memory NEVER in plan");
  assert.ok(!plan.items.concat(plan.listCheck).some((i) => i.absPath.includes("aaaaaaaa-bbbb")), "fresh session kept");
  assert.ok(plan.listCheck.some((i) => i.absPath.includes(UUID2)), "mid session in listCheck");
});

test("buildPlan: excludeUuids keeps a matching session even if old", () => {
  const { d, now } = fakeTree();
  const plan = buildPlan({ dir: d, tempRoot: join(d, "__notemp"), nowMs: now, excludeUuids: [UUID] });
  assert.ok(!plan.items.some((i) => i.absPath.includes(UUID) && !i.absPath.includes("memory")), "excluded uuid not trashed");
});
```
(Add `import { sep } from "node:path";` to the test file.)

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement (append)**

```javascript
const EPHEMERAL = ["paste-cache", "shell-snapshots", "logs", "cache", "session-env", "daemon"];
const AGE_DIRS = ["file-history", "jobs", "tasks", "backups", "gsd-user-files-backup", "gsd-migration-journal"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeReaddir(p) { try { return readdirSync(p, { withFileTypes: true }); } catch { return []; } }
function statOr(p) { try { return statSync(p); } catch { return null; } }

export function buildPlan({ dir = claudeDir(), tempRoot, nowMs, excludeUuids = [] }) {
  const items = [], listCheck = [];
  const excl = new Set(excludeUuids);
  const push = (arr, absPath, category, reason, mtimeMs) =>
    arr.push({ absPath, size: statOr(absPath)?.isDirectory() ? dirSize(absPath) : (statOr(absPath)?.size ?? 0), category, reason, mtimeMs, bucket: ageBucket(mtimeMs, nowMs) });

  // Ephemeral: trash each immediate child of the dir (dir itself stays).
  for (const name of EPHEMERAL) {
    const root = join(dir, name);
    for (const e of safeReaddir(root)) push(items, join(root, e.name), "ephemeral", `ephemeral:${name}`, newestMtime(join(root, e.name)));
  }
  // Age dirs: each immediate child, only if > AUTO_DAYS.
  for (const name of AGE_DIRS) {
    const root = join(dir, name);
    for (const e of safeReaddir(root)) {
      const p = join(root, e.name); const m = e.isDirectory() ? newestMtime(p) : (statOr(p)?.mtimeMs ?? 0);
      if (ageBucket(m, nowMs) === "auto") push(items, p, "age", `age:${name}`, m);
    }
  }
  // Sessions: projects/<slug>/{<uuid>.jsonl,<uuid>/}; skip literal "memory".
  const projects = join(dir, "projects");
  for (const slugEnt of safeReaddir(projects)) {
    if (!slugEnt.isDirectory()) continue;
    const slugDir = join(projects, slugEnt.name);
    // group uuids
    const uuids = new Map(); // uuid -> {jsonl?, dir?}
    for (const e of safeReaddir(slugDir)) {
      if (e.name === "memory") continue; // NEVER
      const m = e.name.match(/^([0-9a-f-]{36})(\.jsonl)?$/i);
      if (!m || !UUID_RE.test(m[1])) continue;
      const rec = uuids.get(m[1]) || {}; rec[m[2] ? "jsonl" : "dir"] = join(slugDir, e.name); uuids.set(m[1], rec);
    }
    for (const [uuid, rec] of uuids) {
      if (excl.has(uuid)) continue;
      const paths = [rec.jsonl, rec.dir].filter(Boolean);
      const m = Math.max(...paths.map((p) => (statOr(p)?.isDirectory() ? newestMtime(p) : (statOr(p)?.mtimeMs ?? 0))));
      const bucket = ageBucket(m, nowMs);
      if (bucket === "keep") continue;
      for (const p of paths) push(bucket === "auto" ? items : listCheck, p, "session", `session:${slugEnt.name}/${uuid}`, m);
    }
  }
  // Temp: <tempRoot>/<slug>/<uuid>/
  for (const slugEnt of safeReaddir(tempRoot)) {
    if (!slugEnt.isDirectory()) continue;
    const slugDir = join(tempRoot, slugEnt.name);
    for (const e of safeReaddir(slugDir)) {
      if (!e.isDirectory() || !UUID_RE.test(e.name) || excl.has(e.name)) continue;
      const p = join(slugDir, e.name); const m = newestMtime(p); const bucket = ageBucket(m, nowMs);
      if (bucket === "keep") continue;
      push(bucket === "auto" ? items : listCheck, p, "temp", `temp:${slugEnt.name}/${e.name}`, m);
    }
  }
  // Plugins: stale cache versions (always trash).
  for (const p of pluginPruneCandidates(dir)) push(items, p, "plugin", "plugin:stale-version", newestMtime(p));

  const totals = { count: items.length, bytes: items.reduce((a, i) => a + i.size, 0) };
  return { items, listCheck, totals };
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(cleanup): buildPlan scan engine (allowlist, age-gated)"`

---

### Task 4: Trash engine — move, manifest, retention, restore

**Files:** Modify `payload/bin/lib/claude-cleanup-lib.mjs`; add tests.

**Interfaces:**
- Produces: `trashRoot(dir)`, `applyPlan({ dir, items, nowMs }) → { batchDir, moved, bytes, skipped }` (moves items to a new batch, writes `manifest.json`, TOCTOU-skips items whose mtime changed), `listTrashBatches(dir) → [{ ts, dir, mtimeMs }]`, `purgeRetention({ dir, nowMs, retentionDays }) → removedBatches[]`, `restoreBatch({ dir, ts }) → { restored, skipped }`.

**Batch layout:** `~/.claude/.cleanup-trash/<ts>/` where `<ts>` = an ISO-like stamp passed in by the CLI (`Date.now()` is unavailable in tests — pass `nowMs`/`ts`). `manifest.json` = `{ ts, entries:[{ originalAbsPath, size, category, reason, movedAt }] }`. Cross-drive items (temp on another drive) are copied+removed; same-drive use `renameSync`.

- [ ] **Step 1: Write the failing tests**

```javascript
import { applyPlan, restoreBatch, purgeRetention, trashRoot, listTrashBatches } from "./claude-cleanup-lib.mjs";
import { existsSync, readdirSync } from "node:fs";

test("applyPlan moves items to a batch + manifest; restore puts them back", () => {
  const d = tmp(); const now = 1000 * DAY_MS;
  const victim = join(d, "logs", "old.log"); mkdirSync(dirname(victim), { recursive: true }); writeFileSync(victim, "data");
  const items = [{ absPath: victim, size: 4, category: "ephemeral", reason: "ephemeral:logs", mtimeMs: statSync(victim).mtimeMs, bucket: "auto" }];
  const res = applyPlan({ dir: d, items, nowMs: now, ts: "20260727T000000Z" });
  assert.equal(res.moved, 1); assert.ok(!existsSync(victim), "moved out of place");
  assert.ok(existsSync(join(res.batchDir, "manifest.json")));
  const rr = restoreBatch({ dir: d, ts: "20260727T000000Z" });
  assert.equal(rr.restored, 1); assert.ok(existsSync(victim), "restored to original path");
  rmSync(d, { recursive: true, force: true });
});

test("applyPlan TOCTOU: item whose mtime changed since scan is skipped", () => {
  const d = tmp(); const now = 1000 * DAY_MS;
  const v = join(d, "logs", "x"); mkdirSync(dirname(v), { recursive: true }); writeFileSync(v, "d");
  const items = [{ absPath: v, size: 1, category: "ephemeral", reason: "r", mtimeMs: statSync(v).mtimeMs - 999, bucket: "auto" }]; // stale recorded mtime
  const res = applyPlan({ dir: d, items, nowMs: now, ts: "T1" });
  assert.equal(res.skipped, 1); assert.equal(res.moved, 0); assert.ok(existsSync(v), "left in place");
  rmSync(d, { recursive: true, force: true });
});

test("purgeRetention removes only batches older than retentionDays", () => {
  const d = tmp(); const now = 1000 * DAY_MS;
  const root = trashRoot(d); mkdirSync(join(root, "old"), { recursive: true }); mkdirSync(join(root, "new"), { recursive: true });
  writeFileSync(join(root, "old", "manifest.json"), JSON.stringify({ ts: "old", entries: [] }));
  writeFileSync(join(root, "new", "manifest.json"), JSON.stringify({ ts: "new", entries: [] }));
  setMtime(join(root, "old"), now - 10 * DAY_MS); setMtime(join(root, "old", "manifest.json"), now - 10 * DAY_MS);
  setMtime(join(root, "new"), now - 1 * DAY_MS); setMtime(join(root, "new", "manifest.json"), now - 1 * DAY_MS);
  const removed = purgeRetention({ dir: d, nowMs: now, retentionDays: 7 });
  assert.deepEqual(removed, ["old"]); assert.ok(!existsSync(join(root, "old")) && existsSync(join(root, "new")));
  rmSync(d, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement (append)**

```javascript
export function trashRoot(dir = claudeDir()) { return join(dir, ".cleanup-trash"); }

function moveInto(src, destDir) {
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, basename(src));
  try { renameSync(src, dest); }
  catch { // cross-device: copy then remove
    const st = statSync(src);
    if (st.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const e of readdirSync(src)) moveInto(join(src, e), dest);
      rmSync(src, { recursive: true, force: true });
    } else { copyFileSync(src, dest); rmSync(src, { force: true }); }
  }
  return dest;
}

export function applyPlan({ dir = claudeDir(), items, nowMs, ts }) {
  const batchDir = join(trashRoot(dir), ts);
  mkdirSync(batchDir, { recursive: true });
  const entries = []; let moved = 0, bytes = 0, skipped = 0;
  let idx = 0;
  for (const it of items) {
    const st = statOr(it.absPath);
    if (!st) { skipped++; continue; }
    // TOCTOU: became active since scan → leave alone (allow tiny fs rounding)
    const liveM = st.isDirectory() ? newestMtime(it.absPath) : st.mtimeMs;
    if (Math.abs(liveM - it.mtimeMs) > 1) { skipped++; continue; }
    const slot = join(batchDir, String(idx++)); // unique slot avoids basename collisions
    const dest = moveInto(it.absPath, slot);
    entries.push({ originalAbsPath: it.absPath, size: it.size, category: it.category, reason: it.reason, movedAt: nowMs, slot: basename(slot) });
    moved++; bytes += it.size;
  }
  writeFileSync(join(batchDir, "manifest.json"), JSON.stringify({ ts, entries }, null, 2), "utf8");
  return { batchDir, moved, bytes, skipped };
}

export function listTrashBatches(dir = claudeDir()) {
  const root = trashRoot(dir); const out = [];
  for (const e of safeReaddir(root)) {
    if (!e.isDirectory()) continue;
    const p = join(root, e.name); out.push({ ts: e.name, dir: p, mtimeMs: statOr(p)?.mtimeMs ?? 0 });
  }
  return out;
}

export function purgeRetention({ dir = claudeDir(), nowMs, retentionDays = RETENTION_DAYS }) {
  const removed = [];
  for (const b of listTrashBatches(dir)) {
    if ((nowMs - b.mtimeMs) / DAY_MS > retentionDays) { rmSync(b.dir, { recursive: true, force: true }); removed.push(b.ts); }
  }
  return removed;
}

export function restoreBatch({ dir = claudeDir(), ts }) {
  const batchDir = join(trashRoot(dir), ts);
  let manifest; try { manifest = JSON.parse(readFileSync(join(batchDir, "manifest.json"), "utf8")); } catch { return { restored: 0, skipped: 0 }; }
  let restored = 0, skipped = 0;
  for (const e of manifest.entries || []) {
    const stored = join(batchDir, e.slot, basename(e.originalAbsPath));
    if (existsSync(e.originalAbsPath) || !existsSync(stored)) { skipped++; continue; } // never clobber
    mkdirSync(dirname(e.originalAbsPath), { recursive: true });
    moveInto(join(batchDir, e.slot, basename(e.originalAbsPath)), dirname(e.originalAbsPath));
    restored++;
  }
  if (skipped === 0) rmSync(batchDir, { recursive: true, force: true });
  return { restored, skipped };
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(cleanup): trash move + manifest + retention + restore"`

---

### Task 5: CLI dispatch `claude-cleanup.mjs`

**Files:**
- Create: `payload/bin/claude-cleanup.mjs`
- Test: `payload/bin/claude-cleanup.test.mjs`

**Interfaces:**
- Consumes: the lib. Produces: `parseArgs(argv) → { cmd, opts }`, and a `main()` that prints JSON for `scan` and human lines for others.

**Subcommands:** `scan` (prints `buildPlan` JSON; opts `--temp-root`, `--exclude-session` repeatable, `--exclude-slug`, `--keep-under`, `--older-than`), `apply --plan <file>` (reads a finalized plan JSON = `{items, ts}`; runs `applyPlan`), `empty-trash`, `restore --ts <ts>`, `purge-retention`. `nowMs` from `Date.now()` in `main()` only (never in the lib/tests).

- [ ] **Step 1: Write the failing tests** (arg parsing + a scan smoke over a fixture)

```javascript
// payload/bin/claude-cleanup.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./claude-cleanup.mjs";

test("parseArgs: scan with excludes + temp-root", () => {
  const { cmd, opts } = parseArgs(["scan", "--temp-root", "C:/t", "--exclude-session", "u1", "--exclude-session", "u2", "--exclude-slug", "s"]);
  assert.equal(cmd, "scan"); assert.equal(opts.tempRoot, "C:/t");
  assert.deepEqual(opts.excludeSession, ["u1", "u2"]); assert.equal(opts.excludeSlug, "s");
});
test("parseArgs: restore --ts", () => {
  const { cmd, opts } = parseArgs(["restore", "--ts", "T1"]);
  assert.equal(cmd, "restore"); assert.equal(opts.ts, "T1");
});
test("parseArgs: bare command defaults to scan", () => {
  assert.equal(parseArgs([]).cmd, "scan");
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```javascript
// payload/bin/claude-cleanup.mjs
import { fileURLToPath } from "node:url";
import { realpathSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { claudeDir, buildPlan, applyPlan, purgeRetention, restoreBatch, listTrashBatches, trashRoot }
  from "./lib/claude-cleanup-lib.mjs";
import { rmSync } from "node:fs";

export function parseArgs(argv) {
  const opts = { excludeSession: [] };
  const cmd = (argv[0] && !argv[0].startsWith("--")) ? argv[0] : "scan";
  for (let i = (cmd === argv[0] ? 1 : 0); i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--temp-root") opts.tempRoot = next();
    else if (a === "--exclude-session") opts.excludeSession.push(next());
    else if (a === "--exclude-slug") opts.excludeSlug = next();
    else if (a === "--ts") opts.ts = next();
    else if (a === "--plan") opts.plan = next();
    else if (a === "--keep-under") opts.keepUnder = Number(next());
    else if (a === "--older-than") opts.olderThan = Number(next());
  }
  return { cmd, opts };
}

function isMain() {
  const a = process.argv[1]; if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

function stamp(nowMs) { return new Date(nowMs).toISOString().replace(/[:.]/g, "").replace(/-/g, ""); }

export function main(argv = process.argv.slice(2), nowMs = Date.now()) {
  const dir = claudeDir();
  const { cmd, opts } = parseArgs(argv);
  if (cmd === "scan") {
    const plan = buildPlan({ dir, tempRoot: opts.tempRoot, nowMs, excludeUuids: opts.excludeSession });
    process.stdout.write(JSON.stringify(plan, null, 2));
  } else if (cmd === "apply") {
    const finalized = JSON.parse(readFileSync(opts.plan, "utf8")); // { items, ts? }
    const res = applyPlan({ dir, items: finalized.items, nowMs, ts: finalized.ts || stamp(nowMs) });
    process.stdout.write(`Moved ${res.moved} items (${res.bytes} bytes) to ${res.batchDir}; skipped ${res.skipped}.\n`);
  } else if (cmd === "purge-retention") {
    const removed = purgeRetention({ dir, nowMs });
    process.stdout.write(`Purged ${removed.length} trash batch(es): ${removed.join(", ") || "none"}.\n`);
  } else if (cmd === "empty-trash") {
    for (const b of listTrashBatches(dir)) rmSync(b.dir, { recursive: true, force: true });
    rmSync(trashRoot(dir), { recursive: true, force: true });
    process.stdout.write("Trash emptied.\n");
  } else if (cmd === "restore") {
    const res = restoreBatch({ dir, ts: opts.ts });
    process.stdout.write(`Restored ${res.restored}; skipped ${res.skipped}.\n`);
  }
}

if (isMain()) main();
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(cleanup): claude-cleanup CLI (scan/apply/restore/retention)"`

---

### Task 6: `/claude-cleanup` command (prose orchestration)

**Files:** Create `payload/commands/claude-cleanup.md`.

**Context:** Prose the agent follows. No unit test. Model the frontmatter/style on `payload/commands/pnpm-phantom-fix.md`.

- [ ] **Step 1: Write the command**

Author `payload/commands/claude-cleanup.md` with `allowed-tools: Bash(node *), AskUserQuestion` and these steps:
1. **Retention first.** Run `node ~/.claude/bin/claude-cleanup.mjs purge-retention` and note what it purged.
2. **Scan.** Derive `TEMP_ROOT` and the current `<slug>`/`<session-uuid>` from the scratchpad path in the environment (the parent chain of the scratchpad dir: `<TEMP_ROOT>/<slug>/<uuid>/scratchpad`). Run `node ~/.claude/bin/claude-cleanup.mjs scan --temp-root "<TEMP_ROOT>" --exclude-session "<uuid>" --exclude-slug "<slug>"`. Parse the JSON plan.
3. **Dry-run report.** Present a grouped summary: per `category`, count + total size; call out the biggest reclaimers. State that nothing has moved yet.
4. **List-checker.** If `listCheck` is non-empty, show a compact numbered table (slug · date-from-mtime · size) of the 7–14-day sessions/temp and ask the user which to remove — offer keep-all / remove-all / a specific subset. Fold the chosen `listCheck` items into the plan's `items`.
5. **Confirm & apply.** Ask for explicit confirmation. On yes, write the finalized `{ items, ts }` to a temp file and run `node ~/.claude/bin/claude-cleanup.mjs apply --plan <file>`. Report reclaimed bytes, the trash batch path, and that it is restorable for 7 days (`restore --ts <ts>`), then auto-purged.
6. **Safety notes in the doc:** never runs unattended; `memory/`, active config, venvs, and the running session are never in scope; everything is reversible from `.cleanup-trash/` until retention.

- [ ] **Step 2: Verify no code regressions** — `shopt -s globstar; node --test payload/**/*.test.mjs` still green.
- [ ] **Step 3: Commit** — `git commit -m "feat(cleanup): /claude-cleanup command (dry-run + list-checker + apply)"`

---

### Task 7: RISK_REGISTER entry

**Files:** Modify `RISK_REGISTER.md`.

- [ ] **Step 1:** Add `RISK-CLEANUP-001` (read the file first to match format/IDs): irreversible loss of user data. Mitigations: allowlist-only scan (never considers config/`memory/`/venvs), dry-run-first, unified trash + 7-day retention + `restore`, `<7d` KEEP window + `--exclude-session` + TOCTOU guard for the running session, plugin-prune fail-safe-skip on unreadable manifest. Residuals to log: cross-drive move partial-failure handling; a session that spans multiple temp uuid dirs relies on the age guard, not the explicit exclude.
- [ ] **Step 2:** `shopt -s globstar; node --test payload/**/*.test.mjs && node --test *.test.mjs` — green.
- [ ] **Step 3: Commit** — `git commit -m "docs(risk): RISK-CLEANUP-001 for /claude-cleanup data-deletion exposure"`

---

## Self-Review

**Spec coverage:** conservative janitor (venvs never in a category root) ✓ Tasks 1–3; reversible trash+retention+restore ✓ Task 4; dry-run+list-checker ✓ Task 6; active-session/`memory` guards ✓ Tasks 3–4 (+command); plugin-prune fail-safe ✓ Task 2; +temp ✓ Task 3; all-profiles (no variants.json edit) ✓ (noted); risk ✓ Task 7. Age policy 7/14 + retention 7 ✓ Task 1.

**Placeholder scan:** none — every code/test step has real code. `<TEMP_ROOT>`/`<slug>`/`<uuid>` in Task 6 are values the agent extracts from the known scratchpad path, not TBD.

**Type consistency:** plan item shape `{absPath,size,category,reason,mtimeMs,bucket}` is produced by `buildPlan` and consumed unchanged by `applyPlan`; `ts` threads scan→apply; `applyPlan`/`restoreBatch` share the manifest `{ts,entries:[{originalAbsPath,slot,...}]}` shape (round-trip tested).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-claude-cleanup.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, broad final review.
2. **Inline Execution** — execute in this session with checkpoints.

Which approach?
