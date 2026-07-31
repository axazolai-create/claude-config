# gsd-core Detector and a Statusline for base/lite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `base` or `lite` install finds a foreign gsd-core on disk, offer to remove it reversibly through the existing cleanup trash; and give those profiles a statusline of their own, since the one they lose was a wrapper around gsd-core's.

**Architecture:** A new pure library builds the inventory and filters `settings.hooks`; `setup.mjs` only orchestrates and prompts. Removal reuses `claude-cleanup-lib.mjs` — every path is *moved* into `.cleanup-trash/<ts>/` with 7-day retention and a documented rollback, never `rm`. For the statusline, the profile-neutral half of `gsd-context-meter-lib.mjs` moves into a new `statusline-lib.mjs` that both the `full` wrapper and the new `base`/`lite` renderer import.

**Tech Stack:** Node 20+ ESM, `node --test`, no dependencies.

## Global Constraints

- **Trigger:** `profile ∈ {base, lite}` **and** `~/.claude/gsd-core/VERSION` exists. Nothing happens on `full`, and nothing happens when gsd-core is absent.
- **Never touched:** `~/.gsd/` (settings and research cache must survive a return to `full`), `.planning/` in any project, anything outside `~/.claude`.
- **Paths in the current bundle manifest are subtracted from the inventory**, so the detector can never consume a file this bundle owns.
- **`--replace-all` / `--merge-all` do NOT imply consent.** Those flags are about this bundle's own files; extending them to a foreign product is the wrong semantics. Scripted use gets a dedicated `--uninstall-gsd`. This deliberately diverges from `pruneStale()`, which does treat the bulk flags as consent.
- **Non-TTY reports only.** No prompt, no removal.
- **Default answer is no.**
- **Every removal is a move.** `applyPlan` → `.cleanup-trash/<ts>/`, `restoreBatch` is the rollback inside the 7-day window, `purgeRetention` sweeps it exactly as it already does for `/claude-cleanup`.
- **The statusline never breaks the prompt.** Any error yields empty output — the discipline `gsd-context-meter.mjs` already follows.
- **No duplicated statusline logic between profiles.** The shared functions move once; nothing is copied.
- Terse-code mode: no comments except a genuine non-obvious *why*.

## Measured starting state

| Surface | Count |
|---|---|
| `~/.claude/gsd-core/` | `VERSION` = 1.8.0 |
| `~/.claude/skills/gsd-*` | 71 |
| `~/.claude/agents/gsd-*.md` | 34 |
| `~/.claude/hooks/gsd-*` | 23 files, **12 registered** in `settings.json` |
| `~/.gsd/` | `defaults.json`, `research-cache` — **out of scope** |

`pruneStale()` (`setup.mjs`) cannot reach any of it: its candidate set is this bundle's previous manifest plus `SEED_REMOVED`, so a file the bundle never installed never becomes a candidate. That is a stated guarantee, not an oversight — `setup.mjs` says so where it skips `gsd-*` agents.

`base` has no statusline at all, also by design: `setup.mjs` deletes a `statusLine` pointing at `gsd-context-meter` whenever the profile is not `full`, because `hooks/gsd-context-meter.mjs` is excluded outside `full`. That file shells out to gsd-core's own `gsd-statusline.js` and rewrites one segment, so without gsd-core it has nothing to wrap.

## The one guarantee this work weakens, and how it is contained

`setup.mjs` filters hook entries only through `mentionsOurs(e)`, whose basenames are collected dynamically from `settings.partial.json`. Foreign entries are left alone **by construction** — the code cannot touch what it cannot name.

The detector must match `gsd-*` explicitly, which breaks that property. Containment: it runs only under the profile trigger, only with explicit consent, and only after a copy of the current `settings.json` is written into the same trash batch.

Note the asymmetry, because it matters at rollback time: `restoreBatch` restores *moved files*. The settings copy is not a moved file — it is a copy — so reversing the settings edit is a manual `cp` that `setup.mjs` prints verbatim after the batch completes. A rollback that silently restored settings would also undo unrelated edits made since.

## File Structure

| File | Responsibility |
|---|---|
| `payload/bin/lib/gsd-core-detect.mjs` | inventory building and the `settings.hooks` filter — pure |
| `payload/bin/lib/gsd-core-detect.test.mjs` | its tests |
| `setup.mjs` | trigger, prompt, execution, the printed rollback |
| `payload/hooks/lib/statusline-lib.mjs` | the profile-neutral half, moved out of `gsd-context-meter-lib.mjs` |
| `payload/hooks/lib/gsd-context-meter-lib.mjs` | keeps only `rewriteContextBar`, imports the rest |
| `payload/hooks/statusline.mjs` | the whole line, for `base`/`lite` |
| `payload/hooks/statusline.test.mjs` | its tests |
| `payload/hooks/lib/component-registry.mjs` | gains `pendingNames(state)` |

---

### Task 1: The detector library

`setup.mjs` is already ~1250 lines, and pure logic is testable without filesystem mocks. Everything that decides *what* would be removed lives here; `setup.mjs` decides only *whether*.

