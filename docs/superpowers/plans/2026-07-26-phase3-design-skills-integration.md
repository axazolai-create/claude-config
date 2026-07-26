# Phase 3 — design-skills integration (Impeccable + Pro Max) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `frontend-design` with Impeccable + a grafted 3-skill Pro Max subset, installed per-project by `/init-stack` on frontend detect and kept fresh (graft re-applied) by the Phase 2 updater.

**Architecture:** A dedicated idempotent orchestrator (`bin/install-design-stack.mjs`) runs the two official installers under an isolated HOME, prunes Pro Max to a subset, registers Impeccable's design hook into the project's `.claude/settings.json` via our own writer, and grafts "query Pro Max first" prose into Impeccable's `reference/*.md`. The Phase 2 update worker gains a `--root` project-scope probe that re-applies the graft after each `impeccable update`.

**Tech Stack:** Node ≥18 ESM (`.mjs`, stdlib only — no npm deps in payload), `node:test` + `node:assert/strict`, existing `variants.mjs` resolver, `hooks/lib/component-registry.mjs` + `component-update-check-run.mjs`.

## Global Constraints

- Payload runtime code is **stdlib-only ESM** — no npm dependencies, no `require`. Match existing `payload/**` style.
- New `*.test.mjs` files are **never shipped** — `variants.json` `alwaysExclude` already carries `**.test.mjs` (do not re-add).
- Both external installers run **only** via the isolation wrapper: scratch `HOME`/`USERPROFILE`, `cwd=<root>`, flags `--providers=claude --scope=project --no-hooks` (Impeccable) / `--ai claude --offline` (Pro Max). Never inherit the real HOME. (RISK-DESIGNSTACK-001)
- Tests must never shell out to real `npx`/`uipro`/`npm` — gate every external call behind `CLAUDE_DESIGN_STACK_SKIP_INSTALL=1` (installer/probe no-op), mirroring the existing `CLAUDE_INIT_STACK_SKIP_SUBPROCESS=1` / `CLAUDE_SETUP_SKIP_PLUGINS=1` patterns.
- Pro Max subset (keep, prune everything else): `["ui-ux-pro-max", "ui-styling", "design-system"]`.
- Every orchestrator step and every worker probe is **fail-soft** (wrapped so one failure warns and continues) and **idempotent**.
- All new files ship in **all three profiles** (full/base/lite) — they are `tier: core` equivalent; verify none is caught by a profile `exclude`.
- Spec of record: `docs/superpowers/specs/2026-07-26-phase3-design-skills-integration-design.md`.

---

## File structure

| File | Responsibility |
|---|---|
| `payload/setting-templates/frontend/_base.json` (modify) | Remove `frontend-design`; add declarative `designStack` block (commands + `keepSkills`). |
| `payload/hooks/lib/impeccable-promax-graft.mjs` (create) | Anchored + sentinel graft of "query Pro Max" prose into Impeccable `reference/*.md`; `applyPromaxGraft`. |
| `payload/bin/lib/design-stack.mjs` (create) | Pure/side-effect helpers: `runInstaller`, `pruneProMaxSkills`, `pythonAvailable`, `registerDesignHook`, `recordBaselineVersions`, `readDesignStackConfig`. |
| `payload/bin/install-design-stack.mjs` (create) | CLI orchestrator wiring the helpers + graft; idempotent, fail-soft; `--root`. |
| `payload/hooks/lib/component-registry.mjs` (modify) | Add `afterUpdate: "promax-graft"` to the `impeccable` entry. |
| `payload/hooks/lib/component-update-check-run.mjs` (modify) | Parse `--root`; project-scope PROBES for `impeccable`/`ui-ux-pro-max`; invoke `afterUpdate` re-graft. |
| `payload/commands/init-stack.md` (modify) | New gated step: on frontend detect, run `install-design-stack.mjs --root .`. |
| Tests (create): `payload/hooks/lib/impeccable-promax-graft.test.mjs`, `payload/bin/lib/design-stack.test.mjs`, `payload/bin/install-design-stack.test.mjs`, `payload/hooks/lib/component-update-check-run.test.mjs` (extend if exists), plus a case in `setup-variants.e2e.test.mjs`. |

---

## Task 1: Template edit — remove frontend-design, add designStack

**Files:**
- Modify: `payload/setting-templates/frontend/_base.json`
- Test: `payload/bin/install-design-stack.test.mjs` (template-shape assertions live here; created in this task, extended later)

**Interfaces:**
- Produces: the `designStack` object shape `{ impeccable: { install: string }, proMax: { install: string, keepSkills: string[] } }` read by `readDesignStackConfig` (Task 5).

- [ ] **Step 1: Write the failing test**

