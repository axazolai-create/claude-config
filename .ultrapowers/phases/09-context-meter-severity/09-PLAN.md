# Context Fill Severity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colour the statusline's context segment by how full the model's window is, and mark it with an icon by how close automatic compaction is.

**Architecture:** One pure ladder module decides `{ colour, icon }` from two percentages. One pure autocompact module resolves where compaction fires — from an env override, from an observation, or from the window itself. A `PreCompact` hook records the observation; the statusline promotes it to a keyed entry on the next render, because only it knows the model id and window size. The renderer paints the existing text; `computeContext` is untouched.

**Tech Stack:** Plain Node.js ESM (`.mjs`), no dependencies, Node's built-in test runner (`node --test`).

## Global Constraints

- No npm dependencies. `node:*` built-ins only. This repository ships no `package.json`.
- Everything new goes in `payload/` or the installer (`setup.mjs`, `settings.partial.json`, `variants.json`). Never write to `~/.claude` by hand — this repository is the source of an installation, not a working configuration.
- Terse code: no comments except a genuine non-obvious *why*; no blank lines used only for visual grouping.
- The statusline never breaks the prompt. Any failure yields a missing segment, never an exception and never a non-zero exit.
- The ladder is exactly `15 / 45 / 70 / 85 / 95`. Colours in order: `2`, `32`, `33`, `38;5;208`, `31`, `91`. Icons from 45 up: `💡`, `⚠️`, `🔥`, `💀`.
- Colour is driven by percent of the model window. The icon is driven by percent of the way to automatic compaction. These are two different numbers.
- The default autocompact point is the full window. Never seed a guessed reserve.
- Run tests with `node --test <file>`. Full suite: `find payload .test/unit -name '*.test.mjs' -not -path '*/node_modules/*'`.

---

### Task 1: The severity ladder

**Files:**
- Create: `payload/hooks/lib/context-severity.mjs`
- Test: `payload/hooks/lib/context-severity.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `severityOf({ windowPct, acProgress }) -> { colour: string, icon: string }`. `colour` is an ANSI SGR parameter string without the escape (`"2"`, `"32"`, `"33"`, `"38;5;208"`, `"31"`, `"91"`). `icon` is `""` or one emoji. Never throws, never returns null.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/context-severity.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { severityOf } from "./context-severity.mjs";

test("severityOf: colour follows the window ladder", () => {
  assert.equal(severityOf({ windowPct: 0, acProgress: 0 }).colour, "2");
  assert.equal(severityOf({ windowPct: 14.9, acProgress: 0 }).colour, "2");
  assert.equal(severityOf({ windowPct: 15, acProgress: 0 }).colour, "32");
  assert.equal(severityOf({ windowPct: 44.9, acProgress: 0 }).colour, "32");
  assert.equal(severityOf({ windowPct: 45, acProgress: 0 }).colour, "33");
  assert.equal(severityOf({ windowPct: 70, acProgress: 0 }).colour, "38;5;208");
  assert.equal(severityOf({ windowPct: 85, acProgress: 0 }).colour, "31");
  assert.equal(severityOf({ windowPct: 95, acProgress: 0 }).colour, "91");
  assert.equal(severityOf({ windowPct: 140, acProgress: 0 }).colour, "91");
});

test("severityOf: the icon follows the autocompact ladder and is silent below 45", () => {
  assert.equal(severityOf({ windowPct: 99, acProgress: 0 }).icon, "");
  assert.equal(severityOf({ windowPct: 99, acProgress: 44.9 }).icon, "");
  assert.equal(severityOf({ windowPct: 0, acProgress: 45 }).icon, "💡");
  assert.equal(severityOf({ windowPct: 0, acProgress: 70 }).icon, "⚠️");
  assert.equal(severityOf({ windowPct: 0, acProgress: 85 }).icon, "🔥");
  assert.equal(severityOf({ windowPct: 0, acProgress: 95 }).icon, "💀");
  assert.equal(severityOf({ windowPct: 0, acProgress: 300 }).icon, "💀");
});

test("severityOf: the two scales are independent", () => {
  assert.deepEqual(severityOf({ windowPct: 32, acProgress: 96 }), { colour: "32", icon: "💀" });
  assert.deepEqual(severityOf({ windowPct: 96, acProgress: 32 }), { colour: "91", icon: "" });
});

test("severityOf: junk degrades to grey and no icon, never throws", () => {
  assert.deepEqual(severityOf(), { colour: "2", icon: "" });
  assert.deepEqual(severityOf({}), { colour: "2", icon: "" });
  assert.deepEqual(severityOf({ windowPct: null, acProgress: undefined }), { colour: "2", icon: "" });
  assert.deepEqual(severityOf({ windowPct: NaN, acProgress: "x" }), { colour: "2", icon: "" });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test payload/hooks/lib/context-severity.test.mjs`
