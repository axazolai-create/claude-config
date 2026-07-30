# Unified Statusline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the install-time choice between two statusline renderers with one renderer that composes a fixed floor plus segments that appear only when their source exists.

**Architecture:** `payload/hooks/statusline.mjs` becomes the only renderer for every profile. It reads the statusLine payload from stdin and renders six segments — updates, model, context, project, gsd, ultrapowers — joined by a dim pipe. `gsd-context-meter.mjs` and the machinery that wrapped gsd-core's own `gsd-statusline.js` are deleted. Pure formatting stays in `payload/hooks/lib/statusline-lib.mjs`; the entry point does I/O and composition only.

**Tech Stack:** Plain Node.js ESM (`.mjs`), `node:*` built-ins only, Node's built-in test runner (`node --test`).

## Global Constraints

- **No npm dependencies.** This repository ships no `package.json`. Use only `node:*` built-ins.
- **Payload-only.** Everything goes to `payload/` or the installer. Never develop into `~/.claude` or into this project's own `.claude/`. Legitimate exceptions: `setup.mjs` and its tests, `variants.json`, `settings.partial.json`, the top-level READMEs, and the repo's own records under `.ultrapowers/`.
- **Tests run with `node --test <file>`**, `node:test` + `node:assert/strict`.
- **Small helpers are reimplemented locally, not cross-imported** across the `hooks/` ↔ `bin/` layer boundary. This is the repository's stated convention.
- **The statusline never breaks the prompt.** Any failure yields a missing segment or an empty line, never a non-zero exit and never a stack trace on stdout.
- **Terse code.** Comments only for a genuine non-obvious *why*. No comments that restate the code.
- **No deploy in this plan.** Phase 07's rule stands: one serialised deploy from `master` after the branch lands, gated on an audit and a written impact assessment.

## File Structure

| file | responsibility | fate |
|---|---|---|
| `payload/hooks/statusline.mjs` | the only renderer: stdin → segments → one line | rewritten |
| `payload/hooks/lib/statusline-lib.mjs` | pure formatting: token/window strings, context segment | reworked |
| `payload/hooks/gsd-context-meter.mjs` | wrapper around gsd-core's renderer | deleted |
| `payload/hooks/lib/gsd-context-meter-lib.mjs` | `rewriteContextBar` + re-exports | deleted |
| `payload/hooks/lib/gsd-context-meter-lib.test.mjs` | tests for the above | deleted |
| `payload/hooks/lib/gsd-statusline-registration.mjs` | `/init-stack`'s non-interactive takeover | retargeted |
| `settings.partial.json` | the shipped `statusLine` key | retargeted |
| `setup.mjs:995-1024` | per-profile registration | collapsed to one branch |
| `setup-variants.e2e.test.mjs` | end-to-end per-profile assertions | updated |
| `variants.test.mjs` | profile file-set assertions | updated |
| `payload/hooks/statusline.test.mjs` | the process-boundary seam | extended |
| `payload/hooks/lib/statusline-lib.test.mjs` | pure-function units | updated |
| `README.md`, `README.en.md` | the component tables | updated |

---

### Task 1: Capture a live statusLine payload

The spec asserts from documentation that the window size arrives as `context_window_size` and not `total_tokens`. Every `total_tokens` occurrence in this repository is self-authored. Before any code trusts either name, capture one real payload.

**This task needs a human.** It registers a dump script, requires a Claude Code restart, and restores the previous setting. An agentic executor that cannot restart Claude Code must stop here, say so, and let the human run it.

**Files:**
- Create: `.ultrapowers/phases/08-unified-statusline/refs/live-statusline-payload.json`

**Interfaces:**
- Produces: a captured payload every later task reads field names from. No functions.

- [ ] **Step 1: Write the dump script to a temporary location**

```bash
mkdir -p "$CLAUDE_JOB_DIR/tmp" 2>/dev/null || mkdir -p /tmp
cat > "$HOME/.claude/hooks/_payload-dump.mjs" <<'EOF'
import { writeFileSync } from "node:fs";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  try { writeFileSync(`${process.env.HOME || process.env.USERPROFILE}/.claude/_payload.json`, input); } catch {}
  process.stdout.write("capturing…");
});
EOF
```

- [ ] **Step 2: Record the current statusLine setting, then point it at the dump**

```bash
node -e "
const fs=require('fs'), p=process.env.USERPROFILE+'/.claude/settings.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
fs.writeFileSync(process.env.USERPROFILE+'/.claude/_statusline-backup.json', JSON.stringify(j.statusLine ?? null));
j.statusLine={type:'command',command:'node \"'+process.env.USERPROFILE.replace(/\\\\/g,'/')+'/.claude/hooks/_payload-dump.mjs\"'};
fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
console.log('statusLine redirected; previous value saved');
"
```

- [ ] **Step 3: Restart Claude Code and send one prompt**

The statusline renders on every prompt. One is enough. `~/.claude/_payload.json` now holds a real payload.

