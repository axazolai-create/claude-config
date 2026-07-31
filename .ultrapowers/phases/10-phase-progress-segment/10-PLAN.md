# Phase and task progress segment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ultrapowers statusline segment with one that renders three modes — task counters while executing, a named action otherwise, a phase tally between phases — in five colour states.

**Architecture:** One new module, `payload/hooks/lib/phase-segment.mjs`, holding `readPhaseState(root)` (all filesystem work and the source-merge rules) and `renderPhaseSegment(state)` (pure: object in, coloured string out). `statusline.mjs` keeps only the wiring and loses `renderPhase`, `renderSdd`, `sddState`, `phaseSegment`, `roadmapPhases`, `frontmatter` and `fmField`, which move or disappear.

**Tech Stack:** Node ESM, `node:test`, `node:assert/strict`. No dependencies. Existing house style: `safe()` around every filesystem read, ANSI codes as bare strings.

## Global Constraints

- Payload-only: every code change lands under `payload/`. Never edit `~/.claude` directly.
- The segment is never a precondition for printing the line: any throw yields an empty segment, the rest of the bar renders.
- No percentage is ever derived from the counters (phase 08's rule, unchanged).
- Colour codes, verbatim: green `32`, cyan `36`, yellow `33`, red `31`.
- Only numbers and the action word are coloured — separators, the em dash and the phase id stay plain.
- The em dash in the executing mode is `—` (U+2014) with a space on each side.
- The SDD ledger is read structurally — by counting `task-N-brief.md` against `task-N-report.md`. No line of its prose is ever parsed.
- Tests live beside the unit as `<name>.test.mjs` and run under `node --test`.

---

### Task 1: Migrate the status/delivery vocabulary

The segment reads these fields, so the rename comes first. This task is documentation: no code reads `integration` (verified — every match in `payload/` is a gsd-agent name, not this field).

**Files:**
- Modify: `.ultrapowers/ROADMAP.md` (frontmatter rows 01-09)
- Modify: `.ultrapowers/phases/01-graphify-neo4j/01-STATE.md`
- Modify: `.ultrapowers/phases/02-ai-development-mode/02-STATE.md`
- Modify: `.ultrapowers/phases/03-ultrapowers-layer0-patcher/03-STATE.md`
- Modify: `.ultrapowers/phases/04-ultrapowers-planning-tree/04-STATE.md`
- Modify: `.ultrapowers/phases/05-versioning-and-changelog/05-STATE.md`
- Modify: `.ultrapowers/phases/06-design-records-and-stack-rules/06-STATE.md`
- Modify: `.ultrapowers/phases/07-gsd-core-detector-and-statusline/07-STATE.md`
- Modify: `.ultrapowers/phases/08-unified-statusline/08-STATE.md` (value fix, see Step 3)
- Modify: `.ultrapowers/phases/09-context-meter-severity/09-STATE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the field names `delivery` and `superseded_by` that Task 3 reads, and `status` restricted to `planned | running | blocked | complete | superseded | abandoned`.

- [ ] **Step 1: See the current state**

Run: `grep -rn "^integration:" .ultrapowers/ROADMAP.md .ultrapowers/phases/`
Expected: eight `NN-STATE.md` files (01-07, 09) plus the ROADMAP rows. Phase 08 will not appear — it was migrated already.

- [ ] **Step 2: Rename the field in the eight state files**

In each of `01`, `02`, `03`, `04`, `05`, `06`, `07`, `09`, replace the frontmatter line `integration: merged` with `delivery: merged`. Nothing else in those files changes.

- [ ] **Step 3: Correct phase 08's stale value**

`08-STATE.md` already reads `delivery: branch`, which is false: `ROADMAP.md` records phase 08 as merged at `82deacb` and deployed. Change it to:

```yaml
delivery: deployed
```

Add one line to that file's prose, below the frontmatter, so the correction is recorded rather than silent:

```markdown
`delivery` read `branch` until 2026-07-31. That was stale, not wrong at the time — the field
was written while the branch was open and never revisited after the merge at `82deacb` and
the deploy of `51a65d0`. This is the failure mode the vocabulary migration exists to make
visible: a delivery fact that nobody rewrote when delivery changed.
```

- [ ] **Step 4: Rename the field in ROADMAP's frontmatter**

Rows `01` through `09` change `integration: merged` to `delivery: merged`. Row `10` already carries `delivery: null`. Then delete the paragraph that explains the mixed vocabulary — it begins `The frontmatter above is deliberately mixed:` — because it is no longer true, and replace it with:

```markdown
Every row carries `delivery`; `integration` is gone. Phase 10 migrated the vocabulary as its
first step, because the segment it builds reads these fields.
```

- [ ] **Step 5: Verify nothing was missed**

Run: `grep -rn "integration:" .ultrapowers/ | grep -v archive`
Expected: no output. (`archive/` keeps historical documents verbatim and is deliberately excluded — a closed record says what it said.)

- [ ] **Step 6: Verify the suite is unaffected**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: PASS, unchanged count. Documentation cannot move it; if it does, something read `integration` after all.

- [ ] **Step 7: Commit**

```bash
git add .ultrapowers/ROADMAP.md .ultrapowers/phases
git commit -m "refactor(state): rename integration to delivery across the tree"
```

---

### Task 2: The pure renderer

**Files:**
- Create: `payload/hooks/lib/phase-segment.mjs`
- Test: `payload/hooks/lib/phase-segment.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `renderPhaseSegment(state)` → `string`. Never throws for any JSON-native input; returns `""` when it cannot render. The `state` shape it accepts:

```js
// mode: "executing"
{ mode: "executing", id: "09", name: "context-meter-severity",
  counts: { done: 2, active: 1, fixing: 0, queued: 3, blocked: 0 } }
// mode: "action"
{ mode: "action", id: "09", name: "context-meter-severity", action: "planning", status: "running" }
// mode: "tally"
{ mode: "tally", name: "unified-statusline", phasesDone: 8, phasesTotal: 9 }
```

- [ ] **Step 1: Write the failing test**

Create `payload/hooks/lib/phase-segment.test.mjs`:

```js
// payload/hooks/lib/phase-segment.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPhaseSegment } from "./phase-segment.mjs";

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const EXEC = { mode: "executing", id: "09", name: "ctx-severity",
  counts: { done: 2, active: 1, fixing: 0, queued: 3, blocked: 0 } };

test("executing mode prints id, three counts, em dash and name", () => {
  assert.equal(strip(renderPhaseSegment(EXEC)), "09 2/1/3 — ctx-severity");
});

test("the blocked count is appended only when it is non-zero", () => {
  const blocked = { ...EXEC, counts: { ...EXEC.counts, blocked: 1 } };
  assert.equal(strip(renderPhaseSegment(blocked)), "09 2/1/3/1 — ctx-severity");
});

test("done is green, in-work is cyan, queued is uncoloured", () => {
  const out = renderPhaseSegment(EXEC);
  assert.ok(out.includes("\x1b[32m2\x1b[0m"), "done green");
  assert.ok(out.includes("\x1b[36m1\x1b[0m"), "in work cyan");
  assert.ok(out.includes("/3 "), "queued carries no escape");
});

test("the in-work position turns yellow when any task is in the fix loop", () => {
  const fixing = { ...EXEC, counts: { done: 2, active: 1, fixing: 1, queued: 2, blocked: 0 } };
  const out = renderPhaseSegment(fixing);
  assert.equal(strip(out), "09 2/2/2 — ctx-severity");
  assert.ok(out.includes("\x1b[33m2\x1b[0m"), "in work yellow");
  assert.ok(!out.includes("\x1b[36m"), "cyan is not used when fixing");
});

test("the blocked count is red", () => {
  const out = renderPhaseSegment({ ...EXEC, counts: { ...EXEC.counts, blocked: 2 } });
  assert.ok(out.includes("\x1b[31m2\x1b[0m"));
});

test("action mode prints the action in parentheses between id and name", () => {
  assert.equal(strip(renderPhaseSegment({ mode: "action", id: "09", name: "ctx-severity",
    action: "planning", status: "running" })), "09 (planning) ctx-severity");
});

test("the action is cyan, and red when the phase is blocked", () => {
  const running = renderPhaseSegment({ mode: "action", id: "09", name: "n", action: "review", status: "running" });
  const blocked = renderPhaseSegment({ mode: "action", id: "09", name: "n", action: "review", status: "blocked" });
  assert.ok(running.includes("\x1b[36mreview\x1b[0m"));
  assert.ok(blocked.includes("\x1b[31mreview\x1b[0m"));
});

test("a phase with no action prints its id and name alone", () => {
  assert.equal(strip(renderPhaseSegment({ mode: "action", id: "09", name: "ctx-severity" })),
    "09 ctx-severity");
});

test("tally mode prints done over total and the phase name", () => {
  const out = renderPhaseSegment({ mode: "tally", name: "unified-statusline", phasesDone: 8, phasesTotal: 9 });
  assert.equal(strip(out), "8/9 unified-statusline");
  assert.ok(out.includes("\x1b[32m8\x1b[0m"), "numerator green");
  assert.ok(out.includes("/9 "), "denominator plain");
});

test("a negative queue prints the action instead of provably wrong arithmetic", () => {
  const broken = { mode: "executing", id: "09", name: "n", action: "review", status: "running",
    counts: { done: 5, active: 1, fixing: 0, queued: -2, blocked: 0 } };
  assert.equal(strip(renderPhaseSegment(broken)), "09 (review) n");
});

test("no input class throws, and unrenderable input yields an empty string", () => {
  for (const bad of [null, undefined, 42, "x", [], true, {}, { mode: "executing" }, { mode: "tally" }])
    assert.equal(renderPhaseSegment(bad), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/hooks/lib/phase-segment.test.mjs`
Expected: FAIL — `Cannot find module ... phase-segment.mjs`.

- [ ] **Step 3: Write the implementation**

Create `payload/hooks/lib/phase-segment.mjs` with the renderer only. `readPhaseState` arrives in Task 3.

```js
// Renders the ultrapowers work segment. Three modes, switched wholesale: in two of them the
// leading token is one phase's id, in the third it is a tally across all phases, and those are
// different kinds of thing in the same position.
const C = { green: "32", cyan: "36", yellow: "33", red: "31" };
const paint = (s, colour) => `\x1b[${colour}m${s}\x1b[0m`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function renderPhaseSegment(state) {
  const s = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  if (s.mode === "tally") {
    if (!s.name || !Number.isFinite(Number(s.phasesTotal))) return "";
    return `${paint(num(s.phasesDone), C.green)}/${num(s.phasesTotal)} ${s.name}`;
  }
  if (!s.id || !s.name) return "";
  const c = s.counts;
  const queued = c ? num(c.queued) : -1;
  // A negative queue means the fields contradict each other. Printing arithmetic that is
  // provably wrong is worse than printing none, so it degrades to the action mode.
  if (s.mode === "executing" && c && queued >= 0) {
    const fixing = num(c.fixing);
    const inWork = num(c.active) + fixing;
    const blocked = num(c.blocked);
    const cells = [
      paint(num(c.done), C.green),
      paint(inWork, fixing > 0 ? C.yellow : C.cyan),
      String(queued),
    ];
    if (blocked > 0) cells.push(paint(blocked, C.red));
    return `${s.id} ${cells.join("/")} — ${s.name}`;
  }
  if (!s.action) return `${s.id} ${s.name}`;
  return `${s.id} (${paint(s.action, s.status === "blocked" ? C.red : C.cyan)}) ${s.name}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test payload/hooks/lib/phase-segment.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/phase-segment.mjs payload/hooks/lib/phase-segment.test.mjs
git commit -m "feat(statusline): render three phase-progress modes in five colours"
```

---

### Task 3: Reading the tree

**Files:**
- Modify: `payload/hooks/lib/phase-segment.mjs`
- Test: `payload/hooks/lib/phase-segment.test.mjs`

**Interfaces:**
- Consumes: `renderPhaseSegment(state)` from Task 2, unchanged.
- Produces: `readPhaseState(root)` → the state object Task 2 renders, or `null` when the tree has no `ROADMAP.md`. Also exports `roadmapPhases(text)` → `Array<{phase, slug, status, ...}>`, which Task 4 removes from `statusline.mjs`.

Merge rules this task implements, from the spec:

| Source | Trusted for |
|---|---|
| `ROADMAP.md` frontmatter | `current`, the phase rows and their statuses |
| `phases/NN-*/NN-STATE.md` | `action`, `tasks_fixing`, `tasks_blocked`, `tasks_dropped` |
| `.ultrapowers/sdd/phases-NN-<slug>/` | `total`, `done`, `active`, and whether tasks execute at all |

- [ ] **Step 1: Write the failing test**

Append to `payload/hooks/lib/phase-segment.test.mjs`:

```js
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readPhaseState } from "./phase-segment.mjs";

const dir = (name) => {
  const d = join(mkdtempSync(join(tmpdir(), "phaseseg-")), name);
  mkdirSync(d, { recursive: true });
  return d;
};
const write = (p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return p; };

const roadmap = ({ current = null, rows = [] }) =>
  `---\ncurrent: ${current === null ? "null" : `"${current}"`}\nphases:\n` +
  rows.map((r) => `  - { phase: "${r.phase}", slug: ${r.slug}, status: ${r.status} }`).join("\n") +
  `\n---\n\n# Roadmap\n`;

const ROWS = [
  { phase: "08", slug: "unified-statusline", status: "complete" },
  { phase: "09", slug: "ctx-severity", status: "running" },
];

test("no ROADMAP means no segment at all", () => {
  assert.equal(readPhaseState(dir("empty")), null);
});

test("current names the phase, and its state file supplies the action", () => {
  const root = dir("by-current");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: planning\n---\n');
  const st = readPhaseState(root);
  assert.equal(st.mode, "action");
  assert.equal(st.id, "09");
  assert.equal(st.name, "ctx-severity");
  assert.equal(st.action, "planning");
});

test("with current null, exactly one running phase resolves", () => {
  const root = dir("by-running");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: null, rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: review\n---\n');
  assert.equal(readPhaseState(root).action, "review");
});

test("several running phases resolve to the tally instead of a guess", () => {
  const root = dir("ambiguous");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: null, rows: [
    { phase: "08", slug: "a", status: "running" }, { phase: "09", slug: "b", status: "running" }] }));
  assert.equal(readPhaseState(root).mode, "tally");
});

