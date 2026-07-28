# Decision Records: `risks`, `adr`, `glossary` and a Nudge Hook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the glossary, the ADR register and the risk register a standing practice — three CLIs that own everything deterministic, one non-blocking hook that notices when they drift, and three retrospective ADRs so the directory is not empty on day one.

**Architecture:** Three thin CLIs in `payload/bin/` over three pure libraries in `payload/bin/lib/`, each with tests beside it. One `PreToolUse` hook on `Bash` matching `git commit` runs the matching lint only for files actually staged, prints what is wrong and the command that fixes it, and never blocks. Everything requiring judgement — whether a risk is genuinely closed, whether a decision earned an ADR, what a term means — stays as instruction and was shipped by plan #2's delta `010`.

**Tech Stack:** Node 20+ ESM, `node --test`, no dependencies.

## Global Constraints

- **Paths follow the tree.** Resolution order for every file this plan touches: if `.ultrapowers/` exists at the repository root, use `.ultrapowers/RISK_REGISTER.md`, `.ultrapowers/adr/`, `.ultrapowers/GLOSSARY.md`; otherwise the repository root and `adr/`. One resolver, shared by all three CLIs and the hook — three copies of this rule would drift the first time the tree moves.
- **The hook never blocks.** It follows `ci-watch-nudge.mjs` and `graphify-grep-nudge.mjs`, not `secrets-gate.mjs`: an unnormalised register is untidy, not dangerous. Fail-open — any error means exit 0 with no output.
- **The hook reads the staged index, never the commit message.** `db-live-access-gate.mjs` already false-positives on SQL keywords inside commit messages; a second hook making the same mistake would make `git commit -F` the only usable form.
- **`risks normalize` is a pure move.** It reorders entries and regenerates the table of contents. It never edits the prose of an entry, so its diff reads as reordering and nothing else. A second run is a no-op.
- **A closed risk is never deleted.** Its ID is cited from at least ten documents; a closed risk explains why the code looks the way it does. Closed entries move to the bottom.
- **IDs are never reused**, including those of closed entries.
- Tests live beside each module as `*.test.mjs`; `variants.json`'s `alwaysExclude` already carries `**.test.mjs`, so they never ship.
- Terse-code mode: no comments except a genuine non-obvious *why*.

## Measured starting state

Read before writing any parser — these are the numbers the normaliser has to survive.

- `RISK_REGISTER.md`: 44 entries over 814 lines, headings of the form `## RISK-<PREFIX>-<NNN> — <title>`, fields as `- **Status:** …`, `- **Context:** …`, `- **Mitigation:** …`, `- **Residual:** …`, with free-form extra bullets.
- 18 distinct prefixes: `BOOTSTRAP`, `CLAUDEMD`, `CLEANUP`, `DESIGNSTACK` (6), `FALLOW`, `GRAPHFRESH`, `GSDEXEC`, `HARNESS`, `INITSTACK`, `INJECT`, `NEO4J` (6), `PNPM` (4), `STACKRULES` (2), `SUP` (3), `TOKENLOG`, `ULTRAPOWERS` (8), `VARIANT` (4), `VERBOSITY`.
- **22 distinct Status spellings**, not the 12 the design estimated. The three largest are `Open (accepted)` ×12, `Open (mitigated by design)` ×7, `Open (accepted / low)` ×5; the remaining 19 are one-offs carrying a parenthetical nuance, a date, or an em-dashed explanation.
- No ADRs and no glossary exist.

## The status vocabulary, and the mapping onto it

Four values replace the 22. The nuance currently jammed into the status line moves into `Mitigation`, where it belongs.

| Status | Meaning | Mapped from |
|---|---|---|
| `Active` | needs a decision or an ongoing watch | `Open (accepted…)` in all its forms — `accepted`, `accepted / low`, `accepted, behavioral`, `accepted with a budget`, `accepted; not fixable from this repository`, `accepted at design time, <date>` |
| `Deferred (<what is awaited>)` | blocked on an external event | `Open (until tests green)`, `Open (until Stage 2)`, `Open (verification pending)` |
| `Mitigated` | addressed by design; kept because the exposure is real | `Open (mitigated by design)` and its dated/narrowed variants, `Mitigated (detector built; …)` |
| `Closed (<date>) — <why>` | resolved, retained for provenance | `Resolved (<date>) — <why>`, `Resolved (<other phrasing>)` |

The parenthetical text that made each spelling unique is not discarded: `normalize` appends it to the entry's `Mitigation` field as a new sentence, prefixed `Status nuance (migrated <date>):`. A migration that silently drops "not fixable from this repository" would lose the single most useful thing that status line said.

## File Structure

| File | Responsibility |
|---|---|
| `payload/bin/lib/records-paths.mjs` | `resolveRecordPaths(root)` — the one place the `.ultrapowers/`-or-root rule lives |
| `payload/bin/lib/risk-register.mjs` | parse, lint, normalize, allocate the next ID — pure, string in / string out |
| `payload/bin/lib/adr-lib.mjs` | next number, template, format lint, cross-reference lint |
| `payload/bin/lib/glossary-lib.mjs` | format lint, and the frequency pass behind `suggest` |
| `payload/bin/risks.mjs` | CLI: `lint`, `normalize`, `add` |
| `payload/bin/adr.mjs` | CLI: `new`, `lint` |
| `payload/bin/glossary.mjs` | CLI: `lint`, `suggest` |
| `payload/hooks/decision-records-nudge.mjs` | `PreToolUse` on `Bash`, `git commit`, staged files only |
| `settings.partial.json` | registers the hook |

Each library gets a `*.test.mjs` beside it. The three CLIs get no separate tests beyond an entry-point smoke test: they parse `argv`, call one library function and print — the logic under test lives in the library.

**The normalised file's shape.** Sections are `##`, entries become `###`:

```markdown
# Risk Register

<table of contents>

## Active
### RISK-HARNESS-001 — <title>
- **Status:** Active
- **Context:** …

## Deferred
### RISK-SUP-002 — <title>

## Mitigated

## Closed
### RISK-NEO4J-004 — <title>
- **Status:** Closed (2026-07-17) — the check-and-retry landed
```

Entries are `##` today, so normalisation demotes 44 headings by one level. That is a structural change, not a prose edit, and it is what lets an entry belong to a section at all.

---

### Task 1: `resolveRecordPaths` — one rule for where the records live

Three CLIs and a hook all need to answer "where is the register in this repository". Four copies of that answer drift the first time the tree moves; this is the one place it is written.

**Files:**
- Create: `payload/bin/lib/records-paths.mjs`
- Create: `payload/bin/lib/records-paths.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveRecordPaths(root)` → `{ base, risks, adrDir, glossary }`, all absolute. `base` is `<root>/.ultrapowers` when that directory exists, otherwise `root`.

- [ ] **Step 1: Write the failing tests**

Create `payload/bin/lib/records-paths.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRecordPaths } from "./records-paths.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "records-paths-"));

test("without the tree, records live at the repository root", () => {
  const root = tmp();
  const p = resolveRecordPaths(root);
  assert.equal(p.base, root);
  assert.equal(p.risks, join(root, "RISK_REGISTER.md"));
  assert.equal(p.adrDir, join(root, "adr"));
  assert.equal(p.glossary, join(root, "GLOSSARY.md"));
});

test("with the tree, records live inside it", () => {
  const root = tmp();
  mkdirSync(join(root, ".ultrapowers"));
  const p = resolveRecordPaths(root);
  assert.equal(p.base, join(root, ".ultrapowers"));
  assert.equal(p.risks, join(root, ".ultrapowers", "RISK_REGISTER.md"));
  assert.equal(p.adrDir, join(root, ".ultrapowers", "adr"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/bin/lib/records-paths.test.mjs`
