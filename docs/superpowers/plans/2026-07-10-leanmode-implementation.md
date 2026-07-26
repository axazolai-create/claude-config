# leanmode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-party, per-`agent_type` YAGNI-ruleset injector (`leanmode`) that replaces the `ponytail` plugin idea with finer-grained control: a baseline map, per-project overrides, and a project-wide off/lite/full/ultra dial gated on `/init-stack` having run.

**Architecture:** A `SubagentStart` hook (`payload/hooks/leanmode-subagent.mjs`) resolves an effective level for the firing `agent_type` via a shared library (`payload/hooks/lib/leanmode-rules.mjs`) and injects the matching rule-text file as `additionalContext`. A new custom agent (`payload/agents/leanmode-executor.md`) gives explicit per-task opt-in. A command (`payload/commands/leanmode.md`) sets the project dial. All of it is plain Node ESM synced into `~/.claude/` by this repo's existing `setup.mjs`.

**Tech Stack:** Node.js (ESM, no dependencies — matches every other hook in this repo), Claude Code hooks (`SubagentStart`), Claude Code custom subagents (`~/.claude/agents/*.md`), Claude Code custom commands (`~/.claude/commands/*.md`).

## Global Constraints

- No test framework exists in this repo (no `package.json`, no `tests/` dir) — every other hook (`session-init.mjs`, `gsd-config-patch.mjs`, etc.) is verified by direct `node script.mjs` invocation with crafted stdin/fixtures, not an automated suite. Follow that convention; do not introduce a test framework for this feature alone.
- Every hook script uses the repo's established `safe()`/`writeFile()`/`readJSON()` (BOM-stripping) helper pattern and duplicates the `findRoot()` walk rather than importing across independent hook files — see `payload/hooks/session-init.mjs` and `payload/hooks/gsd-config-patch.mjs` for the exact shape.
- `.claude/settings.json` is never a place for this feature's own config — project-level leanmode config lives in a dedicated `.claude/leanmode.json` this feature owns exclusively (spec: docs/superpowers/specs/2026-07-10-leanmode-design.md, "BASE level" section).
- Deploy path: any file placed under `payload/` is picked up automatically by `node setup.mjs` (recursive `walkBundle(SRC)`) — no changes to `setup.mjs` itself are needed for new files.
- Full algorithmic spec (BASE resolution, dial resolution, the shift table, the full `DEFAULT_LEANMODE_MAP` with rationale) is locked in `docs/superpowers/specs/2026-07-10-leanmode-design.md` — read it before Task 1, don't re-derive decisions already made there.

---

## Task 1: `leanmode-rules.mjs` — the shared resolver + rule text

**Files:**
- Create: `payload/hooks/lib/leanmode-lite-rule.md`
- Create: `payload/hooks/lib/leanmode-full-rule.md`
- Create: `payload/hooks/lib/leanmode-ultra-rule.md`
- Create: `payload/hooks/lib/leanmode-rules.mjs`
- Test: none (no test framework — verified via a throwaway Node script, deleted at the end of this task, see Step 6)

**Interfaces:**
- Produces (consumed by Task 2, Task 5):
  - `export const LEVEL_ORDER = ["off", "lite", "full", "ultra"]`
  - `export const DEFAULT_LEANMODE_MAP` — `{ [agentType: string]: "lite" | "full" }` (11 entries; `"off"` is never a value in this object — see Step 2)
  - `export function findRoot(start: string): string`
  - `export function resolveBaseLevel(agentType: string, root: string): "off" | "lite" | "full"`
  - `export function resolveDial(root: string): "off" | "lite" | "full" | "ultra"`
  - `export function shift(base: "off"|"lite"|"full", dial: "off"|"lite"|"full"|"ultra"): "off"|"lite"|"full"|"ultra"`
  - `export function resolveEffectiveLevel(agentType: string, root: string): "off"|"lite"|"full"|"ultra"`
  - `export function loadRuleText(level: "off"|"lite"|"full"|"ultra"): string` (empty string for `"off"`)

### Step 1: Write the three rule-text files

- [ ] Create `payload/hooks/lib/leanmode-lite-rule.md`:

```
Before writing code: does this need to exist, and does the codebase already have something
for it? Prefer the smallest correct change over new abstractions.
```

- [ ] Create `payload/hooks/lib/leanmode-full-rule.md`:

```
1. Does this need to be built at all?
2. Does it already exist in this codebase — reuse it, don't rewrite it.
3. Does stdlib/the language runtime already do it?
4. Is there an already-installed dependency that does it?
5. Otherwise: the minimum code that satisfies the actual requirement.
No speculative flexibility, no unrequested abstractions, no config knobs nobody asked for.
This is about complexity, not correctness: error handling at real boundaries, validation,
and security practices stay in place regardless of level.
```

