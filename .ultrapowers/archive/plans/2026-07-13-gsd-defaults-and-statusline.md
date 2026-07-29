# GSD Global Defaults Sync + Statusline Context-Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the user's curated personal GSD config (`gsd-defaults.partial.json`) into gsd-core's native `~/.gsd/defaults.json` and into any current project's `.planning/config.json`, and replace the gsd-core-managed statusline's context-window bar with a token-count display — both wired into `setup.mjs` and `/init-stack`, both surviving `gsd-core` updates.

**Architecture:** Two independent feature pairs sharing one delivery pattern: pure merge/format logic lives in small `payload/hooks/lib/*.mjs` modules (unit-tested with Node's built-in test runner, no new dependencies), thin I/O/CLI wrappers call them, and both `setup.mjs` (machine-wide, interactive-capable) and a new non-interactive CLI script invoked from `/init-stack` (project-wide, safe-default behavior) call the same library functions so behavior never diverges between the two entry points.

**Tech Stack:** Plain Node.js (ESM `.mjs`, no npm dependencies — this repo ships no `package.json`), Node's built-in test runner (`node --test`, available Node 18+; this machine runs Node 25).

## Global Constraints

- No new npm dependencies — this repo has no `package.json` and is installed by unpacking + running `node setup.mjs` directly (see `setup.mjs:1-33` header comment). Use only `node:*` built-ins.
- Small helper functions that duplicate logic already in `setup.mjs` or `payload/hooks/gsd-config-patch.mjs` (deep-merge, `findRoot`, JSON-with-BOM read) are **reimplemented locally, not cross-imported** — matches this repo's existing convention (see `gsd-config-patch.mjs`'s own comment on duplicating `findRoot()`).
- `syncGsdGlobalDefaults` (target `~/.gsd/defaults.json`): deep-additive merge, **existing user values win**, missing keys/array items added. Silent, best-effort, no diff/prompt.
- `syncProjectConfig` (target `<project>/.planning/config.json`): **reference wins** on any key it defines; keys absent from the reference are left completely untouched. No-op (not an error) when `.planning/` doesn't exist. Runs on every invocation — no one-time state gate.
- The statusline wrapper must **never break the statusline** — any failure (spawn error, bad JSON, regex miss) falls through to printing whatever the original script produced, or nothing, but never throws past the top level.
- The non-interactive CLI path (used by `/init-stack`) only takes over `statusLine.command` when it's unset or already gsd-core's own `gsd-statusline.js`; a genuinely custom value is left untouched and reported. `setup.mjs`'s own interactive path may rely on its existing diff+prompt UX instead of this guard (the user sees the change before it applies).
- Tests: `node --test <file>` (built-in runner, `node:assert/strict` + `node:test`). New unit tests live under `.test/unit/` (mirrors this repo's existing `.test/` convention for test-only content that is never shipped in `payload/`). Pure logic is unit-tested; process-spawning/stdin-stdout wrappers and `setup.mjs`/`init-stack.md` wiring are verified manually (`--dry-run`, then a real run against a scratch home dir) — matches this repo's stated "boundary trust" testing convention (`.claude/stack-rules.md`: pure wiring/config is covered by the integration it enables, not a dedicated unit test on itself) and its existing verification pattern (`.test/setup-envs.mjs`).

---

### Task 1: `gsd-defaults.partial.json` — curated source content

**Files:**
- Create: `gsd-defaults.partial.json` (repo root, sibling of `settings.partial.json`)

**Interfaces:**
- Produces: a static JSON object every later task reads by parsing this file. No functions.

- [ ] **Step 1: Write the file**

```json
{
  "mode": "interactive",
  "granularity": "fine",
  "model_profile": "adaptive",
  "models": {
    "planning": "opus",
    "discuss": "sonnet",
    "research": "sonnet",
    "execution": "sonnet",
    "verification": "opus",
    "completion": "sonnet"
  },
  "model_overrides": {
    "gsd-planner": "opus",
    "gsd-roadmapper": "opus",
    "gsd-pattern-mapper": "haiku",
    "gsd-phase-researcher": "sonnet",
    "gsd-project-researcher": "sonnet",
    "gsd-research-synthesizer": "haiku",
    "gsd-codebase-mapper": "opus",
    "gsd-ui-researcher": "opus",
    "gsd-verifier": "sonnet",
    "gsd-plan-checker": "sonnet",
    "gsd-integration-checker": "haiku",
    "gsd-nyquist-auditor": "haiku",
    "gsd-ui-checker": "haiku",
    "gsd-ui-auditor": "haiku",
    "gsd-doc-verifier": "haiku",
    "gsd-code-reviewer": "opus",
    "gsd-security-auditor": "opus",
    "gsd-debugger": "opus",
    "gsd-executor": "sonnet",
    "gsd-code-fixer": "sonnet",
    "gsd-doc-writer": "opus"
  },
  "commit_docs": true,
  "parallelization": true,
  "branching_strategy": "phase",
  "quick_branch_template": null,
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true,
    "auto_advance": false,
    "nyquist_validation": true,
    "pattern_mapper": true,
    "ui_phase": true,
    "ui_safety_gate": true,
    "ai_integration_phase": true,
    "tdd_mode": true,
    "code_review": true,
    "code_review_depth": "standard",
    "ui_review": false,
    "skip_discuss": false,
    "use_worktrees": true
  },
  "plan_review": { "source_grounding": true },
  "intel": { "enabled": true },
  "features": { "global_learnings": true },
  "graphify": { "enabled": true, "auto_update": true },
  "git": { "create_tag": true },
  "hooks": { "context_warnings": true }
}
```

- [ ] **Step 2: Validate it parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('gsd-defaults.partial.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add gsd-defaults.partial.json
git commit -m "feat: add curated gsd-defaults.partial.json source content"
```

---

### Task 2: `gsd-defaults-sync.mjs` lib — pure merge/root-finding functions

**Files:**
- Create: `payload/hooks/lib/gsd-defaults-sync.mjs`
- Test: `.test/unit/gsd-defaults-sync.test.mjs`

**Interfaces:**
- Consumes: nothing (pure functions + `node:fs`/`node:path` built-ins).
- Produces:
  - `deepMergeExistingWins(base, add) -> mergedValue` (objects/arrays/scalars; existing `base` wins on scalar conflicts, deep merges plain objects, unions arrays by `JSON.stringify` identity)
  - `mergeReferenceWins(target, patch) -> target` (mutates and returns `target`; one level of nested-object merge, patch wins on every key it defines, `target` keys `patch` doesn't mention are untouched)
  - `findProjectRoot(startDir) -> absolutePath` (walks up from `startDir` looking for `.planning`, `.git`, `package.json`, `pyproject.toml`, `go.mod`, `build.gradle.kts`; returns `resolve(startDir)` if none found within 40 levels)

- [ ] **Step 1: Write the failing tests**

```javascript
// .test/unit/gsd-defaults-sync.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deepMergeExistingWins,
  mergeReferenceWins,
  findProjectRoot,
} from "../../payload/hooks/lib/gsd-defaults-sync.mjs";

test("deepMergeExistingWins: existing scalar wins over incoming", () => {
  const result = deepMergeExistingWins({ a: 1 }, { a: 2, b: 3 });
  assert.deepEqual(result, { a: 1, b: 3 });
});

test("deepMergeExistingWins: recurses into nested plain objects", () => {
  const result = deepMergeExistingWins(
    { workflow: { research: false } },
    { workflow: { research: true, verifier: true } }
  );
  assert.deepEqual(result, { workflow: { research: false, verifier: true } });
});

test("deepMergeExistingWins: unions arrays without duplicating existing items", () => {
  const result = deepMergeExistingWins({ tags: ["a", "b"] }, { tags: ["b", "c"] });
  assert.deepEqual(result, { tags: ["a", "b", "c"] });
});

test("mergeReferenceWins: patch scalar overwrites target scalar", () => {
  const target = { branching_strategy: "none" };
  mergeReferenceWins(target, { branching_strategy: "phase" });
  assert.equal(target.branching_strategy, "phase");
});

test("mergeReferenceWins: nested object merges key-by-key, patch wins per key", () => {
  const target = { workflow: { research: false, code_review: true, project_only: "keep" } };
  mergeReferenceWins(target, { workflow: { research: true, code_review: false } });
  assert.deepEqual(target.workflow, { research: true, code_review: false, project_only: "keep" });
});

test("mergeReferenceWins: keys the patch never mentions are left untouched", () => {
  const target = { project_code: "CK", ship: { pr_body_sections: [] } };
  mergeReferenceWins(target, { commit_docs: true });
  assert.deepEqual(target, { project_code: "CK", ship: { pr_body_sections: [] }, commit_docs: true });
});

test("mergeReferenceWins: returns the mutated target", () => {
  const target = {};
  const result = mergeReferenceWins(target, { a: 1 });
  assert.equal(result, target);
});

test("findProjectRoot: finds a directory containing .planning walking upward", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  const projectRoot = join(base, "project");
  const nested = join(projectRoot, "sub", "deep");
  mkdirSync(join(projectRoot, ".planning"), { recursive: true });
  mkdirSync(nested, { recursive: true });
  try {
    assert.equal(findProjectRoot(nested), projectRoot);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("findProjectRoot: falls back to resolve(startDir) when nothing found", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  try {
    assert.equal(findProjectRoot(base), base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test .test/unit/gsd-defaults-sync.test.mjs`
Expected: FAIL — `Cannot find module '../../payload/hooks/lib/gsd-defaults-sync.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// payload/hooks/lib/gsd-defaults-sync.mjs
// Deploys gsd-defaults.partial.json into gsd-core's own global-defaults file
// (~/.gsd/defaults.json) and into a project's .planning/config.json.
// Small helpers (deep merge, project-root walk) are deliberately duplicated from
// setup.mjs / gsd-config-patch.mjs rather than cross-imported - same convention
// gsd-config-patch.mjs itself already uses for findRoot().
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

/** Deep-additive merge: existing `base` values win, missing keys/array items are added. */
export function deepMergeExistingWins(base, add) {
  if (Array.isArray(base) && Array.isArray(add)) {
    const seen = new Set(base.map((v) => JSON.stringify(v)));
    const out = base.slice();
    for (const v of add) {
      const k = JSON.stringify(v);
      if (!seen.has(k)) { out.push(v); seen.add(k); }
    }
    return out;
  }
  if (isObj(base) && isObj(add)) {
    const out = { ...base };
    for (const k of Object.keys(add)) out[k] = k in base ? deepMergeExistingWins(base[k], add[k]) : add[k];
    return out;
  }
  return base;
}

/** One-level-nested merge: `patch` wins on every key it defines; target's own keys survive. */
export function mergeReferenceWins(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object" || Array.isArray(target[k])) target[k] = {};
      Object.assign(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/** Walks up from startDir looking for a project-root marker. Falls back to resolve(startDir). */
export function findProjectRoot(startDir) {
  let cur = resolve(startDir);
  for (let i = 0; i < 40; i++) {
    for (const m of [".planning", ".git", "package.json", "pyproject.toml", "go.mod", "build.gradle.kts"])
      if (existsSync(join(cur, m))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(startDir);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test .test/unit/gsd-defaults-sync.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/gsd-defaults-sync.mjs .test/unit/gsd-defaults-sync.test.mjs
git commit -m "feat: add pure merge/root-finding helpers for gsd-defaults sync"
```

---

### Task 3: `gsd-defaults-sync.mjs` lib — I/O sync functions

**Files:**
- Modify: `payload/hooks/lib/gsd-defaults-sync.mjs` (append to the file created in Task 2)
- Test: `.test/unit/gsd-defaults-sync.test.mjs` (append)

**Interfaces:**
- Consumes: `deepMergeExistingWins`, `mergeReferenceWins` from Task 2 (same file, no import needed).
- Produces:
  - `syncGsdGlobalDefaults({ homeDir, partial }) -> { path, changed: boolean }`
  - `syncProjectConfig({ projectRoot, partial }) -> { path, changed: boolean } | { skipped: true, reason: string }`

- [ ] **Step 1: Write the failing tests**

```javascript
// appended to .test/unit/gsd-defaults-sync.test.mjs
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import {
  syncGsdGlobalDefaults,
  syncProjectConfig,
} from "../../payload/hooks/lib/gsd-defaults-sync.mjs";

test("syncGsdGlobalDefaults: creates ~/.gsd/defaults.json when absent", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  try {
    const result = syncGsdGlobalDefaults({ homeDir: home, partial: { commit_docs: true } });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(home, ".gsd", "defaults.json"), "utf8"));
    assert.deepEqual(written, { commit_docs: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncGsdGlobalDefaults: existing user value is not overwritten", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  mkdirSync(join(home, ".gsd"), { recursive: true });
  writeFileSync(join(home, ".gsd", "defaults.json"), JSON.stringify({ model_profile: "balanced" }));
  try {
    const result = syncGsdGlobalDefaults({ homeDir: home, partial: { model_profile: "adaptive", commit_docs: true } });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(home, ".gsd", "defaults.json"), "utf8"));
    assert.equal(written.model_profile, "balanced");
    assert.equal(written.commit_docs, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncGsdGlobalDefaults: no-op (changed:false) when already a superset", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  mkdirSync(join(home, ".gsd"), { recursive: true });
  writeFileSync(join(home, ".gsd", "defaults.json"), JSON.stringify({ commit_docs: true }, null, 2) + "\n");
  try {
    const result = syncGsdGlobalDefaults({ homeDir: home, partial: { commit_docs: true } });
    assert.equal(result.changed, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncProjectConfig: skips when .planning directory is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  try {
    const result = syncProjectConfig({ projectRoot: root, partial: { commit_docs: true } });
    assert.equal(result.skipped, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncProjectConfig: reference wins on overlapping keys, other fields untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  mkdirSync(join(root, ".planning"), { recursive: true });
  writeFileSync(
    join(root, ".planning", "config.json"),
    JSON.stringify({ project_code: "CK", workflow: { code_review: false, tdd_mode: false } }, null, 2)
  );
  try {
    const result = syncProjectConfig({
      projectRoot: root,
      partial: { workflow: { code_review: true, tdd_mode: true } },
    });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(root, ".planning", "config.json"), "utf8"));
    assert.equal(written.project_code, "CK");
    assert.deepEqual(written.workflow, { code_review: true, tdd_mode: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncProjectConfig: no-op (changed:false) when config already matches reference", () => {
  const root = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  mkdirSync(join(root, ".planning"), { recursive: true });
  writeFileSync(join(root, ".planning", "config.json"), JSON.stringify({ commit_docs: true }, null, 2) + "\n");
  try {
    const result = syncProjectConfig({ projectRoot: root, partial: { commit_docs: true } });
    assert.equal(result.changed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test .test/unit/gsd-defaults-sync.test.mjs`
Expected: FAIL — `syncGsdGlobalDefaults is not a function` (and similar for `syncProjectConfig`)

- [ ] **Step 3: Append the implementation**

```javascript
// appended to payload/hooks/lib/gsd-defaults-sync.mjs
const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

/** Deep-additive-merges `partial` into ~/.gsd/defaults.json. Existing user values win. */
export function syncGsdGlobalDefaults({ homeDir, partial }) {
  const dir = join(homeDir, ".gsd");
  const path = join(dir, "defaults.json");
  const cur = existsSync(path) ? (safe(() => readJSON(path)) ?? {}) : {};
  const merged = deepMergeExistingWins(cur, partial);
  const curStr = JSON.stringify(cur, null, 2);
  const mergedStr = JSON.stringify(merged, null, 2);
  if (curStr === mergedStr) return { path, changed: false };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, mergedStr + "\n");
  return { path, changed: true };
}

/** Reference-wins-merges `partial` into <projectRoot>/.planning/config.json, if it exists. */
export function syncProjectConfig({ projectRoot, partial }) {
  const planningDir = join(projectRoot, ".planning");
  if (!existsSync(planningDir)) return { skipped: true, reason: "no .planning directory" };
  const path = join(planningDir, "config.json");
  if (!existsSync(path)) return { skipped: true, reason: "no .planning/config.json" };
  const cur = safe(() => readJSON(path));
  if (cur === undefined || typeof cur !== "object" || cur === null)
    return { skipped: true, reason: "config.json unreadable or invalid JSON" };
  const before = JSON.stringify(cur, null, 2);
  mergeReferenceWins(cur, partial);
  const after = JSON.stringify(cur, null, 2);
  if (before === after) return { path, changed: false };
  writeFileSync(path, after + "\n");
  return { path, changed: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test .test/unit/gsd-defaults-sync.test.mjs`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/gsd-defaults-sync.mjs .test/unit/gsd-defaults-sync.test.mjs
git commit -m "feat: add global-defaults and project-config sync I/O functions"
```

---

### Task 4: `settings.partial.json` — register the statusline wrapper

**Files:**
- Modify: `settings.partial.json`

**Interfaces:**
- Produces: a `statusLine` top-level key that `setup.mjs`'s existing settings.json merge block (Task 9) reads as `partial.statusLine`.

- [ ] **Step 1: Add the key**

Add this top-level key to `settings.partial.json` (after `"permissions"`, before the closing brace) — uses the same `<HOME>` placeholder convention `setup.mjs` already substitutes for every hook entry in this file:

```json
  ,
  "statusLine": {
    "type": "command",
    "command": "node <HOME>/.claude/hooks/gsd-context-meter.mjs"
  }
```

Resulting file (full, for reference — only the new `statusLine` block is added, `hooks`/`permissions` unchanged):

```json
{
  "_comment": "Reference only. Prefer `node setup.mjs` (merges these keys into your existing ~/.claude/settings.json and fills absolute paths). Manual merge: ADD these keys, keep your model/enabledPlugins/language. Replace <HOME> with your real home dir (Linux/macOS: /home/you ; Windows JSON: C:\\\\Users\\\\you). NOTE: no global claudeMdExcludes here on purpose - .planning/CLAUDE.md may be your curated file. If a specific project's .planning/CLAUDE.md is GSD-owned and unwanted at load, add  \"claudeMdExcludes\": [\"**/.planning/CLAUDE.md\"]  to THAT project's .claude/settings.json only.",
  "hooks": { "...": "unchanged, see current file" },
  "permissions": { "deny": ["Edit(~/.claude/CLAUDE.md)", "Write(~/.claude/CLAUDE.md)"] },
  "statusLine": {
    "type": "command",
    "command": "node <HOME>/.claude/hooks/gsd-context-meter.mjs"
  }
}
```

- [ ] **Step 2: Validate it parses after `<HOME>` substitution**

Run: `node -e "const raw=require('fs').readFileSync('settings.partial.json','utf8'); const home=require('os').homedir(); JSON.parse(raw.split('<HOME>').join(JSON.stringify(home).slice(1,-1))); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add settings.partial.json
git commit -m "feat: register gsd-context-meter.mjs as the statusLine command in settings.partial.json"
```

---

### Task 5: `gsd-context-meter-lib.mjs` — pure token-count formatting/rewrite functions

**Files:**
- Create: `payload/hooks/lib/gsd-context-meter-lib.mjs`
- Test: `.test/unit/gsd-context-meter-lib.test.mjs`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces:
  - `formatTokenCount(n) -> string` (e.g. `250000 -> "250k"`)
  - `computeUsedTokenMetrics(data) -> { totalCtx: number, used: number } | null` (mirrors `gsd-statusline.js`'s own buffer-normalized percentage calc; `data` is the statusline JSON payload; returns `null` when `data.context_window.remaining_percentage` is absent)
  - `rewriteContextBar(text, { totalCtx, used }) -> string` (replaces the first ANSI block-bar segment found in `text` with a token-count segment in the same color; returns `text` unchanged if no bar segment matches)

- [ ] **Step 1: Write the failing tests**

```javascript
// .test/unit/gsd-context-meter-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTokenCount,
  computeUsedTokenMetrics,
  rewriteContextBar,
} from "../../payload/hooks/lib/gsd-context-meter-lib.mjs";

test("formatTokenCount: rounds to nearest thousand with a 'k' suffix", () => {
  assert.equal(formatTokenCount(250000), "250k");
  assert.equal(formatTokenCount(1000000), "1000k");
  assert.equal(formatTokenCount(1499), "1k");
});

test("computeUsedTokenMetrics: returns null when remaining_percentage is absent", () => {
  assert.equal(computeUsedTokenMetrics({ context_window: {} }), null);
  assert.equal(computeUsedTokenMetrics({}), null);
});

test("computeUsedTokenMetrics: computes buffer-normalized used% and totalCtx", () => {
  const data = { context_window: { remaining_percentage: 90, total_tokens: 1000000 } };
  const result = computeUsedTokenMetrics(data);
  assert.equal(result.totalCtx, 1000000);
  // remaining=90, buffer=16.5 (default) -> usableRemaining = ((90-16.5)/(100-16.5))*100 = ~88.02 -> used = round(100-88.02) = 12
  assert.equal(result.used, 12);
});

test("computeUsedTokenMetrics: defaults total_tokens to 1_000_000 when absent", () => {
  const data = { context_window: { remaining_percentage: 50 } };
  const result = computeUsedTokenMetrics(data);
  assert.equal(result.totalCtx, 1000000);
});

test("rewriteContextBar: replaces a green (<50%) bar segment with token counts, same color", () => {
  const original = "model | \x1b[32m████░░░░░░ 42%\x1b[0m | dir";
  const result = rewriteContextBar(original, { totalCtx: 1000000, used: 42 });
  assert.equal(result, "model | \x1b[32m[420k/1000k] 42%\x1b[0m | dir");
});

test("rewriteContextBar: preserves the skull-emoji prefix on the >=80% red segment", () => {
  const original = "model | \x1b[5;31m💀 ██████████ 92%\x1b[0m | dir";
  const result = rewriteContextBar(original, { totalCtx: 200000, used: 92 });
  assert.equal(result, "model | \x1b[5;31m💀 [184k/200k] 92%\x1b[0m | dir");
});

test("rewriteContextBar: returns text unchanged when no bar segment is present", () => {
  const original = "model | no context segment here | dir";
  assert.equal(rewriteContextBar(original, { totalCtx: 1000000, used: 42 }), original);
});

test("rewriteContextBar: returns text unchanged when metrics are missing", () => {
  const original = "model | \x1b[32m████░░░░░░ 42%\x1b[0m | dir";
  assert.equal(rewriteContextBar(original, { totalCtx: null, used: null }), original);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test .test/unit/gsd-context-meter-lib.test.mjs`
Expected: FAIL — `Cannot find module '../../payload/hooks/lib/gsd-context-meter-lib.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// payload/hooks/lib/gsd-context-meter-lib.mjs
// Pure logic for the statusline context-meter override (see payload/hooks/gsd-context-meter.mjs).
// computeUsedTokenMetrics deliberately duplicates ~/.claude/hooks/gsd-statusline.js's own
// buffer-normalization math rather than importing gsd-core internals - that file is
// gsd-core-managed and versioned, its internals aren't a stable import surface.

/** e.g. 250000 -> "250k" */
export function formatTokenCount(n) {
  return `${Math.round(n / 1000)}k`;
}

/**
 * Mirrors gsd-statusline.js's context-window bar math: normalizes `remaining_percentage`
 * against Claude Code's autocompact buffer (16.5% default, or derived from
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW when set) to get the same `used` percentage the
 * original bar displays.
 */
export function computeUsedTokenMetrics(data) {
  const remaining = data && data.context_window && data.context_window.remaining_percentage;
  if (remaining == null) return null;
  const totalCtx = (data.context_window && data.context_window.total_tokens) || 1_000_000;
  const acw = parseInt(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || "0", 10);
  const AUTO_COMPACT_BUFFER_PCT = acw > 0
    ? Math.min(100, Math.max(0, (1 - acw / totalCtx) * 100))
    : 16.5;
  const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
  const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
  return { totalCtx, used };
}

// Matches gsd-statusline.js's exact bar output: ` \x1b[<color>m` + optional `💀 ` +
// 10 block/shade chars + ` NN%` + `\x1b[0m`. Color and skull-prefix are captured so the
// replacement keeps the same color/urgency signal; the bar chars and percent number are
// not captured - percent comes from the caller's own `used` (same value already printed),
// guaranteeing the displayed % and the token ratio never disagree.
const BAR_RE = /\x1b\[([\d;]+)m(💀 )?[█░]{10} \d+%\x1b\[0m/;

/** Replaces the context bar segment in `text` with a token-count segment, same color. */
export function rewriteContextBar(text, { totalCtx, used }) {
  if (typeof text !== "string" || totalCtx == null || used == null) return text;
  const usedTokens = Math.round((totalCtx * used) / 100);
  return text.replace(
    BAR_RE,
    (_match, color, skull) =>
      `\x1b[${color}m${skull || ""}[${formatTokenCount(usedTokens)}/${formatTokenCount(totalCtx)}] ${used}%\x1b[0m`
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test .test/unit/gsd-context-meter-lib.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/gsd-context-meter-lib.mjs .test/unit/gsd-context-meter-lib.test.mjs
git commit -m "feat: add pure token-count formatting/rewrite functions for statusline meter"
```

---

### Task 6: `gsd-context-meter.mjs` — the executable statusLine wrapper

**Files:**
- Create: `payload/hooks/gsd-context-meter.mjs`

**Interfaces:**
- Consumes: `computeUsedTokenMetrics`, `rewriteContextBar` from Task 5 (`./lib/gsd-context-meter-lib.mjs`).
- Produces: an executable entry point (registered as `statusLine.command`); no exports consumed by later tasks.

- [ ] **Step 1: Write the implementation**

```javascript
#!/usr/bin/env node
// Registered as statusLine.command (see settings.partial.json) instead of gsd-core's own
// ~/.claude/hooks/gsd-statusline.js directly. Calls the original as a black box - so the
// model/task/milestone-bar segments always match whatever gsd-core currently ships - and
// rewrites only the context-window bar segment to a token-count display. Must never break
// the statusline: any failure falls through to the original's raw output (or nothing).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeUsedTokenMetrics, rewriteContextBar } from "./lib/gsd-context-meter-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let output = "";
  try {
    const original = spawnSync(process.execPath, [join(here, "gsd-statusline.js")], {
      input,
      encoding: "utf8",
    });
    output = original.stdout || "";
  } catch {
    // Original script missing/broken - nothing to rewrite, print nothing rather than throw.
  }

  try {
    const data = JSON.parse(input);
    const metrics = computeUsedTokenMetrics(data);
    if (metrics) output = rewriteContextBar(output, metrics);
  } catch {
    // Bad input JSON or compute failure - keep the original's output unmodified.
  }

  process.stdout.write(output);
});
```

- [ ] **Step 2: Manual verification (no automated test — process-spawning I/O shell; pure logic already covered in Task 5)**

This step requires a real installed `~/.claude/hooks/gsd-statusline.js` next to the new file, so it can only be exercised after Task 9 installs both into the same directory. Run it now against a fixture to confirm the wiring at least doesn't crash on missing input:

Run: `echo '{}' | node payload/hooks/gsd-context-meter.mjs`
Expected: prints whatever `node payload/hooks/gsd-context-meter.js`'s sibling `gsd-statusline.js` would print for an empty payload (or nothing, if that file isn't present yet in `payload/hooks/` — it never will be, since it's gsd-core's file, not ours; this is expected to no-op silently here). No stack trace, no thrown error, process exits 0.

Full end-to-end verification (real `gsd-statusline.js` present, real context data) happens in Task 9's manual verification step, after `setup.mjs` has installed this file into `~/.claude/hooks/` alongside gsd-core's own `gsd-statusline.js`.

- [ ] **Step 3: Commit**

```bash
git add payload/hooks/gsd-context-meter.mjs
git commit -m "feat: add gsd-context-meter.mjs statusline wrapper"
```

---

### Task 7: `gsd-statusline-registration.mjs` — safe non-interactive statusLine takeover

**Files:**
- Create: `payload/hooks/lib/gsd-statusline-registration.mjs`
- Test: `.test/unit/gsd-statusline-registration.test.mjs`

**Interfaces:**
- Consumes: nothing (own `node:fs`/`node:path` built-ins).
- Produces: `ensureStatuslineOverride({ claudeDir }) -> { changed: boolean, reason: string }`

- [ ] **Step 1: Write the failing tests**

```javascript
// .test/unit/gsd-statusline-registration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStatuslineOverride } from "../../payload/hooks/lib/gsd-statusline-registration.mjs";

function withClaudeDir(fn) {
  const claudeDir = mkdtempSync(join(tmpdir(), "gsd-statusline-reg-test-"));
  try {
    return fn(claudeDir);
  } finally {
    rmSync(claudeDir, { recursive: true, force: true });
  }
}

test("ensureStatuslineOverride: no-op when settings.json is missing", () => {
  withClaudeDir((claudeDir) => {
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, false);
  });
});

test("ensureStatuslineOverride: sets statusLine when absent", () => {
  withClaudeDir((claudeDir) => {
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ model: "sonnet" }));
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    assert.match(written.statusLine.command, /gsd-context-meter\.mjs/);
    assert.equal(written.model, "sonnet");
  });
});

test("ensureStatuslineOverride: takes over from gsd-core's own gsd-statusline.js", () => {
  withClaudeDir((claudeDir) => {
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({ statusLine: { type: "command", command: `node "${claudeDir}/hooks/gsd-statusline.js"` } })
    );
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    assert.match(written.statusLine.command, /gsd-context-meter\.mjs/);
  });
});

test("ensureStatuslineOverride: no-op when already pointing at our wrapper", () => {
  withClaudeDir((claudeDir) => {
    const wanted = `node "${join(claudeDir, "hooks", "gsd-context-meter.mjs").replace(/\\/g, "/")}"`;
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: wanted } }));
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, false);
  });
});

test("ensureStatuslineOverride: leaves a genuinely custom statusLine command untouched", () => {
  withClaudeDir((claudeDir) => {
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({ statusLine: { type: "command", command: "node /my/own/custom-statusline.js" } })
    );
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, false);
    const written = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    assert.equal(written.statusLine.command, "node /my/own/custom-statusline.js");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test .test/unit/gsd-statusline-registration.test.mjs`
Expected: FAIL — `Cannot find module '../../payload/hooks/lib/gsd-statusline-registration.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// payload/hooks/lib/gsd-statusline-registration.mjs
// Non-interactive counterpart to setup.mjs's own (diff+prompt-driven) statusLine handling
// in its settings.json merge block - used by the CLI wrapper invoked from /init-stack,
// which has no interactive prompt to fall back on, so it only ever takes over from an
// unset value or from gsd-core's own default (gsd-statusline.js); anything else is left
// untouched and reported, never silently clobbered.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };

function desiredCommand(claudeDir) {
  const scriptPath = join(claudeDir, "hooks", "gsd-context-meter.mjs").replace(/\\/g, "/");
  return `node "${scriptPath}"`;
}

export function ensureStatuslineOverride({ claudeDir }) {
  const settingsPath = join(claudeDir, "settings.json");
  if (!existsSync(settingsPath)) return { changed: false, reason: "settings.json missing" };
  const parsed = safe(() => JSON.parse(readFileSync(settingsPath, "utf8")));
  if (parsed === undefined) return { changed: false, reason: "settings.json invalid JSON" };

  const wanted = desiredCommand(claudeDir);
  const currentCmd = parsed.statusLine && parsed.statusLine.command;
  const isOurs = typeof currentCmd === "string" && currentCmd.includes("gsd-context-meter");
  if (isOurs) return { changed: false, reason: "already set" };

  const isGsdCoreDefault = typeof currentCmd === "string" && currentCmd.includes("gsd-statusline.js");
  if (currentCmd && !isGsdCoreDefault)
    return { changed: false, reason: `statusLine.command points at a custom value (${currentCmd}) - left untouched` };

  parsed.statusLine = { type: "command", command: wanted };
  writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + "\n");
  return { changed: true, reason: currentCmd ? "took over from gsd-statusline.js" : "set (was unset)" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test .test/unit/gsd-statusline-registration.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/gsd-statusline-registration.mjs .test/unit/gsd-statusline-registration.test.mjs
git commit -m "feat: add safe non-interactive statusLine takeover for the context-meter wrapper"
```

---

### Task 8: `gsd-defaults-sync.mjs` CLI wrapper (repo root)

**Files:**
- Create: `payload/gsd-defaults-sync.mjs`

**Interfaces:**
- Consumes: `syncGsdGlobalDefaults`, `syncProjectConfig`, `findProjectRoot` from `./hooks/lib/gsd-defaults-sync.mjs` (Tasks 2-3); `ensureStatuslineOverride` from `./hooks/lib/gsd-statusline-registration.mjs` (Task 7).
- Produces: an executable CLI entry point (installed at `~/.claude/gsd-defaults-sync.mjs`, invoked from `/init-stack` in Task 10); no exports consumed elsewhere.

- [ ] **Step 1: Write the implementation**

```javascript
#!/usr/bin/env node
// CLI entry point for payload/commands/init-stack.md (step 10) and for anyone re-running it
// standalone after editing gsd-defaults.partial.json. Mirrors apply-gsd-agent-patches.mjs's
// shape: thin argv-driven wrapper around the lib, prints a plain-text summary.
// Reads ./gsd-defaults.partial.json - the mirror copy setup.mjs writes into ~/.claude
// alongside this script (Task 9) - not the repo's own copy, which won't exist on a machine
// that only ever unpacked-and-ran once.
// Usage: node gsd-defaults-sync.mjs [homeDir] [projectDir]
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncGsdGlobalDefaults, syncProjectConfig, findProjectRoot } from "./hooks/lib/gsd-defaults-sync.mjs";
import { ensureStatuslineOverride } from "./hooks/lib/gsd-statusline-registration.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const homeDir = process.argv[2] || homedir();
const partial = JSON.parse(readFileSync(join(here, "gsd-defaults.partial.json"), "utf8"));

const g = syncGsdGlobalDefaults({ homeDir, partial });
console.log(g.changed
  ? `Updated ${g.path} (deep-additive merge; your existing values were kept).`
  : `${g.path}: already up to date.`);

const projectRoot = findProjectRoot(process.argv[3] || process.cwd());
const p = syncProjectConfig({ projectRoot, partial });
console.log(p.skipped
  ? `Project config: skipped (${p.reason}).`
  : p.changed
    ? `Updated ${p.path} (reference values applied; other keys untouched).`
    : `${p.path}: already up to date.`);

const s = ensureStatuslineOverride({ claudeDir: join(homeDir, ".claude") });
console.log(s.changed ? `statusLine: ${s.reason}.` : `statusLine: no change (${s.reason}).`);
```

- [ ] **Step 2: Manual verification against a scratch home directory**

```bash
node -e "
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const home = mkdtempSync(join(tmpdir(), 'gsd-cli-verify-'));
mkdirSync(join(home, '.claude'), { recursive: true });
writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet' }));
console.log(home);
" > /tmp/scratch-home.txt
SCRATCH=$(cat /tmp/scratch-home.txt)
cp gsd-defaults.partial.json "$SCRATCH/.claude/gsd-defaults.partial.json"
mkdir -p "$SCRATCH/.claude/hooks/lib"
cp payload/hooks/lib/gsd-defaults-sync.mjs payload/hooks/lib/gsd-statusline-registration.mjs "$SCRATCH/.claude/hooks/lib/"
cp payload/gsd-defaults-sync.mjs "$SCRATCH/.claude/gsd-defaults-sync.mjs"
node "$SCRATCH/.claude/gsd-defaults-sync.mjs" "$SCRATCH"
cat "$SCRATCH/.gsd/defaults.json"
cat "$SCRATCH/.claude/settings.json"
```

Expected: three summary lines print (`Updated .../defaults.json ...`, `Project config: skipped (no .planning directory).`, `statusLine: set (was unset)....`); `$SCRATCH/.gsd/defaults.json` contains the full `gsd-defaults.partial.json` content; `$SCRATCH/.claude/settings.json`'s `statusLine.command` now references `gsd-context-meter.mjs` and `model: "sonnet"` is preserved. Delete `$SCRATCH` afterward.

- [ ] **Step 3: Commit**

```bash
git add payload/gsd-defaults-sync.mjs
git commit -m "feat: add gsd-defaults-sync.mjs CLI entry point"
```

---

### Task 9: Wire `setup.mjs` — global defaults sync, statusLine partial merge

**Files:**
- Modify: `setup.mjs:483-499` (insert after the existing `context-mode-gsd-agents` best-effort block, before the `settings.json` merge block)
- Modify: `setup.mjs`'s settings.json merge block (currently sets only `merged.hooks`/`merged.permissions`)

**Interfaces:**
- Consumes: `syncGsdGlobalDefaults` from the just-installed `~/.claude/hooks/lib/gsd-defaults-sync.mjs` (Task 3); `partial.statusLine` from the parsed `settings.partial.json` (Task 4, already substituted via the existing `<HOME>` replacement in `setup.mjs`).

- [ ] **Step 1: Insert the gsd-defaults mirror-copy + global-sync block**

In `setup.mjs`, insert this new block immediately after the existing context-mode-gsd-agents block (after the closing `}` that currently sits at line 499, before the `/* ---------- settings.json: structured additive merge ---------- */` comment):

```javascript
  /* ---------- gsd-defaults.partial.json: mirror + apply to ~/.gsd/defaults.json ----------
   * gsd-defaults.partial.json is REPO_ROOT meta (same treatment as settings.partial.json -
   * source of truth, not walked by placeFile()). Its content must also persist inside
   * ~/.claude so /init-stack's standalone CLI (payload/gsd-defaults-sync.mjs, which has no
   * access to REPO_ROOT once installed) can re-read it later - so this step always
   * overwrites the installed mirror copy, then applies it via the just-installed lib. */
  if (!DRY) {
    const partialDefaultsRaw = read(join(REPO_ROOT, "gsd-defaults.partial.json"));
    if (partialDefaultsRaw !== undefined) {
      const mirrorPath = join(CDIR, "gsd-defaults.partial.json");
      if (write(mirrorPath, partialDefaultsRaw)) summary.push(`updated  ${mirrorPath} (mirror copy)`);
      const gsdSyncLibPath = join(CDIR, "hooks", "lib", "gsd-defaults-sync.mjs");
      if (existsSync(gsdSyncLibPath)) {
        try {
          const mod = await import(pathToFileURL(gsdSyncLibPath).href);
          const gsdDefaultsPartial = safe(() => JSON.parse(partialDefaultsRaw));
          if (gsdDefaultsPartial) {
            const r = mod.syncGsdGlobalDefaults({ homeDir: HOME, partial: gsdDefaultsPartial });
            if (r.changed) summary.push(`merged   ${r.path} (deep additive; your values kept)`);
          }
        } catch { /* best-effort; never blocks install */ }
      }
    }
  }

```

- [ ] **Step 2: Extend the settings.json merge block for `statusLine`**

Find the existing block in `setup.mjs` that builds `merged` from `cur`/`partial` (the one that currently sets `merged.hooks = ...` and `merged.permissions = merged.permissions || {}`). Immediately after the `merged.permissions` loop (right before `const curStr = JSON.stringify(cur, null, 2);`), add:

```javascript
    // statusLine: only take over from an absent value or from gsd-core's own default
    // (gsd-statusline.js) - this path IS shown to the user via the diff+prompt below, so
    // (unlike the non-interactive CLI's ensureStatuslineOverride) it's safe to compute the
    // desired value unconditionally and let the existing diff make the change visible.
    if (partial.statusLine) {
      const curCmd = merged.statusLine && merged.statusLine.command;
      const isOurs = typeof curCmd === "string" && curCmd.includes("gsd-context-meter");
      const isGsdCoreDefault = typeof curCmd === "string" && curCmd.includes("gsd-statusline.js");
      if (!curCmd || isGsdCoreDefault || isOurs) merged.statusLine = partial.statusLine;
    }

```

- [ ] **Step 3: Manual verification**

```bash
node setup.mjs --dry-run
```

Expected: output includes a line like `updated  <home>/.claude/gsd-defaults.partial.json (mirror copy)` and, on a machine with no prior `~/.gsd/defaults.json`, a `merged   <home>/.gsd/defaults.json (deep additive; your values kept)` line (dry-run doesn't actually write, but the summary line still reflects what would happen — verify by re-running without `--dry-run` against a scratch `HOME` per Task 8's pattern if you need to confirm the file contents, not just the summary text). Confirm no stack trace and the process exits 0.

- [ ] **Step 4: Commit**

```bash
git add setup.mjs
git commit -m "feat: wire gsd-defaults sync and statusLine registration into setup.mjs"
```

---

### Task 10: Wire `/init-stack` — new step 10

**Files:**
- Modify: `payload/commands/init-stack.md` (append after the existing "## 9. Apply pending gsd-* agent patches" section)

- [ ] **Step 1: Add the new section**

```markdown

## 10. Sync personal GSD defaults + statusline override (machine-wide + this project)
`gsd-defaults.partial.json` is this bundle's curated personal GSD config (model routing,
workflow toggles) plus the statusline context-meter override. `setup.mjs` already applies
both once per install; this step catches drift for the entry point you actually run per
project without necessarily re-running the full installer - same rationale as step 9.

Run:
```bash
node ~/.claude/gsd-defaults-sync.mjs
```

Show me exactly what it printed: whether `~/.gsd/defaults.json` changed (deep-additive -
your own values always win), whether this project's `.planning/config.json` changed
(reference wins on overlapping keys, skipped entirely if there's no `.planning/` here), and
whether the statusLine registration changed (it only takes over from an unset value or from
gsd-core's own default `gsd-statusline.js` - if it reports a custom value was left
untouched, that's expected and not an error).
```

- [ ] **Step 2: Commit**

```bash
git add payload/commands/init-stack.md
git commit -m "docs: add init-stack step 10 for gsd-defaults + statusline sync"
```

---

### Task 11: `docs/gsd-config-defaults.md` — addendum on the Tier 2 reversal

**Files:**
- Modify: `docs/gsd-config-defaults.md`

- [ ] **Step 1: Append the addendum**

Add this section at the end of `docs/gsd-config-defaults.md`:

```markdown
## Addendum (2026-07-13) — gsd-defaults.partial.json and the Tier 2 exclusions above

A second, independent delivery path now exists: `gsd-defaults.partial.json` (repo root),
applied to gsd-core's own native `~/.gsd/defaults.json` and to the current project's
`.planning/config.json` via `payload/hooks/lib/gsd-defaults-sync.mjs` (see
`.ultrapowers/archive/plans/2026-07-13-gsd-defaults-and-statusline.md`).

That file deliberately includes `tdd_mode`, `code_review`(+`_depth`), and
`ui_phase`/`ui_review`/`ui_safety_gate` - a reversal of this document's Tier 2 "deliberately
NOT included" list above. The reversal is scoped to that new path only: this hook
(`gsd-config-patch.mjs`) and its `DEFAULT_WORKFLOW_CONFIG` are unchanged, still exclude
those keys, and the original rationale (set deliberately per project; UI keys are
stack-dependent) still applies to *this* hook's own Tier 2 patch. Reconciling the two
mechanisms into one is a separate, not-yet-scheduled task.
```

- [ ] **Step 2: Commit**

```bash
git add docs/gsd-config-defaults.md
git commit -m "docs: note the gsd-defaults.partial.json Tier 2 reversal in the decision log"
```

---

## Self-Review Notes

- **Spec coverage**: Plan A (source file, global-defaults sync, project-config sync, CLI, setup.mjs wiring, init-stack wiring, docs addendum) → Tasks 1-3, 8-11. Plan B (call-through + regex rewrite, survives gsd-core updates, settings.partial.json registration, setup.mjs + init-stack wiring) → Tasks 4-10. Plan C required no implementation. All spec sections have a task.
- **Placeholder scan**: no TBD/TODO; every step has complete, runnable code or an exact command with expected output.
- **Type/name consistency checked**: `syncGsdGlobalDefaults`/`syncProjectConfig`/`findProjectRoot`/`mergeReferenceWins`/`deepMergeExistingWins` (Tasks 2-3) match their usage in Task 8's CLI and Task 9's `setup.mjs` wiring. `ensureStatuslineOverride` (Task 7) matches its usage in Task 8 and is distinct from Task 9's inline `setup.mjs` statusLine block (different call sites, deliberately different safety behavior per Global Constraints - both documented, not a naming drift).
- **`docs/` is gitignored in this repo** (confirmed via `git check-ignore`) - the `git add`/`git commit` steps for Tasks 10-11 target `payload/`/root files, not `docs/`; this plan document and its parent spec stay local-only by existing repo convention, consistent with `docs/gsd-config-defaults.md` already being untracked.