- [ ] **Step 4: Restore the previous statusLine**

```bash
node -e "
const fs=require('fs'), p=process.env.USERPROFILE+'/.claude/settings.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
const b=JSON.parse(fs.readFileSync(process.env.USERPROFILE+'/.claude/_statusline-backup.json','utf8'));
if (b===null) delete j.statusLine; else j.statusLine=b;
fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
fs.rmSync(process.env.USERPROFILE+'/.claude/hooks/_payload-dump.mjs',{force:true});
fs.rmSync(process.env.USERPROFILE+'/.claude/_statusline-backup.json',{force:true});
console.log('restored');
"
```

- [ ] **Step 5: Save the payload as a phase reference and report the field names**

```bash
mkdir -p .ultrapowers/phases/08-unified-statusline/refs
node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync(process.env.USERPROFILE+'/.claude/_payload.json','utf8'));
fs.writeFileSync('.ultrapowers/phases/08-unified-statusline/refs/live-statusline-payload.json', JSON.stringify(j,null,2)+'\n');
console.log('context_window keys:', Object.keys(j.context_window||{}).join(', '));
console.log('model keys:', Object.keys(j.model||{}).join(', '));
console.log('workspace keys:', Object.keys(j.workspace||{}).join(', '));
"
```

Expected: `context_window keys:` includes exactly one of `context_window_size` or `total_tokens`. Record which. `model keys:` includes `display_name`.

- [ ] **Step 6: Commit**

```bash
git add .ultrapowers/phases/08-unified-statusline/refs/live-statusline-payload.json
git commit -m "docs(phase-08): capture a live statusLine payload"
```

**If the capture cannot be performed**, write the reason into `08-STATE.md` and continue. Task 3's read order falls through both names, so the code is correct either way — only the certainty is lost.

---

### Task 2: One renderer for every profile

Delete the wrapper and repoint every registration site at `hooks/statusline.mjs`. The renderer itself is not yet touched, so `full` temporarily loses the model segment it used to get from gsd-core — Task 4 restores it. Nothing is broken at any point.

**Files:**
- Delete: `payload/hooks/gsd-context-meter.mjs`
- Delete: `payload/hooks/lib/gsd-context-meter-lib.mjs`
- Delete: `payload/hooks/lib/gsd-context-meter-lib.test.mjs`
- Modify: `payload/hooks/lib/gsd-statusline-registration.mjs:11-14,24`
- Modify: `settings.partial.json` (the `statusLine` key)
- Modify: `setup.mjs:1002-1024`
- Modify: `setup-variants.e2e.test.mjs` (statusLine and gsd-context-meter assertions)
- Modify: `variants.test.mjs:110,269,286`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `statusLine.command` is `node "<claudeDir>/hooks/statusline.mjs"` on every profile. No module exports change.

- [ ] **Step 1: Write the failing test — registration no longer varies by profile**

In `setup-variants.e2e.test.mjs`, replace the body of the test named `statusLine follows the profile: full<->base swaps the renderer, and re-running is idempotent` with this, and rename it:

```js
test("statusLine is the same renderer on every profile, and re-running is idempotent", () => {
  const dir = freshHome();
  const statusLine = () => JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).statusLine;

  runSetup(dir, ["--variant=full"]);
  assert.match(statusLine().command, /hooks\/statusline\.mjs"$/);
  assert.ok(existsSync(join(dir, "hooks/statusline.mjs")));
  assert.ok(!existsSync(join(dir, "hooks/gsd-context-meter.mjs")), "the wrapper is gone");

  runSetup(dir, ["--variant=base"]);
  const base = statusLine();
  assert.match(base.command, /hooks\/statusline\.mjs"$/);

  runSetup(dir, ["--variant=base"]);
  assert.deepEqual(statusLine(), base, "a second base run changed its own entry");

  runSetup(dir, ["--variant=lite"]);
  assert.match(statusLine().command, /hooks\/statusline\.mjs"$/);
});
```

`freshHome()` and `runSetup()` are this file's existing helpers — reuse them exactly as the neighbouring tests do.

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test setup-variants.e2e.test.mjs`
Expected: FAIL — `full` still writes `hooks/gsd-context-meter.mjs`.

- [ ] **Step 3: Collapse the registration in `setup.mjs`**

Replace `setup.mjs:1002-1024` with:

```js
    // Either historical renderer counts as ours, in both directions: a profile switch prunes the
    // file the old entry pointed at, so a takeover that recognised only one would leave statusLine
    // aimed at nothing and render an empty line on every prompt.
    const ourStatusLine = (cmd) => typeof cmd === "string"
      && (cmd.includes("gsd-context-meter") || cmd.includes("hooks/statusline.mjs"));
    if (partial.statusLine) {
      const curCmd = merged.statusLine && merged.statusLine.command;
      const isGsdCoreDefault = typeof curCmd === "string" && curCmd.includes("gsd-statusline.js");
      if (!curCmd || isGsdCoreDefault || ourStatusLine(curCmd)) {
        const scriptPath = join(CDIR, "hooks", "statusline.mjs").replace(/\\/g, "/");
        merged.statusLine = { type: "command", ...partial.statusLine, command: `node "${scriptPath}"` };
      }
    }