```js
// payload/bin/install-design-stack.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tpl = JSON.parse(readFileSync(join(ROOT, "payload/setting-templates/frontend/_base.json"), "utf8"));

test("frontend/_base.json no longer references frontend-design", () => {
  const raw = JSON.stringify(tpl);
  assert.ok(!raw.includes("frontend-design"), "frontend-design must be fully removed");
});

test("frontend/_base.json declares designStack with the locked Pro Max subset", () => {
  assert.ok(tpl.designStack, "designStack block missing");
  assert.match(tpl.designStack.impeccable.install, /impeccable install .*--scope=project.*--no-hooks/);
  assert.match(tpl.designStack.proMax.install, /uipro init .*--offline/);
  assert.deepEqual(tpl.designStack.proMax.keepSkills, ["ui-ux-pro-max", "ui-styling", "design-system"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/bin/install-design-stack.test.mjs`
Expected: FAIL — `frontend-design` still present; `tpl.designStack` undefined.

- [ ] **Step 3: Edit `_base.json`**

Remove the `"frontend-design@claude-plugins-official": true` line from `merge.enabledPlugins`, remove the entire `frontend-design` object from `plugins[]`, and add this top-level key (sibling of `plugins`/`skills`):

```jsonc
"designStack": {
  "description": "Impeccable (deterministic design detector) + grafted UI-UX-Pro-Max search DB. Installed per-project on frontend detect via bin/install-design-stack.mjs; frontend-design plugin retired.",
  "impeccable": { "install": "npx impeccable install --providers=claude --scope=project --no-hooks" },
  "proMax": {
    "install": "uipro init --ai claude --offline",
    "keepSkills": ["ui-ux-pro-max", "ui-styling", "design-system"]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/bin/install-design-stack.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add payload/setting-templates/frontend/_base.json payload/bin/install-design-stack.test.mjs
git commit -m "feat(phase3): retire frontend-design, declare designStack in frontend template"
```

---

## Task 2: Graft module `impeccable-promax-graft.mjs`

**Files:**
- Create: `payload/hooks/lib/impeccable-promax-graft.mjs`
- Test: `payload/hooks/lib/impeccable-promax-graft.test.mjs`

**Interfaces:**
- Produces: `applyPromaxGraft({ skillsDir }) -> { applied: string[], already: string[], skippedNoAnchor: string[] }`. `skillsDir` is the project's `.claude/skills` dir; it grafts into `<skillsDir>/impeccable/reference/<file>`. Also exports `SENTINEL` (string) and `ANCHORS` (record).

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/impeccable-promax-graft.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPromaxGraft, SENTINEL, ANCHORS } from "./impeccable-promax-graft.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "graft-"));
  const refDir = join(dir, "impeccable", "reference");
  mkdirSync(refDir, { recursive: true });
  for (const [file, anchor] of Object.entries(ANCHORS))
    writeFileSync(join(refDir, file), `# ${file}\n\n${anchor}\nbody\n`);
  return { dir, refDir };
}

test("graft inserts the sentinel into every anchored reference file", () => {
  const { dir, refDir } = fixture();
  const r = applyPromaxGraft({ skillsDir: dir });
  assert.deepEqual(r.applied.sort(), Object.keys(ANCHORS).sort());
  for (const file of Object.keys(ANCHORS))
    assert.ok(readFileSync(join(refDir, file), "utf8").includes(SENTINEL));
  rmSync(dir, { recursive: true, force: true });
});

test("graft is idempotent — second run inserts nothing", () => {
  const { dir } = fixture();
  applyPromaxGraft({ skillsDir: dir });
  const r2 = applyPromaxGraft({ skillsDir: dir });
  assert.deepEqual(r2.applied, []);
  assert.deepEqual(r2.already.sort(), Object.keys(ANCHORS).sort());
  rmSync(dir, { recursive: true, force: true });
});

test("graft re-applies after an update clobber restores the file", () => {
  const { dir, refDir } = fixture();
  applyPromaxGraft({ skillsDir: dir });
  const file = Object.keys(ANCHORS)[0];
  writeFileSync(join(refDir, file), `# ${file}\n\n${ANCHORS[file]}\nbody\n`); // simulate `impeccable update`
  const r = applyPromaxGraft({ skillsDir: dir });
  assert.ok(r.applied.includes(file));
  assert.ok(readFileSync(join(refDir, file), "utf8").includes(SENTINEL));
  rmSync(dir, { recursive: true, force: true });
});