Expected: FAIL — `Cannot find module './records-paths.mjs'`.

- [ ] **Step 3: Write the resolver**

Create `payload/bin/lib/records-paths.mjs`:

```js
import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveRecordPaths(root) {
  const tree = join(root, ".ultrapowers");
  const base = existsSync(tree) ? tree : root;
  return {
    base,
    risks: join(base, "RISK_REGISTER.md"),
    adrDir: join(base, "adr"),
    glossary: join(base, "GLOSSARY.md"),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/bin/lib/records-paths.test.mjs`
Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add payload/bin/lib/records-paths.mjs payload/bin/lib/records-paths.test.mjs
git commit -m "feat(records): one resolver for where decision records live"
```

---

### Task 2: Parse and lint the risk register

**Files:**
- Create: `payload/bin/lib/risk-register.mjs`
- Create: `payload/bin/lib/risk-register.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseRegister(text)` → `{ preamble, entries }` where each entry is `{ id, prefix, num, title, status, lines, section }`. `lines` is the entry's body verbatim, heading excluded. `section` is the enclosing `##` heading when the file is already sectioned, otherwise `null`.
  - `lintRegister(parsed, { knownAdrIds })` → `Array<{ id, problem }>`, empty when clean.
  - `nextId(parsed, prefix)` → `"RISK-<PREFIX>-<NNN>"`, one above the highest ever used for that prefix.

- [ ] **Step 1: Write the failing tests**

Create `payload/bin/lib/risk-register.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegister, lintRegister, nextId } from "./risk-register.mjs";

const SECTIONED = `# Risk Register

## Active
### RISK-VARIANT-003 — trash retention
- **Status:** Active
- **Context:** something

## Closed
### RISK-NEO4J-004 — stale reference
- **Status:** Closed (2026-07-17) — the check-and-retry landed
- **Context:** other
`;

test("parses id, prefix, number, title and status", () => {
  const { entries } = parseRegister(SECTIONED);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    { ...entries[0], lines: undefined },
    { id: "RISK-VARIANT-003", prefix: "VARIANT", num: 3, title: "trash retention", status: "Active", section: "Active", lines: undefined },
  );
});

test("parses the legacy flat format, with no sections", () => {
  const { entries } = parseRegister("# Risk Register\n\n## RISK-SUP-002 — x\n- **Status:** Open (accepted)\n");
  assert.equal(entries[0].section, null);
  assert.equal(entries[0].status, "Open (accepted)");
});

test("clean input lints clean", () => {
  assert.deepEqual(lintRegister(parseRegister(SECTIONED), { knownAdrIds: [] }), []);
});

test("an unknown status value is reported", () => {
  const bad = SECTIONED.replace("- **Status:** Active", "- **Status:** Open (accepted)");
  const found = lintRegister(parseRegister(bad), { knownAdrIds: [] });
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /status/i);
  assert.equal(found[0].id, "RISK-VARIANT-003");
});

test("an entry in the wrong section is reported", () => {
  const bad = SECTIONED.replace("## Closed\n### RISK-NEO4J-004", "## Active\n### RISK-NEO4J-004");
  const found = lintRegister(parseRegister(bad), { knownAdrIds: [] });
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /section/i);
});

test("a duplicate id is reported once", () => {
  const bad = SECTIONED + "\n### RISK-VARIANT-003 — again\n- **Status:** Active\n";
  const found = lintRegister(parseRegister(bad), { knownAdrIds: [] });
  assert.equal(found.filter((f) => /duplicate/i.test(f.problem)).length, 1);
});

test("a dangling ADR reference is reported", () => {
  const bad = SECTIONED.replace("- **Context:** something", "- **Context:** see ADR-0007");
  const found = lintRegister(parseRegister(bad), { knownAdrIds: ["ADR-0001"] });
  assert.match(found[0].problem, /ADR-0007/);
});

test("nextId never reuses a number, including a closed one", () => {
  const parsed = parseRegister(SECTIONED);
  assert.equal(nextId(parsed, "VARIANT"), "RISK-VARIANT-004");
  assert.equal(nextId(parsed, "NEO4J"), "RISK-NEO4J-005");
  assert.equal(nextId(parsed, "BRANDNEW"), "RISK-BRANDNEW-001");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/bin/lib/risk-register.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the parser and the linter**

Create `payload/bin/lib/risk-register.mjs`:

```js
export const SECTIONS = ["Active", "Deferred", "Mitigated", "Closed"];

