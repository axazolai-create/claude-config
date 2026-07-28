# AI Development Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a toggleable "AI development mode" that makes generated code terse (a `verbosity` rule axis) and strengthens use of the existing graphify code graph (a grep nudge + freshness), both riding a new universal multi-axis rule injector.

**Architecture:** Generalize the single-axis `leanmode-subagent.mjs` hook into an axis registry (`inject-axes.mjs`) that composes independent rule axes over both `SessionStart` (main loop) and `SubagentStart` (agents). `leanmode-rules.mjs` is left untouched and re-exported as one axis; `verbosity` is a second, simpler axis; each axis resolves and toggles independently. graphify strengthening is a separate advisory PreToolUse hook plus a guarded freshness edit.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict` (run via `node --test`, no package.json), markdown rule/command files, `variants.json` full/lite manifest.

## Global Constraints

- All code, docs, config, and rule text in English (user rule). This plan's prose is the exception; shipped files are English.
- Tests are `*.test.mjs` using `node:test`, run with `node --test <path>`. No package.json, no external test deps.
- Never Write/Edit `payload/CLAUDE.md` or any `CURATED:NOEDIT` file — G must not touch the graphify prose there; strengthen only via hooks.
- Every new file under `payload/` MUST be classified in `variants.json` (added to `lite.include` so A ships in lite, or it silently drops from the lite build).
- Every verbosity tier rule file ends with this **carve-out, verbatim**: *"This is about comment/whitespace verbosity only. Preserve meaningful names, correct casing (camelCase/PascalCase), mandatory syntax and indentation (e.g. Python), error handling at real boundaries, validation, and security. This is NOT minification — never shorten identifiers, never collapse required structure."*
- Config lives per-axis: leanmode reads `.claude/leanmode.json` (unchanged), verbosity reads `.claude/verbosity.json`. A unified `.claude/dev-mode.json` is deferred (YAGNI).
- Advisory hooks (graphify nudge) NEVER set a deny/permission decision — `additionalContext` only.

## File Structure

- `payload/hooks/lib/leanmode-rules.mjs` — UNCHANGED. Re-exported as the leanmode axis.
- `payload/hooks/lib/leanmode-rules.test.mjs` — NEW. Characterization tests guarding the refactor.
- `payload/hooks/lib/inject-axes.mjs` — NEW. Axis registry (`AXES`, axis definitions).
- `payload/hooks/inject-axes.mjs` — NEW. The injector hook (replaces `leanmode-subagent.mjs`).
- `payload/hooks/inject-axes.test.mjs` — NEW. Hook behavior + axis-independence tests.
- `payload/hooks/leanmode-subagent.mjs` — DELETED (replaced by injector).
- `payload/hooks/lib/verbosity-rules.mjs` — NEW. Verbosity resolver.
- `payload/hooks/lib/verbosity-rules.test.mjs` — NEW.
- `payload/hooks/lib/verbosity-{lite,full,ultra}-rule.md` — NEW. Tier rule text.
- `payload/commands/aidev.md` — NEW. `/aidev` dial command.
- `payload/hooks/graphify-grep-nudge.mjs` — NEW. G Stage 1 advisory nudge.
- `payload/hooks/graphify-grep-nudge.test.mjs` — NEW.
- `settings.partial.json` — MODIFIED. Register injector on both events; register nudge on PreToolUse.
- `variants.json` — MODIFIED. Swap hook name, add new lite includes.

---

### Task 1: Characterization tests for current leanmode resolution

Guards the Task 2/5 refactor. These pass immediately against the **unchanged** `leanmode-rules.mjs`; they exist to break if composition later distorts leanmode behavior.

**Files:**
- Create: `payload/hooks/lib/leanmode-rules.test.mjs`

**Interfaces:**
- Consumes: `resolveEffectiveLevel(agentType, root)`, `loadRuleText(level)`, `shift(base, dial)` from `leanmode-rules.mjs`.
- Produces: nothing (test-only).

- [ ] **Step 1: Write the characterization test**

```js
// payload/hooks/lib/leanmode-rules.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEffectiveLevel, loadRuleText, shift } from "./leanmode-rules.mjs";