test("the tally counts every phase except abandoned ones", () => {
  const root = dir("tally");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: null, rows: [
    { phase: "01", slug: "a", status: "complete" },
    { phase: "02", slug: "b", status: "abandoned" },
    { phase: "03", slug: "c", status: "superseded" },
    { phase: "04", slug: "last-one", status: "complete" }] }));
  const st = readPhaseState(root);
  assert.equal(st.mode, "tally");
  assert.equal(st.phasesDone, 2);
  assert.equal(st.phasesTotal, 3);
  assert.equal(st.name, "last-one");
});

test("a live ledger with an unreported brief switches to executing and supplies the counts", () => {
  const root = dir("executing");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: planning\ntasks_total: 99\ntasks_done: 99\n---\n');
  const sdd = join(root, ".ultrapowers", "sdd", "phases-09-ctx-severity");
  for (const n of [1, 2, 3, 4, 5, 6]) write(join(sdd, `task-${n}-brief.md`), "b");
  for (const n of [1, 2]) write(join(sdd, `task-${n}-report.md`), "r");
  const st = readPhaseState(root);
  assert.equal(st.mode, "executing");
  assert.deepEqual(st.counts, { done: 2, active: 4, fixing: 0, queued: 0, blocked: 0 });
});

test("fixing and blocked come from frontmatter, and the queue is what is left", () => {
  const root = dir("fixing");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\ntasks_fixing: 1\ntasks_blocked: 1\n---\n');
  const sdd = join(root, ".ultrapowers", "sdd", "phases-09-ctx-severity");
  for (const n of [1, 2, 3, 4, 5, 6]) write(join(sdd, `task-${n}-brief.md`), "b");
  write(join(sdd, "task-1-report.md"), "r");
  const st = readPhaseState(root);
  // 6 briefs, 1 reported, 5 unreported. 1 of those is fixing and 1 is blocked, so 3 remain active.
  assert.deepEqual(st.counts, { done: 1, active: 3, fixing: 1, queued: 0, blocked: 1 });
});