- [ ] Create `payload/hooks/lib/leanmode-ultra-rule.md`:

```
Beyond the ladder above: actively look for existing code to delete or simplify while you're
in the area, not just avoid adding new. Don't introduce an abstraction for 2 call sites —
inline until there are genuinely 4+. No new files unless the existing ones can't reasonably
hold this. No new dependencies, even ones already used elsewhere in a monorepo, unless
already a direct dependency of this package. Hard-code the literal case in front of you over
a general solution nobody asked for. This still does not touch correctness, error handling at
real boundaries, or security practices — those stay exactly as required regardless of level.
```

### Step 2: Write `leanmode-rules.mjs`

- [ ] Create `payload/hooks/lib/leanmode-rules.mjs`:

```js
#!/usr/bin/env node
// leanmode shared resolver - see docs/superpowers/specs/2026-07-10-leanmode-design.md for the
// full off/lite/full/ultra rationale. Two independent axes: BASE level (resolveBaseLevel, which
// text tier this agent_type gets ignoring the project dial) and the project dial (resolveDial,
// a uniform shift applied to BASE). shift() combines them; resolveEffectiveLevel() is the one
// function callers actually need.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

export const LEVEL_ORDER = ["off", "lite", "full", "ultra"];

// Runtime map holds only the 11 non-"off" entries - "off" is already the global fallback, so a
// key that would just say "off" adds nothing at lookup time. The other 29 known agent_type
// values (GSD's remaining agents plus Explore/Plan/claude-code-guide) are deliberately NOT
// entries here - see docs/superpowers/specs/2026-07-10-leanmode-design.md for the full,
// per-agent accounting of what was considered and why each landed on "off".
export const DEFAULT_LEANMODE_MAP = {
  "general-purpose": "lite", // catch-all agent, code-writing is common but not certain - mild nudge only
  "claude": "lite", // default catch-all when no agent name given - same reasoning as general-purpose
  "statusline-setup": "lite", // narrow single-purpose config edit - small scope, minimal is naturally correct here
  "leanmode-executor": "full", // payload/agents/leanmode-executor.md - explicit per-task opt-in to lean implementation
  "gsd-executor": "full", // writes/edits application code implementing plans - primary target for this system
  "gsd-code-fixer": "full", // applies fixes to code review findings - writes application code
  "gsd-debugger": "full", // investigates bugs and writes fix code
  "gsd-pattern-mapper": "full", // maps existing code patterns for reuse - directly synergistic with YAGNI/reuse-first
  "gsd-codebase-mapper": "full", // maps codebase structure/tech for planning - reinforces "reuse what's already there"
  "gsd-nyquist-auditor": "lite", // generates tests to fill validation gaps - some minimalism helps, doesn't need the full push
  "gsd-debug-session-manager": "lite", // orchestrates debug cycles and applies fixes itself - code-touching but mostly a manager role
};

// Same root-finding walk as session-init.mjs/gsd-config-patch.mjs, duplicated on purpose (small
// helper, keeps this module independently readable without importing a sibling hook file).
export function findRoot(start) {
  let cur = resolve(start);
  for (let i = 0; i < 40; i++) {
    for (const m of [".git", ".planning", "package.json", "pyproject.toml", "go.mod", "build.gradle.kts"])
      if (existsSync(join(cur, m))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(start);
}

function readLeanmodeConfig(root) {
  const p = join(root, ".claude", "leanmode.json");
  if (!existsSync(p)) return {};
  return safe(() => readJSON(p)) || {};
}

// BASE level: which text tier this agent_type gets, ignoring the project dial. 4-step priority
// (highest first): project override -> global map -> project default -> "off".
export function resolveBaseLevel(agentType, root) {
  const cfg = readLeanmodeConfig(root);
  if (cfg.overrides && typeof cfg.overrides[agentType] === "string") return cfg.overrides[agentType];
  if (Object.prototype.hasOwnProperty.call(DEFAULT_LEANMODE_MAP, agentType)) return DEFAULT_LEANMODE_MAP[agentType];
  if (typeof cfg.default === "string") return cfg.default;
  return "off";
}

// Project dial: off|lite|full|ultra. Explicit leanmode.json.dial wins; otherwise "full" once
// /init-stack has run for this project (state[root].initStackRun, written by
// hooks/lib/mark-initstack-done.mjs from init-stack.md's last step), else "off".
export function resolveDial(root) {
  const cfg = readLeanmodeConfig(root);
  if (typeof cfg.dial === "string") return cfg.dial;
  const stateFile = join(homedir(), ".claude", "state", "project-init.json");
  const state = existsSync(stateFile) ? (safe(() => readJSON(stateFile)) || {}) : {};
  return (state[root] && state[root].initStackRun) ? "full" : "off";
}

// Applies the dial to BASE. "off" is pinned - it only ever changes via the "off" dial itself,
// never via a lite/ultra shift: every "off" agent_type writes plans, reports, docs, or specs,
// never application code (verified against the full map - see the design doc), so nudging it
// under `ultra` would be pure noise at best (a "before writing code" line landing on a research
// agent) or actively harmful at worst (diluting gsd-security-auditor/gsd-planner). Downward
// shifts need no such guard - "lite" naturally floors at "off" via the plain index clamp.
export function shift(base, dial) {
  if (dial === "off") return "off";
  const i = LEVEL_ORDER.indexOf(base);
  if (dial === "lite") return LEVEL_ORDER[Math.max(0, i - 1)]; // full->lite, lite->off, off->off
  if (dial === "full") return base; // identity - BASE as authored
  if (dial === "ultra") {
    if (base === "off") return "off"; // pinned - see comment above
    return LEVEL_ORDER[Math.min(LEVEL_ORDER.length - 1, i + 1)]; // lite->full, full->ultra
  }
  return base; // unknown dial value - fail safe to identity, never escalate
}

export function resolveEffectiveLevel(agentType, root) {
  return shift(resolveBaseLevel(agentType, root), resolveDial(root));
}

// Rule text loader. "off" -> "" (callers should skip emitting additionalContext entirely).
// lite/full/ultra -> the matching markdown file's content, trimmed. Files live next to this
// module so this works regardless of cwd.
const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export function loadRuleText(level) {
  if (level !== "lite" && level !== "full" && level !== "ultra") return "";
  const p = join(LIB_DIR, `leanmode-${level}-rule.md`);
  return (safe(() => readFileSync(p, "utf8")) || "").trim();
}
```