test("missing/renamed reference file is skipped, never corrupted", () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-empty-"));
  mkdirSync(join(dir, "impeccable", "reference"), { recursive: true });
  const r = applyPromaxGraft({ skillsDir: dir });
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.skippedNoAnchor.sort(), Object.keys(ANCHORS).sort());
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/impeccable-promax-graft.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```js
// payload/hooks/lib/impeccable-promax-graft.mjs
// Anchored, idempotent graft of "query Pro Max first" guidance into Impeccable's reference
// docs. Survives `npx impeccable update` (which clobbers reference/*.md) by re-apply from the
// updater's afterUpdate. Same shape as gsd-agent-patches.mjs: sentinel = already-applied guard,
// anchor = where to insert, missing anchor = skip (never corrupt).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SENTINEL = "<!-- promax-graft:v1 -->";

// anchor text must be a stable prose fragment present in each shipped Impeccable reference file.
// Verify against the installed skill during Task 5 integration; update here if upstream changes.
export const ANCHORS = {
  "new-work.md": "## ",
  "shape.md": "## ",
  "colorize.md": "## ",
  "typeset.md": "## ",
};

const GRAFT = `${SENTINEL}
**Query the Pro Max style DB first.** Before proposing visuals, run
\`python .claude/skills/ui-ux-pro-max/scripts/search.py "<design intent>"\` and prefer its
candidate styles / palettes / font-pairings. If python3 or the skill is absent, fall back to the
reference tables below.
`;