Expected: FAIL — `Cannot find module './context-severity.mjs'`.

- [ ] **Step 3: Write the implementation**

```js
// payload/hooks/lib/context-severity.mjs
// The ladder is 15/45/70/85/95. Colour reads percent of the model window; the icon reads
// percent of the way to automatic compaction. Two questions, two numbers, one ladder.
const COLOURS = [[95, "91"], [85, "31"], [70, "38;5;208"], [45, "33"], [15, "32"]];
const ICONS = [[95, "💀"], [85, "🔥"], [70, "⚠️"], [45, "💡"]];

const pick = (table, value, fallback) => {
  if (!Number.isFinite(value)) return fallback;
  for (const [floor, out] of table) if (value >= floor) return out;
  return fallback;
};

export function severityOf({ windowPct, acProgress } = {}) {
  return {
    colour: pick(COLOURS, Number(windowPct), "2"),
    icon: pick(ICONS, Number(acProgress), ""),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test payload/hooks/lib/context-severity.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/context-severity.mjs payload/hooks/lib/context-severity.test.mjs
git commit -m "feat(statusline): the context severity ladder"
```

---

### Task 2: Expose the context metrics `computeContext` already parses

**Files:**
- Modify: `payload/hooks/lib/statusline-lib.mjs`
- Test: `payload/hooks/lib/statusline-lib.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `contextMetrics(data) -> { windowSize: number, tokens: number, pct: number|null|undefined } | null`. `null` when there is nothing to show — the same condition under which `computeContext` returns `""`. `computeContext(data) -> string` keeps its exact current signature and output.

This task must not change a single character of `computeContext`'s output. The three existing tests in this file assert its strings and must keep passing untouched.

- [ ] **Step 1: Write the failing test**

Append to `payload/hooks/lib/statusline-lib.test.mjs`, and add `contextMetrics` to the existing import on line 4:

```js
test("contextMetrics: the numbers behind the segment", () => {
  const m = contextMetrics({ context_window: { context_window_size: 200000, used_percentage: 22,
    current_usage: { input_tokens: 40000, cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 2000, output_tokens: 500 } } });
  assert.equal(m.windowSize, 200000);
  assert.equal(m.tokens, 43500);
  assert.equal(m.pct, 22);
});

test("contextMetrics: estimates tokens from the percentage when current_usage is absent", () => {
  const m = contextMetrics({ context_window: { total_tokens: 200000, used_percentage: 10 } });
  assert.equal(m.windowSize, 200000);
  assert.equal(m.tokens, 20000);
});