### Step 3: Verify `shift()` against the full truth table (no fixtures needed — pure function)

- [ ] Run this inline check (bash):

```bash
node --input-type=module -e '
import { shift } from "./payload/hooks/lib/leanmode-rules.mjs";
const cases = [
  ["off","off","off"], ["off","lite","off"], ["off","full","off"], ["off","ultra","off"],
  ["lite","off","off"], ["lite","lite","off"], ["lite","full","lite"], ["lite","ultra","full"],
  ["full","off","off"], ["full","lite","lite"], ["full","full","full"], ["full","ultra","ultra"],
];
let fail = 0;
for (const [base, dial, want] of cases) {
  const got = shift(base, dial);
  if (got !== want) { console.log(`FAIL shift(${base},${dial}) = ${got}, want ${want}`); fail++; }
}
console.log(fail === 0 ? "ALL 12 CASES PASS" : `${fail} FAILURES`);
'
```

Expected: `ALL 12 CASES PASS`

### Step 4: Verify `resolveBaseLevel()` priority order against fixture directories

- [ ] Set up two scratch fixture roots and run (bash):

```bash
mkdir -p /tmp/leanmode-fixture-a/.claude /tmp/leanmode-fixture-b/.claude
echo '{"overrides":{"gsd-pattern-mapper":"off"},"default":"lite"}' > /tmp/leanmode-fixture-a/.claude/leanmode.json
echo '{}' > /tmp/leanmode-fixture-b/.claude/leanmode.json

node --input-type=module -e '
import { resolveBaseLevel } from "./payload/hooks/lib/leanmode-rules.mjs";
const cases = [
  // [root, agentType, expected, why]
  ["/tmp/leanmode-fixture-a", "gsd-pattern-mapper", "off", "step 1: project override beats global map (map says full)"],
  ["/tmp/leanmode-fixture-a", "gsd-executor", "full", "step 2: global map, no override present"],
  ["/tmp/leanmode-fixture-a", "some-unknown-agent", "lite", "step 3: project default, not in map"],
  ["/tmp/leanmode-fixture-b", "some-unknown-agent", "off", "step 4: no override, not in map, no project default"],
];
let fail = 0;
for (const [root, agent, want, why] of cases) {
  const got = resolveBaseLevel(agent, root);
  if (got !== want) { console.log(`FAIL resolveBaseLevel(${agent}, ${root}) = ${got}, want ${want} (${why})`); fail++; }
}
console.log(fail === 0 ? "ALL 4 CASES PASS" : `${fail} FAILURES`);
'
rm -rf /tmp/leanmode-fixture-a /tmp/leanmode-fixture-b
```

Expected: `ALL 4 CASES PASS`