const HEADING = /^(##|###)\s+(RISK-([A-Z0-9]+)-(\d+))\s+—\s+(.+?)\s*$/;
const SECTION = /^##\s+(Active|Deferred|Mitigated|Closed)\s*$/;
const STATUS = /^-\s+\*\*Status:\*\*\s*(.+?)\s*$/;

const VALID_STATUS = [
  /^Active$/,
  /^Deferred \(.+\)$/,
  /^Mitigated$/,
  /^Closed \(\d{4}-\d{2}-\d{2}\) — .+$/,
];

export function parseRegister(text) {
  const lines = text.split("\n");
  const entries = [];
  const preamble = [];
  let section = null;
  let current = null;
  for (const line of lines) {
    const sec = SECTION.exec(line);
    if (sec && !HEADING.test(line)) { section = sec[1]; current = null; continue; }
    const head = HEADING.exec(line);
    if (head) {
      current = { id: head[2], prefix: head[3], num: Number(head[4]), title: head[5], status: null, lines: [], section };
      entries.push(current);
      continue;
    }
    if (!current) { preamble.push(line); continue; }
    const st = STATUS.exec(line);
    if (st && current.status === null) current.status = st[1];
    current.lines.push(line);
  }
  return { preamble, entries };
}

export function sectionFor(status) {
  if (/^Closed/.test(status ?? "")) return "Closed";
  if (/^Deferred/.test(status ?? "")) return "Deferred";
  if (/^Mitigated$/.test(status ?? "")) return "Mitigated";
  return "Active";
}

export function lintRegister({ entries }, { knownAdrIds = [] } = {}) {
  const problems = [];
  const seen = new Set();
  const known = new Set(knownAdrIds);
  for (const e of entries) {
    if (seen.has(e.id)) problems.push({ id: e.id, problem: `duplicate id — ${e.id} appears more than once` });
    seen.add(e.id);
    if (!e.status) problems.push({ id: e.id, problem: "no Status field" });
    else if (!VALID_STATUS.some((re) => re.test(e.status)))
      problems.push({ id: e.id, problem: `status "${e.status}" is outside the vocabulary (Active, Deferred (…), Mitigated, Closed (date) — why)` });
    if (e.section && e.status && sectionFor(e.status) !== e.section)
      problems.push({ id: e.id, problem: `wrong section — status maps to ${sectionFor(e.status)}, entry sits under ${e.section}` });
    for (const m of e.lines.join("\n").matchAll(/\bADR-(\d{4})\b/g))
      if (!known.has(`ADR-${m[1]}`)) problems.push({ id: e.id, problem: `dangling reference to ADR-${m[1]}` });
  }
  return problems;
}

export function nextId({ entries }, prefix) {
  const used = entries.filter((e) => e.prefix === prefix).map((e) => e.num);
  const next = used.length ? Math.max(...used) + 1 : 1;
  return `RISK-${prefix}-${String(next).padStart(3, "0")}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/bin/lib/risk-register.test.mjs`
Expected: 8/8 PASS.

- [ ] **Step 5: Verify the parser survives the real 814-line register**

```bash
node -e "
  import('./payload/bin/lib/risk-register.mjs').then(async (m) => {
    const { readFileSync } = await import('node:fs');
    const p = m.parseRegister(readFileSync('RISK_REGISTER.md', 'utf8'));
    console.log('entries', p.entries.length);
    console.log('without status', p.entries.filter((e) => !e.status).map((e) => e.id));
  });
"
```

Expected: `entries 44` and an empty list. A parsed count below 44 means a heading uses a different dash or spacing — fix the regex, not the register.

- [ ] **Step 6: Commit**

```bash
git add payload/bin/lib/risk-register.mjs payload/bin/lib/risk-register.test.mjs
git commit -m "feat(risks): parse and lint the register"
```

---

### Task 3: Normalise — four sections, one vocabulary, a regenerated contents

**Files:**
- Modify: `payload/bin/lib/risk-register.mjs`
- Modify: `payload/bin/lib/risk-register.test.mjs`

**Interfaces:**
- Consumes: `parseRegister`, `sectionFor`, `SECTIONS` from Task 2.
- Produces:
  - `migrateStatus(raw, fallbackDate)` → `{ status, nuance }` — `nuance` is the parenthetical text that made the old spelling unique, or `null`.
  - `normalizeRegister(parsed, { fallbackDate })` → the whole file as a string. Idempotent.

- [ ] **Step 1: Write the failing tests**

Append to `payload/bin/lib/risk-register.test.mjs`:

```js
import { migrateStatus, normalizeRegister } from "./risk-register.mjs";

test("maps every observed Open spelling onto the vocabulary", () => {
  const cases = [
    ["Open (accepted)", "Active", "accepted"],
    ["Open (accepted / low)", "Active", "accepted / low"],
    ["Open (accepted; not fixable from this repository)", "Active", "accepted; not fixable from this repository"],
    ["Open (mitigated by design)", "Mitigated", "mitigated by design"],
    ["Open (mitigated by design, 2026-07-27)", "Mitigated", "mitigated by design, 2026-07-27"],
    ["Open (until tests green)", "Deferred (until tests green)", null],
    ["Open (until Stage 2)", "Deferred (until Stage 2)", null],
    ["Open (verification pending)", "Deferred (verification pending)", null],
    ["Mitigated (detector built; auto-apply in Stage 2)", "Mitigated", "detector built; auto-apply in Stage 2"],
  ];
  for (const [raw, status, nuance] of cases) {
    const got = migrateStatus(raw, "2026-07-28");
    assert.equal(got.status, status, raw);
    assert.equal(got.nuance, nuance, raw);
  }
});

test("Resolved becomes Closed, keeping its date and reason", () => {
  assert.deepEqual(migrateStatus("Resolved (2026-07-17) — the check-and-retry landed", "2026-07-28"), {
    status: "Closed (2026-07-17) — the check-and-retry landed",
    nuance: null,
  });
});

test("Resolved without a date takes the fallback and keeps the reason", () => {
  assert.deepEqual(migrateStatus("Resolved (subset choice + provenance-based pruning)", "2026-07-28"), {
    status: "Closed (2026-07-28) — subset choice + provenance-based pruning",
    nuance: null,
  });
});

test("an already-valid status passes through untouched", () => {
  assert.deepEqual(migrateStatus("Active", "2026-07-28"), { status: "Active", nuance: null });
});

test("normalize groups into sections and is idempotent", () => {
  const flat = `# Risk Register

## RISK-B-002 — later
- **Status:** Open (accepted)
- **Mitigation:** none

## RISK-A-001 — earlier
- **Status:** Resolved (2026-07-17) — done
`;
  const once = normalizeRegister(parseRegister(flat), { fallbackDate: "2026-07-28" });
  assert.match(once, /## Active\n### RISK-B-002/);
  assert.match(once, /## Closed\n### RISK-A-001/);
  assert.match(once, /Status nuance \(migrated 2026-07-28\): accepted/);
  assert.equal(normalizeRegister(parseRegister(once), { fallbackDate: "2026-07-28" }), once);
});

test("an entry with no Mitigation field gains one to hold the nuance", () => {
  const flat = "# Risk Register\n\n## RISK-A-001 — x\n- **Status:** Open (accepted / low)\n";
  const out = normalizeRegister(parseRegister(flat), { fallbackDate: "2026-07-28" });
  assert.match(out, /- \*\*Mitigation:\*\* Status nuance \(migrated 2026-07-28\): accepted \/ low/);
});

test("every section heading is present even when empty", () => {
  const out = normalizeRegister(parseRegister("# Risk Register\n"), { fallbackDate: "2026-07-28" });
  for (const s of ["Active", "Deferred", "Mitigated", "Closed"]) assert.match(out, new RegExp(`^## ${s}$`, "m"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/bin/lib/risk-register.test.mjs`
Expected: the seven new cases FAIL — `migrateStatus is not a function`.

- [ ] **Step 3: Write the migration and the normaliser**

Append to `payload/bin/lib/risk-register.mjs`:

```js
const DEFERRED_HINT = /\b(until|pending|awaiting|blocked on)\b/i;

export function migrateStatus(raw, fallbackDate) {
  const s = String(raw ?? "").trim();
  if (VALID_STATUS.some((re) => re.test(s))) return { status: s, nuance: null };

  let m = /^Resolved\s*\((\d{4}-\d{2}-\d{2})\)\s*—\s*(.+)$/.exec(s);
  if (m) return { status: `Closed (${m[1]}) — ${m[2]}`, nuance: null };
  m = /^Resolved\s*\((.+)\)\s*$/.exec(s);
  if (m) return { status: `Closed (${fallbackDate}) — ${m[1]}`, nuance: null };

  m = /^(Open|Mitigated)\s*\((.+?)\)\s*(?:—\s*(.+))?$/.exec(s);
  if (m) {
    const inner = m[2];
    const tail = m[3] ? ` — ${m[3]}` : "";
    if (/mitigated by design/i.test(inner) || m[1] === "Mitigated")
      return { status: "Mitigated", nuance: `${inner}${tail}` };
    if (DEFERRED_HINT.test(inner)) return { status: `Deferred (${inner})`, nuance: tail ? m[3] : null };
    return { status: "Active", nuance: `${inner}${tail}` };
  }
  return { status: "Active", nuance: s || null };
}

function anchor(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");
}

// The nuance is appended to Mitigation rather than dropped: "not fixable from this repository"
// was the single most useful thing several old status lines said.
function applyNuance(lines, nuance, fallbackDate) {
  if (!nuance) return lines;
  const sentence = `Status nuance (migrated ${fallbackDate}): ${nuance}`;
  const i = lines.findIndex((l) => /^-\s+\*\*Mitigation:\*\*/.test(l));
  if (i === -1) return [...lines, `- **Mitigation:** ${sentence}`];
  return lines.map((l, n) => (n === i ? `${l.replace(/\s*$/, "")} ${sentence}` : l));
}

export function normalizeRegister({ entries }, { fallbackDate }) {
  const migrated = entries.map((e) => {
    const { status, nuance } = migrateStatus(e.status, fallbackDate);
    const lines = applyNuance(
      e.lines.map((l) => (STATUS.test(l) ? `- **Status:** ${status}` : l)).filter((l, i, a) => !(l === "" && a[i - 1] === "")),
      nuance,
      fallbackDate,
    );
    return { ...e, status, lines };
  });

  const bySection = new Map(SECTIONS.map((s) => [s, []]));
  for (const e of migrated) bySection.get(sectionFor(e.status)).push(e);
  for (const list of bySection.values())
    list.sort((a, b) => a.prefix.localeCompare(b.prefix) || a.num - b.num);

  const toc = ["## Contents", ""];
  for (const s of SECTIONS) {
    toc.push(`### ${s}`);
    const list = bySection.get(s);
    if (!list.length) toc.push("- _none_");
    for (const e of list) toc.push(`- [${e.id} — ${e.title}](#${anchor(`${e.id} — ${e.title}`)})`);
    toc.push("");
  }

  const body = [];
  for (const s of SECTIONS) {
    body.push(`## ${s}`);
    for (const e of bySection.get(s)) {
      body.push(`### ${e.id} — ${e.title}`);
      body.push(...e.lines.join("\n").replace(/\n+$/, "").split("\n"));
      body.push("");
    }
  }

  return ["# Risk Register", "", ...toc, ...body].join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/bin/lib/risk-register.test.mjs`
Expected: 15/15 PASS. The idempotence assertion is the one that matters most — a normaliser that keeps moving the file is worse than none, because every commit then carries a spurious diff.

- [ ] **Step 5: Commit**

```bash
git add payload/bin/lib/risk-register.mjs payload/bin/lib/risk-register.test.mjs
git commit -m "feat(risks): normalise into four sections and one status vocabulary"
```

---

### Task 4: The `risks` CLI, and the one-off normalisation of the real register

**Files:**
- Create: `payload/bin/risks.mjs`
- Modify: `RISK_REGISTER.md` (or `.ultrapowers/RISK_REGISTER.md` if plan #1 has landed)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `risks lint` (exit 1 on problems), `risks normalize`, `risks add "<title>" --prefix VARIANT`.

- [ ] **Step 1: Write the CLI**

Create `payload/bin/risks.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRecordPaths } from "./lib/records-paths.mjs";
import { parseRegister, lintRegister, normalizeRegister, nextId } from "./lib/risk-register.mjs";