test("contextMetrics: null exactly where computeContext returns empty", () => {
  assert.equal(contextMetrics({}), null);
  assert.equal(computeContext({}), "");
  assert.equal(contextMetrics({ context_window: {} }), null);
  assert.equal(computeContext({ context_window: {} }), "");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test payload/hooks/lib/statusline-lib.test.mjs`
Expected: FAIL — `contextMetrics is not a function`. The pre-existing tests in the file still pass.

- [ ] **Step 3: Extract the parse, make `computeContext` consume it**

Replace the body of `computeContext` in `payload/hooks/lib/statusline-lib.mjs` with these two functions, keeping the existing doc comment above `computeContext`:

```js
export function contextMetrics(data) {
  const cw = data && data.context_window;
  if (!cw) return null;
  const windowSize = cw.context_window_size ?? cw.total_tokens ?? 1_000_000;
  const u = cw.current_usage;
  let used = null;
  if (u && typeof u === "object") {
    const sum = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) +
      (Number(u.cache_read_input_tokens) || 0) + (Number(u.output_tokens) || 0);
    if (sum > 0) used = sum;
  }
  const pct = cw.used_percentage;
  if (used == null && pct == null) return null;
  return { windowSize, tokens: used != null ? used : (windowSize * pct) / 100, pct };
}

export function computeContext(data) {
  const m = contextMetrics(data);
  if (!m) return "";
  return `${formatCurrentTokens(m.tokens)}/${formatContextWindow(m.windowSize)}` +
    (m.pct == null ? "" : ` ${Math.round(m.pct)}%`);
}
```

- [ ] **Step 4: Run the whole file, including the untouched tests**

Run: `node --test payload/hooks/lib/statusline-lib.test.mjs`
Expected: PASS. The three pre-existing `computeContext` tests must pass without being edited — that is the proof the extraction changed nothing.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/statusline-lib.mjs payload/hooks/lib/statusline-lib.test.mjs
git commit -m "refactor(statusline): expose the metrics computeContext already parses"
```

---

### Task 3: Resolving the autocompact point

**Files:**
- Create: `payload/hooks/lib/autocompact.mjs`
- Test: `payload/hooks/lib/autocompact.test.mjs`

**Interfaces:**
- Consumes: nothing. Every function is pure; callers do their own I/O.
- Produces:
  - `resolveAutocompact({ windowSize, modelId, state, env, enabled }) -> { tokens: number, source: "env"|"observed"|"assumed"|"disabled" } | null`
  - `observationFrom(records) -> { tokens: number, model: string } | null`
  - `promotePending(state, { modelId, windowSize }) -> { next: object, changed: boolean }`
  - `autoCompactEnabledFrom(settings) -> boolean`

State shape written to `~/.claude/state/autocompact.json`:
`{ "pending": { "tokens": number, "model": string, "at": string }, "models": { "<model.id>": { "tokens": number, "windowSize": number, "observedAt": string } } }`

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/autocompact.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAutocompact, observationFrom, promotePending, autoCompactEnabledFrom } from "./autocompact.mjs";

test("resolveAutocompact: an explicit env override wins", () => {
  const r = resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state: null,
    env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "80" }, enabled: true });
  assert.deepEqual(r, { tokens: 800000, source: "env" });
});

test("resolveAutocompact: an observation for this model beats the assumption", () => {
  const state = { models: { m: { tokens: 835000, windowSize: 1_000_000 } } };
  assert.deepEqual(resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state, env: {}, enabled: true }),
    { tokens: 835000, source: "observed" });
});

test("resolveAutocompact: an observation for another model is not borrowed", () => {
  const state = { models: { other: { tokens: 180000, windowSize: 200000 } } };
  assert.deepEqual(resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state, env: {}, enabled: true }),
    { tokens: 1_000_000, source: "assumed" });
});

test("resolveAutocompact: with nothing known the point is the window itself", () => {
  assert.deepEqual(resolveAutocompact({ windowSize: 200000, modelId: "m", state: null, env: {}, enabled: true }),
    { tokens: 200000, source: "assumed" });
});

test("resolveAutocompact: compaction turned off means there is nothing to warn about", () => {
  assert.deepEqual(resolveAutocompact({ windowSize: 200000, modelId: "m",
    state: { models: { m: { tokens: 100000 } } }, env: {}, enabled: false }),
    { tokens: 200000, source: "disabled" });
});

test("resolveAutocompact: a junk env value is ignored, not obeyed", () => {
  for (const v of ["0", "-5", "101", "abc", ""]) {
    assert.equal(resolveAutocompact({ windowSize: 200000, modelId: "m", state: null,
      env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: v }, enabled: true }).source, "assumed");
  }
});