### Step 5: Verify `resolveDial()` priority order and `loadRuleText()`

- [ ] Run (bash) — covers explicit dial, the `initStackRun` state fallback, and the no-state fallback, plus the text loader:

```bash
mkdir -p /tmp/leanmode-fixture-c/.claude /tmp/leanmode-fixture-d
echo '{"dial":"ultra"}' > /tmp/leanmode-fixture-c/.claude/leanmode.json
STATE_FILE="$HOME/.claude/state/project-init.json"
mkdir -p "$(dirname "$STATE_FILE")"
node -e "
const fs = require('fs');
const p = process.env.STATE_FILE;
const s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
s['/tmp/leanmode-fixture-d'] = { initStackRun: new Date().toISOString() };
fs.writeFileSync(p, JSON.stringify(s, null, 2));
" 
node --input-type=module -e '
import { resolveDial, loadRuleText } from "./payload/hooks/lib/leanmode-rules.mjs";
let fail = 0;
const d1 = resolveDial("/tmp/leanmode-fixture-c");
if (d1 !== "ultra") { console.log(`FAIL explicit dial: got ${d1}`); fail++; }
const d2 = resolveDial("/tmp/leanmode-fixture-d");
if (d2 !== "full") { console.log(`FAIL initStackRun fallback: got ${d2}`); fail++; }
const d3 = resolveDial("/tmp/leanmode-fixture-nonexistent-root");
if (d3 !== "off") { console.log(`FAIL no-state fallback: got ${d3}`); fail++; }
const t1 = loadRuleText("off");
if (t1 !== "") { console.log(`FAIL loadRuleText(off) not empty`); fail++; }
const t2 = loadRuleText("full");
if (!t2.startsWith("1. Does this need to be built at all?")) { console.log(`FAIL loadRuleText(full) wrong content: ${t2.slice(0,50)}`); fail++; }
console.log(fail === 0 ? "ALL 5 CASES PASS" : `${fail} FAILURES`);
'
rm -rf /tmp/leanmode-fixture-c /tmp/leanmode-fixture-d
node -e "
const fs = require('fs');
const p = process.env.STATE_FILE;
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
delete s['/tmp/leanmode-fixture-d'];
fs.writeFileSync(p, JSON.stringify(s, null, 2));
"
```

Expected: `ALL 5 CASES PASS`. The cleanup lines at the end remove the scratch entry from the real
`~/.claude/state/project-init.json` so this verification leaves no residue.

### Step 6: Commit

- [ ] Commit:

```bash
git add payload/hooks/lib/leanmode-rules.mjs payload/hooks/lib/leanmode-lite-rule.md payload/hooks/lib/leanmode-full-rule.md payload/hooks/lib/leanmode-ultra-rule.md
git commit -m "feat: leanmode resolver — BASE/dial resolution, shift table, rule text"
```

---

## Task 2: `leanmode-subagent.mjs` — the `SubagentStart` hook + wiring

**Files:**
- Create: `payload/hooks/leanmode-subagent.mjs`
- Modify: `settings.partial.json`

**Interfaces:**
- Consumes (from Task 1): `findRoot(start)`, `resolveEffectiveLevel(agentType, root)`, `loadRuleText(level)` from `./lib/leanmode-rules.mjs`
- Produces: nothing other tasks import — this is a leaf hook script invoked by Claude Code itself, not by other files in this repo

### Step 1: Write the hook

- [ ] Create `payload/hooks/leanmode-subagent.mjs`:

```js
#!/usr/bin/env node
// leanmode - SubagentStart hook. Reads agent_type from stdin, resolves the effective level via
// lib/leanmode-rules.mjs, and injects the matching rule text as additionalContext. No matcher in
// settings.partial.json on purpose - filtering happens here so adding a new agent_type to
// DEFAULT_LEANMODE_MAP never requires touching the hook registration.
// Master kill switch: CLAUDE_LEANMODE=0 disables this hook entirely.
import { readFileSync } from "node:fs";
import { findRoot, resolveEffectiveLevel, loadRuleText } from "./lib/leanmode-rules.mjs";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
function emit(ctx) {
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: ctx || "" }
    }));
  } catch { /* ignore */ }
  process.exit(0);
}

if (process.env.CLAUDE_LEANMODE === "0") process.exit(0);

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }

const agentType = d.agent_type;
if (!agentType) process.exit(0);

const root = findRoot(d.cwd || process.cwd());
const level = resolveEffectiveLevel(agentType, root);
if (level === "off") process.exit(0);

const text = loadRuleText(level);
if (!text) process.exit(0);

emit(text);
```

### Step 2: Register the hook in `settings.partial.json`