export function applyPromaxGraft({ skillsDir }) {
  const refDir = join(skillsDir, "impeccable", "reference");
  const applied = [], already = [], skippedNoAnchor = [];
  for (const [file, anchor] of Object.entries(ANCHORS)) {
    const p = join(refDir, file);
    if (!existsSync(p)) { skippedNoAnchor.push(file); continue; }
    const txt = readFileSync(p, "utf8");
    if (txt.includes(SENTINEL)) { already.push(file); continue; }
    const at = txt.indexOf(anchor);
    if (at < 0) { skippedNoAnchor.push(file); continue; }
    writeFileSync(p, txt.slice(0, at) + GRAFT + "\n" + txt.slice(at), "utf8");
    applied.push(file);
  }
  return { applied, already, skippedNoAnchor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/impeccable-promax-graft.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/impeccable-promax-graft.mjs payload/hooks/lib/impeccable-promax-graft.test.mjs
git commit -m "feat(phase3): anchored idempotent Pro Max graft module"
```

---

## Task 3: Orchestrator helpers `bin/lib/design-stack.mjs`

**Files:**
- Create: `payload/bin/lib/design-stack.mjs`
- Test: `payload/bin/lib/design-stack.test.mjs`

**Interfaces:**
- Produces:
  - `runInstaller(cmd, args, { root, skip }) -> { ok, stdout, stderr, skipped }` — isolated HOME/cwd; when `skip` (or `CLAUDE_DESIGN_STACK_SKIP_INSTALL=1`) returns `{ ok:true, skipped:true }` without spawning.
  - `pruneProMaxSkills(skillsDir, keepSkills, { protect }) -> string[]` (removed dir names). Deletes only dirs created by `uipro init`; never touches `keepSkills`, `impeccable`, or dirs in `protect` (pre-existing unrelated skills).
  - `pythonAvailable() -> boolean`.
  - `registerDesignHook(settingsFile, { scriptPath }) -> { added: boolean }` — idempotent PostToolUse(Edit|Write|MultiEdit)+Stop entry running `node <scriptPath>`.
  - `readDesignStackConfig(root, { templatesDir }) -> designStack|null`.
  - `recordBaselineVersions(root, versions) -> void` (writes `<root>/.claude/state/component-updates.json`).

- [ ] **Step 1: Write the failing test**

```js
// payload/bin/lib/design-stack.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstaller, pruneProMaxSkills, registerDesignHook } from "./design-stack.mjs";

test("runInstaller with skip=true never spawns and reports skipped", () => {
  const r = runInstaller("npx", ["impeccable", "install"], { root: tmpdir(), skip: true });
  assert.deepEqual(r, { ok: true, skipped: true, stdout: "", stderr: "" });
});

test("pruneProMaxSkills removes only non-kept uipro skills, protecting others", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"));
  for (const s of ["ui-ux-pro-max", "ui-styling", "design-system", "design", "brand", "slides", "impeccable", "shadcn"])
    mkdirSync(join(dir, s), { recursive: true });
  const removed = pruneProMaxSkills(dir, ["ui-ux-pro-max", "ui-styling", "design-system"],
    { protect: ["impeccable", "shadcn"] });
  assert.deepEqual(removed.sort(), ["brand", "design", "slides"]);
  for (const keep of ["ui-ux-pro-max", "ui-styling", "design-system", "impeccable", "shadcn"])
    assert.ok(existsSync(join(dir, keep)), `${keep} must survive`);
  rmSync(dir, { recursive: true, force: true });
});

test("registerDesignHook adds Edit|Write|MultiEdit + Stop once (idempotent)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hook-"));
  const settingsFile = join(dir, "settings.json");
  const first = registerDesignHook(settingsFile, { scriptPath: ".claude/skills/impeccable/scripts/hook.mjs" });
  assert.equal(first.added, true);
  const s = JSON.parse(readFileSync(settingsFile, "utf8"));
  const post = s.hooks.PostToolUse.find((e) => e.matcher === "Edit|Write|MultiEdit");
  assert.ok(post, "PostToolUse Edit|Write|MultiEdit entry missing");
  assert.match(post.hooks[0].command, /impeccable\/scripts\/hook\.mjs/);
  assert.ok(Array.isArray(s.hooks.Stop) && s.hooks.Stop.length >= 1, "Stop entry missing");
  const second = registerDesignHook(settingsFile, { scriptPath: ".claude/skills/impeccable/scripts/hook.mjs" });
  assert.equal(second.added, false, "second call must be a no-op");
  const s2 = JSON.parse(readFileSync(settingsFile, "utf8"));
  assert.equal(s2.hooks.PostToolUse.filter((e) => e.matcher === "Edit|Write|MultiEdit").length, 1);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/bin/lib/design-stack.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```js
// payload/bin/lib/design-stack.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const skipInstall = (skip) => skip || process.env.CLAUDE_DESIGN_STACK_SKIP_INSTALL === "1";

// Isolated installer invocation — fresh HOME so Impeccable's "install into all harnesses" default
// finds nothing but the scratch dir; cwd=root + --scope=project confines writes to <root>/.claude.
export function runInstaller(cmd, args, { root, skip = false } = {}) {
  if (skipInstall(skip)) return { ok: true, skipped: true, stdout: "", stderr: "" };
  const scratch = mkdtempSync(join(tmpdir(), "design-stack-home-"));
  const env = { ...process.env, HOME: scratch, USERPROFILE: scratch };
  const r = spawnSync(cmd, args, { cwd: root, env, encoding: "utf8", timeout: 180000, shell: true });
  return { ok: !r.error && r.status === 0, skipped: false, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// Delete every skill dir under skillsDir that isn't kept, isn't impeccable, and isn't a pre-existing
// unrelated skill (protect). Only touches direct child dirs (uipro installs flat).
export function pruneProMaxSkills(skillsDir, keepSkills, { protect = [] } = {}) {
  const keep = new Set([...keepSkills, "impeccable", ...protect]);
  const removed = [];
  if (!existsSync(skillsDir)) return removed;
  for (const e of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!e.isDirectory() || keep.has(e.name)) continue;
    rmSync(join(skillsDir, e.name), { recursive: true, force: true });
    removed.push(e.name);
  }
  return removed;
}

export function pythonAvailable() {
  for (const py of ["python3", "python"]) {
    const r = spawnSync(py, ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return true;
  }
  return false;
}

const MATCHER = "Edit|Write|MultiEdit";
export function registerDesignHook(settingsFile, { scriptPath }) {
  const cmd = `node ${scriptPath}`;
  let s = {};
  if (existsSync(settingsFile)) { try { s = JSON.parse(readFileSync(settingsFile, "utf8")) || {}; } catch { s = {}; } }
  s.hooks = s.hooks || {};
  s.hooks.PostToolUse = s.hooks.PostToolUse || [];
  s.hooks.Stop = s.hooks.Stop || [];
  const hasPost = s.hooks.PostToolUse.some((e) => e.matcher === MATCHER && (e.hooks || []).some((h) => h.command === cmd));
  const hasStop = s.hooks.Stop.some((e) => (e.hooks || []).some((h) => h.command === cmd));
  if (hasPost && hasStop) return { added: false };
  if (!hasPost) s.hooks.PostToolUse.push({ matcher: MATCHER, hooks: [{ type: "command", command: cmd }] });
  if (!hasStop) s.hooks.Stop.push({ hooks: [{ type: "command", command: cmd }] });
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(s, null, 2) + "\n", "utf8");
  return { added: true };
}

export function readDesignStackConfig(root, { templatesDir } = {}) {
  // Prefer the resolved frontend template shipped in ~/.claude; fall back to null (orchestrator
  // then uses built-in defaults). templatesDir defaults to <configDir>/setting-templates.
  const base = templatesDir || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "setting-templates");
  const p = join(base, "frontend", "_base.json");
  if (!existsSync(p)) return null;
  try { return (JSON.parse(readFileSync(p, "utf8")) || {}).designStack || null; } catch { return null; }
}

export function recordBaselineVersions(root, versions) {
  const file = join(root, ".claude", "state", "component-updates.json");
  let state = {};
  if (existsSync(file)) { try { state = JSON.parse(readFileSync(file, "utf8")) || {}; } catch { state = {}; } }
  for (const [name, installed] of Object.entries(versions))
    state[name] = { ...(state[name] || {}), installed, class: "safe", updateAvailable: false, lastCheckedAt: new Date().toISOString() };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/bin/lib/design-stack.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add payload/bin/lib/design-stack.mjs payload/bin/lib/design-stack.test.mjs
git commit -m "feat(phase3): design-stack orchestrator helpers (isolation, prune, hook, versions)"
```