test("resolveAutocompact: null without a usable window", () => {
  assert.equal(resolveAutocompact({ windowSize: 0, modelId: "m", state: null, env: {}, enabled: true }), null);
  assert.equal(resolveAutocompact({ windowSize: NaN, modelId: "m", state: null, env: {}, enabled: true }), null);
});

test("observationFrom: sums the last assistant usage", () => {
  const records = [
    { type: "user", message: { content: "hi" } },
    { type: "assistant", message: { model: "claude-opus-5", usage: { input_tokens: 1, output_tokens: 2,
      cache_creation_input_tokens: 3, cache_read_input_tokens: 4 } } },
    { type: "assistant", message: { model: "claude-opus-5", usage: { input_tokens: 10, output_tokens: 20,
      cache_creation_input_tokens: 30, cache_read_input_tokens: 40 } } },
  ];
  assert.deepEqual(observationFrom(records), { tokens: 100, model: "claude-opus-5" });
});

test("observationFrom: nothing usable yields null", () => {
  assert.equal(observationFrom([]), null);
  assert.equal(observationFrom([{ type: "user", message: { content: "x" } }]), null);
  assert.equal(observationFrom([{ type: "assistant", message: {} }]), null);
  assert.equal(observationFrom([{ type: "assistant", message: { usage: { input_tokens: 0 } } }]), null);
});

test("promotePending: an unkeyed record becomes a keyed one and the pending clears", () => {
  const state = { pending: { tokens: 835000, model: "claude-opus-5", at: "2026-07-30T18:00:00Z" } };
  const { next, changed } = promotePending(state, { modelId: "claude-opus-5[1m]", windowSize: 1_000_000 });
  assert.equal(changed, true);
  assert.equal(next.pending, undefined);
  assert.equal(next.models["claude-opus-5[1m]"].tokens, 835000);
  assert.equal(next.models["claude-opus-5[1m]"].windowSize, 1_000_000);
});

test("promotePending: a figure bigger than this window is discarded, not promoted", () => {
  const state = { pending: { tokens: 835000, model: "claude-opus-5", at: "2026-07-30T18:00:00Z" } };
  const { next, changed } = promotePending(state, { modelId: "claude-opus-5", windowSize: 200000 });
  assert.equal(changed, true);
  assert.equal(next.pending, undefined);
  assert.equal(next.models, undefined);
});

test("promotePending: no pending means no write", () => {
  assert.deepEqual(promotePending({ models: {} }, { modelId: "m", windowSize: 1000 }),
    { next: { models: {} }, changed: false });
  assert.equal(promotePending(null, { modelId: "m", windowSize: 1000 }).changed, false);
});