- [ ] Read `settings.partial.json`, then add a `SubagentStart` key to the `hooks` object (after
  the existing `SessionStart` entry):

```json
    "SubagentStart": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["<HOME>/.claude/hooks/leanmode-subagent.mjs"] }
        ]
      }
    ]
```

Resulting `hooks` object must have `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, and now
`SubagentStart` as siblings, each still comma-separated correctly (there is no key after
`SessionStart` today, so `SessionStart`'s closing `]` needs a trailing comma once
`SubagentStart` is added after it).

### Step 3: Verify the hook end-to-end with crafted stdin

- [ ] Run each case (bash) from the repo root:

```bash
# off (BASE off, no leanmode.json anywhere near /tmp) -> no hookSpecificOutput at all, exit 0
echo '{"agent_type":"gsd-planner","cwd":"/tmp"}' | node payload/hooks/leanmode-subagent.mjs; echo "exit=$?"
```
Expected: no stdout, `exit=0` (BASE=off for gsd-planner, dial defaults to off with no init-stack
marker for `/tmp` — either way lands on off).

```bash
# CLAUDE_LEANMODE=0 kill switch -> no output even for a full-mapped agent
CLAUDE_LEANMODE=0 bash -c 'echo "{\"agent_type\":\"gsd-executor\",\"cwd\":\"/tmp\"}" | node payload/hooks/leanmode-subagent.mjs'; echo "exit=$?"
```
Expected: no stdout, `exit=0`.

```bash
# full pipeline: mark a scratch root as init-stack-run (dial->full), agent_type gsd-executor (BASE full) -> effective "full", expect the full-rule text back
mkdir -p /tmp/leanmode-hook-fixture
node -e "
const fs = require('fs'); const path = require('path'); const os = require('os');
const p = path.join(os.homedir(), '.claude', 'state', 'project-init.json');
const s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
s['/tmp/leanmode-hook-fixture'] = { initStackRun: new Date().toISOString() };
fs.mkdirSync(path.dirname(p), { recursive: true });
fs.writeFileSync(p, JSON.stringify(s, null, 2));
"
echo '{"agent_type":"gsd-executor","cwd":"/tmp/leanmode-hook-fixture"}' | node payload/hooks/leanmode-subagent.mjs
```
Expected stdout: a JSON object whose `hookSpecificOutput.additionalContext` starts with
`"1. Does this need to be built at all?"`.

- [ ] Clean up the scratch state entry and fixture dir:

```bash
node -e "
const fs = require('fs'); const path = require('path'); const os = require('os');
const p = path.join(os.homedir(), '.claude', 'state', 'project-init.json');
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
delete s['/tmp/leanmode-hook-fixture'];
fs.writeFileSync(p, JSON.stringify(s, null, 2));
"
rm -rf /tmp/leanmode-hook-fixture
```

### Step 4: Commit

- [ ] Commit:

```bash
git add payload/hooks/leanmode-subagent.mjs settings.partial.json
git commit -m "feat: leanmode SubagentStart hook + settings.partial.json wiring"
```

---

## Task 3: `mark-initstack-done.mjs` + `init-stack.md` step 7

**Files:**
- Create: `payload/hooks/lib/mark-initstack-done.mjs`
- Modify: `payload/commands/init-stack.md`

**Interfaces:**
- Produces: `state[root].initStackRun` (ISO timestamp string) in
  `~/.claude/state/project-init.json` — this is the exact key `resolveDial()` (Task 1, Step 2)
  reads. Keep the key name `initStackRun` identical between the two files.

### Step 1: Write the marker script

- [ ] Create `payload/hooks/lib/mark-initstack-done.mjs`:

```js
#!/usr/bin/env node
// leanmode - stamps state[root].initStackRun so leanmode's project dial can default to "full"
// once /init-stack has actually run for this project (see resolveDial() in leanmode-rules.mjs).
// Called as the last step of payload/commands/init-stack.md's own instructions - NOT a
// registered Claude Code hook, just a plain script run once per /init-stack completion.
// Idempotent: only writes if the flag isn't already set, matching every other one-time flag in
// the shared ~/.claude/state/project-init.json file (see session-init.mjs, gsd-config-patch.mjs).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const writeFile = (p, content) => { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); return true; } catch { return false; } };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