**Files:**
- Create: `payload/bin/lib/gsd-core-detect.mjs`
- Create: `payload/bin/lib/gsd-core-detect.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `gsdCorePresent(dir)` → boolean — `<dir>/gsd-core/VERSION` exists.
  - `buildGsdInventory({ dir, manifestRels })` → `{ items, categories, totalBytes }`. Each item is `{ absPath, size, category, reason, mtimeMs }` — exactly the shape `applyPlan` consumes. `categories` is `[{ name, count, bytes }]` for the consent prompt.
  - `filterGsdHooks(settings)` → `{ settings, removed }` — a new settings object with every hook entry whose `args` reference `hooks/gsd-*` dropped, and the dropped entries listed.

- [ ] **Step 1: Write the failing tests**

Create `payload/bin/lib/gsd-core-detect.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gsdCorePresent, buildGsdInventory, filterGsdHooks } from "./gsd-core-detect.mjs";

function claudeDir(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gsd-detect-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}

test("presence is decided by gsd-core/VERSION alone", () => {
  assert.equal(gsdCorePresent(claudeDir({})), false);
  assert.equal(gsdCorePresent(claudeDir({ "gsd-core/VERSION": "1.8.0\n" })), true);
});

test("the inventory covers exactly the five surfaces", () => {
  const dir = claudeDir({
    "gsd-core/VERSION": "1.8.0\n",
    "skills/gsd-plan-phase/SKILL.md": "x",
    "agents/gsd-planner.md": "x",
    "agents/other.md": "x",
    "hooks/gsd-config-patch.mjs": "x",
    "hooks/lib/gsd-agent-patches.mjs": "x",
    "hooks/session-init.mjs": "x",
    "skills/update-changelog/SKILL.md": "x",
  });
  const { items, categories } = buildGsdInventory({ dir, manifestRels: [] });
  const rels = items.map((i) => i.absPath.slice(dir.length + 1).replace(/\\/g, "/")).sort();
  assert.deepEqual(rels, [
    "agents/gsd-planner.md",
    "gsd-core",
    "hooks/gsd-config-patch.mjs",
    "hooks/lib/gsd-agent-patches.mjs",
    "skills/gsd-plan-phase",
  ]);
  assert.equal(categories.find((c) => c.name === "agents").count, 1);
});

test("a path this bundle owns is never in the inventory", () => {
  const dir = claudeDir({
    "gsd-core/VERSION": "1.8.0\n",
    "hooks/gsd-context-meter.mjs": "x",
    "hooks/lib/gsd-context-meter-lib.mjs": "x",
  });
  const { items } = buildGsdInventory({
    dir,
    manifestRels: ["hooks/gsd-context-meter.mjs", "hooks/lib/gsd-context-meter-lib.mjs"],
  });
  assert.deepEqual(items.map((i) => i.absPath.slice(dir.length + 1).replace(/\\/g, "/")), ["gsd-core"]);
});

test("every item carries what applyPlan needs", () => {
  const dir = claudeDir({ "gsd-core/VERSION": "1.8.0\n" });
  for (const it of buildGsdInventory({ dir, manifestRels: [] }).items)
    for (const k of ["absPath", "size", "category", "reason", "mtimeMs"])
      assert.ok(k in it, `${k} missing`);
});

test("only gsd hook registrations are dropped, and they are reported", () => {
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "node", args: ["/h/.claude/hooks/gsd-config-patch.mjs"] }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "node", args: ["/h/.claude/hooks/secrets-gate.mjs"] }] },
      ],
      SessionStart: [{ hooks: [{ type: "command", command: "node", args: ["/h/.claude/hooks/gsd-session.mjs"] }] }],
    },
    model: "opus",
  };
  const { settings: out, removed } = filterGsdHooks(settings);
  assert.equal(out.hooks.PreToolUse.length, 1);
  assert.equal(out.hooks.SessionStart.length, 0);
  assert.equal(removed.length, 2);
  assert.equal(out.model, "opus");
  assert.equal(settings.hooks.PreToolUse.length, 2, "input must not be mutated");
});