const USAGE = `usage:
  risks lint [--root DIR]
  risks normalize [--root DIR]
  risks add "<title>" --prefix PREFIX [--root DIR]`;

function knownAdrIds(adrDir) {
  if (!existsSync(adrDir)) return [];
  return readdirSync(adrDir)
    .map((n) => /^(\d{4})-/.exec(n))
    .filter(Boolean)
    .map((m) => `ADR-${m[1]}`);
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function main(argv) {
  const cmd = argv[0];
  const root = resolve(flag(argv, "--root") || process.cwd());
  const paths = resolveRecordPaths(root);
  const today = new Date().toISOString().slice(0, 10);
  if (!existsSync(paths.risks)) {
    console.error(`no register at ${paths.risks}`);
    return 2;
  }
  const parsed = parseRegister(readFileSync(paths.risks, "utf8"));

  if (cmd === "lint") {
    const problems = lintRegister(parsed, { knownAdrIds: knownAdrIds(paths.adrDir) });
    for (const p of problems) console.error(`${p.id}: ${p.problem}`);
    if (problems.length) console.error(`\n${problems.length} problem(s). Fix with: risks normalize`);
    return problems.length ? 1 : 0;
  }

  if (cmd === "normalize") {
    const out = normalizeRegister(parsed, { fallbackDate: today });
    const before = readFileSync(paths.risks, "utf8");
    if (out === before) { console.log("already normalised"); return 0; }
    writeFileSync(paths.risks, out, "utf8");
    console.log(`normalised ${parsed.entries.length} entries -> ${paths.risks}`);
    return 0;
  }

  if (cmd === "add") {
    const title = argv[1];
    const prefix = flag(argv, "--prefix");
    if (!title || !prefix || title.startsWith("--")) { console.error(USAGE); return 2; }
    const id = nextId(parsed, prefix.toUpperCase());
    const entry = `\n### ${id} — ${title}\n- **Status:** Active\n- **Context:** \n- **Mitigation:** \n- **Residual:** \n`;
    const text = readFileSync(paths.risks, "utf8");
    const at = text.indexOf("\n## Deferred");
    const out = at === -1 ? text + entry : text.slice(0, at) + entry + text.slice(at);
    writeFileSync(paths.risks, out, "utf8");
    console.log(id);
    return 0;
  }

  console.error(USAGE);
  return 2;
}

function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMainModule()) process.exit(main(process.argv.slice(2)));
```

- [ ] **Step 2: Verify each subcommand against a scratch copy first**

```bash
mkdir -p /tmp/risks-probe && cp RISK_REGISTER.md /tmp/risks-probe/
node payload/bin/risks.mjs lint --root /tmp/risks-probe | head -5
node payload/bin/risks.mjs normalize --root /tmp/risks-probe
node payload/bin/risks.mjs lint --root /tmp/risks-probe && echo "clean after normalize"
node payload/bin/risks.mjs normalize --root /tmp/risks-probe
node payload/bin/risks.mjs add "probe entry" --prefix VARIANT --root /tmp/risks-probe
```

Expected, in order: a list of status problems; `normalised 44 entries`; `clean after normalize`; `already normalised`; `RISK-VARIANT-005`.

`already normalised` on the second run is the idempotence check against real data — the unit test proves it on a fixture, this proves it on 814 lines.

- [ ] **Step 3: Review the real diff before writing it**

```bash
node payload/bin/risks.mjs normalize
git diff --stat RISK_REGISTER.md
git diff RISK_REGISTER.md | grep "^-" | grep -v "^---" | grep -v "Status:" | head -20
```

Expected: the only removed lines that are not `Status:` lines are the old `## RISK-…` headings (now `###`) and blank lines. **If any prose line appears in that output, stop and revert** — `normalize` is a pure move, and a prose edit means a bug in `applyNuance`.

- [ ] **Step 4: Commit**

```bash
git add payload/bin/risks.mjs RISK_REGISTER.md
git commit -m "feat(risks): the CLI, and normalise the register onto four sections"
```

---

### Task 5: `adr` — allocate, template, lint

The format is fixed from outside: `gsd-doc-classifier` recognises `NNNN-slug.md` with frontmatter `status:`, a `# ADR-NNNN Title` heading, and `## Context` / `## Decision` / `## Consequences`, and marks such a document `locked: true`. Keeping that shape costs nothing and means an ADR is machine-readable by a tool this repository does not own.

**Files:**
- Create: `payload/bin/lib/adr-lib.mjs`
- Create: `payload/bin/lib/adr-lib.test.mjs`
- Create: `payload/bin/adr.mjs`

**Interfaces:**
- Consumes: `resolveRecordPaths` (Task 1); `parseRegister` (Task 2) for the reverse cross-reference check.
- Produces: `nextAdrNumber(filenames)` → `"0004"`; `adrTemplate({ number, title, date })` → string; `lintAdr(text, filename)` → `Array<{ file, problem }>`; `lintCrossRefs({ adrs, riskIds })` → dangling references in both directions.

- [ ] **Step 1: Write the failing tests**