function findRoot(start) {
  let cur = resolve(start);
  for (let i = 0; i < 40; i++) {
    for (const m of [".git", ".planning", "package.json", "pyproject.toml", "go.mod", "build.gradle.kts"])
      if (existsSync(join(cur, m))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(start);
}

const root = findRoot(process.cwd());
const stateFile = join(homedir(), ".claude", "state", "project-init.json");
let state = existsSync(stateFile) ? (safe(() => readJSON(stateFile)) || {}) : {};
if (!state[root]) state[root] = {};
if (!state[root].initStackRun) {
  state[root].initStackRun = new Date().toISOString();
  writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
}
```

### Step 2: Add the final step to `init-stack.md`

- [ ] Append a new numbered section at the end of `payload/commands/init-stack.md` (after the
  existing step 6), unconditional (runs regardless of whether `.planning/config.json` exists —
  unlike steps 5–6, leanmode isn't GSD-specific):

```markdown

## 7. Mark leanmode dial default (always, no gate)
Run `node ~/.claude/hooks/lib/mark-initstack-done.mjs` (no output expected, always safe to
re-run). This lets leanmode's project dial default to `full` for this project from now on,
instead of staying `off` until someone explicitly runs `/leanmode` — see
`docs/superpowers/specs/2026-07-10-leanmode-design.md` for why the dial is gated on
`/init-stack` having run at all.
```

### Step 3: Verify the marker script

- [ ] Run from a scratch fixture directory that looks like a project root (bash):

```bash
mkdir -p /tmp/leanmode-initstack-fixture && cd /tmp/leanmode-initstack-fixture && git init -q
node "$OLDPWD/payload/hooks/lib/mark-initstack-done.mjs"
node -e "
const fs = require('fs'); const path = require('path'); const os = require('os');
const p = path.join(os.homedir(), '.claude', 'state', 'project-init.json');
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
const key = fs.realpathSync('/tmp/leanmode-initstack-fixture');
console.log(s[key] && s[key].initStackRun ? 'PASS: initStackRun set' : 'FAIL: initStackRun missing');
"
cd "$OLDPWD"
```
Expected: `PASS: initStackRun set`

- [ ] Run it a second time and confirm the timestamp does NOT change (idempotent):

```bash
cd /tmp/leanmode-initstack-fixture
FIRST=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME + '/.claude/state/project-init.json','utf8'))[require('fs').realpathSync('.')].initStackRun)")
node "$OLDPWD/payload/hooks/lib/mark-initstack-done.mjs"
SECOND=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME + '/.claude/state/project-init.json','utf8'))[require('fs').realpathSync('.')].initStackRun)")
[ "$FIRST" = "$SECOND" ] && echo "PASS: idempotent" || echo "FAIL: timestamp changed"
cd "$OLDPWD"
```
Expected: `PASS: idempotent`

- [ ] Clean up:

```bash
node -e "
const fs = require('fs'); const path = require('path'); const os = require('os');
const p = path.join(os.homedir(), '.claude', 'state', 'project-init.json');
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
const key = fs.realpathSync('/tmp/leanmode-initstack-fixture');
delete s[key];
fs.writeFileSync(p, JSON.stringify(s, null, 2));
"
rm -rf /tmp/leanmode-initstack-fixture
```

### Step 4: Commit

- [ ] Commit:

```bash
git add payload/hooks/lib/mark-initstack-done.mjs payload/commands/init-stack.md
git commit -m "feat: mark-initstack-done — leanmode dial defaults to full after /init-stack"
```

---

## Task 4: `leanmode-executor.md` — the new custom agent

**Files:**
- Create: `payload/agents/leanmode-executor.md`

**Interfaces:**
- Consumes: relies on `DEFAULT_LEANMODE_MAP["leanmode-executor"] === "full"` already being set
  in Task 1 — this task only needs the agent file to exist so the `subagent_type` is real and
  invokable. No code interface; the `name:` frontmatter value IS the `agent_type` string
  `SubagentStart` hooks (Task 2) receive.

### Step 1: Write the agent definition

- [ ] Create `payload/agents/leanmode-executor.md`. Confirmed via Claude Code's subagent docs:
  only `name` and `description` are required; omitting `tools:` means the agent inherits every
  tool (true `general-purpose` drop-in — do not add a `tools:` line):

```markdown
---
name: leanmode-executor
description: Use for implementation tasks where lean, minimal code is explicitly wanted — an alternative to general-purpose when you specifically want aggressive YAGNI discipline applied to this task, regardless of what level general-purpose would otherwise get.
color: green
---

<role>
You are an implementation agent for tasks where minimal, lean code is the explicit goal. You
behave like `general-purpose` in every other respect — full tool access, no scope restriction.