function tmpRoot(leanmodeJson) {
  const root = mkdtempSync(join(tmpdir(), "lm-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "leanmode.json"), JSON.stringify(leanmodeJson));
  return root;
}

test("shift table is stable", () => {
  assert.equal(shift("full", "full"), "full");
  assert.equal(shift("full", "lite"), "lite");
  assert.equal(shift("lite", "lite"), "off");
  assert.equal(shift("off", "ultra"), "off");   // off is pinned
  assert.equal(shift("full", "ultra"), "ultra");
  assert.equal(shift("anything", "off"), "off");
});

test("explicit dial resolves default agent baseline", () => {
  const root = tmpRoot({ dial: "full", default: "full" });
  assert.equal(resolveEffectiveLevel("some-unmapped-agent", root), "full");
  rmSync(root, { recursive: true, force: true });
});

test("override wins over default", () => {
  const root = tmpRoot({ dial: "full", default: "full", overrides: { "x": "lite" } });
  assert.equal(resolveEffectiveLevel("x", root), "lite");
  rmSync(root, { recursive: true, force: true });
});

test("loadRuleText returns tier file content and empty for off", () => {
  assert.equal(loadRuleText("off"), "");
  assert.ok(loadRuleText("full").length > 0);
});
```

- [ ] **Step 2: Run and confirm it passes (characterization = green now)**

Run: `node --test payload/hooks/lib/leanmode-rules.test.mjs`
Expected: PASS (all tests). If any FAIL, stop — the assumptions about current behavior are wrong; reconcile before continuing.

- [ ] **Step 3: Commit**

```bash
git add payload/hooks/lib/leanmode-rules.test.mjs
git commit -m "test(leanmode): characterization tests guarding injector refactor"
```

---

### Task 2: Universal injector — registry + hook (leanmode axis only)

Behavior-preserving replacement of `leanmode-subagent.mjs`. Only the leanmode axis exists here; verbosity is added in Task 5. Not yet wired into settings (Task 3).

**Files:**
- Create: `payload/hooks/lib/inject-axes.mjs`
- Create: `payload/hooks/inject-axes.mjs`
- Test: `payload/hooks/inject-axes.test.mjs`

**Interfaces:**
- Consumes: `resolveEffectiveLevel`, `loadRuleText`, `findRoot` from `leanmode-rules.mjs`.
- Produces: `AXES` (array of axis objects), each axis `{ name, events, killSwitchEnv, resolve(agentType, root), loadRuleText(level) }`. The hook reads stdin JSON `{ hook_event_name, agent_type?, cwd? }` and writes `{ systemMessage, hookSpecificOutput: { hookEventName, additionalContext } }` or exits 0 silently.

- [ ] **Step 1: Write the failing hook test**

```js
// payload/hooks/inject-axes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "inject-axes.mjs");

function run(payload, env = {}) {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : null;
}

function leanmodeRoot() {
  const root = mkdtempSync(join(tmpdir(), "inj-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "leanmode.json"), JSON.stringify({ dial: "full", default: "full" }));
  return root;
}

test("SubagentStart injects the leanmode block for a mapped-to-full agent", () => {
  const root = leanmodeRoot();
  const res = run({ hook_event_name: "SubagentStart", agent_type: "x", cwd: root });
  assert.ok(res, "expected output");
  assert.match(res.systemMessage, /leanmode: full/);
  assert.ok(res.hookSpecificOutput.additionalContext.length > 0);
  assert.equal(res.hookSpecificOutput.hookEventName, "SubagentStart");
  rmSync(root, { recursive: true, force: true });
});

test("CLAUDE_LEANMODE=0 disables the leanmode axis (no output)", () => {
  const root = leanmodeRoot();
  const res = run({ hook_event_name: "SubagentStart", agent_type: "x", cwd: root }, { CLAUDE_LEANMODE: "0" });
  assert.equal(res, null);
  rmSync(root, { recursive: true, force: true });
});

test("SessionStart yields nothing yet (leanmode is SubagentStart-only)", () => {
  const root = leanmodeRoot();
  const res = run({ hook_event_name: "SessionStart", cwd: root });
  assert.equal(res, null);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test payload/hooks/inject-axes.test.mjs`
Expected: FAIL — `inject-axes.mjs` does not exist (spawn error / non-JSON).

- [ ] **Step 3: Write the registry**

```js
// payload/hooks/lib/inject-axes.mjs
// Universal rule injector — axis registry. Each axis resolves independently; the hook composes
// whichever axes yield a non-"off" level for the current event. Axes never reference one another,
// so disabling one never affects another. Add an axis by pushing to AXES.
import { resolveEffectiveLevel, loadRuleText } from "./leanmode-rules.mjs";

export const leanmodeAxis = {
  name: "leanmode",
  events: ["SubagentStart"],
  killSwitchEnv: "CLAUDE_LEANMODE",
  resolve: (agentType, root) => resolveEffectiveLevel(agentType, root),
  loadRuleText,
};

export const AXES = [leanmodeAxis];
```

- [ ] **Step 4: Write the hook**

```js
#!/usr/bin/env node
// Multi-axis rule injector. Registered on SessionStart (main loop) and SubagentStart (agents).
// Reads stdin JSON, resolves every axis in lib/inject-axes.mjs independently, and injects the
// composed rule blocks as additionalContext. No matcher in settings — filtering happens here.
import { readFileSync } from "node:fs";
import { AXES } from "./lib/inject-axes.mjs";
import { findRoot } from "./lib/leanmode-rules.mjs";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }

const event = d.hook_event_name || (d.agent_type ? "SubagentStart" : "SessionStart");
const agentType = d.agent_type || "main";
const root = findRoot(d.cwd || process.cwd());

const blocks = [], labels = [];
for (const axis of AXES) {
  if (process.env[axis.killSwitchEnv] === "0") continue;
  if (!axis.events.includes(event)) continue;
  const level = safe(() => axis.resolve(agentType, root)) || "off";
  if (level === "off") continue;
  const text = safe(() => axis.loadRuleText(level)) || "";
  if (text) { blocks.push(text); labels.push(`${axis.name}: ${level}`); }
}
if (!blocks.length) process.exit(0);

process.stdout.write(JSON.stringify({
  systemMessage: labels.join(" · "),
  hookSpecificOutput: { hookEventName: event, additionalContext: blocks.join("\n\n") },
}));
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test payload/hooks/inject-axes.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/lib/inject-axes.mjs payload/hooks/inject-axes.mjs payload/hooks/inject-axes.test.mjs
git commit -m "feat(hooks): universal multi-axis rule injector (leanmode axis)"
```

---

### Task 3: Wire injector into settings, remove old hook, update variants

**Files:**
- Modify: `settings.partial.json` (SubagentStart → inject-axes; add inject-axes to SessionStart)
- Delete: `payload/hooks/leanmode-subagent.mjs`
- Modify: `variants.json:14-28` (lite.include: rename hook, add lib registry)
- Test: `payload/hooks/settings-injector.test.mjs` (new, tiny sanity test)

**Interfaces:**
- Consumes: the injector from Task 2.
- Produces: settings registering `inject-axes.mjs` on `SessionStart` and `SubagentStart`; no reference to `leanmode-subagent.mjs`.

- [ ] **Step 1: Write the failing settings test**

```js
// payload/hooks/settings-injector.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settings = JSON.parse(readFileSync(join(ROOT, "settings.partial.json"), "utf8"));

function argsFor(event) {
  return (settings.hooks[event] || []).flatMap(e => e.hooks).map(h => (h.args || []).join(" "));
}

test("injector registered on SessionStart and SubagentStart", () => {
  assert.ok(argsFor("SessionStart").some(a => a.includes("inject-axes.mjs")));
  assert.ok(argsFor("SubagentStart").some(a => a.includes("inject-axes.mjs")));
});

test("obsolete leanmode-subagent hook is gone", () => {
  const all = Object.keys(settings.hooks).flatMap(argsFor).join("\n");
  assert.ok(!all.includes("leanmode-subagent.mjs"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test payload/hooks/settings-injector.test.mjs`
Expected: FAIL — `inject-axes.mjs` not registered; `leanmode-subagent.mjs` still present.

- [ ] **Step 3: Edit `settings.partial.json`**

Change the `SubagentStart` block's args from `["<HOME>/.claude/hooks/leanmode-subagent.mjs"]` to `["<HOME>/.claude/hooks/inject-axes.mjs"]`. Add a second hook entry under `SessionStart` (after `session-init.mjs`):

```json
"SessionStart": [
  {
    "hooks": [
      { "type": "command", "command": "node", "args": ["<HOME>/.claude/hooks/session-init.mjs"] },
      { "type": "command", "command": "node", "args": ["<HOME>/.claude/hooks/inject-axes.mjs"] }
    ]
  }
],
"SubagentStart": [
  {
    "hooks": [
      { "type": "command", "command": "node", "args": ["<HOME>/.claude/hooks/inject-axes.mjs"] }
    ]
  }
]
```

- [ ] **Step 4: Delete the old hook and update `variants.json`**

```bash
git rm payload/hooks/leanmode-subagent.mjs
```

In `variants.json` `lite.include` (line ~22), replace `"hooks/leanmode-subagent.mjs"` with `"hooks/inject-axes.mjs"`. The `"hooks/lib/leanmode-*"` glob (line ~24) already covers `leanmode-rules.mjs` and its test. Add a new include entry for the registry: `"hooks/lib/inject-axes.mjs"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test payload/hooks/settings-injector.test.mjs payload/variants.test.mjs`

> Note: `variants.test.mjs` is at repo root — adjust path: `node --test payload/hooks/settings-injector.test.mjs variants.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add settings.partial.json variants.json payload/hooks/settings-injector.test.mjs
git commit -m "feat(hooks): wire injector on both events, retire leanmode-subagent"
```

---

### Task 4: Verbosity axis — resolver + tier rule files

**Files:**
- Create: `payload/hooks/lib/verbosity-rules.mjs`
- Create: `payload/hooks/lib/verbosity-lite-rule.md`
- Create: `payload/hooks/lib/verbosity-full-rule.md`
- Create: `payload/hooks/lib/verbosity-ultra-rule.md`
- Test: `payload/hooks/lib/verbosity-rules.test.mjs`

**Interfaces:**
- Produces: `resolveVerbosityLevel(agentType, root) -> "off"|"lite"|"full"|"ultra"` (reads `<root>/.claude/verbosity.json`: `overrides[agentType]` else `level` else `"off"`); `loadVerbosityRule(level) -> string` (`""` for off/unknown).

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/verbosity-rules.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVerbosityLevel, loadVerbosityRule } from "./verbosity-rules.mjs";

function root(json) {
  const r = mkdtempSync(join(tmpdir(), "vb-"));
  if (json !== undefined) {
    mkdirSync(join(r, ".claude"), { recursive: true });
    writeFileSync(join(r, ".claude", "verbosity.json"), JSON.stringify(json));
  }
  return r;
}

test("no config resolves to off", () => {
  const r = root(undefined);
  assert.equal(resolveVerbosityLevel("main", r), "off");
  rmSync(r, { recursive: true, force: true });
});

test("level applies to main and any agent", () => {
  const r = root({ level: "full" });
  assert.equal(resolveVerbosityLevel("main", r), "full");
  assert.equal(resolveVerbosityLevel("gsd-executor", r), "full");
  rmSync(r, { recursive: true, force: true });
});

test("per-agent override wins over level", () => {
  const r = root({ level: "full", overrides: { "gsd-planner": "off" } });
  assert.equal(resolveVerbosityLevel("gsd-planner", r), "off");
  rmSync(r, { recursive: true, force: true });
});

test("each tier file loads and carries the anti-minify carve-out; off is empty", () => {
  assert.equal(loadVerbosityRule("off"), "");
  for (const lvl of ["lite", "full", "ultra"]) {
    const t = loadVerbosityRule(lvl);
    assert.ok(t.length > 0, `${lvl} has text`);
    assert.match(t, /NOT minification/);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test payload/hooks/lib/verbosity-rules.test.mjs`
Expected: FAIL — module and rule files missing.

- [ ] **Step 3: Write the resolver**

```js
// payload/hooks/lib/verbosity-rules.mjs
// Verbosity axis — terse-code rule. A single project-level dial (off|lite|full|ultra) applied to
// the main loop and all subagents, with optional per-agent overrides. Deliberately simpler than
// leanmode: verbosity is uniform across code-writing contexts, so no per-agent base map and no
// dial-shift table. Reads <root>/.claude/verbosity.json.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
const LEVELS = ["off", "lite", "full", "ultra"];

function readConfig(root) {
  const p = join(root, ".claude", "verbosity.json");
  if (!existsSync(p)) return {};
  return safe(() => readJSON(p)) || {};
}

export function resolveVerbosityLevel(agentType, root) {
  const cfg = readConfig(root);
  if (cfg.overrides && typeof cfg.overrides[agentType] === "string") return cfg.overrides[agentType];
  if (typeof cfg.level === "string") return cfg.level;
  return "off";
}

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export function loadVerbosityRule(level) {
  if (!LEVELS.includes(level) || level === "off") return "";
  const p = join(LIB_DIR, `verbosity-${level}-rule.md`);
  return (safe(() => readFileSync(p, "utf8")) || "").trim();
}
```

- [ ] **Step 4: Write the three tier files**

`payload/hooks/lib/verbosity-lite-rule.md`:

```markdown
Terse-code mode (lite). Applies to code you write directly and code you dispatch to agents.
- No change-log comments and no comments that restate what the code already says.
- Comment only the non-obvious *why*, never the *what*.
- No decorative separator blank lines.
This is about comment/whitespace verbosity only. Preserve meaningful names, correct casing (camelCase/PascalCase), mandatory syntax and indentation (e.g. Python), error handling at real boundaries, validation, and security. This is NOT minification — never shorten identifiers, never collapse required structure.
```

`payload/hooks/lib/verbosity-full-rule.md`:

```markdown
Terse-code mode (full). Applies to code you write directly and code you dispatch to agents.
- No comments at all except a genuine non-obvious *why* that the code cannot express.
- Drop blank lines whose only purpose is visual grouping.
- Docstrings only where they document a public contract/API, never for internal helpers.
This is about comment/whitespace verbosity only. Preserve meaningful names, correct casing (camelCase/PascalCase), mandatory syntax and indentation (e.g. Python), error handling at real boundaries, validation, and security. This is NOT minification — never shorten identifiers, never collapse required structure.
```

`payload/hooks/lib/verbosity-ultra-rule.md`:

```markdown
Terse-code mode (ultra). Applies to code you write directly and code you dispatch to agents.
- Zero comments. Zero optional blank lines.
- Keep only blank lines the language requires (e.g. PEP 8 hard rules that tooling enforces).
This is about comment/whitespace verbosity only. Preserve meaningful names, correct casing (camelCase/PascalCase), mandatory syntax and indentation (e.g. Python), error handling at real boundaries, validation, and security. This is NOT minification — never shorten identifiers, never collapse required structure.
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test payload/hooks/lib/verbosity-rules.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/lib/verbosity-rules.mjs payload/hooks/lib/verbosity-*-rule.md payload/hooks/lib/verbosity-rules.test.mjs
git commit -m "feat(verbosity): terse-code axis resolver and tier rules"
```

---

### Task 5: Register verbosity axis in the injector (both events) + axis-independence

**Files:**
- Modify: `payload/hooks/lib/inject-axes.mjs` (add verbosity axis to `AXES`)
- Test: `payload/hooks/inject-axes.test.mjs` (extend)

**Interfaces:**
- Consumes: `resolveVerbosityLevel`, `loadVerbosityRule` (Task 4).
- Produces: `AXES = [leanmodeAxis, verbosityAxis]`; verbosity subscribes to both events; independence holds (RISK-INJECT-001).

- [ ] **Step 1: Extend the hook test (failing)**

Append to `payload/hooks/inject-axes.test.mjs`:

```js
import { writeFileSync as wf, mkdirSync as md } from "node:fs";

function bothRoot() {
  const root = mkdtempSync(join(tmpdir(), "inj2-"));
  md(join(root, ".claude"), { recursive: true });
  wf(join(root, ".claude", "leanmode.json"), JSON.stringify({ dial: "full", default: "full" }));
  wf(join(root, ".claude", "verbosity.json"), JSON.stringify({ level: "full" }));
  return root;
}

test("SessionStart injects verbosity only (leanmode not subscribed)", () => {
  const root = bothRoot();
  const res = run({ hook_event_name: "SessionStart", cwd: root });
  assert.ok(res);
  assert.match(res.systemMessage, /verbosity: full/);
  assert.doesNotMatch(res.systemMessage, /leanmode/);
  rmSync(root, { recursive: true, force: true });
});

test("SubagentStart injects both axes when both on", () => {
  const root = bothRoot();
  const res = run({ hook_event_name: "SubagentStart", agent_type: "x", cwd: root });
  assert.match(res.systemMessage, /leanmode: full/);
  assert.match(res.systemMessage, /verbosity: full/);
  rmSync(root, { recursive: true, force: true });
});

test("leanmode disabled still injects verbosity (axis independence)", () => {
  const root = bothRoot();
  const res = run({ hook_event_name: "SubagentStart", agent_type: "x", cwd: root }, { CLAUDE_LEANMODE: "0" });
  assert.ok(res);
  assert.match(res.systemMessage, /verbosity: full/);
  assert.doesNotMatch(res.systemMessage, /leanmode/);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test payload/hooks/inject-axes.test.mjs`
Expected: FAIL on the three new tests (verbosity not registered yet).

- [ ] **Step 3: Add the verbosity axis**

Edit `payload/hooks/lib/inject-axes.mjs`:

```js
import { resolveEffectiveLevel, loadRuleText } from "./leanmode-rules.mjs";
import { resolveVerbosityLevel, loadVerbosityRule } from "./verbosity-rules.mjs";

export const leanmodeAxis = {
  name: "leanmode",
  events: ["SubagentStart"],
  killSwitchEnv: "CLAUDE_LEANMODE",
  resolve: (agentType, root) => resolveEffectiveLevel(agentType, root),
  loadRuleText,
};

export const verbosityAxis = {
  name: "verbosity",
  events: ["SessionStart", "SubagentStart"],
  killSwitchEnv: "CLAUDE_VERBOSITY",
  resolve: (agentType, root) => resolveVerbosityLevel(agentType, root),
  loadRuleText: loadVerbosityRule,
};

export const AXES = [leanmodeAxis, verbosityAxis];
```

- [ ] **Step 4: Run to verify all pass**

Run: `node --test payload/hooks/inject-axes.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/inject-axes.mjs payload/hooks/inject-axes.test.mjs
git commit -m "feat(verbosity): register verbosity axis on both events, independent of leanmode"
```

---

### Task 6: `/aidev` command + verbosity files into lite variant

**Files:**
- Create: `payload/commands/aidev.md`
- Modify: `variants.json` (lite.include: add verbosity libs, command)
- Test: extend `setup-variants.e2e.test.mjs` (assert A ships in lite)

**Interfaces:**
- Consumes: `resolveVerbosityLevel` (for the report step); writes `.claude/verbosity.json → level`.

- [ ] **Step 1: Write the failing variant e2e assertion**

Inspect `setup-variants.e2e.test.mjs` for its existing "lite contains file X" pattern and add, in the same style:

```js
test("lite build ships the AI-dev-mode (A) files", () => {
  // Reuse this file's existing lite-resolution helper (resolveVariant/filter). Assert each path
  // survives the lite filter — mirror the existing assertions in this file exactly.
  for (const p of [
    "hooks/inject-axes.mjs",
    "hooks/lib/inject-axes.mjs",
    "hooks/lib/verbosity-rules.mjs",
    "hooks/lib/verbosity-lite-rule.md",
    "commands/aidev.md",
  ]) {
    assert.ok(liteIncludes(p), `${p} must be in lite`);
  }
});
```

> If the file exposes no reusable `liteIncludes` helper, replicate its existing lite-membership check inline for these paths — do not invent a new abstraction.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test setup-variants.e2e.test.mjs`
Expected: FAIL — `aidev.md` and verbosity libs not yet in `lite.include`.

- [ ] **Step 3: Write `/aidev` command**

```markdown
---
description: Set or view the AI-dev-mode verbosity dial (off/lite/full/ultra) — how terse generated code is (comments/whitespace only)
argument-hint: "[--off|--lite|--full|--ultra]"
allowed-tools: Read, Write, Edit, Bash(node *), AskUserQuestion
---

Set the verbosity dial for THIS project (`.claude/verbosity.json` → `level`). Governs comment and
whitespace terseness ONLY — never minification, names, or correctness. Independent of leanmode
(which governs code structure). Never write without an explicit flag in `$ARGUMENTS` or my
confirmed menu choice.

## 1. Determine the flag
Check `$ARGUMENTS` for `--off`, `--lite`, `--full`, or `--ultra`.

## 2. If no flag: interactive menu
Use `AskUserQuestion` with exactly these options:

    AskUserQuestion([{
      question: "Set the AI-dev-mode verbosity dial for this project:",
      header: "verbosity dial",
      options: [
        { label: "off", description: "Normal commenting/whitespace. Verbosity axis inert here." },
        { label: "lite", description: "No change-log/restating comments; comment only the non-obvious why; no decorative blank lines." },
        { label: "full", description: "No comments except genuine why; drop grouping blank lines; docstrings only for public APIs." },
        { label: "ultra", description: "Zero comments, zero optional blank lines. Still NOT minification — names/structure preserved." }
      ]
    }])

## 3. Determine project root
Walk up from cwd to the nearest `.git`, `.planning`, `package.json`, `pyproject.toml`, `go.mod`,
or `build.gradle.kts` — same walk as `findRoot()` in `~/.claude/hooks/lib/leanmode-rules.mjs`.

## 4. Write the config
Read `<root>/.claude/verbosity.json` if it exists; else start from `{}`. Set `level` to the chosen
value, preserving any existing `overrides`. Write back (create `<root>/.claude/` first), pretty-
printed with a trailing newline.

## 5. Report both axes
Show the resolved verbosity level plus leanmode levels so the user sees the full picture:

    node --input-type=module -e '
    import { homedir } from "node:os";
    import { join } from "node:path";
    import { pathToFileURL } from "node:url";
    const root = process.argv[1];
    const lib = (f) => pathToFileURL(join(homedir(), ".claude", "hooks", "lib", f)).href;
    const { resolveVerbosityLevel } = await import(lib("verbosity-rules.mjs"));
    const { DEFAULT_LEANMODE_MAP, resolveEffectiveLevel } = await import(lib("leanmode-rules.mjs"));
    console.log("verbosity (main + agents): " + resolveVerbosityLevel("main", root));
    for (const k of Object.keys(DEFAULT_LEANMODE_MAP).sort()) {
      const l = resolveEffectiveLevel(k, root);
      if (l !== "off") console.log("leanmode " + k + ": " + l);
    }
    ' -- "<root>"

Present as a short table. If verbosity is `off`, say so explicitly.
```

- [ ] **Step 4: Add to `variants.json` `lite.include`**

Add these entries next to the leanmode ones: `"hooks/lib/verbosity-*"`, `"commands/aidev.md"`. (`hooks/lib/verbosity-*` covers the resolver, its test, and all three rule files.)

- [ ] **Step 5: Run to verify it passes**

Run: `node --test setup-variants.e2e.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add payload/commands/aidev.md variants.json setup-variants.e2e.test.mjs
git commit -m "feat(verbosity): /aidev command and lite-variant registration"
```

---

### Task 7: G Stage 1 — graphify grep nudge (advisory, zero-risk)

**Files:**
- Create: `payload/hooks/graphify-grep-nudge.mjs`
- Test: `payload/hooks/graphify-grep-nudge.test.mjs`
- Modify: `settings.partial.json` (register on PreToolUse)
- Modify: `variants.json` (lite.include)

**Interfaces:**
- Reads stdin `{ tool_name, tool_input: { pattern?, path? }, cwd? }`. Emits `{ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } }` or exits 0. NEVER denies.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/graphify-grep-nudge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "graphify-grep-nudge.mjs");
function run(payload) {
  const out = execFileSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : null;
}
function withGraph(has) {
  const root = mkdtempSync(join(tmpdir(), "gn-"));
  if (has) { mkdirSync(join(root, "graphify-out"), { recursive: true }); writeFileSync(join(root, "graphify-out", "graph.json"), "{}"); }
  return root;
}

test("architectural grep + graph present -> suggests graphify query", () => {
  const root = withGraph(true);
  const res = run({ tool_name: "Grep", tool_input: { pattern: "what calls AuthModule" }, cwd: root });
  assert.ok(res);
  assert.match(res.hookSpecificOutput.additionalContext, /graphify query/);
  assert.equal(res.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.ok(!("permissionDecision" in res.hookSpecificOutput), "must never deny");
  rmSync(root, { recursive: true, force: true });
});

test("no graph -> silent", () => {
  const root = withGraph(false);
  assert.equal(run({ tool_name: "Grep", tool_input: { pattern: "what calls X" }, cwd: root }), null);
  rmSync(root, { recursive: true, force: true });
});

test("non-architectural grep -> silent even with graph", () => {
  const root = withGraph(true);
  assert.equal(run({ tool_name: "Grep", tool_input: { pattern: "TODO fixme" }, cwd: root }), null);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test payload/hooks/graphify-grep-nudge.test.mjs`
Expected: FAIL — hook missing.

- [ ] **Step 3: Write the hook**

```js
#!/usr/bin/env node
// PreToolUse advisory: when a graphify graph exists and a Grep/Glob looks architectural, suggest
// `graphify query` first. Advisory ONLY — never sets a permission decision. Off via CLAUDE_GRAPHIFY_NUDGE=0.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
if (process.env.CLAUDE_GRAPHIFY_NUDGE === "0") process.exit(0);

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }
if (d.tool_name !== "Grep" && d.tool_name !== "Glob") process.exit(0);

const cwd = d.cwd || process.cwd();
if (!existsSync(join(cwd, "graphify-out", "graph.json"))) process.exit(0);

const pattern = (d.tool_input && d.tool_input.pattern) || "";
const q = `${pattern} ${(d.tool_input && d.tool_input.path) || ""}`.toLowerCase();
const architectural = /where is|what calls|who calls|how does .* work|depends on|imports|call graph|architecture|entry ?point|data flow/.test(q);
if (!architectural) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: `graphify-out/graph.json exists here. For an architectural question prefer \`graphify query "${pattern.slice(0, 80)}"\` — it answers from the code graph within a token budget instead of grepping. Grep is fine if the graph is stale or empty.`,
  },
}));
```

- [ ] **Step 4: Register + variant**

In `settings.partial.json`, add under `PreToolUse` a matcher-scoped entry for `Grep|Glob`:

```json
{ "matcher": "Grep|Glob", "hooks": [ { "type": "command", "command": "node", "args": ["<HOME>/.claude/hooks/graphify-grep-nudge.mjs"] } ] }
```

In `variants.json` `lite.include` add `"hooks/graphify-grep-nudge.mjs"` (graphify is a lite feature — `graphify-global-sync.mjs` is already in lite).

- [ ] **Step 5: Run to verify it passes**

Run: `node --test payload/hooks/graphify-grep-nudge.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/graphify-grep-nudge.mjs payload/hooks/graphify-grep-nudge.test.mjs settings.partial.json variants.json
git commit -m "feat(graphify): advisory grep nudge toward graph queries (G stage 1)"
```

---

### Task 8: G Stage 2 — freshness (guarded, splittable)

Lands only after Task 7 is merged and green. If risk grows during implementation, STOP and move this task to a follow-up spec (`.ultrapowers/archive/specs/`), leaving Tasks 1–7 as the shipped increment.

**Files:**
- Test: `payload/hooks/graphify-freshness.characterization.test.mjs` (new — pin current autosync behavior FIRST)
- Modify: `payload/hooks/lib/graphify-global-sync-run.mjs` and/or `payload/bin/graphify-freshness*` (wire a staleness signal)
- Modify: `payload/hooks/graphify-grep-nudge.mjs` (read the signal; say "graph is stale" when so)

**Interfaces:**
- Produces: a freshness check (graph.json mtime vs. HEAD commit time / tracked marker) surfaced to the nudge.

- [ ] **Step 1: Characterize current autosync (regression guard)**

Read `payload/hooks/lib/graphify-global-sync-run.mjs` and `payload/bin/graphify-freshness*` to learn their current contract. Write a test that pins their observable behavior TODAY (inputs → sync decision), independent of the coming change.

Run: `node --test payload/hooks/graphify-freshness.characterization.test.mjs`
Expected: PASS now (documents current behavior). This is the guard for RISK-GRAPHFRESH-001.

- [ ] **Step 2: Write the failing freshness-signal test**

Add a test asserting: given a `graph.json` older than the latest commit, the freshness helper reports `stale: true`; when newer, `stale: false`.

Run: the new test.
Expected: FAIL — signal not implemented.

- [ ] **Step 3: Implement the freshness signal (minimal)**

Add the smallest helper that compares `graphify-out/graph.json` mtime against the last tracked commit time and exposes `{ stale }`. Wire the post-commit `--update` path so a stale graph triggers a refresh. Keep the existing autosync contract intact.

- [ ] **Step 4: Run both freshness test and the characterization guard**

Run: `node --test payload/hooks/graphify-freshness.characterization.test.mjs payload/hooks/graphify-grep-nudge.test.mjs <new freshness test>`
Expected: ALL PASS — the guard proves the autosync contract did not regress.

- [ ] **Step 5: Nudge reads the signal**

Update `graphify-grep-nudge.mjs` to append "the graph looks stale — run `graphify <path> --update` first" when `stale: true`. Extend the nudge test with a stale-graph case.

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/graphify-freshness.characterization.test.mjs payload/hooks/lib/graphify-global-sync-run.mjs payload/hooks/graphify-grep-nudge.mjs
git commit -m "feat(graphify): graph freshness signal wired into the nudge (G stage 2)"
```

---

## Self-Review

**Spec coverage (against `2026-07-26-ai-development-mode-design.md`):**
- § 2 universal injector → Tasks 2, 3, 5. ✓
- § 3 verbosity axis (tiers + carve-out, main + agents) → Tasks 4, 5. ✓
- § 4 G staged (Stage 1 nudge, Stage 2 freshness guarded) → Tasks 7, 8. ✓
- § 5 config (`.claude/verbosity.json`) + `/aidev` → Tasks 4, 6. ✓
- § 6 variants full+lite → Tasks 3, 6, 7. ✓
- § 7 testing (resolver, independence, coverage, e2e, nudge, freshness guard) → Tasks 1, 5, 6, 7, 8. ✓
- § 8 risks → RISK-INJECT-001 (Tasks 1, 5), RISK-VERBOSITY-001 (carve-out, Task 4), RISK-GRAPHFRESH-001 (Task 8 guard). ✓

**Placeholder scan:** No "TBD/handle appropriately" — every code/test step has literal content. Task 6 Step 1 and Task 8 depend on reading an existing file's shape first (`setup-variants.e2e.test.mjs`, `graphify-global-sync-run.mjs`); those steps instruct mirroring the existing pattern rather than inventing one, which is deliberate (follow-established-pattern), not a placeholder.

**Type/name consistency:** `resolveVerbosityLevel`/`loadVerbosityRule` (Task 4) used identically in Tasks 5, 6. `AXES`, axis `{name, events, killSwitchEnv, resolve, loadRuleText}` consistent across Tasks 2, 5. Hook I/O (`hook_event_name`, `additionalContext`, `hookEventName`) consistent across Tasks 2, 5, 7. Config keys `level`/`overrides` consistent Tasks 4, 6.