test("a ledger belonging to another phase is never consulted", () => {
  const root = dir("other-ledger");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: planning\n---\n');
  write(join(root, ".ultrapowers", "sdd", "phases-08-unified-statusline", "task-1-brief.md"), "b");
  assert.equal(readPhaseState(root).mode, "action");
});

test("a ledger whose briefs are all reported is not executing", () => {
  const root = dir("ledger-done");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: review\n---\n');
  const sdd = join(root, ".ultrapowers", "sdd", "phases-09-ctx-severity");
  write(join(sdd, "task-1-brief.md"), "b");
  write(join(sdd, "task-1-report.md"), "r");
  assert.equal(readPhaseState(root).mode, "action");
});

test("a current naming a phase with no directory falls to the tally", () => {
  const root = dir("dangling");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "07", rows: ROWS }));
  assert.equal(readPhaseState(root).mode, "tally");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/hooks/lib/phase-segment.test.mjs`
Expected: FAIL — `readPhaseState is not a function`.

- [ ] **Step 3: Write the implementation**

Prepend the imports to `payload/hooks/lib/phase-segment.mjs` and append the reader below the renderer:

```js
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const read = (p) => safe(() => readFileSync(p, "utf8"), "") ?? "";

export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ""));
  return m ? m[1] : "";
}