Your minimal-code discipline comes from the `leanmode` `SubagentStart` hook, which injects the
active rule tier automatically based on this repository's `leanmode` configuration. Nothing in
this file hardcodes that ruleset — do not duplicate it here; if this agent ever runs with no
injected context, that means leanmode's project dial is set to `off` for this project, and you
should behave like a normal `general-purpose` agent instead of inventing your own rules.
</role>
```

### Step 2: Verify the agent is discoverable and correctly mapped

- [ ] Confirm the file is syntactically valid frontmatter (bash):

```bash
node -e "
const fs = require('fs');
const raw = fs.readFileSync('payload/agents/leanmode-executor.md', 'utf8');
const m = raw.match(/^---\n([\s\S]*?)\n---/);
console.log(m ? 'PASS: frontmatter block found' : 'FAIL: no frontmatter block');
console.log(/^name: leanmode-executor$/m.test(raw) ? 'PASS: name matches' : 'FAIL: name mismatch');
console.log(/^tools:/m.test(raw) ? 'FAIL: tools: line present (should be omitted)' : 'PASS: tools: correctly omitted');
"
```
Expected: three `PASS` lines.

- [ ] Confirm Task 1's map already has the matching entry (bash, run from repo root):

```bash
node --input-type=module -e '
import { DEFAULT_LEANMODE_MAP } from "./payload/hooks/lib/leanmode-rules.mjs";
console.log(DEFAULT_LEANMODE_MAP["leanmode-executor"] === "full" ? "PASS" : "FAIL: " + DEFAULT_LEANMODE_MAP["leanmode-executor"]);
'
```
Expected: `PASS`

- [ ] After this file is deployed (`node setup.mjs`) in a real environment, confirm
  `leanmode-executor` shows up as a selectable `subagent_type` (e.g. via the Agent tool's agent
  list, or `@leanmode-executor` typeahead) — this step is a manual spot-check to run once after
  the next `node setup.mjs`, not part of this task's own commit.

### Step 3: Commit

- [ ] Commit:

```bash
git add payload/agents/leanmode-executor.md
git commit -m "feat: leanmode-executor custom agent — explicit per-task lean opt-in"
```

---

## Task 5: `/leanmode` command

**Files:**
- Create: `payload/commands/leanmode.md`

**Interfaces:**
- Consumes (conceptually, at command-execution time, not at plan-authoring time): the same
  `.claude/leanmode.json` shape `resolveBaseLevel`/`resolveDial` (Task 1) read, and
  `DEFAULT_LEANMODE_MAP` (Task 1) for the "report effective levels" step.

### Step 1: Write the command

- [ ] Create `payload/commands/leanmode.md`:

```markdown
---
description: Set or view the leanmode project dial (off/lite/full/ultra) — how aggressively subagents get nudged toward minimal code
argument-hint: "[--off|--lite|--full|--ultra]"
allowed-tools: Read, Write, Edit, Bash(node *), AskUserQuestion
---

Set the leanmode project dial for THIS project (`.claude/leanmode.json` → `dial`). Never write
anything without either an explicit flag in `$ARGUMENTS` or my confirmed choice from the
interactive menu below.

## 1. Determine the flag
Check `$ARGUMENTS` for `--off`, `--lite`, `--full`, or `--ultra`.

## 2. If no flag: interactive menu
Use `AskUserQuestion` with exactly these four options (mirrors the shift table in
`docs/superpowers/specs/2026-07-10-leanmode-design.md`):

```text
AskUserQuestion([{
  question: "Set the leanmode dial for this project:",
  header: "leanmode dial",
  options: [
    { label: "off", description: "Every agent_type -> off. leanmode fully inert for this project." },
    { label: "lite", description: "Shifts the baseline map down one step (full->lite, lite->off). off stays off." },
    { label: "full", description: "Baseline map as authored — the default once /init-stack has run for this project." },
    { label: "ultra", description: "Shifts the baseline map up one step (lite->full, full->ultra). off stays off — never nudges planning/research/review/security agents." }
  ]
}])
```

## 3. Determine project root
Walk up from the current directory to the nearest `.git`, `.planning`, `package.json`,
`pyproject.toml`, `go.mod`, or `build.gradle.kts` — same walk this repo's hooks use
(`findRoot()` in `~/.claude/hooks/lib/leanmode-rules.mjs`).