test("a hooks-less settings object survives untouched", () => {
  const { settings, removed } = filterGsdHooks({ model: "opus" });
  assert.deepEqual(settings, { model: "opus" });
  assert.deepEqual(removed, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/bin/lib/gsd-core-detect.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the library**

Create `payload/bin/lib/gsd-core-detect.mjs`:

```js
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { dirSize, newestMtime } from "./claude-cleanup-lib.mjs";

const CATEGORIES = [
  { name: "gsd-core", dir: ".", match: (n) => n === "gsd-core", reason: "gsd-core install root" },
  { name: "skills", dir: "skills", match: (n) => n.startsWith("gsd-"), reason: "gsd-core skill" },
  { name: "agents", dir: "agents", match: (n) => n.startsWith("gsd-") && n.endsWith(".md"), reason: "gsd-core agent" },
  { name: "hooks", dir: "hooks", match: (n) => n.startsWith("gsd-"), reason: "gsd-core hook" },
  { name: "hooks/lib", dir: join("hooks", "lib"), match: (n) => n.startsWith("gsd-"), reason: "gsd-core hook library" },
];

export const gsdCorePresent = (dir) => existsSync(join(dir, "gsd-core", "VERSION"));

const safeReaddir = (p) => { try { return readdirSync(p); } catch { return []; } };
const statOr = (p) => { try { return statSync(p); } catch { return null; } };

export function buildGsdInventory({ dir, manifestRels = [] }) {
  const owned = new Set(manifestRels.map((r) => r.replace(/\\/g, "/")));
  const items = [];
  const categories = [];
  for (const cat of CATEGORIES) {
    const base = cat.dir === "." ? dir : join(dir, cat.dir);
    let count = 0;
    let bytes = 0;
    for (const name of safeReaddir(base)) {
      if (!cat.match(name)) continue;
      const rel = (cat.dir === "." ? name : `${cat.dir.replace(/\\/g, "/")}/${name}`);
      if (owned.has(rel)) continue;
      const absPath = join(base, name);
      const st = statOr(absPath);
      if (!st) continue;
      const size = st.isDirectory() ? dirSize(absPath) : st.size;
      const mtimeMs = st.isDirectory() ? newestMtime(absPath) : st.mtimeMs;
      items.push({ absPath, size, category: `gsd-core:${cat.name}`, reason: cat.reason, mtimeMs });
      count += 1;
      bytes += size;
    }
    if (count) categories.push({ name: cat.name, count, bytes });
  }
  return { items, categories, totalBytes: items.reduce((n, i) => n + i.size, 0) };
}

// `hooks/lib/gsd-*` is deliberately NOT matched here: nothing registers a lib file as a hook,
// and a broader match would be a second place this code can reach outside its own files.
const REFERENCES_GSD_HOOK = (entry) =>
  (entry.hooks || []).some((h) => (h.args || []).some((a) => /(^|[\\/])hooks[\\/]gsd-[^\\/]+$/.test(String(a))));

export function filterGsdHooks(settings) {
  if (!settings || !settings.hooks) return { settings: { ...settings }, removed: [] };
  const hooks = {};
  const removed = [];
  for (const [event, entries] of Object.entries(settings.hooks)) {
    hooks[event] = (entries || []).filter((e) => {
      if (!REFERENCES_GSD_HOOK(e)) return true;
      removed.push({ event, entry: e });
      return false;
    });
  }
  return { settings: { ...settings, hooks }, removed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/bin/lib/gsd-core-detect.test.mjs`
Expected: 6/6 PASS. The "input must not be mutated" assertion is the one that matters: `setup.mjs` diffs old against new settings, and an in-place edit makes that diff empty.

- [ ] **Step 5: Dry-run against the real `~/.claude`**

```bash
node -e "
  import('./payload/bin/lib/gsd-core-detect.mjs').then(async (m) => {
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    console.log('present:', m.gsdCorePresent(dir));
    const inv = m.buildGsdInventory({ dir, manifestRels: [] });
    console.log(inv.categories, 'total', Math.round(inv.totalBytes / 1024) + 'KB');
  });
"
```

Expected on a `full` install: `present: true` and counts close to skills 71, agents 34, hooks 23. This call only reads. Note that `manifestRels: []` here overstates the inventory on purpose — the real call subtracts the manifest.

- [ ] **Step 6: Commit**

```bash
git add payload/bin/lib/gsd-core-detect.mjs payload/bin/lib/gsd-core-detect.test.mjs
git commit -m "feat(setup): pure detector for a foreign gsd-core install"
```

---

### Task 2: `setup.mjs` orchestrates, prompts, and prints the rollback

**Files:**
- Modify: `setup.mjs`

**Interfaces:**
- Consumes: `gsdCorePresent`, `buildGsdInventory`, `filterGsdHooks` (Task 1); `applyPlan`, `purgeRetention`, `trashRoot` from `payload/bin/lib/claude-cleanup-lib.mjs`; `manifestNow` (already in scope in `setup.mjs`).
- Produces: a `--uninstall-gsd` flag, and the removal itself.

- [ ] **Step 1: Add the flag**

Wherever `setup.mjs` parses its argv alongside `--replace-all` / `--merge-all`, add `--uninstall-gsd` as `UNINSTALL_GSD`. Do **not** derive it from the bulk flags:

```js
const UNINSTALL_GSD = process.argv.includes("--uninstall-gsd");
```

- [ ] **Step 2: Add the detector step**

Place it after `pruneStale()` and before the settings merge — the settings edit must happen while the merge still runs afterwards, so a single settings write lands. Add:

```js
async function detectForeignGsdCore() {
  if (VARIANT === "full" || !gsdCorePresent(CDIR)) return;
  const { items, categories, totalBytes } = buildGsdInventory({ dir: CDIR, manifestRels: manifestNow.map((f) => f.rel) });
  if (!items.length) return;

  const version = safe(() => readFileSync(join(CDIR, "gsd-core", "VERSION"), "utf8").trim()) || "unknown";
  log(`\ngsd-core ${version} is installed here and is not part of this bundle:`);
  for (const c of categories) log(`  ${c.name.padEnd(10)} ${String(c.count).padStart(3)}  ${Math.round(c.bytes / 1024)} KB`);
  log(`  total ${Math.round(totalBytes / 1024)} KB`);
  log(`  ~/.gsd/ and every project's .planning/ are never touched.`);

  if (!process.stdin.isTTY && !UNINSTALL_GSD) {
    log(`  Reporting only (non-interactive). Run with --uninstall-gsd to remove it.`);
    return;
  }
  // The bulk flags are about THIS bundle's files. Extending them to a foreign product would be
  // consent the user never gave, so --uninstall-gsd is the only scripted route.
  if (!UNINSTALL_GSD && !(await confirm("Move all of it to the cleanup trash?", false))) return;
  if (DRY) { log(`  [dry-run] would move ${items.length} path(s)`); return; }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const settingsPath = join(CDIR, "settings.json");
  const batchDir = join(trashRoot(CDIR), ts);
  mkdirSync(batchDir, { recursive: true });
  const backup = join(batchDir, "settings.json.pre-gsd-uninstall");
  if (existsSync(settingsPath)) copyFileSync(settingsPath, backup);

  const res = applyPlan({ dir: CDIR, items, nowMs: Date.now(), ts });
  log(`  moved ${res.moved} path(s), ${Math.round(res.bytes / 1024)} KB, skipped ${res.skipped}`);

  if (existsSync(settingsPath)) {
    const cur = JSON.parse(readFileSync(settingsPath, "utf8"));
    const { settings, removed } = filterGsdHooks(cur);
    if (removed.length) {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
      log(`  removed ${removed.length} gsd-* hook registration(s) from settings.json`);
    }
  }

  log(`  Rollback within 7 days:`);
  log(`    node ~/.claude/bin/claude-cleanup.mjs --restore ${ts}`);
  log(`    cp "${backup.replace(/\\/g, "/")}" "${settingsPath.replace(/\\/g, "/")}"`);
  purgeRetention({ dir: CDIR, nowMs: Date.now() });
}
```

Add the imports at the top of `setup.mjs` and reuse whatever `confirm`/prompt helper it already has — do not introduce a second prompting mechanism. If no such helper exists, use the same readline pattern the settings diff prompt uses, defaulting to **no**.

- [ ] **Step 3: Call it**

Call `await detectForeignGsdCore();` immediately after the existing `await pruneStale();`.

The ordering matters twice over: the manifest must already be written (so `manifestRels` is this run's, not the previous run's), and the settings merge must still be ahead (so the hook removal and the merge produce one settings write rather than two).

- [ ] **Step 4: Verify on a throwaway config directory**

```bash
D=$(mktemp -d)
mkdir -p "$D/gsd-core" "$D/skills/gsd-probe" "$D/agents" "$D/hooks"
echo 1.8.0 > "$D/gsd-core/VERSION"
echo x > "$D/agents/gsd-planner.md"
echo x > "$D/hooks/gsd-probe.mjs"
printf '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node","args":["%s/hooks/gsd-probe.mjs"]}]}]}}\n' "$D" > "$D/settings.json"
CLAUDE_CONFIG_DIR="$D" node setup.mjs --profile base --uninstall-gsd
ls "$D"; ls "$D/.cleanup-trash"/*/ | head
node -e "console.log(JSON.stringify(require('$D/settings.json').hooks))"
```

Expected: `gsd-core`, `skills/gsd-probe`, `agents/gsd-planner.md` and `hooks/gsd-probe.mjs` gone from `$D`; a trash batch containing them plus `settings.json.pre-gsd-uninstall`; and `hooks.PreToolUse` an empty array — not a missing key.

Replace `--profile base` with whatever flag `setup.mjs` actually uses to select a profile; check its argv parsing rather than assuming.

- [ ] **Step 5: Verify consent is genuinely required**

```bash
D2=$(mktemp -d) && mkdir -p "$D2/gsd-core" && echo 1.8.0 > "$D2/gsd-core/VERSION"
CLAUDE_CONFIG_DIR="$D2" node setup.mjs --profile base --replace-all < /dev/null
test -f "$D2/gsd-core/VERSION" && echo "bulk flags did not consent - correct"
```

Expected: `bulk flags did not consent - correct`. This is the single most important assertion in the task: `--replace-all` reaching a foreign product would be a silent uninstall of software this bundle does not own.

- [ ] **Step 6: File the two risks**

Add to the register (using plan #3's CLI if it has landed, otherwise by hand), at the next free ids in the `ULTRAPOWERS` prefix:

- *Removing foreign hook registrations from `settings.json` weakens the "only ever touch our own entries" property.* Status `Mitigated` — the pre-edit copy inside the trash batch, plus the printed `cp` command; the match is `hooks/gsd-*` only, under the profile trigger and explicit consent.
- *`/gsd-update` reinstalls gsd-core at any time.* Status `Active` — the detector only observes divergence at the next `setup.mjs` run, so between runs the machine drifts. Deliberately not fixed: a session-start enforcement of gsd-core's absence is out of scope.

- [ ] **Step 7: Commit**

```bash
git add setup.mjs RISK_REGISTER.md
git commit -m "feat(setup): offer to remove a foreign gsd-core, reversibly, on base and lite"
```

---

### Task 3: Split the statusline library

`formatCurrentTokens`, `formatContextWindow`, `computeUsedTokenMetrics` and `appendUpdatesSegment` have nothing to do with gsd-core. `rewriteContextBar` does — it exists solely to parse `gsd-statusline.js` output — and stays.

**Files:**
- Create: `payload/hooks/lib/statusline-lib.mjs`
- Modify: `payload/hooks/lib/gsd-context-meter-lib.mjs`
- Modify: `payload/hooks/lib/gsd-context-meter-lib.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `statusline-lib.mjs` exporting `formatCurrentTokens`, `formatContextWindow`, `computeUsedTokenMetrics`, `appendUpdatesSegment`. `gsd-context-meter-lib.mjs` re-exports them so no existing importer breaks.

- [ ] **Step 1: Move the four functions**

Cut `formatCurrentTokens`, `formatContextWindow`, `computeUsedTokenMetrics` and `appendUpdatesSegment` from `gsd-context-meter-lib.mjs` into a new `payload/hooks/lib/statusline-lib.mjs`, unchanged, with whatever module-level constants they use.

- [ ] **Step 2: Re-export from the old home**

At the top of `gsd-context-meter-lib.mjs`:

```js
export { formatCurrentTokens, formatContextWindow, computeUsedTokenMetrics, appendUpdatesSegment } from "./statusline-lib.mjs";
```

and import into the file whatever `rewriteContextBar` still needs:

```js
import { formatCurrentTokens, formatContextWindow } from "./statusline-lib.mjs";
```

Re-exporting rather than moving the call sites is what makes this a no-behaviour-change task: every existing importer, including `gsd-context-meter.mjs`, keeps working with no edit.

- [ ] **Step 3: Verify the move changed nothing**

```bash
node --test payload/hooks/lib/gsd-context-meter-lib.test.mjs
node -e "
  import('./payload/hooks/lib/gsd-context-meter-lib.mjs').then((m) => {
    for (const k of ['formatCurrentTokens','formatContextWindow','computeUsedTokenMetrics','appendUpdatesSegment','rewriteContextBar'])
      if (typeof m[k] !== 'function') throw new Error('missing export: ' + k);
    console.log('all five exports intact');
  });
"
```

Expected: the existing suite passing unchanged, then `all five exports intact`. The existing tests are the regression net here — if any needs editing, the move was not a move.

- [ ] **Step 4: Commit**

```bash
git add payload/hooks/lib/statusline-lib.mjs payload/hooks/lib/gsd-context-meter-lib.mjs
git commit -m "refactor(statusline): split the profile-neutral half out of the gsd wrapper"
```

---

### Task 4: Name the pending components, do not just count them

`⬆2` says something is stale. `⬆ context-mode +1` says what.

**Files:**
- Modify: `payload/hooks/lib/component-registry.mjs`
- Modify: `payload/hooks/lib/component-registry.test.mjs`

**Interfaces:**
- Consumes: the existing state shape — `{ [name]: { updateAvailable: boolean, … } }`, the same predicate `pendingCount` already uses.
- Produces: `pendingNames(state)` → `string[]`, sorted, and `pendingCount` reimplemented as `pendingNames(state).length` so the two can never disagree.

- [ ] **Step 1: Write the failing tests**

Append to `payload/hooks/lib/component-registry.test.mjs`:

```js
test("pendingNames lists exactly the components with an update available", () => {
  const state = {
    graphify: { updateAvailable: false },
    "context-mode": { updateAvailable: true },
    "claude-config": { updateAvailable: true },
  };
  assert.deepEqual(pendingNames(state), ["claude-config", "context-mode"]);
  assert.equal(pendingCount(state), 2);
});

test("pendingNames tolerates junk", () => {
  assert.deepEqual(pendingNames(null), []);
  assert.deepEqual(pendingNames({ a: null, b: "x", c: { updateAvailable: "yes" } }), []);
});
```

Add `pendingNames` to that file's import list.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/hooks/lib/component-registry.test.mjs`
Expected: FAIL — `pendingNames is not a function`.

- [ ] **Step 3: Implement it**

In `payload/hooks/lib/component-registry.mjs`, replace `pendingCount` with:

```js
export function pendingNames(state) {
  if (!state || typeof state !== "object") return [];
  return Object.entries(state)
    .filter(([, e]) => e && e.updateAvailable === true)
    .map(([name]) => name)
    .sort();
}

export const pendingCount = (state) => pendingNames(state).length;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/hooks/lib/component-registry.test.mjs`
Expected: every case passing, including the pre-existing `pendingCount` tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/component-registry.mjs payload/hooks/lib/component-registry.test.mjs
git commit -m "feat(components): name the components with pending updates"
```

---

### Task 5: The statusline for `base` and `lite`

Segment order is `⬆ <names> │ <context> │ <state>`. Updates go **first** and name what is stale rather than counting it; the segment is omitted entirely when nothing is pending. The native `⬆1` in the Claude Code footer is a separate indicator that this does not and cannot replace.

**Files:**
- Create: `payload/hooks/statusline.mjs`
- Create: `payload/hooks/statusline.test.mjs`

**Interfaces:**
- Consumes: `statusline-lib.mjs` (Task 3), `pendingNames` (Task 4).
- Produces, all exported for testing:
  - `renderUpdates(names)` → `"⬆ context-mode graphify +2"` or `""`.
  - `renderGit(porcelain)` → `"main+2~1?3↑1"`, `"main✓"`, `"(detached)"`. Takes the raw output of `git status --porcelain=v1 -b`, so it is pure.
  - `renderGsd({ milestone, phase, status, percent })` → `"v2.0 [██░] 40% · Phase 4.5 executing"`.
  - `renderSdd({ plan, complete, next })` → `"planning-tree ✔3 →4"`.
  - `render(input)` → the whole line.

- [ ] **Step 1: Write the failing tests**

Create `payload/hooks/statusline.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderUpdates, renderGit, renderGsd, renderSdd, render } from "./statusline.mjs";

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("nothing pending renders no updates segment", () => {
  assert.equal(renderUpdates([]), "");
  assert.equal(renderUpdates(null), "");
});

test("up to two components are named, the rest collapse", () => {
  assert.equal(strip(renderUpdates(["context-mode"])), "⬆ context-mode");
  assert.equal(strip(renderUpdates(["context-mode", "graphify"])), "⬆ context-mode graphify");
  assert.equal(strip(renderUpdates(["a", "b", "c", "d"])), "⬆ a b +2");
});

test("a clean branch renders with a tick", () => {
  assert.equal(renderGit("## main...origin/main\n"), "main✓");
});

test("staged, modified, untracked, ahead and behind all render", () => {
  const out = renderGit([
    "## main...origin/main [ahead 1, behind 2]",
    "M  staged.txt",
    " M dirty.txt",
    "?? new.txt",
    "?? other.txt",
    "?? third.txt",
    "",
  ].join("\n"));
  assert.equal(out, "main+1~1?3↑1↓2");
});

test("a detached head says so", () => {
  assert.equal(renderGit("## HEAD (no branch)\n"), "(detached)");
});

test("an initial branch with no upstream still renders", () => {
  assert.equal(renderGit("## No commits yet on master\n"), "master✓");
});

test("the gsd segment mirrors gsd-core's own vocabulary", () => {
  assert.equal(renderGsd({ milestone: "v2.0", phase: "4.5", status: "executing", percent: 40 }),
    "v2.0 [██░] 40% · Phase 4.5 executing");
});

test("the sdd segment names the plan and where to resume", () => {
  assert.equal(renderSdd({ plan: "planning-tree", complete: 3, next: 4 }), "planning-tree ✔3 →4");
});

test("render omits the updates segment and joins the rest", () => {
  const line = strip(render({ updates: [], context: "45k/200k 22%", state: "claude-config main✓" }));
  assert.equal(line, "45k/200k 22% │ claude-config main✓");
});

test("render puts updates first when there are any", () => {
  const line = strip(render({ updates: ["context-mode"], context: "45k/200k 22%", state: "x" }));
  assert.equal(line, "⬆ context-mode │ 45k/200k 22% │ x");
});

test("render survives every segment being empty", () => {
  assert.equal(strip(render({ updates: [], context: "", state: "" })), "");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the statusline**

Create `payload/hooks/statusline.mjs`:

```js
#!/usr/bin/env node
// statusLine renderer for the base and lite profiles. full keeps gsd-context-meter.mjs, which
// wraps gsd-core's own statusline; without gsd-core there is nothing to wrap, so this renders
// the whole line itself. Any error yields empty output - the statusline never breaks the prompt.
import { readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { formatCurrentTokens, formatContextWindow, computeUsedTokenMetrics } from "./lib/statusline-lib.mjs";
import { pendingNames } from "./lib/component-registry.mjs";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

export function renderUpdates(names) {
  if (!Array.isArray(names) || !names.length) return "";
  const shown = names.slice(0, 2);
  const rest = names.length - shown.length;
  return YELLOW(`⬆ ${shown.join(" ")}${rest > 0 ? ` +${rest}` : ""}`);
}

export function renderGit(porcelain) {
  const lines = String(porcelain ?? "").split("\n");
  const head = lines[0] ?? "";
  if (/^## HEAD \(no branch\)/.test(head)) return "(detached)";
  const named = /^## (?:No commits yet on )?([^.\s]+)/.exec(head);
  if (!named) return "";
  const branch = named[1];
  const ahead = /\bahead (\d+)/.exec(head);
  const behind = /\bbehind (\d+)/.exec(head);
  let staged = 0, modified = 0, untracked = 0;
  for (const l of lines.slice(1)) {
    if (!l) continue;
    if (l.startsWith("??")) { untracked += 1; continue; }
    if (l[0] && l[0] !== " ") staged += 1;
    if (l[1] && l[1] !== " ") modified += 1;
  }
  const parts = [
    staged ? `+${staged}` : "",
    modified ? `~${modified}` : "",
    untracked ? `?${untracked}` : "",
    ahead ? `↑${ahead[1]}` : "",
    behind ? `↓${behind[1]}` : "",
  ].join("");
  return `${branch}${parts || "✓"}`;
}

export function renderGsd({ milestone, phase, status, percent }) {
  const filled = Math.max(0, Math.min(3, Math.round((Number(percent) || 0) / 34)));
  const bar = "█".repeat(filled) + "░".repeat(3 - filled);
  return `${milestone} [${bar}] ${percent}% · Phase ${phase} ${status}`;
}

export function renderSdd({ plan, complete, next }) {
  return `${plan} ✔${complete} →${next}`;
}

export function render({ updates, context, state }) {
  return [renderUpdates(updates), context, state].filter(Boolean).join(DIM(" │ "));
}

function gsdState(root) {
  if (!existsSync(join(root, ".planning", "config.json"))) return null;
  const stateText = safe(() => readFileSync(join(root, ".planning", "STATE.md"), "utf8"), "");
  const milestone = (/^\s*(?:\*\*)?(?:milestone|version)(?:\*\*)?\s*[::]\s*(\S+)/im.exec(stateText) || [])[1];
  const phase = (/^\s*(?:\*\*)?phase(?:\*\*)?\s*[::]\s*(\S+)/im.exec(stateText) || [])[1];
  const status = (/^\s*(?:\*\*)?status(?:\*\*)?\s*[::]\s*(\w+)/im.exec(stateText) || [])[1];
  const percent = (/(\d{1,3})\s*%/.exec(stateText) || [])[1];
  // A .planning/ this parser cannot read is not an error - it falls through to the plain
  // project+branch segment, which is always true. Guessing a phase would not be.
  if (!milestone || !phase) return null;
  return renderGsd({ milestone, phase, status: status || "", percent: Number(percent) || 0 });
}

function sddState(root) {
  const base = join(root, ".ultrapowers", "sdd");
  if (!existsSync(base)) return null;
  for (const name of safe(() => readdirSync(base), []) ?? []) {
    const ledger = join(base, name, "progress.md");
    if (!existsSync(ledger)) continue;
    const text = safe(() => readFileSync(ledger, "utf8"), "") ?? "";
    const plan = (/^#\s*SDD ledger\s*—\s*plan:\s*(.+)$/m.exec(text) || [])[1];
    const done = new Set([...text.matchAll(/^Task (\d+): complete/gm)].map((m) => Number(m[1])));
    let next = 1;
    while (done.has(next)) next += 1;
    return renderSdd({ plan: plan ? basename(plan.trim(), ".md") : name, complete: done.size, next });
  }
  return null;
}

function plainState(root) {
  const branch = safe(() => renderGit(execFileSync("git", ["-C", root, "status", "--porcelain=v1", "-b"], { encoding: "utf8", timeout: 1500 })), "");
  return [basename(root), branch].filter(Boolean).join(" ");
}

function main() {
  const raw = safe(() => readFileSync(0, "utf8"), "") ?? "";
  const data = safe(() => JSON.parse(raw || "{}"), {}) ?? {};
  const root = resolve((data.workspace && (data.workspace.current_dir || data.workspace.project_dir)) || process.cwd());

  const state = safe(() => JSON.parse(readFileSync(join(CLAUDE_DIR, "state", "component-updates.json"), "utf8")), null);
  const updates = pendingNames(state);

  const m = safe(() => computeUsedTokenMetrics(data), null);
  const context = m && m.totalCtx
    ? `${formatCurrentTokens(m.usedTokens)}/${formatContextWindow(m.totalCtx)} ${m.used}%`
    : "";

  process.stdout.write(render({ updates, context, state: gsdState(root) || sddState(root) || plainState(root) }));
}

function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  if (import.meta.url === pathToFileURL(a).href) return true;
  try { return import.meta.url === pathToFileURL(realpathSync(a)).href; } catch { return false; }
}

if (isMainModule()) {
  try { main(); } catch { /* never break the prompt */ }
  process.exit(0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: 11/11 PASS.

- [ ] **Step 5: Confirm the context segment's field names against the library**

`renderGit` and the segment renderers are pure and fully tested. The context segment is not: it reads `m.usedTokens`, `m.totalCtx` and `m.used`, taken from how `rewriteContextBar({ totalCtx, used, usedTokens })` destructures the same object.

```bash
grep -n "return {" -A 6 payload/hooks/lib/statusline-lib.mjs | head -20
echo '{"workspace":{"current_dir":"'"$PWD"'"}}' | node payload/hooks/statusline.mjs; echo
```

Expected: `computeUsedTokenMetrics` returning those three keys, and a rendered line ending `claude-config master✓` (or with counts, if the tree is dirty). If the key names differ, fix the three references — the fallback hides the mistake by rendering no context segment at all, which is exactly the failure that survives review.

- [ ] **Step 6: Confirm the GSD branch against a real GSD project**

Run the same piped command with `current_dir` set to a project that has `.planning/`. Expected: a `v… [██░] …% · Phase … …` segment. If it falls through to project+branch, the STATE.md regexes do not match that project's field names — widen them, and do not invent a phase number when they fail.

- [ ] **Step 7: Commit**

```bash
git add payload/hooks/statusline.mjs payload/hooks/statusline.test.mjs
git commit -m "feat(statusline): a whole-line renderer for base and lite"
```

---

### Task 6: Register it for `base` and `lite`

**Files:**
- Modify: `setup.mjs`

**Interfaces:**
- Consumes: `payload/hooks/statusline.mjs` (Task 5).
- Produces: a `statusLine` key on `base`/`lite` where one is currently deleted.

- [ ] **Step 1: Replace the deletion with a registration**

`setup.mjs` currently has, in its statusLine branch:

```js
    } else if (VARIANT !== "full") {
      const curCmd = merged.statusLine && merged.statusLine.command;
      if (typeof curCmd === "string" && curCmd.includes("gsd-context-meter")) delete merged.statusLine;
    }
```

Replace the body with:

```js
    } else if (VARIANT !== "full") {
      // base/lite lose gsd-context-meter (it wraps gsd-core's statusline, which these profiles
      // do not install) and get their own whole-line renderer instead. A user's own custom
      // statusLine still wins: only a prior gsd takeover, or our own entry, is replaced.
      const curCmd = merged.statusLine && merged.statusLine.command;
      const ours = typeof curCmd === "string" && (curCmd.includes("gsd-context-meter") || curCmd.includes("hooks/statusline.mjs"));
      if (!merged.statusLine || ours) {
        const scriptPath = join(CDIR, "hooks", "statusline.mjs").replace(/\\/g, "/");
        merged.statusLine = { ...partial.statusLine, command: `node "${scriptPath}"` };
      }
    }
```

The `ours` test is what keeps this from stealing a statusline the user set by hand — the same discipline the deletion branch already had, extended to cover our own entry so a re-run is idempotent rather than additive.

- [ ] **Step 2: Verify the full → base → full round trip**

```bash
D=$(mktemp -d)
CLAUDE_CONFIG_DIR="$D" node setup.mjs --profile full   && node -e "console.log(require('$D/settings.json').statusLine.command)"
CLAUDE_CONFIG_DIR="$D" node setup.mjs --profile base   && node -e "console.log(require('$D/settings.json').statusLine.command)"
CLAUDE_CONFIG_DIR="$D" node setup.mjs --profile full   && node -e "console.log(require('$D/settings.json').statusLine.command)"
```

Expected: `…gsd-context-meter.mjs`, then `…statusline.mjs`, then `…gsd-context-meter.mjs` again. A profile switch that leaves the wrong renderer in place produces an empty statusline, which looks like a broken terminal rather than a misconfiguration.

- [ ] **Step 3: Verify a hand-set statusline survives**

```bash
D2=$(mktemp -d) && mkdir -p "$D2"
printf '{"statusLine":{"type":"command","command":"echo mine"}}\n' > "$D2/settings.json"
CLAUDE_CONFIG_DIR="$D2" node setup.mjs --profile base
node -e "console.log(require('$D2/settings.json').statusLine.command)"
```

Expected: `echo mine`, unchanged.

- [ ] **Step 4: Commit**

```bash
git add setup.mjs
git commit -m "feat(setup): register the base/lite statusline instead of deleting the key"
```

---

### Task 7: Deploy and verify

- [ ] **Step 1: Run the full suite**

Run: `node --test payload/ *.test.mjs`
Expected: every test passing, including the three new files.

- [ ] **Step 2: Deploy on the current profile and confirm nothing changed for `full`**

```bash
node setup.mjs
node -e "console.log(require(require('os').homedir()+'/.claude/settings.json').statusLine.command)"
```

Expected: still `…gsd-context-meter.mjs`, and no gsd-core removal prompt — this machine is `full`, so the detector's trigger is false. If it prompts, the trigger is reading the wrong profile variable.

- [ ] **Step 3: Confirm the trash mechanism is shared, not duplicated**

```bash
grep -n "applyPlan\|purgeRetention\|restoreBatch" setup.mjs
grep -c "rm -rf\|rmSync" payload/bin/lib/gsd-core-detect.mjs || echo "detector removes nothing itself"
```

Expected: `setup.mjs` calling all three, and `detector removes nothing itself`. The library builds a plan; only `applyPlan` moves anything.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: deploy the gsd-core detector and the base/lite statusline"
```

---

## Self-Review

**Spec coverage.** Trigger on profile plus `gsd-core/VERSION` (Task 2); the five inventory surfaces, with manifest paths subtracted (Task 1); `~/.gsd/` and `.planning/` never touched (Task 1 — they are not in `CATEGORIES` at all, so no code path can reach them); TTY prompt defaulting to no, non-TTY reporting only, bulk flags not implying consent, `--uninstall-gsd` for scripted use (Task 2); removal through `applyPlan` with `restoreBatch` rollback and `purgeRetention` sweep (Task 2); the pre-edit `settings.json` copy inside the same batch (Task 2); pure library plus orchestrating `setup.mjs` (Tasks 1–2); both risks filed (Task 2 Step 6). Statusline: updates segment first, naming rather than counting, collapsing beyond two, omitted when empty (Tasks 4–5); the three state cases in priority order (Task 5); shared logic moved to `statusline-lib.mjs` with `rewriteContextBar` left behind (Task 3); empty output on any error (Task 5).

**Deliberately not covered.** Uninstalling `~/.gsd/` or any `.planning/` directory; replacing the native Claude Code update indicator; any session-start enforcement of gsd-core's absence.

**Type consistency.** `buildGsdInventory` emits exactly the five fields `applyPlan` reads, asserted by a test rather than by inspection. `filterGsdHooks` returns a new object and is asserted not to mutate its input, because `setup.mjs` diffs old against new. `pendingCount` is derived from `pendingNames`, so the count and the names cannot disagree.

**Three things a reviewer should push on.**

1. **The GSD state segment is the only part with no evidence behind it.** `.planning/config.json` turned out to hold model configuration, not milestone or phase, so the milestone/phase/status values are read from `STATE.md` with regexes written against a format nobody verified here. The renderer is unit-tested; the *reader* is best-effort and falls through to project+branch when it cannot parse. That degradation is deliberate and is the reason this is shippable, but Task 5 Step 6 must actually be run against a real GSD project before this is called done.
2. **`restoreBatch` does not restore `settings.json`.** The copy inside the batch is a copy, not a moved file. Reversing the hook removal is a manual `cp` that `setup.mjs` prints. That asymmetry is intentional — a rollback that overwrote settings would also undo unrelated edits made since — but it means a rollback is two commands, and only one of them is the documented one.
3. **The detector runs at `setup.mjs` time only.** `/gsd-update` can reinstall gsd-core five minutes later and nothing notices until the next install. That is filed as a risk rather than fixed, and it is worth confirming that is still the right call.