---

## Task 4: CLI orchestrator `bin/install-design-stack.mjs`

**Files:**
- Create: `payload/bin/install-design-stack.mjs`
- Test: extend `payload/bin/install-design-stack.test.mjs`

**Interfaces:**
- Consumes: all `design-stack.mjs` exports (Task 3) + `applyPromaxGraft` (Task 2).
- Produces: `runDesignStack({ root, config, skip }) -> { impeccable, proMax, pruned, hook, graft, python }` (the orchestration result, testable without the CLI wrapper). The CLI (`main`) calls it with `--root` (default cwd) and `CLAUDE_DESIGN_STACK_SKIP_INSTALL` honored via `skip`.

- [ ] **Step 1: Write the failing test** (append to `install-design-stack.test.mjs`)

```js
import { runDesignStack } from "./install-design-stack.mjs";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// With installers skipped, simulate their effect by pre-planting the skill dirs, then assert the
// orchestrator prunes, registers the hook, and grafts — idempotently.
function plantSkills(root) {
  const skills = join(root, ".claude", "skills");
  for (const s of ["ui-ux-pro-max", "ui-styling", "design-system", "design", "brand"])
    mkdirSync(join(skills, s), { recursive: true });
  const refDir = join(skills, "impeccable", "reference");
  mkdirSync(refDir, { recursive: true });
  for (const f of ["new-work.md", "shape.md", "colorize.md", "typeset.md"])
    writeFileSync(join(refDir, f), `# ${f}\n\n## Steps\nbody\n`);
}
const CONFIG = { impeccable: { install: "npx impeccable install --scope=project --no-hooks" },
  proMax: { install: "uipro init --offline", keepSkills: ["ui-ux-pro-max", "ui-styling", "design-system"] } };

test("runDesignStack prunes to subset, registers hook, grafts — idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "ds-root-"));
  plantSkills(root);
  const r1 = runDesignStack({ root, config: CONFIG, skip: true });
  assert.deepEqual(r1.pruned.sort(), ["brand", "design"]);
  assert.equal(r1.hook.added, true);
  assert.ok(r1.graft.applied.length === 4);
  assert.ok(existsSync(join(root, ".claude", "settings.json")));
  assert.ok(readFileSync(join(root, ".claude", "skills", "impeccable", "reference", "shape.md"), "utf8").includes("promax-graft"));
  // second run: nothing to prune, hook already there, graft already applied
  const r2 = runDesignStack({ root, config: CONFIG, skip: true });
  assert.deepEqual(r2.pruned, []);
  assert.equal(r2.hook.added, false);
  assert.deepEqual(r2.graft.applied, []);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/bin/install-design-stack.test.mjs`
Expected: FAIL — `runDesignStack` not exported.

- [ ] **Step 3: Write the orchestrator**

```js
// payload/bin/install-design-stack.mjs
// Idempotent, fail-soft, project-scope design-stack installer. Invoked by /init-stack on frontend
// detect: node install-design-stack.mjs --root <path>. See
// docs/superpowers/specs/2026-07-26-phase3-design-skills-integration-design.md.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInstaller, pruneProMaxSkills, pythonAvailable, registerDesignHook,
         readDesignStackConfig, recordBaselineVersions } from "./lib/design-stack.mjs";
import { applyPromaxGraft } from "../hooks/lib/impeccable-promax-graft.mjs";

const DEFAULT = {
  impeccable: { install: "npx impeccable install --providers=claude --scope=project --no-hooks" },
  proMax: { install: "uipro init --ai claude --offline", keepSkills: ["ui-ux-pro-max", "ui-styling", "design-system"] },
};
const safe = (fn, fallback) => { try { return fn(); } catch (e) { console.error(`  ! ${e.message}`); return fallback; } };
const parts = (s) => s.trim().split(/\s+/);