Create `payload/bin/lib/adr-lib.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAdrNumber, adrTemplate, lintAdr, lintCrossRefs } from "./adr-lib.mjs";

test("allocates above the highest existing number, never filling a gap", () => {
  assert.equal(nextAdrNumber([]), "0001");
  assert.equal(nextAdrNumber(["0001-a.md", "0003-c.md"]), "0004");
  assert.equal(nextAdrNumber(["0001-a.md", "README.md", "notes.txt"]), "0002");
});

test("the template carries every section the classifier expects", () => {
  const t = adrTemplate({ number: "0007", title: "Fork instead of consume", date: "2026-07-28" });
  assert.match(t, /^---\nstatus: proposed\ndate: 2026-07-28\n---\n/);
  assert.match(t, /^# ADR-0007 Fork instead of consume$/m);
  for (const s of ["## Context", "## Decision", "## Consequences"]) assert.match(t, new RegExp(`^${s}$`, "m"));
});

test("a well-formed ADR lints clean", () => {
  const t = adrTemplate({ number: "0007", title: "x", date: "2026-07-28" });
  assert.deepEqual(lintAdr(t, "0007-x.md"), []);
});

test("a heading whose number disagrees with the filename is reported", () => {
  const t = adrTemplate({ number: "0007", title: "x", date: "2026-07-28" });
  const found = lintAdr(t, "0008-x.md");
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /0008/);
});

test("a missing section is reported by name", () => {
  const t = adrTemplate({ number: "0007", title: "x", date: "2026-07-28" }).replace("## Consequences\n", "");
  assert.match(lintAdr(t, "0007-x.md")[0].problem, /Consequences/);
});

test("a missing status field is reported", () => {
  const t = adrTemplate({ number: "0007", title: "x", date: "2026-07-28" }).replace("status: proposed\n", "");
  assert.match(lintAdr(t, "0007-x.md")[0].problem, /status/);
});

test("cross-references are checked in both directions", () => {
  const adrs = [{ file: "0001-a.md", id: "ADR-0001", text: "see RISK-SUP-009 and ADR-0002" }];
  const found = lintCrossRefs({ adrs, riskIds: ["RISK-SUP-001"] });
  assert.equal(found.length, 2);
  assert.ok(found.some((f) => /RISK-SUP-009/.test(f.problem)));
  assert.ok(found.some((f) => /ADR-0002/.test(f.problem)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/bin/lib/adr-lib.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the library**

Create `payload/bin/lib/adr-lib.mjs`:

```js
const FILE = /^(\d{4})-[a-z0-9-]+\.md$/;
const SECTIONS = ["## Context", "## Decision", "## Consequences"];

export function nextAdrNumber(filenames) {
  const nums = filenames.map((n) => FILE.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0");
}

export function adrTemplate({ number, title, date }) {
  return `---
status: proposed
date: ${date}
---

# ADR-${number} ${title}

## Context

## Decision

## Consequences
`;
}

export function lintAdr(text, filename) {
  const problems = [];
  const m = FILE.exec(filename);
  if (!m) return [{ file: filename, problem: "filename must be NNNN-kebab-slug.md" }];
  if (!/^---\n(?:.*\n)*?status:\s*\S+/m.test(text)) problems.push({ file: filename, problem: "no `status:` field in the frontmatter" });
  const head = /^# ADR-(\d{4}) (.+)$/m.exec(text);
  if (!head) problems.push({ file: filename, problem: "no `# ADR-NNNN Title` heading" });
  else if (head[1] !== m[1]) problems.push({ file: filename, problem: `heading says ADR-${head[1]}, filename says ${m[1]}` });
  for (const s of SECTIONS)
    if (!new RegExp(`^${s}$`, "m").test(text)) problems.push({ file: filename, problem: `missing section ${s}` });
  return problems;
}

// Both directions: an ADR naming a risk that does not exist is as broken as a risk naming an
// ADR that does not exist, and only one of the two is caught by linting the register.
export function lintCrossRefs({ adrs, riskIds }) {
  const problems = [];
  const knownRisks = new Set(riskIds);
  const knownAdrs = new Set(adrs.map((a) => a.id));
  for (const a of adrs) {
    for (const m of a.text.matchAll(/\bRISK-[A-Z0-9]+-\d+\b/g))
      if (!knownRisks.has(m[0])) problems.push({ file: a.file, problem: `dangling reference to ${m[0]}` });
    for (const m of a.text.matchAll(/\bADR-(\d{4})\b/g))
      if (`ADR-${m[1]}` !== a.id && !knownAdrs.has(`ADR-${m[1]}`))
        problems.push({ file: a.file, problem: `dangling reference to ADR-${m[1]}` });
  }
  return problems;
}
```

- [ ] **Step 4: Write the CLI**

Create `payload/bin/adr.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRecordPaths } from "./lib/records-paths.mjs";
import { nextAdrNumber, adrTemplate, lintAdr, lintCrossRefs } from "./lib/adr-lib.mjs";
import { parseRegister } from "./lib/risk-register.mjs";

const USAGE = `usage:
  adr new "<title>" [--root DIR]
  adr lint [--root DIR]`;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function readAdrs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n !== "README.md")
    .map((file) => ({ file, id: `ADR-${file.slice(0, 4)}`, text: readFileSync(join(dir, file), "utf8") }));
}

function main(argv) {
  const cmd = argv[0];
  const root = resolve(flag(argv, "--root") || process.cwd());
  const paths = resolveRecordPaths(root);

  if (cmd === "new") {
    const title = argv[1];
    if (!title || title.startsWith("--")) { console.error(USAGE); return 2; }
    mkdirSync(paths.adrDir, { recursive: true });
    const number = nextAdrNumber(readdirSync(paths.adrDir));
    const file = join(paths.adrDir, `${number}-${slug(title)}.md`);
    writeFileSync(file, adrTemplate({ number, title, date: new Date().toISOString().slice(0, 10) }), "utf8");
    console.log(file);
    return 0;
  }

  if (cmd === "lint") {
    const adrs = readAdrs(paths.adrDir);
    const riskIds = existsSync(paths.risks)
      ? parseRegister(readFileSync(paths.risks, "utf8")).entries.map((e) => e.id)
      : [];
    const problems = [...adrs.flatMap((a) => lintAdr(a.text, a.file)), ...lintCrossRefs({ adrs, riskIds })];
    for (const p of problems) console.error(`${p.file}: ${p.problem}`);
    return problems.length ? 1 : 0;
  }

  console.error(USAGE);
  return 2;
}

function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMainModule()) process.exit(main(process.argv.slice(2)));
```

- [ ] **Step 5: Run the tests and a round-trip**

```bash
node --test payload/bin/lib/adr-lib.test.mjs
mkdir -p /tmp/adr-probe && node payload/bin/adr.mjs new "Fork instead of consume" --root /tmp/adr-probe
node payload/bin/adr.mjs lint --root /tmp/adr-probe && echo "template lints clean"
```

Expected: 7/7 PASS, a path ending `0001-fork-instead-of-consume.md`, then `template lints clean`. A template that does not pass its own linter is the first bug to look for.

- [ ] **Step 6: Commit**

```bash
git add payload/bin/lib/adr-lib.mjs payload/bin/lib/adr-lib.test.mjs payload/bin/adr.mjs
git commit -m "feat(adr): allocate, template and lint architecture decision records"
```

---

### Task 6: `glossary` — lint, and expose the gaps

`suggest` proposes nothing and writes nothing. It reports terms that appear often in prose and are not defined; deciding whether a term is overloaded enough to define is judgement, and a tool that guessed would fill the file with noise until nobody read it.

**Files:**
- Create: `payload/bin/lib/glossary-lib.mjs`
- Create: `payload/bin/lib/glossary-lib.test.mjs`
- Create: `payload/bin/glossary.mjs`

**Interfaces:**
- Consumes: `resolveRecordPaths` (Task 1).
- Produces: `parseGlossary(text)` → `Array<{ term, definition }>`; `lintGlossary(text)` → problems; `suggestTerms({ documents, defined, minCount, minFiles })` → `Array<{ term, count, files }>` sorted by count descending.

- [ ] **Step 1: Write the failing tests**

Create `payload/bin/lib/glossary-lib.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGlossary, lintGlossary, suggestTerms } from "./glossary-lib.mjs";