```

- [ ] **Step 4: Retarget `settings.partial.json`**

```json
  "statusLine": {
    "type": "command",
    "command": "node \"<HOME>/.claude/hooks/statusline.mjs\""
  }
```

- [ ] **Step 5: Retarget `gsd-statusline-registration.mjs`**

Replace lines 11-14 and the `isOurs` predicate on line 24:

```js
function desiredCommand(claudeDir) {
  const scriptPath = join(claudeDir, "hooks", "statusline.mjs").replace(/\\/g, "/");
  return `node "${scriptPath}"`;
}
```

```js
  const isOurs = typeof currentCmd === "string"
    && (currentCmd.includes("hooks/statusline.mjs") || currentCmd.includes("gsd-context-meter"));
```

An `isOurs` that matched only the new path would report "already set" as "custom value — left untouched" on any machine still carrying the old entry, and never migrate it.

- [ ] **Step 6: Delete the wrapper and its library**

```bash
git rm payload/hooks/gsd-context-meter.mjs \
       payload/hooks/lib/gsd-context-meter-lib.mjs \
       payload/hooks/lib/gsd-context-meter-lib.test.mjs
```

- [ ] **Step 7: Drop the wrapper from the remaining assertions**

In `variants.test.mjs`, delete the assertion at line 110 (`v.rels.includes("hooks/gsd-context-meter.mjs")`), delete `gsd-context-meter.mjs` from the `basenames` negative check at 269, and delete it from the list at 286. Leave `statusline.mjs` assertions in place.

In `setup-variants.e2e.test.mjs`, delete every remaining `gsd-context-meter.mjs` `existsSync` assertion (lines 87, 89, 93, 108, 125, 135, 147, 160, 166, 176). Where an assertion existed only to prove a profile-specific file was present or pruned, substitute a file that is still profile-specific — `hooks/gsd-config-patch.mjs` is `full`-only and serves the same purpose.

- [ ] **Step 8: Run the full suite**

Run: `node --test setup-variants.e2e.test.mjs variants.test.mjs payload/hooks/statusline.test.mjs payload/hooks/lib/statusline-lib.test.mjs`
Expected: PASS. `statusline-lib.mjs` still exports `computeUsedTokenMetrics`, `usedTokensOf` and `appendUpdatesSegment`; nothing imports them any more, and Task 3 removes them.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: one statusline renderer for every profile"
```

---

### Task 3: The context segment on the real field names

**Files:**
- Modify: `payload/hooks/lib/statusline-lib.mjs` (replace lines 20-74)
- Modify: `payload/hooks/lib/statusline-lib.test.mjs`
- Modify: `payload/hooks/statusline.mjs:136-139`

**Interfaces:**
- Consumes: Task 1's captured payload, for the field name.
- Produces: `computeContext(data) -> string` — the whole context segment, `""` when the payload carries no usage. `formatCurrentTokens(n) -> string` and `formatContextWindow(n) -> string` keep their current signatures. `computeUsedTokenMetrics`, `usedTokensOf` and `appendUpdatesSegment` no longer exist.

- [ ] **Step 1: Write the failing tests**

Replace every `computeUsedTokenMetrics`/`usedTokensOf`/`appendUpdatesSegment` test in `payload/hooks/lib/statusline-lib.test.mjs` with:

```js
import { computeContext } from "./statusline-lib.mjs";

test("computeContext: window size comes from context_window_size", () => {
  assert.equal(
    computeContext({ context_window: { context_window_size: 200000, used_percentage: 22,
      current_usage: { input_tokens: 40000, cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 2000, output_tokens: 500 } } }),
    "43.5K/200K 22%");
});

test("computeContext: falls back to total_tokens, then to 1M", () => {
  assert.equal(computeContext({ context_window: { total_tokens: 200000, used_percentage: 10 } }),
    "20.0K/200K 10%");
  assert.equal(computeContext({ context_window: { used_percentage: 10 } }), "100.0K/1M 10%");
});

test("computeContext: the real usage sum wins over the percentage estimate", () => {
  const out = computeContext({ context_window: { context_window_size: 1000000, used_percentage: 50,
    current_usage: { input_tokens: 1000, output_tokens: 500 } } });
  assert.equal(out, "1.5K/1M 50%");
});

test("computeContext: tokens without a percentage, and a percentage without tokens", () => {
  assert.equal(computeContext({ context_window: { context_window_size: 200000,
    current_usage: { input_tokens: 5000 } } }), "5.0K/200K");
  assert.equal(computeContext({ context_window: { context_window_size: 200000, used_percentage: 3 } }),
    "6.0K/200K 3%");
});

test("computeContext: nothing to show yields an empty segment", () => {
  assert.equal(computeContext({}), "");
  assert.equal(computeContext({ context_window: {} }), "");
  assert.equal(computeContext({ context_window: { current_usage: {} } }), "");
  assert.equal(computeContext(null), "");
});

test("computeContext: the autocompact env var no longer changes anything", () => {
  const data = { context_window: { context_window_size: 1000000, used_percentage: 20 } };
  const before = computeContext(data);
  process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "500000";
  try { assert.equal(computeContext(data), before); }
  finally { delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW; }
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test payload/hooks/lib/statusline-lib.test.mjs`
Expected: FAIL — `computeContext` is not exported.