test("autoCompactEnabledFrom: absent means on", () => {
  assert.equal(autoCompactEnabledFrom({}), true);
  assert.equal(autoCompactEnabledFrom(null), true);
  assert.equal(autoCompactEnabledFrom({ autoCompactEnabled: true }), true);
  assert.equal(autoCompactEnabledFrom({ autoCompactEnabled: false }), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test payload/hooks/lib/autocompact.test.mjs`
Expected: FAIL — `Cannot find module './autocompact.mjs'`.

- [ ] **Step 3: Write the implementation**

```js
// payload/hooks/lib/autocompact.mjs
// Where automatic compaction fires, and how that gets learned. PreCompact carries no
// context_window, so the hook records an unkeyed observation in tokens and the statusline
// promotes it once it knows the model id and window. Keying on the transcript's own model
// id would collide: its 200K and 1M variants share it.
export function resolveAutocompact({ windowSize, modelId, state, env = process.env, enabled = true } = {}) {
  const w = Number(windowSize);
  if (!Number.isFinite(w) || w <= 0) return null;
  if (!enabled) return { tokens: w, source: "disabled" };
  const pct = Number(env && env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
  if (Number.isFinite(pct) && pct > 0 && pct <= 100) return { tokens: (w * pct) / 100, source: "env" };
  const seen = state && state.models && state.models[modelId];
  const tokens = seen && Number(seen.tokens);
  if (Number.isFinite(tokens) && tokens > 0) return { tokens, source: "observed" };
  return { tokens: w, source: "assumed" };
}

export function observationFrom(records) {
  if (!Array.isArray(records)) return null;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    const u = r && r.type === "assistant" && r.message && r.message.usage;
    if (!u) continue;
    const tokens = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) +
      (Number(u.cache_read_input_tokens) || 0) + (Number(u.output_tokens) || 0);
    if (tokens > 0) return { tokens, model: (r.message.model || "") };
  }
  return null;
}

export function promotePending(state, { modelId, windowSize } = {}) {
  const next = { ...(state || {}) };
  const p = next.pending;
  if (!p || !Number.isFinite(Number(p.tokens))) return { next: state || {}, changed: false };
  delete next.pending;
  const w = Number(windowSize);
  if (Number.isFinite(w) && w > 0 && Number(p.tokens) <= w) {
    next.models = { ...(next.models || {}),
      [modelId]: { tokens: Number(p.tokens), windowSize: w, observedAt: p.at } };
  }
  return { next, changed: true };
}

export function autoCompactEnabledFrom(settings) {
  return !(settings && settings.autoCompactEnabled === false);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test payload/hooks/lib/autocompact.test.mjs`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/autocompact.mjs payload/hooks/lib/autocompact.test.mjs
git commit -m "feat(statusline): resolve and learn the autocompact point"
```

---

### Task 4: The observing hook

**Files:**
- Create: `payload/hooks/precompact-observe.mjs`

**Interfaces:**
- Consumes: `observationFrom` from Task 3; `safe`, `readJSON`, `writeFile`, `readJSONLRecords` from `./lib/token-usage-shared.mjs`.
- Produces: a `pending` record in `~/.claude/state/autocompact.json`. Nothing imports this file.

No unit test on this file: it is an I/O wrapper whose only logic (`observationFrom`) is already tested in Task 3, and the repository's convention is that pure wiring is covered by the integration it enables. Step 3 verifies it by running it.

- [ ] **Step 1: Write the hook**

```js
#!/usr/bin/env node
// payload/hooks/precompact-observe.mjs
// PreCompact carries no context_window, so the compaction point cannot be read where it
// fires. The transcript's last assistant usage is that point, in tokens. Recorded unkeyed;
// statusline.mjs promotes it once it knows the model id and window size.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { safe, readJSON, writeFile, readJSONLRecords } from "./lib/token-usage-shared.mjs";
import { observationFrom } from "./lib/autocompact.mjs";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const STATE = join(CLAUDE_DIR, "state", "autocompact.json");

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }
if (d.trigger !== "auto" || !d.transcript_path) process.exit(0);

const seen = safe(() => observationFrom(readJSONLRecords(d.transcript_path)));
if (!seen) process.exit(0);

const state = safe(() => readJSON(STATE)) || {};
state.pending = { tokens: seen.tokens, model: seen.model, at: new Date().toISOString() };
writeFile(STATE, JSON.stringify(state, null, 2));
process.exit(0);
```

`readFileSync(0, "utf8")` is how `token-usage-log.mjs:61` reads stdin in this repository — fd 0, not a stream, because the hook is short-lived and synchronous.

- [ ] **Step 2: Verify it ignores a manual compaction**

```bash
echo '{"trigger":"manual","transcript_path":"nope.jsonl"}' | node payload/hooks/precompact-observe.mjs
echo "exit=$?"
```
Expected: `exit=0`, and no `autocompact.json` created anywhere.

- [ ] **Step 3: Verify it records an automatic one**

```bash
TMP=$(mktemp -d)
printf '%s\n' '{"type":"assistant","message":{"model":"claude-opus-5","usage":{"input_tokens":1,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":4}}}' > "$TMP/t.jsonl"
CLAUDE_CONFIG_DIR="$TMP" sh -c "echo '{\"trigger\":\"auto\",\"transcript_path\":\"$TMP/t.jsonl\"}' | node payload/hooks/precompact-observe.mjs"
cat "$TMP/state/autocompact.json"
```
Expected: exit 0 and a file whose `pending.tokens` is `10` and `pending.model` is `claude-opus-5`.

- [ ] **Step 4: Verify a broken transcript is survivable**

```bash
echo '{"trigger":"auto","transcript_path":"/does/not/exist.jsonl"}' | node payload/hooks/precompact-observe.mjs
echo "exit=$?"
```
Expected: `exit=0`, no crash, no output.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/precompact-observe.mjs
git commit -m "feat(statusline): observe where automatic compaction fires"
```

---

### Task 5: Paint the segment

**Files:**
- Modify: `payload/hooks/statusline.mjs`
- Test: `payload/hooks/statusline.test.mjs`

**Interfaces:**
- Consumes: `severityOf` (Task 1), `contextMetrics` (Task 2), `resolveAutocompact` / `promotePending` / `autoCompactEnabledFrom` (Task 3).
- Produces: `paintContext(text, { colour, icon }) -> string`, exported for the test.

The two pre-existing entry-point context tests assert `strip(out.stdout).startsWith("43.5K/200K 22% │ ")` and `"20.0K/200K 10% │ "`. At 22% and 10% with no observation the assumed autocompact point is the window, so `acProgress` equals the window percentage, both are below 45, and no icon is appended. Those tests must keep passing unedited. If either fails, the wiring is wrong — do not edit the test.

- [ ] **Step 1: Write the failing test**

The helpers in this file, at lines 150-163, are: `dir(...parts)` makes a scratch directory under
`TMP`; `write(path, content)` writes one; `payload(root, extra)` builds the stdin JSON as
`{ workspace: { current_dir: root }, ...extra }`; and `runEntry(input, { claudeDir })` spawns
the entry point with `CLAUDE_CONFIG_DIR` set. **The project root and the claude dir are two
different arguments** — state files belong under `claudeDir`, never under the payload root.

First make the harness deterministic for this phase. In `runEntry`, beside the existing
`delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;`, add:

```js
  delete env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
```

Then append these tests, adding `paintContext` to the existing import on line 9:

```js
test("paintContext: wraps in the colour and hangs the icon outside it", () => {
  assert.equal(paintContext("12K/1M 12%", { colour: "32", icon: "" }), "\x1b[32m12K/1M 12%\x1b[0m");
  assert.equal(paintContext("12K/1M 12%", { colour: "91", icon: "💀" }), "\x1b[91m12K/1M 12%\x1b[0m 💀");
  assert.equal(paintContext("", { colour: "91", icon: "💀" }), "");
});

test("entry point: a full window is bright red and carries the skull", () => {
  const out = runEntry(payload(dir("proj-hot"), {
    context_window: { context_window_size: 200000, used_percentage: 96,
      current_usage: { input_tokens: 192000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir: dir("claude-hot") });
  assert.equal(out.status, 0);
  assert.ok(out.stdout.includes("\x1b[91m"), `no bright red: ${JSON.stringify(out.stdout)}`);
  assert.ok(out.stdout.includes("💀"), `no skull: ${JSON.stringify(out.stdout)}`);
});

test("entry point: an empty window is grey and silent", () => {
  const out = runEntry(payload(dir("proj-cold"), {
    context_window: { context_window_size: 1000000, used_percentage: 3,
      current_usage: { input_tokens: 30000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir: dir("claude-cold") });
  assert.equal(out.status, 0);
  assert.ok(out.stdout.includes("\x1b[2m30.0K/1M 3%\x1b[0m"), `got: ${JSON.stringify(out.stdout)}`);
  for (const icon of ["💡", "⚠️", "🔥", "💀"]) assert.equal(out.stdout.includes(icon), false);
});

test("entry point: an observed autocompact point makes the icon lead the colour", () => {
  const claudeDir = dir("claude-lead");
  write(join(claudeDir, "state", "autocompact.json"), JSON.stringify({
    models: { "claude-opus-5[1m]": { tokens: 600000, windowSize: 1000000 } },
  }));
  const out = runEntry(payload(dir("proj-lead"), {
    model: { id: "claude-opus-5[1m]", display_name: "Opus 5 (1M context)" },
    context_window: { context_window_size: 1000000, used_percentage: 32,
      current_usage: { input_tokens: 320000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir });
  assert.equal(out.status, 0);
  assert.ok(out.stdout.includes("\x1b[32m"), `expected green: ${JSON.stringify(out.stdout)}`);
  assert.ok(out.stdout.includes("💡"), `expected the lamp: ${JSON.stringify(out.stdout)}`);
});

test("entry point: a pending observation is promoted and cleared", () => {
  const claudeDir = dir("claude-promote");
  const statePath = join(claudeDir, "state", "autocompact.json");
  write(statePath, JSON.stringify({
    pending: { tokens: 400000, model: "claude-opus-5", at: "2026-07-30T18:00:00Z" },
  }));
  const out = runEntry(payload(dir("proj-promote"), {
    model: { id: "claude-opus-5[1m]", display_name: "Opus 5 (1M context)" },
    context_window: { context_window_size: 1000000, used_percentage: 10,
      current_usage: { input_tokens: 100000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir });
  assert.equal(out.status, 0);
  const after = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(after.pending, undefined);
  assert.equal(after.models["claude-opus-5[1m]"].tokens, 400000);
});
```

`payload()` spreads `extra` at the top level, so passing `model` works with no change to the
helper. That fourth test is the whole reason the two scales exist: 320K of a 1M window is 32%
and green, but it is 53% of the way to a compaction observed at 600K, so the lamp is already
lit while the figure still reads calm. Check the arithmetic when changing these numbers — at a
400K point the same 320K would be 80% and the icon would be ⚠️, not 💡.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: FAIL — `paintContext is not a function`, plus the four entry-point tests failing on missing colour codes.

- [ ] **Step 3: Wire it up**

Extend the existing `node:fs` import on line 5 with `writeFileSync` — do not add a second
import from the same module:

```js
import { readFileSync, writeFileSync, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
```

Extend the existing `statusline-lib.mjs` import with `contextMetrics`, and add the two new
modules:

```js
import { computeContext, contextMetrics } from "./lib/statusline-lib.mjs";
import { severityOf } from "./lib/context-severity.mjs";
import { resolveAutocompact, promotePending, autoCompactEnabledFrom } from "./lib/autocompact.mjs";
```

Neither new module may import `node:child_process` or call `spawn`/`exec` in any form. The
"no subprocess" property test at `statusline.test.mjs:168` walks the entry point and every lib
it imports transitively and asserts exactly that — it is what keeps this renderer cheap enough
to run on every prompt.

Add the painter beside the other renderers:

```js
export function paintContext(text, { colour, icon } = {}) {
  if (!text) return "";
  const painted = colour ? `\x1b[${colour}m${text}\x1b[0m` : text;
  return icon ? `${painted} ${icon}` : painted;
}
```

Add the segment builder above `main`:

```js
function contextSegment(data) {
  const text = safe(() => computeContext(data), "") || "";
  if (!text) return "";
  const m = safe(() => contextMetrics(data), null);
  if (!m) return text;
  const statePath = join(CLAUDE_DIR, "state", "autocompact.json");
  const modelId = (data.model && data.model.id) || "";
  let state = safe(() => JSON.parse(readFileSync(statePath, "utf8")), null) || {};
  const promoted = safe(() => promotePending(state, { modelId, windowSize: m.windowSize }), null);
  if (promoted && promoted.changed) {
    state = promoted.next;
    safe(() => writeFileSync(statePath, JSON.stringify(state, null, 2)));
  }
  const settings = safe(() => JSON.parse(readFileSync(join(CLAUDE_DIR, "settings.json"), "utf8")), null);
  const ac = safe(() => resolveAutocompact({ windowSize: m.windowSize, modelId, state,
    enabled: autoCompactEnabledFrom(settings) }), null);
  const windowPct = m.pct != null ? Number(m.pct) : (m.tokens / m.windowSize) * 100;
  const acProgress = ac && ac.tokens > 0 ? (m.tokens / ac.tokens) * 100 : windowPct;
  return paintContext(text, severityOf({ windowPct, acProgress }));
}
```

Then in `main`, replace the `context:` line with:

```js
    context: safe(() => contextSegment(data), "") || "",
```

- [ ] **Step 4: Run the whole file**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: PASS. The two pre-existing context tests must be green without having been edited.

- [ ] **Step 5: Run the full suite**

Run: `node --test $(find payload .test/unit -name '*.test.mjs' -not -path '*/node_modules/*' | tr '\n' ' ')`
Expected: 0 failures.

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/statusline.mjs payload/hooks/statusline.test.mjs
git commit -m "feat(statusline): colour the context segment and mark it near compaction"
```

---

### Task 6: Register the hook and document the segment

**Files:**
- Modify: `settings.partial.json`
- Modify: `README.md`
- Modify: `README.en.md`

**Interfaces:**
- Consumes: the hook path from Task 4.
- Produces: nothing importable. This is installer wiring plus documentation.

`variants.json` needs no change: its `alwaysExclude` covers `hooks/task-lifecycle-probe*`, `claude-md/**` and `**.test.mjs`, and `base`/`lite` exclude `hooks/gsd-*`. `precompact-observe.mjs` matches none of those, so it ships on every profile, which is correct — the segment it feeds is on every profile.

- [ ] **Step 1: Register the hook**

Add to `settings.partial.json` under `hooks`, in the same shape as the existing `SubagentStop` entry:

```json
  "PreCompact": [
    {
      "hooks": [
        { "type": "command", "command": "node", "args": ["<HOME>/.claude/hooks/precompact-observe.mjs"] }
      ]
    }
  ]
```

- [ ] **Step 2: Verify the file still parses and the installer sees the hook**

```bash
node -e "const j=require('./settings.partial.json'); console.log(Object.keys(j.hooks).join(', ')); console.log(j.hooks.PreCompact[0].hooks[0].args[0])"
node setup.mjs --dry-run | grep -i -E 'precompact|statusline|context-severity|autocompact'
```
Expected: `PreCompact` listed among the events, the path printed, and the dry run showing `created`/`updated` lines for `hooks/precompact-observe.mjs`, `hooks/lib/context-severity.mjs`, `hooks/lib/autocompact.mjs`.

- [ ] **Step 3: Document the segment in both READMEs**

Find the hook table in each README (the one listing `token-usage-log.mjs` with its event) and add a row in the same style:

```
precompact-observe.mjs               # PreCompact — records where automatic compaction fired
```

In the statusline section of each README, replace the description of the context segment with one that states both ladders: colour by percent of the model window at 15/45/70/85/95, icon by percent of the way to automatic compaction at 45/70/85/95 (`💡 ⚠️ 🔥 💀`), the autocompact point resolved from `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, then an observation, then the window itself.

- [ ] **Step 4: Run the full suite once more**

Run: `node --test $(find payload .test/unit -name '*.test.mjs' -not -path '*/node_modules/*' | tr '\n' ' ')`
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add settings.partial.json README.md README.en.md
git commit -m "feat(installer): register the PreCompact observer, document the severity ladders"
```

---

## Verification before the phase closes

- [ ] `node setup.mjs --dry-run` exits 0 and lists the three new files.
- [ ] Full suite green.
- [ ] Deploy with `node setup.mjs`, restart Claude Code, and confirm the context segment is coloured at the current fill level.
- [ ] File the deferred acceptance check for `RISK-STATUSLINE-002` (see below): after one automatic compaction, `~/.claude/state/autocompact.json` holds a `models` entry whose `tokens` is below `windowSize`, and no `pending` key remains.

## Risks to file in `RISK_REGISTER.md`

- **RISK-STATUSLINE-002 — the autocompact point is assumed until a compaction is observed.** Until then the icon ladder equals the colour ladder and `💀` cannot appear ahead of a compaction that has never happened. Accepted over seeding a guessed reserve. Acceptance check as above.