const GOOD = `# Glossary

## bundle
Everything this repository installs into ~/.claude, as one unit.

## profile
A named subset of the bundle: full, base or lite.
`;

test("parses terms and their definitions", () => {
  assert.deepEqual(parseGlossary(GOOD).map((e) => e.term), ["bundle", "profile"]);
  assert.match(parseGlossary(GOOD)[0].definition, /installs into/);
});

test("a well-formed glossary lints clean", () => {
  assert.deepEqual(lintGlossary(GOOD), []);
});

test("an empty definition is reported", () => {
  assert.match(lintGlossary(GOOD + "\n## delta\n")[0].problem, /delta/);
});

test("a duplicate term is reported", () => {
  assert.match(lintGlossary(GOOD + "\n## bundle\nAgain.\n")[0].problem, /duplicate/i);
});

test("terms out of alphabetical order are reported", () => {
  const out = `# Glossary\n\n## profile\nA subset.\n\n## bundle\nA unit.\n`;
  assert.match(lintGlossary(out)[0].problem, /order/i);
});

test("suggest reports frequent undefined terms and never proposes a definition", () => {
  const documents = [
    { path: "a.md", text: "The `graft` is applied. A `graft` again. And `graft` once more. Also `bundle`." },
    { path: "b.md", text: "Another `graft` here." },
  ];
  const found = suggestTerms({ documents, defined: ["bundle"], minCount: 3, minFiles: 2 });
  assert.deepEqual(found.map((f) => f.term), ["graft"]);
  assert.equal(found[0].count, 4);
  assert.deepEqual(found[0].files, ["a.md", "b.md"]);
  assert.equal("definition" in found[0], false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/bin/lib/glossary-lib.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the library**

Create `payload/bin/lib/glossary-lib.mjs`:

```js
export function parseGlossary(text) {
  const entries = [];
  let current = null;
  for (const line of String(text ?? "").split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { current = { term: m[1], definition: "" }; entries.push(current); continue; }
    if (current) current.definition += `${line}\n`;
  }
  return entries.map((e) => ({ ...e, definition: e.definition.trim() }));
}

export function lintGlossary(text) {
  const entries = parseGlossary(text);
  const problems = [];
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.term)) problems.push({ term: e.term, problem: `duplicate term — ${e.term} is defined more than once` });
    seen.add(e.term);
    if (!e.definition) problems.push({ term: e.term, problem: `${e.term} has no definition` });
  }
  const terms = entries.map((e) => e.term);
  const sorted = [...terms].sort((a, b) => a.localeCompare(b));
  if (terms.join(" ") !== sorted.join(" "))
    problems.push({ term: null, problem: "terms are out of alphabetical order" });
  return problems;
}

// Backticked identifiers only. A frequency pass over free prose surfaces "the", "should" and
// every project noun, which is noise dressed as a report; a term someone bothered to mark as
// code is a term someone already treated as jargon.
export function suggestTerms({ documents, defined = [], minCount = 5, minFiles = 2 }) {
  const known = new Set(defined);
  const counts = new Map();
  for (const doc of documents) {
    for (const m of String(doc.text ?? "").matchAll(/`([a-z][a-z0-9 -]{2,30})`/gi)) {
      const term = m[1].toLowerCase();
      if (known.has(term)) continue;
      const rec = counts.get(term) ?? { term, count: 0, files: new Set() };
      rec.count += 1;
      rec.files.add(doc.path);
      counts.set(term, rec);
    }
  }
  return [...counts.values()]
    .filter((r) => r.count >= minCount && r.files.size >= minFiles)
    .map((r) => ({ term: r.term, count: r.count, files: [...r.files].sort() }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}
```

- [ ] **Step 4: Write the CLI**

Create `payload/bin/glossary.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRecordPaths } from "./lib/records-paths.mjs";
import { parseGlossary, lintGlossary, suggestTerms } from "./lib/glossary-lib.mjs";

const USAGE = `usage:
  glossary lint [--root DIR]
  glossary suggest [--root DIR] [--min-count N]`;

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function collect(dir, out = [], depth = 0) {
  if (depth > 4 || !existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out, depth + 1);
    else if (name.endsWith(".md")) out.push({ path: full, text: readFileSync(full, "utf8") });
  }
  return out;
}

function main(argv) {
  const cmd = argv[0];
  const root = resolve(flag(argv, "--root") || process.cwd());
  const paths = resolveRecordPaths(root);
  const text = existsSync(paths.glossary) ? readFileSync(paths.glossary, "utf8") : "";

  if (cmd === "lint") {
    if (!existsSync(paths.glossary)) { console.log("no glossary yet - nothing to lint"); return 0; }
    const problems = lintGlossary(text);
    for (const p of problems) console.error(p.problem);
    return problems.length ? 1 : 0;
  }

  if (cmd === "suggest") {
    const documents = [...collect(join(root, "docs")), ...collect(root, [], 4).filter((d) => !d.path.includes("docs"))];
    const found = suggestTerms({
      documents,
      defined: parseGlossary(text).map((e) => e.term),
      minCount: Number(flag(argv, "--min-count") || 5),
    });
    if (!found.length) { console.log("no undefined terms above the threshold"); return 0; }
    for (const f of found) console.log(`${String(f.count).padStart(4)}  ${f.term}  (${f.files.length} files)`);
    console.log("\nThese are gaps, not proposals. Define the ones that are genuinely overloaded; ignore the rest.");
    return 0;
  }

  console.error(USAGE);
  return 2;
}

function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMainModule()) process.exit(main(process.argv.slice(2)));
```

- [ ] **Step 5: Run the tests, then the suggest pass over this repository**

```bash
node --test payload/bin/lib/glossary-lib.test.mjs
node payload/bin/glossary.mjs suggest --min-count 8 | head -20
```

Expected: 6/6 PASS, and a list whose top entries are this repository's real vocabulary — `profile`, `variant`, `payload`, `delta`, `graft`, `manifest`. If the list is dominated by filenames, raise `--min-count`; if it is empty, the collector is not reaching `docs/`.

- [ ] **Step 6: Commit**

```bash
git add payload/bin/lib/glossary-lib.mjs payload/bin/lib/glossary-lib.test.mjs payload/bin/glossary.mjs
git commit -m "feat(glossary): lint the file, and expose undefined terms without proposing any"
```

---

### Task 7: The nudge hook

**Files:**
- Create: `payload/hooks/decision-records-nudge.mjs`
- Create: `payload/hooks/decision-records-nudge.test.mjs`

**Interfaces:**
- Consumes: all three libraries, imported as `../bin/lib/*.mjs` — under `~/.claude`, `hooks/` and `bin/` are siblings.
- Produces: `isGitCommit(cmd)`, exported for the test; and, on a dirty record, a `PreToolUse` `additionalContext` string.

- [ ] **Step 1: Write the failing tests**

Create `payload/hooks/decision-records-nudge.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isGitCommit } from "./decision-records-nudge.mjs";

test("recognises a commit in any of its usual forms", () => {
  for (const cmd of ["git commit -m x", "git -C /repo commit", "git add . && git commit -F msg.txt", "git.exe commit --amend"])
    assert.equal(isGitCommit(cmd), true, cmd);
});

test("does not fire on other git commands", () => {
  for (const cmd of ["git push", "git status", "git log --oneline"]) assert.equal(isGitCommit(cmd), false, cmd);
});

test("a commit message mentioning commit does not matter - only the command does", () => {
  assert.equal(isGitCommit("echo 'how to commit' > notes.txt"), false);
  assert.equal(isGitCommit("git commit -m 'do not commit secrets'"), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/hooks/decision-records-nudge.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

Create `payload/hooks/decision-records-nudge.mjs`:

```js
#!/usr/bin/env node
// PreToolUse guard (matcher: Bash). Before a `git commit` that stages a decision record, run the
// matching lint and print what is wrong and the command that fixes it. NON-BLOCKING by design:
// this follows ci-watch-nudge and graphify-grep-nudge, not secrets-gate - an unnormalised
// register is untidy, not dangerous. Fail-open: any error => exit 0, no output.
//
// It inspects the STAGED INDEX and never the commit message. db-live-access-gate already
// false-positives on SQL keywords inside messages; a second hook making that mistake would make
// `git commit -F` the only usable form.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRecordPaths } from "../bin/lib/records-paths.mjs";
import { parseRegister, lintRegister } from "../bin/lib/risk-register.mjs";
import { lintAdr, lintCrossRefs } from "../bin/lib/adr-lib.mjs";
import { lintGlossary } from "../bin/lib/glossary-lib.mjs";

function gitSubcommand(tokens) {
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "-C" || t === "-c") { i += 2; continue; }
    if (t.startsWith("-")) { i++; continue; }
    return t;
  }
  return null;
}

export function isGitCommit(cmd) {
  for (const seg of String(cmd || "").split(/&&|\|\||;|\|/)) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    if (tokens[0] !== "git" && tokens[0] !== "git.exe") continue;
    if (gitSubcommand(tokens) === "commit") return true;
  }
  return false;
}