## 4. Write the config
Read `<root>/.claude/leanmode.json` if it exists (`Read`); otherwise start from `{}`. Set/merge
`dial` to the chosen value, preserving any existing `default`/`overrides` keys untouched. Write
the result back with `Write` (create `<root>/.claude/` first if it doesn't exist), pretty-printed
with a trailing newline.

## 5. Report the effective levels
Run this to show which `agent_type`s are actually active after the change (only non-`off` ones
are worth showing):

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.argv[1];
const libPath = pathToFileURL(join(homedir(), ".claude", "hooks", "lib", "leanmode-rules.mjs")).href;
const { DEFAULT_LEANMODE_MAP, resolveEffectiveLevel } = await import(libPath);
const keys = new Set(Object.keys(DEFAULT_LEANMODE_MAP));
let cfg = {};
try { cfg = JSON.parse(readFileSync(join(root, ".claude", "leanmode.json"), "utf8")); } catch {}
for (const k of Object.keys(cfg.overrides || {})) keys.add(k);
for (const k of [...keys].sort()) {
  const level = resolveEffectiveLevel(k, root);
  if (level !== "off") console.log(`${k}: ${level}`);
}
' -- "<root>"
```

(Uses a dynamic `import()` with `pathToFileURL` — not a static `import ... from "$HOME/..."` — because
`$HOME` inside a single-quoted `-e` script is never shell-expanded, and a static import specifier
can't be built from a runtime path anyway. `homedir()` resolves the real path in Node itself,
cross-platform, no shell interpolation needed.)

Present the output as a short table to me: `agent_type` → effective level. If the list is empty,
say so explicitly (e.g. dial is `off`, or every mapped agent shifted down to `off` under `lite`).
```

### Step 2: Verify the frontmatter and structure

- [ ] Run (bash):

```bash
node -e "
const fs = require('fs');
const raw = fs.readFileSync('payload/commands/leanmode.md', 'utf8');
console.log(/^---\n[\s\S]*?\n---/.test(raw) ? 'PASS: frontmatter block found' : 'FAIL');
console.log(/argument-hint:.*--off.*--lite.*--full.*--ultra/.test(raw) ? 'PASS: argument-hint lists all 4 flags' : 'FAIL');
console.log(/AskUserQuestion/.test(raw) ? 'PASS: interactive path present' : 'FAIL');
"
```
Expected: three `PASS` lines.

- [ ] Manually dry-run the reporting one-liner from Step 1.5 against a scratch fixture to confirm
  the script itself is syntactically correct (bash, run from repo root):

```bash
mkdir -p /tmp/leanmode-cmd-fixture/.claude
echo '{"dial":"ultra"}' > /tmp/leanmode-cmd-fixture/.claude/leanmode.json
node --input-type=module -e '
import { DEFAULT_LEANMODE_MAP, resolveEffectiveLevel } from "./payload/hooks/lib/leanmode-rules.mjs";
const root = "/tmp/leanmode-cmd-fixture";
for (const k of Object.keys(DEFAULT_LEANMODE_MAP).sort()) {
  const level = resolveEffectiveLevel(k, root);
  if (level !== "off") console.log(`${k}: ${level}`);
}
'
rm -rf /tmp/leanmode-cmd-fixture
```
Expected: 11 lines, each of the `DEFAULT_LEANMODE_MAP` keys shifted up one step under `ultra`
(e.g. `gsd-executor: ultra`, `general-purpose: full`).

### Step 3: Commit

- [ ] Commit:

```bash
git add payload/commands/leanmode.md
git commit -m "feat: /leanmode command — interactive + flag-driven project dial"
```

---

## Self-Review

**Spec coverage:**
- Rule text tiers (off/lite/full/ultra) → Task 1, Step 1 ✓
- `DEFAULT_LEANMODE_MAP` + always-off comment block → Task 1, Step 2 ✓
- BASE resolution (4-step) → Task 1, Step 2 (`resolveBaseLevel`), verified Task 1 Step 4 ✓
- Project dial resolution (3-step) + shift table incl. off-pinning → Task 1, Step 2
  (`resolveDial`, `shift`), verified Task 1 Steps 3 & 5 ✓
- `SubagentStart` hook + no-matcher wiring + `CLAUDE_LEANMODE=0` kill switch → Task 2 ✓
- `.claude/leanmode.json` format → consumed throughout Task 1/2/5, no separate task needed (it's
  data, not code — nothing to "implement") ✓
- `leanmode-executor` agent → Task 4 ✓
- `mark-initstack-done.mjs` + `init-stack.md` step 7 → Task 3 ✓
- `/leanmode` command (interactive + flags, writes config, reports effective levels) → Task 5 ✓
- Future third-party/MCP extension → explicitly out of scope for this plan (design doc marks it
  deferred/placeholder — no task should implement it)

**Placeholder scan:** no TBD/TODO; every code block is complete, runnable content — none deferred.

**Type consistency:** `resolveEffectiveLevel(agentType: string, root: string)` used identically
in Task 2's hook and Task 5's command; `findRoot`/`resolveBaseLevel`/`resolveDial`/`shift`/
`loadRuleText` names and signatures match between their Task 1 definition and every later
consumer. `state[root].initStackRun` key name is identical between Task 1's `resolveDial()` read
and Task 3's `mark-initstack-done.mjs` write.