export function runDesignStack({ root, config, skip = false } = {}) {
  const cfg = config || DEFAULT;
  const skillsDir = join(root, ".claude", "skills");
  const preExisting = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];

  // (a) Impeccable — install only if absent.
  const impPresent = existsSync(join(skillsDir, "impeccable"));
  const [ic, ...ia] = parts(cfg.impeccable.install);
  const impeccable = impPresent ? { ok: true, skipped: true } : safe(() => runInstaller(ic, ia, { root, skip }), { ok: false });

  // (b) Pro Max — install if the core skill is absent, then prune to the subset.
  const pmPresent = existsSync(join(skillsDir, "ui-ux-pro-max"));
  const [pc, ...pa] = parts(cfg.proMax.install);
  const proMax = pmPresent ? { ok: true, skipped: true } : safe(() => runInstaller(pc, pa, { root, skip }), { ok: false });
  const protect = preExisting.filter((n) => n !== "impeccable" && !cfg.proMax.keepSkills.includes(n)
    && !["design", "brand", "banner-design", "banner", "slides"].includes(n)); // don't protect known uipro extras
  const pruned = safe(() => pruneProMaxSkills(skillsDir, cfg.proMax.keepSkills, { protect }), []);

  // (c) design hook — project-scoped registration via our writer.
  const hook = safe(() => registerDesignHook(join(root, ".claude", "settings.json"),
    { scriptPath: ".claude/skills/impeccable/scripts/hook.mjs" }), { added: false });

  // (d) Pro Max graft into Impeccable reference docs.
  const graft = safe(() => applyPromaxGraft({ skillsDir }), { applied: [], already: [], skippedNoAnchor: [] });

  // (e) baseline versions for the updater (best-effort; real versions filled by the probe later).
  safe(() => recordBaselineVersions(root, { impeccable: "installed", "ui-ux-pro-max": "installed" }));

  // (f) python soft-check.
  const python = safe(() => pythonAvailable(), false);
  if (!python) console.error("  ! python3 not found — Pro Max search.py disabled; graft falls back to reference tables.");

  return { impeccable, proMax, pruned, hook, graft, python };
}