const staged = (cwd) =>
  execFileSync("git", ["-C", cwd, "diff", "--cached", "--name-only"], { encoding: "utf8" })
    .split("\n").filter(Boolean).map((p) => p.replace(/\\/g, "/"));

function readAdrs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n !== "README.md")
    .map((file) => ({ file, id: `ADR-${file.slice(0, 4)}`, text: readFileSync(join(dir, file), "utf8") }));
}

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return; }
  if (!isGitCommit((d.tool_input || {}).command || "")) return;
  const cwd = d.cwd || process.cwd();
  const root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const paths = resolveRecordPaths(root);
  const rel = (p) => resolve(p).replace(/\\/g, "/").slice(resolve(root).replace(/\\/g, "/").length + 1);

  const files = staged(cwd);
  const touchesRisks = files.includes(rel(paths.risks));
  const touchesAdr = files.some((f) => f.startsWith(`${rel(paths.adrDir)}/`));
  const touchesGlossary = files.includes(rel(paths.glossary));
  if (!touchesRisks && !touchesAdr && !touchesGlossary) return;

  const notes = [];
  if (touchesRisks && existsSync(paths.risks)) {
    const adrIds = readAdrs(paths.adrDir).map((a) => a.id);
    const problems = lintRegister(parseRegister(readFileSync(paths.risks, "utf8")), { knownAdrIds: adrIds });
    if (problems.length)
      notes.push(`RISK_REGISTER.md: ${problems.length} problem(s) — ${problems.slice(0, 3).map((p) => `${p.id}: ${p.problem}`).join("; ")}. Fix: node ~/.claude/bin/risks.mjs normalize`);
  }
  if (touchesAdr) {
    const adrs = readAdrs(paths.adrDir);
    const riskIds = existsSync(paths.risks) ? parseRegister(readFileSync(paths.risks, "utf8")).entries.map((e) => e.id) : [];
    const problems = [...adrs.flatMap((a) => lintAdr(a.text, a.file)), ...lintCrossRefs({ adrs, riskIds })];
    if (problems.length)
      notes.push(`adr/: ${problems.length} problem(s) — ${problems.slice(0, 3).map((p) => `${p.file}: ${p.problem}`).join("; ")}. Check: node ~/.claude/bin/adr.mjs lint`);
  }
  if (touchesGlossary && existsSync(paths.glossary)) {
    const problems = lintGlossary(readFileSync(paths.glossary, "utf8"));
    if (problems.length)
      notes.push(`GLOSSARY.md: ${problems.slice(0, 3).map((p) => p.problem).join("; ")}. Check: node ~/.claude/bin/glossary.mjs lint`);
  }
  if (!notes.length) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `Decision records staged for commit have lint problems. This does not block the commit.\n${notes.join("\n")}`,
    },
  }));
}

function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  if (import.meta.url === pathToFileURL(a).href) return true;
  try { return import.meta.url === pathToFileURL(realpathSync(a)).href; } catch { return false; }
}