- [ ] **Step 3: Replace lines 20-74 of `statusline-lib.mjs`**

```js
/**
 * The whole context segment, e.g. "165.6K/1M 17%".
 *
 * The window size is `context_window_size`; `total_tokens` is a fallback only because this
 * bundle read that name for months and no captured payload existed to contradict it.
 *
 * The token figure is the plain sum of `current_usage`, and the percentage is the payload's
 * own `used_percentage` against the full window. Both are documented as null early in a
 * session and after /compact, so either half may be missing and the segment degrades to
 * whichever survives.
 */
export function computeContext(data) {
  const cw = data && data.context_window;
  if (!cw) return "";
  const total = cw.context_window_size ?? cw.total_tokens ?? 1_000_000;
  const u = cw.current_usage;
  let used = null;
  if (u && typeof u === "object") {
    const sum = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) +
      (Number(u.cache_read_input_tokens) || 0) + (Number(u.output_tokens) || 0);
    if (sum > 0) used = sum;
  }
  const pct = cw.used_percentage;
  if (used == null && pct == null) return "";
  const tokens = used != null ? used : (total * pct) / 100;
  return `${formatCurrentTokens(tokens)}/${formatContextWindow(total)}` +
    (pct == null ? "" : ` ${Math.round(pct)}%`);
}
```

Update the file's header comment: it currently says the module is shared with `gsd-context-meter.mjs` and describes buffer-normalisation maths that no longer exist.

- [ ] **Step 4: Wire it into the entry point**

In `payload/hooks/statusline.mjs`, change the import on line 11 to
`import { computeContext } from "./lib/statusline-lib.mjs";`
and replace lines 136-139 with:

```js
  const context = safe(() => computeContext(data), "") || "";
```

- [ ] **Step 5: Run the tests**

Run: `node --test payload/hooks/lib/statusline-lib.test.mjs payload/hooks/statusline.test.mjs`
Expected: PASS. The two entry-point context tests in `statusline.test.mjs` (lines 188 and 200) assert the old `[x/y] n.n%` shape and must be updated to the new `x/y n%` shape in the same step.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: read the context window size from the field that exists"
```

---

### Task 4: Model and project segments; the git segment goes

**Files:**
- Modify: `payload/hooks/statusline.mjs` (`render`, `plainState`, `renderGit`, `main`)
- Modify: `payload/hooks/statusline.test.mjs`

**Interfaces:**
- Consumes: `computeContext` from Task 3.
- Produces: `render({ updates, model, context, project, gsd, up }) -> string`. `renderGit` and `plainState` no longer exist. `renderUpdates`, `renderGsd`, `renderSdd` keep their signatures.

- [ ] **Step 1: Write the failing tests**

In `payload/hooks/statusline.test.mjs`, delete the four `renderGit` tests (lines 24-47) and the `renderGit` assertions inside the "never throw" test, drop `renderGit` from the import on line 9, and replace the three `render` tests (lines 58-70) with:

```js
test("render joins the floor in order", () => {
  const line = strip(render({ updates: [], model: "Opus 5 (1M)", context: "45.0K/200K 22%",
    project: "claude-config" }));
  assert.equal(line, "Opus 5 (1M) │ 45.0K/200K 22% │ claude-config");
});

test("render puts updates first, named", () => {
  const line = strip(render({ updates: ["context-mode"], model: "Opus", context: "1.0K/1M 0%",
    project: "p" }));
  assert.equal(line, "⬆ context-mode │ Opus │ 1.0K/1M 0% │ p");
});

test("render appends gsd then up, and omits either when absent", () => {
  const base = { updates: [], model: "Opus", context: "", project: "p" };
  assert.equal(strip(render({ ...base, gsd: "v1.0 · Phase 3 executing" })),
    "Opus │ p │ v1.0 · Phase 3 executing");
  assert.equal(strip(render({ ...base, up: "08 ✔2/6 running" })), "Opus │ p │ 08 ✔2/6 running");
  assert.equal(strip(render({ ...base, gsd: "v1.0", up: "08 planned" })),
    "Opus │ p │ v1.0 │ 08 planned");
});

test("render survives every segment being empty", () => {
  assert.equal(strip(render({ updates: [], model: "", context: "", project: "" })), "");
  assert.equal(strip(render()), "");
});