function main() {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf("--root");
  const root = ri >= 0 ? argv[ri + 1] : process.cwd();
  const config = readDesignStackConfig(root) || DEFAULT;
  const r = runDesignStack({ root, config });
  console.log(`design-stack: pruned=${r.pruned.length} hook=${r.hook.added ? "added" : "present"} graft=${r.graft.applied.length}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/bin/install-design-stack.test.mjs`
Expected: PASS (Task 1 + this = 3 tests).

- [ ] **Step 5: Commit**

```bash
git add payload/bin/install-design-stack.mjs payload/bin/install-design-stack.test.mjs
git commit -m "feat(phase3): idempotent design-stack orchestrator CLI"
```

---

## Task 5: Live-install integration check (manual, gated) + anchor verification

**Files:**
- Modify: `payload/hooks/lib/impeccable-promax-graft.mjs` (correct `ANCHORS` to real shipped prose if needed)
- Test: none new (manual verification task; deliverable is corrected anchors)

**Interfaces:** none changed unless anchors need real values.

- [ ] **Step 1: Run the real installers in a scratch project** (network required; not in CI)

```bash
mkdir -p /tmp/ds-live && cd /tmp/ds-live && git init -q
HOME=$(mktemp -d) npx impeccable install --providers=claude --scope=project --no-hooks
ls .claude/skills/impeccable/reference/    # discover the real reference filenames
```

- [ ] **Step 2: Verify the graft ANCHORS match real files**

Open each `reference/*.md` the orchestrator targets. Confirm the filenames in `ANCHORS`
(`new-work.md`, `shape.md`, `colorize.md`, `typeset.md`) exist and the anchor string (`"## "`)
appears. If a filename differs, update `ANCHORS` keys; if `"## "` is absent, replace that entry's
anchor with a verbatim heading present in the file. Re-run Task 2's test suite after any edit.

- [ ] **Step 3: Verify Impeccable's hook script path**

Confirm `.claude/skills/impeccable/scripts/hook.mjs` exists (the path `registerDesignHook` writes).
If it moved, update `scriptPath` in Task 4's orchestrator and Task 3's test.

- [ ] **Step 4: Run Pro Max install + confirm prune targets**

```bash
HOME=$(mktemp -d) npx ui-ux-pro-max-cli init --ai claude --offline   # or: uipro init --ai claude --offline
ls .claude/skills/    # confirm the suite dir names to prune (design, brand, banner-design, slides, banner)
```
Update the `known uipro extras` list in Task 4's orchestrator if the real dir names differ.

- [ ] **Step 5: Commit any corrections**

```bash
git add payload/hooks/lib/impeccable-promax-graft.mjs payload/bin/install-design-stack.mjs payload/bin/lib/design-stack.test.mjs
git commit -m "fix(phase3): pin graft anchors + hook path to real Impeccable/Pro Max layout"
```

---

## Task 6: Updater project-scope probe (`--root`, afterUpdate)

**Files:**
- Modify: `payload/hooks/lib/component-registry.mjs`
- Modify: `payload/hooks/lib/component-update-check-run.mjs`
- Test: `payload/hooks/lib/component-update-check-run.test.mjs` (create if absent)

**Interfaces:**
- Consumes: `COMPONENTS` (with new `afterUpdate` field), `applyPromaxGraft` (Task 2).
- Produces: worker parses `--root <path>` (default cwd); project probes for `impeccable`/`ui-ux-pro-max`; after a `safe` auto-`update()`, when `comp.afterUpdate === "promax-graft"`, re-runs `applyPromaxGraft`.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/component-update-check-run.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPONENTS } from "./component-registry.mjs";

test("impeccable registry entry carries afterUpdate=promax-graft", () => {
  const imp = COMPONENTS.find((c) => c.name === "impeccable");
  assert.equal(imp.scope, "project");
  assert.equal(imp.afterUpdate, "promax-graft");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/component-update-check-run.test.mjs`
Expected: FAIL — `afterUpdate` undefined.

- [ ] **Step 3: Add the registry field**

In `component-registry.mjs`, change the `impeccable` line to:

```js
  { name: "impeccable",    scope: "project", kind: "version", updateClass: "safe", legacyEnv: null, afterUpdate: "promax-graft" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/component-update-check-run.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire `--root` + project probes into the worker**

In `component-update-check-run.mjs`: (1) add `import { applyPromaxGraft } from "./impeccable-promax-graft.mjs";`; (2) parse root; (3) add a project PROBES factory; (4) after `probe.update()` invoke the graft. Replace the `main()` head and the update branch:

```js
const argvRoot = (() => { const i = process.argv.indexOf("--root"); return i >= 0 ? process.argv[i + 1] : process.cwd(); })();

function projectProbe(name, root) {
  const skillDir = join(root, ".claude", "skills", name === "ui-ux-pro-max" ? "ui-ux-pro-max" : "impeccable");
  const pkg = name === "impeccable" ? "impeccable" : "ui-ux-pro-max-cli";
  return {
    present: () => existsSync(skillDir),
    check: () => {                       // best-effort; any throw is swallowed by safe() at the call site
      const installed = safe(() => JSON.parse(readFileSync(join(skillDir, "package.json"), "utf8")).version) || "0.0.0";
      const latest = safe(() => spawnSync("npm", ["view", pkg, "version"], { encoding: "utf8" }).stdout.trim()) || installed;
      return { installed, latest, updateAvailable: !!latest && latest !== installed };
    },
    update: () => detached("npx", [pkg === "impeccable" ? "impeccable" : "ui-ux-pro-max-cli", "update"]),
  };
}
```

In the `COMPONENTS` loop, for `comp.scope === "project"` use `projectProbe(comp.name, argvRoot)`; keep the existing `PROBES[comp.name]` for global-scope. After a successful auto-update add:

```js
if (action === "auto" && probe.update) {
  probe.update(); entry.autoUpdated = true;
  if (comp.afterUpdate === "promax-graft")
    safe(() => applyPromaxGraft({ skillsDir: join(argvRoot, ".claude", "skills") }));
}
```

Ensure `readFileSync`, `spawnSync`, `join` are imported (spawnSync/join already are; add `readFileSync` to the `node:fs` import).

- [ ] **Step 6: Add a probe behavior test**

```js
test("projectProbe present() is false when the skill dir is absent (no throw)", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "probe-"));
  // dynamic import of the worker's projectProbe requires it be exported; export it for testability.
  const mod = await import("./component-update-check-run.mjs");
  const probe = mod.projectProbe("impeccable", root);
  assert.equal(probe.present(), false);
  rmSync(root, { recursive: true, force: true });
});
```

Export `projectProbe` from the worker (`export function projectProbe...`) so the test can reach it without spawning the CLI.

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test payload/hooks/lib/component-update-check-run.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add payload/hooks/lib/component-registry.mjs payload/hooks/lib/component-update-check-run.mjs payload/hooks/lib/component-update-check-run.test.mjs
git commit -m "feat(phase3): updater project-scope probe (--root) + afterUpdate re-graft"
```

---

## Task 7: Wire the orchestrator into `/init-stack` (frontend-gated)

**Files:**
- Modify: `payload/commands/init-stack.md`
- Test: none automated (command prose); verified by the Task 8 e2e presence check + manual run.

**Interfaces:** none (invocation wiring only).

- [ ] **Step 1: Add a gated step to `init-stack.md`**

After the interactive install/activate step (`## 3`) and before `## 5. Finish`, insert a new step. Renumber subsequent headings and update any `step N` cross-references (grep the repo for `init-stack` step numbers — RISK-FALLOW-001 documents this drift trap):

```markdown
## 4. Design stack (only if a frontend stack was detected)

If step 1 classified the project as a frontend stack (react / next / react-native / vue / …),
install the per-project design stack — Impeccable + the grafted Pro Max subset:

    node "$CLAUDE_CONFIG_DIR/bin/install-design-stack.mjs" --root .

(Defaults to `~/.claude/bin/...` when `CLAUDE_CONFIG_DIR` is unset.) It is idempotent and
fail-soft — safe to re-run; it installs only what is missing and re-verifies the hook + graft.
Skip entirely for non-frontend stacks.
```

- [ ] **Step 2: Verify no stale step-number references remain**

Run: `grep -rn "step [0-9]" payload/commands/init-stack.md payload/hooks/session-init.mjs payload/README*.md`
Expected: every reference matches the renumbered headings (fix any that shifted). This is a read-check, not a code change unless a mismatch is found.

- [ ] **Step 3: Commit**

```bash
git add payload/commands/init-stack.md
git commit -m "feat(phase3): run design-stack installer as a frontend-gated init-stack step"
```

---

## Task 8: Ship-in-all-profiles + e2e presence guard

**Files:**
- Test: `setup-variants.e2e.test.mjs` (add one case)

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

```js
test("phase3 design-stack files ship in every profile; test files excluded", () => {
  const wanted = [
    "bin/install-design-stack.mjs",
    "bin/lib/design-stack.mjs",
    "hooks/lib/impeccable-promax-graft.mjs",
  ];
  for (const variant of ["full", "base", "lite"]) {
    const v = resolveVariant({ repoRoot: ROOT, variant });
    for (const f of wanted) assert.ok(v.rels.includes(f), `${f} must ship in ${variant}`);
    assert.ok(!v.rels.some((r) => r.endsWith(".test.mjs")), `no test files in ${variant}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `node --test setup-variants.e2e.test.mjs`
Expected: PASS if the new files aren't caught by any `exclude` (they shouldn't be — none match a base/lite exclude glob). If a file is missing from a profile, FAIL → inspect `variants.json` `exclude` for an accidental match and narrow it. Do **not** add these files to any `exclude`.

- [ ] **Step 3: Run the full payload test sweep**

Run: `node --test payload/**/*.test.mjs setup-variants.e2e.test.mjs` (or the repo's test runner)
Expected: all green — the pre-existing 222 component-update tests + variants e2e + the 4 new Phase 3 suites.

- [ ] **Step 4: Update graphify graph**

Run: `graphify update .`
Expected: graph reflects the new files (AST-only, no API cost).

- [ ] **Step 5: Commit**

```bash
git add setup-variants.e2e.test.mjs graphify-out/
git commit -m "test(phase3): guard design-stack files ship in all profiles"
```

---

## Self-review

**Spec coverage:**
- D1 (remove frontend-design) → Task 1. D2 (isolated Impeccable install) → Task 3 `runInstaller` + Task 4. D3 (Pro Max subset + prune) → Task 1 config + Task 3 `pruneProMaxSkills` + Task 4. D4 (project-scoped hook via our writer, `--no-hooks`) → Task 3 `registerDesignHook` + Task 4. D5 (graft + afterUpdate re-apply) → Task 2 + Task 6. D6 (python soft-degrade) → Task 3 `pythonAvailable` + Task 4 warning + graft prose. D7 (updater project-probe) → Task 6. D8 (dedicated orchestrator, gated init-stack step) → Task 4 + Task 7. Units U1–U5 all mapped. Risks DS-001..006 all mitigated by a task (isolation T3/T4, afterUpdate T6, python T3/T4, hook re-register T4/T7, subset prune T3/T4, fail-soft check() T6).
- Live-layout uncertainty (real reference filenames, hook path, uipro dir names) is explicitly a task (Task 5) rather than an assumption.

**Placeholder scan:** no TBD/TODO; every code step has real code; the only manual task (Task 5) is a verification-and-correct task with concrete commands, not a placeholder.

**Type consistency:** `applyPromaxGraft({ skillsDir })` used identically in Tasks 2, 4, 6. `runInstaller(cmd, args, { root, skip })`, `pruneProMaxSkills(skillsDir, keepSkills, { protect })`, `registerDesignHook(settingsFile, { scriptPath })`, `runDesignStack({ root, config, skip })` consistent across defining/consuming tasks. `keepSkills` value identical in Task 1 and the orchestrator DEFAULT.

**Open risk for the executor:** Task 5 may force anchor/path corrections that ripple into Task 2/3/4 tests — run those suites after Task 5 edits.