if (isMainModule()) {
  try { main(); } catch { /* fail-open */ }
  process.exit(0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/hooks/decision-records-nudge.test.mjs`
Expected: 3/3 PASS.

- [ ] **Step 5: Verify it stays silent where it should**

```bash
echo '{"tool_input":{"command":"git status"},"cwd":"'"$PWD"'"}' | node payload/hooks/decision-records-nudge.mjs; echo "exit=$?"
echo '{"tool_input":{"command":"git commit -m x"},"cwd":"'"$PWD"'"}' | node payload/hooks/decision-records-nudge.mjs; echo "exit=$?"
echo 'not json' | node payload/hooks/decision-records-nudge.mjs; echo "exit=$?"
```

Expected: no output and `exit=0` in all three cases — nothing is staged, and malformed input must fail open rather than crash the tool call.

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/decision-records-nudge.mjs payload/hooks/decision-records-nudge.test.mjs
git commit -m "feat(hooks): non-blocking nudge when a staged decision record fails its lint"
```

---

### Task 8: Seed the practice — three ADRs and the glossary

The practice is dead if the directory is empty. Three decisions already made pass all three conditions — hard to reverse, surprising without context, a real trade-off — and each still constrains decisions being taken now.

Two further candidates are deliberately **not** written here: three profiles replacing the two-variant allowlist model, and leaving `~/.gsd/` untouched when switching profiles. They pass the conditions too, but three is enough to make the directory real, and a backlog written in one sitting reads like a backlog.

**Files:**
- Create: three files under the resolved `adr/` directory
- Create: the resolved `GLOSSARY.md`

**Interfaces:**
- Consumes: `adr new` (Task 5), `glossary lint` (Task 6).
- Produces: `ADR-0001`, `ADR-0002`, `ADR-0003` — referenced from Task 9's verification.

- [ ] **Step 1: Allocate the three files**

```bash
node payload/bin/adr.mjs new "Fork superpowers instead of consuming it upstream"
node payload/bin/adr.mjs new "setup.mjs prints plugin install commands instead of running them"
node payload/bin/adr.mjs new "Reversible deletion through a trash batch instead of rm"
```

Expected: `0001-fork-superpowers-instead-of-consuming-it-upstream.md`, `0002-…`, `0003-…`.

- [ ] **Step 2: Fill each one**

Each gets `status: accepted`, and the three sections. The content each must carry, so the ADR is worth reading later:

- **ADR-0001** — Context: upstream ships behaviour this repository needs to change in ways upstream will not take. Decision: fork, rebuild from `original + patch` on every release, never hand-edit `main`. Consequences: a permanent merge burden that this project exists to absorb, and which is therefore never an argument against a change; a build that refuses on unclassified paths; `RISK-ULTRAPOWERS-001` carries the exposure.
- **ADR-0002** — Context: `setup.mjs` could install plugins directly. Decision: it prints the `claude plugin install` commands instead. Consequences: `enabledPlugins` resolves at startup and does not hot-reload, so an installer that "enabled" a plugin mid-session would be lying; the user runs the printed commands and restarts, which is the only sequence that is actually true.
- **ADR-0003** — Context: cleanup operations need to remove files. Decision: every removal is a move into `.cleanup-trash/<ts>/` with 7-day retention and a documented `restoreBatch` rollback, never `rm`. Consequences: `/claude-cleanup` and the planned gsd-core detector share one mechanism; deletion becomes reviewable; the trash needs its own retention sweep, which `purgeRetention()` provides.

Cross-reference `RISK-ULTRAPOWERS-001` from ADR-0001 — it exists, so the cross-reference linter will pass, and the reference is the point of having stable IDs.

- [ ] **Step 3: Write the glossary**

Create the resolved `GLOSSARY.md`. Terms in alphabetical order, definition only — no implementation, no decisions:

```markdown
# Glossary

## bundle
Everything this repository installs into `~/.claude` as one unit. Contrast `payload`, which is
the source tree the bundle is built from.

## curated
A file a human owns and no tool may rewrite. Marked `CURATED:NOEDIT`, enforced by a hook rather
than by convention.

## delta
A numbered patch in the ultrapowers fork, applied to the renamed upstream tree in filename
order. Each one records a single decision that upstream did not make.

## graft
Behaviour taken from another project's skill and carried into ours as a delta, with attribution.

## manifest
The record of what the last install wrote. It is what makes an install reversible: a file the
bundle never installed never becomes a candidate for removal.

## optional group
A set of bundle components a profile may include or omit as a unit.

## payload
The source tree under `payload/` from which the bundle is assembled. Contrast `bundle`.

## profile
A named subset of the bundle: `full`, `base` or `lite`. Replaced the earlier two-variant
allowlist model.

## tier
A model capability level used when choosing which model runs a role.

## variant
The pre-profile name for the same idea. Retained only where old code and old documents use it;
new text says `profile`.
```

- [ ] **Step 4: Verify everything lints**

```bash
node payload/bin/adr.mjs lint && echo "adrs clean"
node payload/bin/glossary.mjs lint && echo "glossary clean"
node payload/bin/risks.mjs lint && echo "register clean"
```

Expected: all three clean. `adr lint` failing on a dangling `RISK-ULTRAPOWERS-001` means the register moved before the ADR was written — check `resolveRecordPaths` is finding the same base for both.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: three retrospective ADRs and the glossary"
```

---

### Task 9: Register the hook and deploy

**Files:**
- Modify: `settings.partial.json`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: the hook active after the next session start.

- [ ] **Step 1: Register the hook**

In `settings.partial.json`, append to the `PreToolUse` array:

```json
{
  "matcher": "Bash",
  "hooks": [{ "type": "command", "command": "node", "args": ["<HOME>/.claude/hooks/decision-records-nudge.mjs"] }]
}
```

- [ ] **Step 2: Deploy and verify the cross-directory imports resolve**

```bash
node setup.mjs
node ~/.claude/bin/risks.mjs lint --root "$PWD" && echo "risks ok"
node ~/.claude/bin/adr.mjs lint --root "$PWD" && echo "adr ok"
node ~/.claude/bin/glossary.mjs lint --root "$PWD" && echo "glossary ok"
echo '{"tool_input":{"command":"git status"},"cwd":"'"$PWD"'"}' | node ~/.claude/hooks/decision-records-nudge.mjs; echo "hook exit=$?"
```

Expected: three `ok` lines and `hook exit=0`. A `Cannot find module '../bin/lib/records-paths.mjs'` from the hook means the deploy did not carry `bin/lib/` — check `variants.json` before assuming the relative path is wrong.

- [ ] **Step 3: Confirm the tests do not ship**

Run: `ls ~/.claude/bin/lib/*.test.mjs 2>/dev/null || echo "tests correctly excluded"`
Expected: `tests correctly excluded` — `alwaysExclude` carries `**.test.mjs`.

- [ ] **Step 4: Run the full suite**

Run: `node --test payload/ *.test.mjs`
Expected: every test passing, including the five new files.

- [ ] **Step 5: Commit**

```bash
git add settings.partial.json
git commit -m "chore: register the decision-records nudge"
```

The hook is not active until the next session start — `settings.json` is read at startup and does not hot-reload. Say so when reporting this task complete; claiming an active hook mid-session is the specific false claim this repository's own rules call out.

---

## Self-Review

**Spec coverage.** `risks lint` / `normalize` / `add` with the stated failure modes (Tasks 2–4); the four-value status vocabulary and the nuance migration (Task 3); closed entries retained and moved to the bottom, IDs never reused (Tasks 2–3); `adr new` / `lint` in the shape `gsd-doc-classifier` recognises, cross-references both directions (Task 5); `glossary lint` / `suggest` that proposes nothing (Task 6); the non-blocking `PreToolUse` hook, silent in a repository without these files (Task 7); retrospective ADRs 1–3 (Task 8); `payload/bin/` placement with `*.test.mjs` beside each module (throughout).

**Deviation from the spec, recorded.** The spec places these files at the repository root and `docs/adr/`, chosen because `docs/adr/` is the discovery path of `/gsd-ingest-docs`. The 2026-07-28 ruling moved them inside `.ultrapowers/`, so that benefit is gone and no bridge replaces it. `resolveRecordPaths` still falls back to the root, so a repository without the tree behaves exactly as the spec described.

**Also deviating:** the spec says twelve Status spellings; the register actually has twenty-two. The mapping table in this plan covers all twenty-two, and `migrateStatus`'s final branch turns anything unrecognised into `Active` with the whole string preserved as nuance — so an unmapped spelling degrades to "kept, needs a look", never to silent loss.

**Deliberately not covered.** Migrating `.planning/codebase/RISK_REGISTER.md` or changing `add-risk.mjs`; enforcing any of this in CI; splitting closed risks into a separate file (deferred until roughly twenty accumulate — there are six).

**Type consistency.** `lintRegister`, `lintAdr` and `lintGlossary` each return an array of objects with a `problem` string; the hook prints all three the same way. `resolveRecordPaths` returns absolute paths everywhere, and every caller relativises for display rather than for logic.

**One thing a reviewer should push on.** `normalizeRegister` demotes 44 headings from `##` to `###`, which breaks every anchor link pointing at a risk from another document. The regenerated table of contents fixes links *within* the register; links from `docs/` are not swept. Either add a sweep to Task 4 or accept the breakage knowingly — but it should not be discovered later.