test("entry point: the project segment is the directory name and nothing else", () => {
  const root = dir("proj-only");
  const out = runEntry(payload(root, { model: { display_name: "Opus 5" } }));
  assert.equal(out.status, 0);
  assert.equal(strip(out.stdout), "Opus 5 │ proj-only");
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: FAIL — `render` still takes `{ updates, context, state }`.

- [ ] **Step 3: Replace `render`**

```js
export function render({ updates, model, context, project, gsd, up } = {}) {
  return [renderUpdates(updates), model, context, project, gsd, up]
    .filter(Boolean)
    .join(DIM(" │ "));
}
```

- [ ] **Step 4: Delete `renderGit` and `plainState`**

Remove `renderGit` (lines 26-49) and `plainState` (lines 122-129) from `statusline.mjs`, and drop `execFileSync` from the `node:child_process` import — nothing else in the file spawns anything.

- [ ] **Step 5: Rewrite `main`**

```js
function main(raw) {
  const data = safe(() => JSON.parse(raw || "{}"), {}) || {};
  const ws = data.workspace || {};
  const root = resolve(ws.current_dir || ws.project_dir || process.cwd());
  const state = safe(() => JSON.parse(readFileSync(join(CLAUDE_DIR, "state", "component-updates.json"), "utf8")), null);
  process.stdout.write(render({
    updates: pendingNames(state),
    model: (data.model && data.model.display_name) || "",
    context: safe(() => computeContext(data), "") || "",
    project: basename(root),
    gsd: safe(() => gsdState(root)) || "",
    up: safe(() => sddState(root)) || "",
  }));
}
```

`gsdState` and `sddState` are still the existing functions; Tasks 5 and 6 replace their gating and their bodies.

- [ ] **Step 6: Run the tests**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: PASS. The "empty stdin" test at line 132 asserts the line starts with `basename(TMP)`; with no model in an empty payload the project segment is now first, so that assertion still holds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: model and project segments, and no more git subprocess"
```

---

### Task 5: The ultrapowers segment is suppressed on lite

**Files:**
- Modify: `payload/hooks/statusline.mjs` (add `installedProfile`, gate `up`)
- Modify: `payload/hooks/statusline.test.mjs`

**Interfaces:**
- Consumes: `render` from Task 4.
- Produces: `installedProfile(claudeDir) -> string|null`, exported for its unit test.

- [ ] **Step 1: Write the failing tests**

```js
import { installedProfile } from "./statusline.mjs";

const claudeDirWithProfile = (name, profile) => {
  const d = dir(name);
  if (profile !== undefined) write(join(d, "state", "bundle-manifest.json"), JSON.stringify({ profile }));
  return d;
};

test("installedProfile reads the manifest, and null when there is none", () => {
  assert.equal(installedProfile(claudeDirWithProfile("prof-lite", "lite")), "lite");
  assert.equal(installedProfile(claudeDirWithProfile("prof-none")), null);
});

test("entry point: lite suppresses the ultrapowers segment, base keeps it", () => {
  const root = dir("up-gate");
  write(join(root, ".ultrapowers", "sdd", "p", "progress.md"),
    "# SDD ledger — plan: my-plan.md\nTask 1: complete\n");

  const onLite = runEntry(payload(root), { claudeDir: claudeDirWithProfile("cd-lite", "lite") });
  assert.doesNotMatch(strip(onLite.stdout), /my-plan/);

  const onBase = runEntry(payload(root), { claudeDir: claudeDirWithProfile("cd-base", "base") });
  assert.match(strip(onBase.stdout), /my-plan/);

  const noManifest = runEntry(payload(root), { claudeDir: claudeDirWithProfile("cd-nomanifest") });
  assert.match(strip(noManifest.stdout), /my-plan/, "an absent manifest must fail open");
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: FAIL — `installedProfile` is not exported.

- [ ] **Step 3: Implement**

```js
export function installedProfile(claudeDir) {
  const m = safe(() => JSON.parse(readFileSync(join(claudeDir, "state", "bundle-manifest.json"), "utf8")));
  return (m && (m.profile || m.variant)) || null;
}
```

In `main`, replace the `up` line:

```js
    up: installedProfile(CLAUDE_DIR) === "lite" ? "" : (safe(() => sddState(root)) || ""),
```

Only `lite` suppresses the segment, so an absent or unreadable manifest fails open.

- [ ] **Step 4: Run the tests**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: suppress the ultrapowers segment on the lite profile"
```

---

### Task 6: Deterministic selection of the work in flight

`sddState` currently picks by file mtime, so a checkout changes what the bar claims. Selection becomes: `ROADMAP.md`'s `current`, then a single `running` phase, then the SDD ledger. The gsd segment gains its `gsd-core`-installed condition.

**Files:**
- Modify: `payload/hooks/statusline.mjs` (add `renderPhase`, `roadmapPhases`, `upState`, `gsdActive`; rework `sddState`'s role)
- Modify: `payload/hooks/statusline.test.mjs`

**Interfaces:**
- Consumes: `installedProfile` from Task 5.
- Produces: `renderPhase({ id, done, total, dropped, status }) -> string`, `roadmapPhases(text) -> Array<{phase,slug,status,...}>`, both exported for their unit tests.

- [ ] **Step 1: Write the failing tests**

```js
import { renderPhase, roadmapPhases } from "./statusline.mjs";

test("renderPhase prints a tally and never a percentage", () => {
  assert.equal(renderPhase({ id: "08", done: 2, total: 6, status: "running" }), "08 ✔2/6 running");
  assert.doesNotMatch(renderPhase({ id: "08", done: 6, total: 7, status: "complete" }), /%/);
});

test("renderPhase subtracts dropped tasks from the denominator", () => {
  assert.equal(renderPhase({ id: "07", done: 6, total: 7, dropped: 1, status: "complete" }),
    "07 ✔6/6 complete");
});

test("renderPhase omits the tally when the phase has no plan yet", () => {
  assert.equal(renderPhase({ id: "08", status: "planned" }), "08 planned");
});

test("renderPhase never interpolates undefined", () => {
  assert.equal(renderPhase(), "");
  assert.doesNotMatch(renderPhase({ id: "08" }), /undefined/);
});

test("roadmapPhases parses the inline maps", () => {
  const rows = roadmapPhases([
    "---",
    'current: "08"',
    "phases:",
    '  - { phase: "07", slug: a, status: complete, integration: merged }',
    '  - { phase: "08", slug: b, status: running, delivery: branch }',
    "---",
  ].join("\n"));
  assert.deepEqual(rows.map((r) => [r.phase, r.status]), [["07", "complete"], ["08", "running"]]);
});

const phaseTree = (name, { current, rows = [], phases = {} }) => {
  const root = dir(name);
  const fm = ["---", `current: ${current === null ? "null" : `"${current}"`}`, "phases:",
    ...rows.map((r) => `  - { phase: "${r.phase}", slug: ${r.slug}, status: ${r.status} }`),
    "---", "", "# Roadmap"].join("\n");
  write(join(root, ".ultrapowers", "ROADMAP.md"), fm);
  for (const [id, body] of Object.entries(phases))
    write(join(root, ".ultrapowers", "phases", id, `${id.slice(0, 2)}-STATE.md`), body);
  return root;
};

const STATE_08 = '---\nphase: "08"\nstatus: running\ntasks_done: 2\ntasks_total: 6\n---\n';

test("entry point: ROADMAP current names the phase in flight", () => {
  const root = phaseTree("sel-current", { current: "08", phases: { "08-unified": STATE_08 } });
  assert.match(strip(runEntry(payload(root)).stdout), /08 ✔2\/6 running/);
});

test("entry point: current null falls back to exactly one running phase", () => {
  const one = phaseTree("sel-one", {
    current: null,
    rows: [{ phase: "07", slug: "a", status: "complete" }, { phase: "08", slug: "b", status: "running" }],
    phases: { "08-unified": STATE_08 },
  });
  assert.match(strip(runEntry(payload(one)).stdout), /08 ✔2\/6 running/);
});

test("entry point: zero or several running phases render no phase segment", () => {
  const none = phaseTree("sel-none", { current: null, rows: [{ phase: "07", slug: "a", status: "complete" }] });
  assert.doesNotMatch(strip(runEntry(payload(none)).stdout), /✔/);

  const many = phaseTree("sel-many", {
    current: null,
    rows: [{ phase: "07", slug: "a", status: "running" }, { phase: "08", slug: "b", status: "running" }],
    phases: { "08-unified": STATE_08 },
  });
  assert.doesNotMatch(strip(runEntry(payload(many)).stdout), /✔/);
});

test("entry point: a phase outranks an SDD ledger, and mtime cannot change that", () => {
  const root = phaseTree("sel-outrank", { current: "08", phases: { "08-unified": STATE_08 } });
  const ledger = write(join(root, ".ultrapowers", "sdd", "p", "progress.md"),
    "# SDD ledger — plan: stale-plan.md\nTask 1: complete\n");
  const future = Date.now() / 1000 + 3600;
  utimesSync(ledger, future, future);
  const out = strip(runEntry(payload(root)).stdout);
  assert.match(out, /08 ✔2\/6 running/);
  assert.doesNotMatch(out, /stale-plan/);
});

test("entry point: the gsd segment needs gsd-core installed, not just .planning", () => {
  const root = dir("gsd-gate");
  write(join(root, ".planning", "config.json"), "{}");
  write(join(root, ".planning", "STATE.md"),
    '---\nmilestone: v1.0\ncurrent_phase: 3\nstatus: executing\npercent: 40\n---\n');

  const without = runEntry(payload(root), { claudeDir: dir("cd-nogsd") });
  assert.doesNotMatch(strip(without.stdout), /v1\.0/);

  const withCore = dir("cd-gsd");
  write(join(withCore, "gsd-core", "VERSION"), "1.8.0\n");
  assert.match(strip(runEntry(payload(root), { claudeDir: withCore }).stdout), /v1\.0/);
});
```

Note: `phaseTree`'s template interpolates the slug **unquoted** into the generated markdown
(`slug: ${r.slug}`), which is how `ROADMAP.md` actually writes it — so the parser is exercised
against bare identifiers even though the JS fixture values are ordinary strings.

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: FAIL — `renderPhase` and `roadmapPhases` are not exported.

- [ ] **Step 3: Implement the frontmatter helpers**

```js
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ""));
  return m ? m[1] : "";
}

function fmField(fm, key) {
  const m = new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.+)$`, "m").exec(fm);
  if (!m) return null;
  const v = m[1].trim().replace(/^["']|["']$/g, "");
  return v === "null" || v === "" ? null : v;
}

export function roadmapPhases(text) {
  return [...frontmatter(text).matchAll(/^\s*-\s*\{([^}]*)\}\s*$/gm)].map((m) => {
    const row = {};
    for (const pair of m[1].split(",")) {
      const i = pair.indexOf(":");
      if (i === -1) continue;
      row[pair.slice(0, i).trim()] = pair.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
    return row;
  });
}
```

- [ ] **Step 4: Implement `renderPhase`**

```js
export function renderPhase({ id, done, total, dropped, status } = {}) {
  if (!id) return "";
  const t = Number(total);
  const d = Number(done);
  const effective = Number.isFinite(t) ? t - (Number(dropped) || 0) : null;
  // No percentage, ever: a phase that retires a task states its tally in fields and its reason in
  // prose, so any derived percentage under-reports a phase that is in fact finished.
  const tally = effective != null && Number.isFinite(d) ? ` ✔${d}/${effective}` : "";
  return `${id}${tally}${status ? ` ${status}` : ""}`;
}
```

- [ ] **Step 5: Implement `upState` and `gsdActive`**

```js
function phaseSegment(root) {
  const tree = join(root, ".ultrapowers");
  const roadmap = safe(() => readFileSync(join(tree, "ROADMAP.md"), "utf8"), "") ?? "";
  if (!roadmap) return null;
  let id = fmField(frontmatter(roadmap), "current");
  if (!id) {
    const running = roadmapPhases(roadmap).filter((r) => r.status === "running");
    if (running.length !== 1) return null;
    id = running[0].phase;
  }
  const names = safe(() => readdirSync(join(tree, "phases")), []) ?? [];
  const hit = names.find((n) => n.startsWith(`${id}-`));
  if (!hit) return null;
  const stateText = safe(() => readFileSync(join(tree, "phases", hit, `${id}-STATE.md`), "utf8"), "") ?? "";
  if (!stateText) return null;
  const fm = frontmatter(stateText);
  return renderPhase({
    id,
    done: fmField(fm, "tasks_done"),
    total: fmField(fm, "tasks_total"),
    dropped: fmField(fm, "tasks_dropped"),
    status: fmField(fm, "status"),
  });
}

function upState(root) {
  return phaseSegment(root) || sddState(root);
}

function gsdActive(root) {
  return existsSync(join(CLAUDE_DIR, "gsd-core", "VERSION"))
    && existsSync(join(root, ".planning", "config.json"));
}
```

Add `readdirSync` and `existsSync` to the `node:fs` import if they are not already there — both already are.

- [ ] **Step 6: Wire both into `main`**

```js
    gsd: gsdActive(root) ? (safe(() => gsdState(root)) || "") : "",
    up: installedProfile(CLAUDE_DIR) === "lite" ? "" : (safe(() => upState(root)) || ""),
```

- [ ] **Step 7: Run the tests**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: pick the work in flight deterministically, not by mtime"
```

---

### Task 7: The renderer cannot hang and cannot print "undefined"

Both are findings left Outstanding in `07-SUMMARY.md`, and both live in the file this phase rewrites.

**Files:**
- Modify: `payload/hooks/statusline.mjs` (the entry block, `renderGsd`, `renderSdd`)
- Modify: `payload/hooks/statusline.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 3-6.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

```js
test("the pure renderers never interpolate undefined", () => {
  assert.equal(renderGsd(), "");
  assert.equal(renderSdd(), "");
  assert.doesNotMatch(renderSdd({ plan: "p" }), /undefined/);
  assert.doesNotMatch(renderGsd({ milestone: "v1" }), /undefined/);
});

test("entry point: stdin that never closes still renders and exits", () => {
  const root = dir("hang-guard");
  const child = spawnSync(process.execPath, [ENTRY], {
    input: payload(root),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: EMPTY_CLAUDE_DIR, CLAUDE_STATUSLINE_STDIN_MS: "50" },
    cwd: TMP,
    timeout: 5000,
  });
  assert.equal(child.status, 0);
  assert.ok(strip(child.stdout).includes("hang-guard"));
});
```

The `spawnSync` `input` option closes stdin, so this test proves the timer does not corrupt the normal path. A truly unclosed stdin cannot be produced through `spawnSync`; the guard's value is that the timeout exists and the render is idempotent under it, which `finish()`'s `done` flag gives.

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: FAIL — `renderSdd()` with no argument throws or yields `undefined ✔undefined →undefined`.

- [ ] **Step 3: Guard the pure renderers**

```js
export function renderSdd({ plan, complete, next } = {}) {
  if (!plan) return "";
  return `${plan} ✔${Number(complete) || 0} →${Number(next) || 1}`;
}
```

In `renderGsd`, return `""` when `milestone` is absent — the existing body already tolerates a missing phase and percent:

```js
export function renderGsd({ milestone, phase, status, percent } = {}) {
  if (!milestone) return "";
```

- [ ] **Step 4: Add the stdin timeout**

Replace the entry block's listener chain so the timer forces a flush:

```js
if (isMainModule()) {
  process.stdout.on("error", () => {});
  let input = "";
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(guard);
    try { main(input); } catch { /* never break the prompt */ }
    process.exitCode = 0;
  };
  // A statusLine command whose stdin never closes would otherwise hang forever and leave the
  // prompt with no line at all; rendering what arrived beats rendering nothing.
  const guard = setTimeout(finish, Number(process.env.CLAUDE_STATUSLINE_STDIN_MS) || 1500);
  guard.unref();
  if (process.stdin.isTTY) finish();
  else {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("error", finish);
    process.stdin.on("end", finish);
  }
}
```

`guard` is referenced inside `finish` before its `const` initialiser runs, which is safe because `finish` is only ever called after that line executes.

- [ ] **Step 5: Run the tests**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: PASS

- [ ] **Step 6: Run the whole suite**

Run: `node --test payload/hooks/statusline.test.mjs payload/hooks/lib/statusline-lib.test.mjs setup-variants.e2e.test.mjs variants.test.mjs payload/bin/lib/gsd-core-detect.test.mjs`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix: guard the statusline against a hanging stdin and undefined fields"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md` (the hook/component tables and the `ensureStatuslineOverride` paragraph near line 515)
- Modify: `README.en.md` (same, near line 517)
- Modify: `.ultrapowers/phases/08-unified-statusline/08-STATE.md`

**Interfaces:**
- Consumes: the finished implementation.
- Produces: nothing consumed by code.

- [ ] **Step 1: Update both READMEs**

Remove every `gsd-context-meter.mjs` row and mention. Describe `statusline.mjs` as the single renderer for every profile, and list the six segments and their two conditions. Fix the `ensureStatuslineOverride` paragraph in each file — it currently describes a takeover that targets the deleted wrapper.

- [ ] **Step 2: Verify no stale references remain**

Run:
```bash
grep -rn "gsd-context-meter" --include=*.mjs --include=*.json --include=*.md . \
  --exclude-dir=.git --exclude-dir=graphify-out --exclude-dir=.test --exclude-dir=docs
```
Expected: only `setup.mjs`'s and `gsd-statusline-registration.mjs`'s `ourStatusLine`/`isOurs` predicates, which keep matching the old string on purpose so an existing registration migrates, and `.ultrapowers/` records, which are history. `docs/` is excluded because its files are dated snapshots.

- [ ] **Step 3: Update the phase state**

Set `status: complete`, `delivery: branch`, `tasks_done: 8`, `tasks_total: 8`, and `updated:` to the current date in `08-STATE.md`. Record whether Task 1's capture succeeded and which context-window field name it showed.

- [ ] **Step 4: Refresh the code graph**

Run: `graphify update .`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: one statusline renderer, six segments, two conditions"
```

---

## Self-Review

**Spec coverage.** Every section of `08-SPEC.md` maps to a task: the line and its order → Task 4; the composition matrix → Tasks 5 and 6; the data-flow table → Tasks 4-6; the context segment and its bug → Tasks 1 and 3; deterministic in-flight selection and the tally → Task 6; the deletion table → Task 2; `setup.mjs` migration → Task 2; failure isolation and the two Outstanding findings → Task 7; testing decisions → the tests in Tasks 3-7; documentation → Task 8. The spec's "Out of scope" list has no tasks by design.

**Placeholders.** None. Every code step carries the code; every test step carries the assertions; every run step carries the command and the expected result.

**Type consistency.** `computeContext(data) -> string` is introduced in Task 3 and consumed under that name in Tasks 3 and 4. `render` takes `{ updates, model, context, project, gsd, up }` from Task 4 onward, and Tasks 5-6 add values to that same object rather than changing its shape. `installedProfile(claudeDir)` is defined in Task 5 and used in Tasks 5 and 6. `renderPhase({ id, done, total, dropped, status })` and `roadmapPhases(text)` are defined and used in Task 6 only. `formatCurrentTokens` and `formatContextWindow` keep the signatures they already have.

**One ordering note.** Task 2 deletes `gsd-context-meter-lib.mjs`, which re-exports `computeUsedTokenMetrics`, `usedTokensOf` and `appendUpdatesSegment`. Those three survive unused in `statusline-lib.mjs` until Task 3 removes them, so the suite is green at the end of Task 2 as well as at the end of Task 3. Reversing the two tasks would break the build in between.