export function fmField(fm, key) {
  const m = new RegExp(`^[ \t]*${key}[ \\t]*:[ \\t]*(.+)$`, "m").exec(fm);
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

// Structural, never prose: briefs give the total, reports give the done count, and a brief
// without its report is a task in flight. The ledger's wording can change freely.
function ledgerCounts(tree, id, slug) {
  const dir = join(tree, "sdd", `phases-${id}-${slug}`);
  if (!existsSync(dir)) return null;
  const names = safe(() => readdirSync(dir), []) ?? [];
  const briefs = new Set(), reports = new Set();
  for (const n of names) {
    const b = /^task-(\d+)-brief\.md$/.exec(n);
    if (b) briefs.add(Number(b[1]));
    const r = /^task-(\d+)-report\.md$/.exec(n);
    if (r) reports.add(Number(r[1]));
  }
  if (!briefs.size) return null;
  const done = [...briefs].filter((n) => reports.has(n)).length;
  return { total: briefs.size, done, unreported: briefs.size - done };
}

function tallyState(rows) {
  const live = rows.filter((r) => r.status !== "abandoned");
  if (!live.length) return null;
  const last = live.reduce((a, b) => (Number(b.phase) >= Number(a.phase) ? b : a));
  return {
    mode: "tally",
    name: last.slug || null,
    phasesDone: live.filter((r) => r.status === "complete").length,
    phasesTotal: live.length,
  };
}

export function readPhaseState(root) {
  const tree = join(root, ".ultrapowers");
  const roadmap = read(join(tree, "ROADMAP.md"));
  if (!roadmap) return null;
  const rows = roadmapPhases(roadmap);
  let id = fmField(frontmatter(roadmap), "current");
  if (!id) {
    const running = rows.filter((r) => r.status === "running");
    id = running.length === 1 ? running[0].phase : null;
  }
  const row = id ? rows.find((r) => r.phase === id) : null;
  const dirs = safe(() => readdirSync(join(tree, "phases")), []) ?? [];
  const dirName = id ? dirs.find((n) => n.startsWith(`${id}-`)) : null;
  if (!dirName) return tallyState(rows);

  const slug = dirName.slice(String(id).length + 1);
  const fm = frontmatter(read(join(tree, "phases", dirName, `${id}-STATE.md`)));
  const base = { id, name: (row && row.slug) || slug, status: fmField(fm, "status"),
    action: fmField(fm, "action") };
  const ledger = ledgerCounts(tree, id, slug);
  if (!ledger || !ledger.unreported) return { ...base, mode: "action" };

  const n = (key) => Number(fmField(fm, key)) || 0;
  const fixing = n("tasks_fixing"), blocked = n("tasks_blocked");
  const active = ledger.unreported - fixing - blocked;
  const queued = ledger.total - ledger.done - active - fixing - blocked - n("tasks_dropped");
  return { ...base, mode: "executing", counts: { done: ledger.done, active, fixing, queued, blocked } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test payload/hooks/lib/phase-segment.test.mjs`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/phase-segment.mjs payload/hooks/lib/phase-segment.test.mjs
git commit -m "feat(statusline): read phase state from roadmap, state file and live ledger"
```

---

### Task 4: Wire it in and delete what it replaces

**Files:**
- Modify: `payload/hooks/statusline.mjs` (remove `renderSdd`, `renderPhase`, `sddState`, `phaseSegment`, `roadmapPhases`, `frontmatter`, `fmField`; rewrite `upState`)
- Modify: `payload/hooks/statusline.test.mjs` (drop the tests for the deleted units, retarget the entry-point tests)

**Interfaces:**
- Consumes: `readPhaseState(root)` and `renderPhaseSegment(state)` from Tasks 2-3.
- Produces: no new exports. `statusline.mjs` keeps exporting `renderUpdates`, `renderGsd`, `paintContext`, `installedProfile` and `render`, all unchanged.

- [ ] **Step 1: Write the failing test**

In `payload/hooks/statusline.test.mjs`, replace the three SDD entry-point tests (`an SDD plan in flight renders the sdd segment`, `the most recently written ledger wins, not the last name`, `a ROADMAP without a resolvable phase still falls back to the ledger`) and the `LEDGER` constant with:

```js
test("entry point: between phases the segment is a tally, not a stale ledger", () => {
  const root = phaseTree("sel-tally", {
    current: null,
    rows: [{ phase: "08", slug: "unified", status: "complete" },
           { phase: "09", slug: "ctx-severity", status: "complete" }],
    phases: { "09-ctx-severity": STATE_08 },
  });
  write(join(root, ".ultrapowers", "sdd", "phases-08-unified", "task-1-brief.md"), "b");
  const out = strip(runEntry(payload(root)).stdout);
  assert.match(out, /2\/2 ctx-severity$/);
});

test("entry point: a live ledger for the current phase renders counters", () => {
  const root = phaseTree("sel-exec", { current: "09",
    rows: [{ phase: "09", slug: "ctx-severity", status: "running" }],
    phases: { "09-ctx-severity": '---\nphase: "09"\nstatus: running\naction: planning\n---\n' } });
  const sdd = join(root, ".ultrapowers", "sdd", "phases-09-ctx-severity");
  write(join(sdd, "task-1-brief.md"), "b");
  write(join(sdd, "task-2-brief.md"), "b");
  write(join(sdd, "task-1-report.md"), "r");
  assert.match(strip(runEntry(payload(root)).stdout), /09 1\/1\/0 — ctx-severity$/);
});
```

Also update `entry point: gsd and up both render when a project has both` — its `up` half now renders a tally rather than an SDD line — and delete the tests named `renderPhase prints a tally and never a percentage`, `renderPhase subtracts dropped tasks from the denominator`, `renderPhase omits the tally when the phase has no plan yet`, `renderPhase never interpolates undefined`, `the sdd segment names the plan and where to resume`, `roadmapPhases parses the inline maps` and `roadmapPhases parses CRLF frontmatter`. The last two move to `phase-segment.test.mjs`; copy them there verbatim, changing only the import to `./phase-segment.mjs`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test payload/hooks/statusline.test.mjs`
Expected: FAIL — the new tests see the old renderer's `09 (1/2) running` shape.

- [ ] **Step 3: Rewrite the wiring**

In `payload/hooks/statusline.mjs`, add to the imports:

```js
import { readPhaseState, renderPhaseSegment } from "./lib/phase-segment.mjs";
```

Delete `renderSdd`, `renderPhase`, `sddState`, `phaseSegment`, `roadmapPhases`, `frontmatter` and `fmField`, then replace `upState` with:

```js
function upState(root) {
  return renderPhaseSegment(readPhaseState(root));
}
```

Remove `basename` and `statSync` from the `node:fs` and `node:path` imports if nothing else uses them, and update the file header comment's segment list if it names the SDD ledger.

- [ ] **Step 4: Run both test files**

Run: `node --test payload/hooks/lib/phase-segment.test.mjs payload/hooks/statusline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the whole suite, both halves**

Run: `node --test` then `node --test .test/unit/*.test.mjs`
Expected: PASS in both. The root run does not collect `.test/unit/` — the directory is hidden — so both commands are required to claim the suite is green.

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/statusline.mjs payload/hooks/statusline.test.mjs payload/hooks/lib/phase-segment.test.mjs
git commit -m "refactor(statusline): replace the phase and sdd renderers with one segment"
```

---

### Task 5: Document the segment

**Files:**
- Modify: `README.md` (the statusline section)
- Modify: `README.en.md` (the same section)

**Interfaces:**
- Consumes: the rendered formats from Task 2.
- Produces: nothing code reads.

- [ ] **Step 1: Find the section**

Run: `grep -n "ultrapowers segment\|SDD ledger\|statusline" README.md README.en.md | head -20`
Expected: the statusline description in both files, which currently documents the phase tally and the SDD fallback.

- [ ] **Step 2: Replace the description in `README.en.md`**

```markdown
The ultrapowers segment has three modes. While tasks execute it shows counters —
`09 2/1/3 — phase-progress-segment`, reading done / in work / queued, with a fourth number in
red appended only when something is blocked. The in-work position is cyan, or yellow when any
task is in a fix round. Otherwise it names the current action, `09 (planning) name`. Between
phases it is a tally of every phase except abandoned ones, `8/9 name`.

The counters come from the live SDD ledger, read structurally by counting `task-N-brief.md`
against `task-N-report.md`; `NN-STATE.md` supplies the action and the fixing and blocked
counts. When no ledger exists the state file answers alone.
```

- [ ] **Step 3: Mirror it in `README.md` (Russian)**

Same content, house style — the two files must agree in meaning, not in phrasing.

- [ ] **Step 4: Verify no stale claim survives**

Run: `grep -n "next 4\|(2/6)\|sdd segment" README.md README.en.md`
Expected: no output. Those are the old segment's shapes.

- [ ] **Step 5: Commit**

```bash
git add README.md README.en.md
git commit -m "docs(readme): describe the three-mode ultrapowers segment"
```

---

## Verification before the phase closes

- [ ] `node --test` and `node --test .test/unit/*.test.mjs` both green.
- [ ] `grep -rn "integration:" .ultrapowers/ | grep -v archive` prints nothing.
- [ ] `node -e "import('./payload/hooks/lib/phase-segment.mjs').then(m=>console.log(JSON.stringify(m.readPhaseState('.'))))"` prints this repository's own state, and the mode matches what the tree actually is.
- [ ] `10-STATE.md` updated: `tasks_total: 5`, `tasks_done: 5`, `status: complete`, `delivery: branch`.
