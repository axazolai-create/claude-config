# Versioning and Changelog as a Standing Practice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive the bump level from Conventional Commits instead of asking a human to type it, move the version once per drain by the accumulated maximum, run on any project with a `package.json`, and never apply a major automatically.

**Architecture:** `classify-bump.mjs` gains a real classifier — commit subject and body in, level out, with major reported as a *proposal* carrying its reason. The post-commit hook records that level beside the hash it already queues, so the drain resolves the maximum without re-reading git. The React/Next gate moves off versioning and onto rendering only: a backend gets versions and contributes entries, it simply has no changelog UI of its own. `SKILL.md` carries everything that is judgement.

**Tech Stack:** Node 20+ ESM, `node --test`, no dependencies.

## Global Constraints

- **Major is never automatic.** The tool may propose one — on an explicit breaking marker, or on a branch carrying many `feat:` commits — and must then stop and wait. Without approval it falls back to minor and says so. This departs from strict SemVer deliberately: an unwanted major is a promise to consumers, expensive and effectively irreversible once published, while waiting costs one question.
- **patch and minor apply unattended.** That is the whole point of deriving them.
- **The version moves once per drain**, taking the maximum accumulated level. A queue holding one `feat` and six `fix` yields a single minor, not seven bumps.
- **Existing projects must not have versions moved retroactively on first contact.** Dropping the React/Next gate means the skill now runs where it never ran before; a first drain in such a repository classifies only commits queued *after* the trigger was installed.
- **Backward compatibility of the queue file is required.** Queue lines are hashes today. A line without a level must still drain — by classifying that commit at drain time — because a queue written before this change will exist on every machine that already has the trigger installed.
- **`classifyBump(oldV, newV)` keeps its current behaviour and its Russian return values** (`релиз` / `патч`). It decides the *commit message prefix*, not the bump, and the post-commit hook's `case` statement matches on those exact strings. Renaming it breaks the trigger silently.
- **Depends on plan #3** for the nudge hook that surfaces `lint` output. Tasks 1–5 stand alone; Task 6 does not.
- Terse-code mode: no comments except a genuine non-obvious *why*.

## Measured starting state

- `classify-bump.mjs` (27 lines) does not classify a change. It compares two already-written versions and returns `релиз` or `патч` for the commit prefix. minor and major appear only if a human typed them.
- `queue.mjs` (64 lines) stores bare hashes at `.claude/changelog-queue`, one per line, with a 15-minute lock at `.claude/changelog.lock`.
- `install-trigger.mjs` writes a `post-commit` hook that appends `git rev-parse HEAD` to that queue, skipping commits whose subject already starts `релиз:` or `патч:`.
- `detect-project.mjs` reports `isReactOrNext` and exits 1 when there is no `package.json`. It is a reporter; the gate itself lives in `SKILL.md`.
- `write-changelog.mjs` refuses an empty `entries[]`, so it cannot currently bump a version without also writing changelog text.
- `SKILL.md` (390 lines) contains the monorepo mode whose opening paragraph promises cross-part fan-out and whose §M3 states there is none.

## Bump levels

| Commit | Level |
|---|---|
| `feat:` | minor |
| `fix:`, `perf:`, `refactor:`, `build:` | patch |
| `docs:`, `chore:`, `test:`, `style:`, `ci:` | no bump |
| `feat!:`, any type with `!`, or `BREAKING CHANGE:` in the body | **proposes major, never applies it** |
| anything with no recognised type | no bump, **and reported by `lint`** |

The last row is the one that quietly loses work: Conventional Commits are a convention, not a constraint, so an unrecognised subject contributes nothing and would vanish without a trace. `lint` exists to surface exactly those.

## File Structure

| File | Responsibility |
|---|---|
| `…/scripts/classify-bump.mjs` | the real classifier, plus the untouched `classifyBump` |
| `…/scripts/classify-bump.test.mjs` | new |
| `…/scripts/queue.mjs` | level-bearing queue lines, and `drain` |
| `…/scripts/queue.test.mjs` | new |
| `…/scripts/install-trigger.mjs` | post-commit records the level beside the hash |
| `…/scripts/write-changelog.mjs` | `--version-only`, for a part with no changelog |
| `…/scripts/lint-versions.mjs` | new — reports drift and unclassifiable commits |
| `…/SKILL.md` | scope, monorepo placement, cross-part relevance, the judgement column |

All paths are relative to `payload/skills/update-changelog/`.

---

### Task 1: The real classifier

**Files:**
- Modify: `payload/skills/update-changelog/scripts/classify-bump.mjs`
- Create: `payload/skills/update-changelog/scripts/classify-bump.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `levelForCommit({ subject, body })` → `{ level: "none"|"patch"|"minor", major: boolean, reason: string|null, unrecognised: boolean }`. `major` never raises `level` above `minor`.
  - `accumulate(results)` → `{ level, proposals: Array<{ reason }>, unrecognised: number }`.
  - `classifyBump(oldV, newV)` — unchanged, still returning `релиз` / `патч`.

- [ ] **Step 1: Write the failing tests**

Create `payload/skills/update-changelog/scripts/classify-bump.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBump, levelForCommit, accumulate } from "./classify-bump.mjs";

const only = (subject, body = "") => levelForCommit({ subject, body });

test("feat is minor, fix family is patch, chore family is none", () => {
  assert.equal(only("feat: add a thing").level, "minor");
  assert.equal(only("feat(scope): add a thing").level, "minor");
  for (const t of ["fix", "perf", "refactor", "build"]) assert.equal(only(`${t}: x`).level, "patch", t);
  for (const t of ["docs", "chore", "test", "style", "ci"]) assert.equal(only(`${t}: x`).level, "none", t);
});

test("a breaking marker proposes a major and applies minor", () => {
  const bang = only("feat!: drop the old API");
  assert.equal(bang.major, true);
  assert.equal(bang.level, "minor");
  assert.match(bang.reason, /!/);

  const footer = only("fix: tighten validation", "body text\n\nBREAKING CHANGE: rejects empty ids");
  assert.equal(footer.major, true);
  assert.equal(footer.level, "minor");
  assert.match(footer.reason, /BREAKING CHANGE/);
});

test("an unrecognised subject contributes nothing and is flagged", () => {
  const r = only("updated some stuff");
  assert.equal(r.level, "none");
  assert.equal(r.unrecognised, true);
});

test("accumulate takes the maximum, not the sum", () => {
  const results = [only("feat: a"), only("fix: b"), only("fix: c"), only("chore: d")];
  const acc = accumulate(results);
  assert.equal(acc.level, "minor");
  assert.equal(acc.proposals.length, 0);
  assert.equal(acc.unrecognised, 0);
});

test("accumulate carries every major proposal and counts unrecognised commits", () => {
  const acc = accumulate([only("feat!: a"), only("nonsense"), only("fix: b")]);
  assert.equal(acc.level, "minor");
  assert.equal(acc.proposals.length, 1);
  assert.equal(acc.unrecognised, 1);
});

test("an empty queue accumulates to no bump", () => {
  assert.equal(accumulate([]).level, "none");
});

test("classifyBump still decides the commit prefix, unchanged", () => {
  assert.equal(classifyBump("1.2.3", "1.3.0"), "релиз");
  assert.equal(classifyBump("1.2.3", "1.2.4"), "патч");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/skills/update-changelog/scripts/classify-bump.test.mjs`
Expected: FAIL — `levelForCommit is not a function`. The last test passes already; that is the point of it.

- [ ] **Step 3: Add the classifier**

Insert into `payload/skills/update-changelog/scripts/classify-bump.mjs`, above the entry-point block and leaving `classifyBump` untouched:

```js
const ORDER = { none: 0, patch: 1, minor: 2 };
const PATCH = new Set(['fix', 'perf', 'refactor', 'build']);
const NONE = new Set(['docs', 'chore', 'test', 'style', 'ci']);
const SUBJECT = /^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/;

export function levelForCommit({ subject, body }) {
  const m = SUBJECT.exec(String(subject ?? '').trim());
  if (!m) return { level: 'none', major: false, reason: null, unrecognised: true };
  const [, type, , bang] = m;
  const breakingFooter = /^BREAKING CHANGE:\s*(.+)$/m.exec(String(body ?? ''));
  const level = type === 'feat' ? 'minor' : PATCH.has(type) ? 'patch' : NONE.has(type) ? 'none' : 'none';
  const unrecognised = type !== 'feat' && !PATCH.has(type) && !NONE.has(type);
  if (bang || breakingFooter) {
    const reason = bang ? `"${subject}" carries a ! breaking marker` : `BREAKING CHANGE: ${breakingFooter[1]}`;
    // minor, not major: a major is a promise to consumers, and an unwanted one is effectively
    // irreversible once published. The proposal waits for a human.
    return { level: 'minor', major: true, reason, unrecognised: false };
  }
  return { level, major: false, reason: null, unrecognised };
}

export function accumulate(results) {
  let level = 'none';
  const proposals = [];
  let unrecognised = 0;
  for (const r of results) {
    if (ORDER[r.level] > ORDER[level]) level = r.level;
    if (r.major) proposals.push({ reason: r.reason });
    if (r.unrecognised) unrecognised += 1;
  }
  return { level, proposals, unrecognised };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/skills/update-changelog/scripts/classify-bump.test.mjs`
Expected: 7/7 PASS.

- [ ] **Step 5: Verify the CLI still answers the trigger's question**

```bash
node payload/skills/update-changelog/scripts/classify-bump.mjs --old 1.2.3 --new 1.3.0
node payload/skills/update-changelog/scripts/classify-bump.mjs --old 1.2.3 --new 1.2.4
```

Expected: `релиз`, then `патч`. The post-commit hook's `case "$msg" in релиз:*|патч:*)` matches these exact strings — a change here silently stops the trigger from skipping its own commits, and the queue starts eating them.

- [ ] **Step 6: Commit**

```bash
git add payload/skills/update-changelog/scripts/classify-bump.mjs payload/skills/update-changelog/scripts/classify-bump.test.mjs
git commit -m "feat(changelog): derive the bump level from Conventional Commits"
```

---

### Task 2: The queue carries the level

**Files:**
- Modify: `payload/skills/update-changelog/scripts/queue.mjs`
- Create: `payload/skills/update-changelog/scripts/queue.test.mjs`

**Interfaces:**
- Consumes: `levelForCommit`, `accumulate` from Task 1.
- Produces:
  - Queue line format `<hash> <level>`; a bare `<hash>` line remains valid and means "not yet classified".
  - `readQueue(root)` → `string[]` of hashes — **unchanged**, because `clearHashes` and the `read` subcommand both depend on it.
  - `readEntries(root)` → `Array<{ hash, level: string|null }>`.
  - `appendHash(root, hash, level)` — `level` optional.
  - `resolveDrain(entries, lookup)` → `{ level, proposals, unrecognised, hashes }`, where `lookup(hash)` returns `{ subject, body }` for entries with no recorded level.

- [ ] **Step 1: Write the failing tests**

Create `payload/skills/update-changelog/scripts/queue.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readQueue, readEntries, appendHash, resolveDrain } from "./queue.mjs";

function repo(queueText) {
  const root = mkdtempSync(join(tmpdir(), "queue-"));
  if (queueText !== undefined) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "changelog-queue"), queueText);
  }
  return root;
}

test("readQueue still returns bare hashes, whatever the line carries", () => {
  const root = repo("aaa1111 minor\nbbb2222\n");
  assert.deepEqual(readQueue(root), ["aaa1111", "bbb2222"]);
});

test("readEntries splits the level out, null when absent", () => {
  const root = repo("aaa1111 minor\nbbb2222\n");
  assert.deepEqual(readEntries(root), [
    { hash: "aaa1111", level: "minor" },
    { hash: "bbb2222", level: null },
  ]);
});

test("appendHash writes the level and never duplicates a hash", () => {
  const root = repo("");
  appendHash(root, "aaa1111", "patch");
  appendHash(root, "aaa1111", "minor");
  assert.equal(readFileSync(join(root, ".claude", "changelog-queue"), "utf8"), "aaa1111 patch\n");
});

test("appendHash without a level writes a bare hash", () => {
  const root = repo("");
  appendHash(root, "aaa1111");
  assert.equal(readFileSync(join(root, ".claude", "changelog-queue"), "utf8"), "aaa1111\n");
});

test("drain takes the maximum level across recorded and looked-up entries", () => {
  const entries = [
    { hash: "a", level: "patch" },
    { hash: "b", level: null },
    { hash: "c", level: "none" },
  ];
  const lookup = (h) => (h === "b" ? { subject: "feat: new thing", body: "" } : { subject: "", body: "" });
  const d = resolveDrain(entries, lookup);
  assert.equal(d.level, "minor");
  assert.deepEqual(d.hashes, ["a", "b", "c"]);
});

test("drain surfaces a major proposal instead of applying it", () => {
  const entries = [{ hash: "a", level: null }];
  const d = resolveDrain(entries, () => ({ subject: "feat!: drop the old API", body: "" }));
  assert.equal(d.level, "minor");
  assert.equal(d.proposals.length, 1);
});

test("drain counts commits it could not classify", () => {
  const d = resolveDrain([{ hash: "a", level: null }], () => ({ subject: "wip", body: "" }));
  assert.equal(d.unrecognised, 1);
  assert.equal(d.level, "none");
});

test("a lookup that throws does not lose the rest of the queue", () => {
  const entries = [{ hash: "a", level: null }, { hash: "b", level: "patch" }];
  const d = resolveDrain(entries, (h) => { if (h === "a") throw new Error("gone"); return { subject: "", body: "" }; });
  assert.equal(d.level, "patch");
  assert.equal(d.unrecognised, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/skills/update-changelog/scripts/queue.test.mjs`
Expected: FAIL — `readEntries is not a function`.

- [ ] **Step 3: Make the queue level-aware**

In `payload/skills/update-changelog/scripts/queue.mjs`, add the import and replace `readQueue` / `appendHash`, then add `readEntries` and `resolveDrain`:

```js
import { levelForCommit, accumulate } from './classify-bump.mjs';

export function readEntries(root) {
  const f = QUEUE(root);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map(line => {
    const [hash, level] = line.trim().split(/\s+/);
    return { hash, level: level ?? null };
  });
}

export function readQueue(root) {
  return readEntries(root).map(e => e.hash);
}

export function appendHash(root, hash, level) {
  const f = QUEUE(root); ensureDir(f);
  const cur = readEntries(root);
  if (!cur.some(e => e.hash === hash)) cur.push({ hash, level: level ?? null });
  writeFileSync(f, cur.map(e => (e.level ? `${e.hash} ${e.level}` : e.hash)).join('\n') + '\n');
  return cur.map(e => e.hash);
}

// A queue written before levels existed holds bare hashes, and that queue exists on every
// machine with the trigger already installed. Those entries are classified here instead.
export function resolveDrain(entries, lookup) {
  const results = entries.map(e => {
    if (e.level) return { level: e.level, major: false, reason: null, unrecognised: false };
    try { return levelForCommit(lookup(e.hash)); }
    catch { return { level: 'none', major: false, reason: null, unrecognised: true }; }
  });
  return { ...accumulate(results), hashes: entries.map(e => e.hash) };
}
```

`clearHashes` keeps working unchanged: it filters `readQueue(root)` by hash and rewrites — but it must now rewrite in the new format. Change its final line to reuse the same serialiser:

```js
export function clearHashes(root, hashes) {
  const f = QUEUE(root); ensureDir(f);
  const cur = readEntries(root).filter(e => !hashes.includes(e.hash));
  writeFileSync(f, cur.length ? cur.map(e => (e.level ? `${e.hash} ${e.level}` : e.hash)).join('\n') + '\n' : '');
  return cur.map(e => e.hash);
}
```

- [ ] **Step 4: Extend the CLI**

In the entry-point block, replace the `append` line and add `drain`:

```js
  if (cmd === 'append') {
    const hash = positionals[0];
    let level = flags.level ?? null;
    if (!level && 'classify' in flags) {
      const subject = execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%s', hash], { encoding: 'utf8' }).trim();
      const body = execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%b', hash], { encoding: 'utf8' });
      level = levelForCommit({ subject, body }).level;
    }
    appendHash(root, hash, level);
  }
  else if (cmd === 'drain') {
    const lookup = (h) => ({
      subject: execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%s', h], { encoding: 'utf8' }).trim(),
      body: execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%b', h], { encoding: 'utf8' }),
    });
    process.stdout.write(JSON.stringify(resolveDrain(readEntries(root), lookup), null, 2) + '\n');
  }
```

Add `import { execFileSync } from 'node:child_process';` at the top. Note that `flags` is built by the existing loop, so `--classify` with no value sets `flags.classify` to the next token or `undefined` — hence the `'classify' in flags` test rather than a truthiness check.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test payload/skills/update-changelog/scripts/queue.test.mjs`
Expected: 8/8 PASS.

- [ ] **Step 6: Verify against a real repository**

```bash
node payload/skills/update-changelog/scripts/queue.mjs drain --root .
```

Expected: JSON with `"level": "none"` and empty `hashes` — this repository has no queue file. A crash instead of empty output means `readEntries` is not handling a missing file.

- [ ] **Step 7: Commit**

```bash
git add payload/skills/update-changelog/scripts/queue.mjs payload/skills/update-changelog/scripts/queue.test.mjs
git commit -m "feat(changelog): the queue carries a level, and drains by the maximum"
```

---

### Task 3: The post-commit trigger records the level

**Files:**
- Modify: `payload/skills/update-changelog/scripts/install-trigger.mjs`
- Modify: `payload/skills/update-changelog/scripts/install-trigger.test.mjs`

**Interfaces:**
- Consumes: `queue.mjs append --classify` from Task 2.
- Produces: a `post-commit` block that classifies each commit as it lands.

- [ ] **Step 1: Write the failing test**

Append to `payload/skills/update-changelog/scripts/install-trigger.test.mjs`:

```js
test("the installed post-commit hook classifies the commit it queues", () => {
  const root = mkdtempSync(join(tmpdir(), "trigger-"));
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });
  ensurePostCommitHook(root);
  const body = readFileSync(join(root, ".git", "hooks", "post-commit"), "utf8");
  assert.match(body, /queue\.mjs/);
  assert.match(body, /--classify/);
});
```

Reuse whatever imports the existing test file already has; add `mkdtempSync`, `mkdirSync`, `readFileSync`, `tmpdir`, `join` if they are not there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/skills/update-changelog/scripts/install-trigger.test.mjs`
Expected: the new case FAILS — the block has no `--classify`.

- [ ] **Step 3: Add the flag**

In `ensurePostCommitHook`, change the append line inside the block from:

```js
    '        node "$q" append "$(git rev-parse HEAD)" --root "$root"',
```

to:

```js
    '        node "$q" append "$(git rev-parse HEAD)" --root "$root" --classify',
```

Nothing else in the shell block changes. Classification runs in Node, where the rules already live and are tested; putting it in the shell would be a second implementation in the language least able to express it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/skills/update-changelog/scripts/install-trigger.test.mjs`
Expected: every case passing.

- [ ] **Step 5: End-to-end check in a scratch repository**

```bash
D=$(mktemp -d) && cd "$D" && git init -q && npm init -y >/dev/null
node ~/.claude/skills/update-changelog/scripts/install-trigger.mjs --root "$D" 2>/dev/null \
  || node "$OLDPWD/payload/skills/update-changelog/scripts/install-trigger.mjs" --root "$D"
git add -A && git commit -qm "feat: first real feature"
cat .claude/changelog-queue
cd "$OLDPWD"
```

Expected: one line ending ` minor`. If the level is missing, the installed hook is the old one — `ensurePostCommitHook` returns early when the marker is already present, so an existing hook is never rewritten. Say so when reporting: repositories with the trigger already installed keep queueing bare hashes until the block is removed and reinstalled, and Task 2's fallback classification is what makes that harmless.

- [ ] **Step 6: Commit**

```bash
git add payload/skills/update-changelog/scripts/install-trigger.mjs payload/skills/update-changelog/scripts/install-trigger.test.mjs
git commit -m "feat(changelog): classify each commit as the trigger queues it"
```

---

### Task 4: Bump a version without a changelog

A backend has no changelog UI of its own, and today `write-changelog.mjs` refuses an empty `entries[]` — so it cannot bump such a part at all. That refusal is what excludes every non-React project from having a derived version.

**Files:**
- Modify: `payload/skills/update-changelog/scripts/write-changelog.mjs`
- Create: `payload/skills/update-changelog/scripts/write-changelog.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `--version-only` — writes `package.json` and, when it exists, `version.json`, and touches no changelog. `--entries-file` becomes optional under that flag.

- [ ] **Step 1: Write the failing tests**

Create `payload/skills/update-changelog/scripts/write-changelog.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "write-changelog.mjs");
const run = (args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

function project(version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "write-changelog-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version }, null, 2));
  return root;
}

test("--version-only bumps package.json and writes no changelog", () => {
  const root = project();
  run(["--version-only", "--final-version", "1.3.0", "--root", root]);
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "1.3.0");
  assert.equal(existsSync(join(root, "changelog.json")), false);
});

test("--version-only updates version.json when it already exists", () => {
  const root = project();
  writeFileSync(join(root, "version.json"), '{\n  "version": "1.2.3"\n}\n');
  run(["--version-only", "--final-version", "1.3.0", "--root", root]);
  assert.match(readFileSync(join(root, "version.json"), "utf8"), /1\.3\.0/);
});

test("--version-only rejects a malformed version", () => {
  const root = project();
  assert.throws(() => run(["--version-only", "--final-version", "v1.3", "--root", root]));
});

test("without --version-only an empty entries file is still refused", () => {
  const root = project();
  const f = join(root, "entries.json");
  writeFileSync(f, JSON.stringify({ entries: [], finalVersion: "1.3.0" }));
  assert.throws(() => run(["--entries-file", f, "--root", root]));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/skills/update-changelog/scripts/write-changelog.test.mjs`
Expected: the first three FAIL — the script exits 1 on a missing `--entries-file`.

- [ ] **Step 3: Add the flag**

In `write-changelog.mjs`, replace the argument guard at the top:

```js
const versionOnly = args.includes('--version-only')
const entriesFileArg = args.indexOf('--entries-file')
if (!versionOnly && (entriesFileArg === -1 || !args[entriesFileArg + 1])) {
   console.error('Usage: write-changelog.mjs --entries-file <path> [--root <path>]')
   console.error('   or: write-changelog.mjs --version-only --final-version X.Y.Z [--root <path>]')
   process.exit(1)
}
```

Then build `input` from either source, and skip the changelog block entirely under the flag:

```js
const finalVersionArg = args.indexOf('--final-version')
const input = versionOnly
   ? { entries: [], finalVersion: finalVersionArg !== -1 ? args[finalVersionArg + 1] : undefined }
   : JSON.parse(readFileSync(args[entriesFileArg + 1], 'utf8'))

if (!versionOnly && (!Array.isArray(input.entries) || input.entries.length === 0)) { /* unchanged */ }
```

The `finalVersion` format check and everything from `// --- package.json ---` onwards stay exactly as they are; wrap only the changelog read/merge/write in `if (!versionOnly) { … }`, and report `changelogPath: null, entriesAdded: 0` in that case.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/skills/update-changelog/scripts/write-changelog.test.mjs`
Expected: 4/4 PASS. The fourth is the regression guard: `--version-only` must not become a way to smuggle an empty changelog write past the existing check.

- [ ] **Step 5: Commit**

```bash
git add payload/skills/update-changelog/scripts/write-changelog.mjs payload/skills/update-changelog/scripts/write-changelog.test.mjs
git commit -m "feat(changelog): --version-only, so a part without a UI still gets versions"
```

---

### Task 5: `SKILL.md` — scope, bump policy, and the monorepo contradiction

Three changes, each removing something the current text gets wrong.

**Files:**
- Modify: `payload/skills/update-changelog/SKILL.md`

**Interfaces:**
- Consumes: `levelForCommit`, `accumulate` (Task 1), `queue.mjs drain` (Task 2), `--version-only` (Task 4).
- Produces: the instruction half — everything in the judgement column below.

- [ ] **Step 1: Replace the React/Next stop in § 0**

Currently § 0 reads: *"If `isReactOrNext` is `false`, stop and tell the user this skill only applies to React/Next projects — do not proceed."* Replace that paragraph with:

```markdown
`isReactOrNext` no longer decides whether to run. It decides only whether a **rendered
changelog** belongs here:

- `isReactOrNext: true` — this part has a changelog UI. Write `changelog.json` and bump.
- `isReactOrNext: false` — this part has no UI of its own. Bump the version with
  `write-changelog.mjs --version-only`, and let its entries appear in the frontend parts'
  changelogs (Monorepo mode, § M7a). A backend still gets versions and still contributes
  entries; it simply has nowhere of its own to show them.

Any project with a `package.json` is in scope. The old gate is what excluded this repository,
the ultrapowers fork, and every backend from having a derived version at all.
```

- [ ] **Step 2: Replace § 4 wholesale**

§ 4 currently increments the patch component once per surviving entry. Replace the whole section with:

```markdown
## 4. Version bumping

The level is **derived from the commits**, and the version moves **once**, by the maximum
level accumulated across the whole range or drain — not once per entry.

| Commit | Level |
|---|---|
| `feat:` | minor |
| `fix:`, `perf:`, `refactor:`, `build:` | patch |
| `docs:`, `chore:`, `test:`, `style:`, `ci:` | no bump |
| `feat!:`, any type with `!`, `BREAKING CHANGE:` in the body | proposes major — never applies it |

A range holding one `feat` and six `fix` yields a single minor. A range holding only `docs`
and `chore` yields **no bump at all**: the version is not a commit counter.

**Major is never automatic.** When the classifier reports a proposal, stop and ask, quoting
the reason it gives. Without approval, fall back to minor and say that you did. This departs
from strict SemVer deliberately — a major is a promise to consumers, an unwanted one is
effectively irreversible once published, and the cost of waiting is one question.

`node ~/.claude/skills/update-changelog/scripts/queue.mjs drain --root <root>` returns
`{ level, proposals, unrecognised, hashes }`. In manual mode, classify the range's commits the
same way rather than inventing a different rule.

`unrecognised` is not noise. A commit with no Conventional-Commits type contributes nothing
and would otherwise vanish silently; report the count and offer to look at those commits.
```

Every downstream reference to "one patch per entry" must go with it — search § 3.5, § 5, § 6, § M6 and § M8 for the phrase and rewrite each to speak of the single accumulated bump.

- [ ] **Step 3: Fix the monorepo contradiction**

The opening of **Monorepo mode** promises that a part with no changelog UI still appears, abstracted, in the other parts' logs. § M3 then states there is no cross-part fan-out and a commit belonging to no part is dropped everywhere. The design that was written is not the design that was implemented. Replace § M3's closing rule with:

```markdown
Every frontend part's changelog carries, besides its own detailed entries, entries originating
in **other** parts — including other frontend parts — in reduced form.

Reduction is about **density, not wording**. The filter is relevance to *this* part's users:

- a backend's character-encoding change: omitted — invisible from this frontend;
- a new endpoint for external integrations: included — it changes what this frontend can offer.

The entry is written in the same voice as any other. It is chosen, not softened.

A commit that belongs to no workspace is **not** dropped. It belongs to the repository root,
which carries its own version (§ M6).
```

And § M6 gains:

```markdown
The repository root carries a version too: the maximum of the parts' bumps in this drain,
combined with its own root-level commits. This closes the hole where a root-level commit
belonged to no workspace and was therefore dropped entirely.
```

- [ ] **Step 4: Add the placement rule**

In § M7, before the existing write instructions:

```markdown
**Where the changelog file goes:**

- no frontend part (`detect-project.mjs` reports `isReactOrNext: false` everywhere) → a single
  changelog at the repository root;
- one or more frontend parts → one changelog **inside each frontend part**, at that part's own
  `changelogPath`.

Parts stay independently versioned. There is no lockstep across the monorepo, by design.
```

- [ ] **Step 5: Record what stays judgement**

At the end of § 4, add:

```markdown
**What is decided by code, and what is not.** Code decides: the level from the commit type,
which workspaces a commit touched, the root version from parts plus root commits, whether a
frontend part exists, where the changelog file belongs. A human or the model decides: whether
a major is warranted, whether another part's change is relevant here, the Russian wording of
an entry, and whether a change is meaningful at all (§ 3.1). Automating the second column
produces confident nonsense.
```

- [ ] **Step 6: Verify no contradiction survives**

```bash
grep -n "only applies to React/Next\|increment the \*\*patch\*\*\|per surviving entry" payload/skills/update-changelog/SKILL.md || echo "old rules removed"
grep -c "no cross-part\|dropped everywhere" payload/skills/update-changelog/SKILL.md || echo "contradiction removed"
```

Expected: `old rules removed` and `contradiction removed`.

- [ ] **Step 7: Commit**

```bash
git add payload/skills/update-changelog/SKILL.md
git commit -m "docs(changelog): derive the level, bump once, and make monorepo fan-out real"
```

---

### Task 6: `lint` — surface what would otherwise vanish

**Files:**
- Create: `payload/skills/update-changelog/scripts/lint-versions.mjs`
- Create: `payload/skills/update-changelog/scripts/lint-versions.test.mjs`
- Modify: `payload/hooks/decision-records-nudge.mjs` (from plan #3)

**Interfaces:**
- Consumes: `readEntries`, `resolveDrain` (Task 2).
- Produces: `lintVersions({ entries, lookup, pendingSince })` → `Array<{ problem }>`; a CLI printing them; and a fourth note in the shared nudge.

- [ ] **Step 1: Write the failing tests**

Create `payload/skills/update-changelog/scripts/lint-versions.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintVersions } from "./lint-versions.mjs";

const feat = { subject: "feat: a", body: "" };
const junk = { subject: "wip", body: "" };

test("a clean queue lints clean", () => {
  assert.deepEqual(lintVersions({ entries: [{ hash: "a", level: "patch" }], lookup: () => feat }), []);
});

test("commits with no recognised type are reported with their hashes", () => {
  const found = lintVersions({ entries: [{ hash: "abc1234", level: null }], lookup: () => junk });
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /abc1234/);
  assert.match(found[0].problem, /no recognised/i);
});

test("a pending major proposal is reported", () => {
  const found = lintVersions({ entries: [{ hash: "a", level: null }], lookup: () => ({ subject: "feat!: x", body: "" }) });
  assert.ok(found.some((f) => /major/i.test(f.problem)));
});

test("an empty queue reports nothing", () => {
  assert.deepEqual(lintVersions({ entries: [], lookup: () => feat }), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/skills/update-changelog/scripts/lint-versions.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the linter**

Create `payload/skills/update-changelog/scripts/lint-versions.mjs`:

```js
#!/usr/bin/env node
import { resolve, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readEntries, resolveDrain } from './queue.mjs';
import { levelForCommit } from './classify-bump.mjs';

// Conventional Commits are a convention, not a constraint. A commit with no recognised type
// contributes no bump and would otherwise vanish without a trace - this is the only thing that
// says so out loud.
export function lintVersions({ entries, lookup }) {
  if (!entries.length) return [];
  const problems = [];
  const unrecognised = entries.filter(e => !e.level && levelForCommit(lookup(e.hash)).unrecognised);
  if (unrecognised.length)
    problems.push({ problem: `${unrecognised.length} queued commit(s) with no recognised Conventional Commits type, so they bump nothing: ${unrecognised.map(e => e.hash.slice(0, 7)).join(', ')}` });
  const drain = resolveDrain(entries, lookup);
  for (const p of drain.proposals)
    problems.push({ problem: `major proposed and awaiting approval — ${p.reason}` });
  return problems;
}

function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMainModule()) {
  const i = process.argv.indexOf('--root');
  const root = resolve(i !== -1 ? process.argv[i + 1] : process.cwd());
  const lookup = (h) => ({
    subject: execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%s', h], { encoding: 'utf8' }).trim(),
    body: execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%b', h], { encoding: 'utf8' }),
  });
  const problems = lintVersions({ entries: readEntries(root), lookup });
  for (const p of problems) console.error(p.problem);
  process.exit(problems.length ? 1 : 0);
}
```

- [ ] **Step 4: Add the fourth note to the shared nudge**

In `payload/hooks/decision-records-nudge.mjs`, after the glossary block and before the `if (!notes.length) return;` line:

```js
  try {
    const { readEntries } = await import("../skills/update-changelog/scripts/queue.mjs");
    const { lintVersions } = await import("../skills/update-changelog/scripts/lint-versions.mjs");
    const entries = readEntries(root);
    if (entries.length) {
      const lookup = (h) => ({
        subject: execFileSync("git", ["-C", root, "log", "-1", "--pretty=%s", h], { encoding: "utf8" }).trim(),
        body: execFileSync("git", ["-C", root, "log", "-1", "--pretty=%b", h], { encoding: "utf8" }),
      });
      const problems = lintVersions({ entries, lookup });
      if (problems.length) notes.push(`changelog queue: ${problems.map((p) => p.problem).join("; ")}`);
    }
  } catch { /* no changelog skill in this install - stay silent */ }
```

`main` becomes `async function main()`, and its call site becomes `await main()` inside the entry-point block — wrap that in `main().catch(() => {})` so the fail-open guarantee survives the change to async.

This is the only place the two plans touch the same file. If plan #3 has not landed, skip this step and say so; the CLI works without it.

- [ ] **Step 5: Run the tests and both entry points**

```bash
node --test payload/skills/update-changelog/scripts/lint-versions.test.mjs
node payload/skills/update-changelog/scripts/lint-versions.mjs --root . ; echo "exit=$?"
echo '{"tool_input":{"command":"git commit -m x"},"cwd":"'"$PWD"'"}' | node payload/hooks/decision-records-nudge.mjs; echo "hook exit=$?"
```

Expected: 4/4 PASS; `exit=0` with no output (no queue here); `hook exit=0` with no output.

- [ ] **Step 6: Commit**

```bash
git add payload/skills/update-changelog/scripts/lint-versions.mjs payload/skills/update-changelog/scripts/lint-versions.test.mjs payload/hooks/decision-records-nudge.mjs
git commit -m "feat(changelog): lint the queue, and surface it through the shared nudge"
```

---

### Task 7: Deploy and verify end to end

- [ ] **Step 1: Deploy**

Run: `node setup.mjs`

- [ ] **Step 2: Prove the whole loop in a scratch repository**

```bash
D=$(mktemp -d) && cd "$D" && git init -q && npm init -y >/dev/null
node ~/.claude/skills/update-changelog/scripts/install-trigger.mjs --root "$D"
git add -A && git commit -qm "chore: scaffold"
git commit -q --allow-empty -m "fix: tighten a check"
git commit -q --allow-empty -m "feat: add the thing"
node ~/.claude/skills/update-changelog/scripts/queue.mjs drain --root "$D"
node ~/.claude/skills/update-changelog/scripts/write-changelog.mjs --version-only --final-version 1.1.0 --root "$D"
node -e "console.log(require('$D/package.json').version)"
cd - >/dev/null
```

Expected: the drain reports `"level": "minor"` with three hashes and no proposals, and the final line prints `1.1.0`. A `"level": "patch"` means the `feat` commit was queued before the trigger was installed — check the queue file.

- [ ] **Step 3: Prove the major proposal stops**

```bash
cd "$D" && git commit -q --allow-empty -m "feat!: drop the old API"
node ~/.claude/skills/update-changelog/scripts/lint-versions.mjs --root "$D"; echo "exit=$?"
cd - >/dev/null
```

Expected: `major proposed and awaiting approval — "feat!: drop the old API" carries a ! breaking marker` and `exit=1`. A silent exit 0 means the breaking marker never reached the queue.

- [ ] **Step 4: Run the full suite**

Run: `node --test payload/ *.test.mjs`
Expected: every test passing, including the five new files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: deploy derived versioning"
```

---

## Self-Review

**Spec coverage.** Bump levels from Conventional Commits (Task 1); major proposed, never applied (Tasks 1, 6, and § 4); classification per commit, version moved once per drain by the accumulated maximum (Tasks 1–3); scope widened to any `package.json`, the React/Next gate retained for rendering only (Tasks 4–5); monorepo versions at every level including the root (Task 5 § M6); changelog placement by whether a frontend part exists (Task 5 § M7); cross-part entries in reduced form, with the density-not-wording rule and both worked examples (Task 5 § M3); the deterministic/judgement split recorded in the skill (Task 5 Step 5); `lint` for versions drifted from the queue and for unclassifiable commits (Task 6).

**Deliberately not covered.** Keep-a-Changelog `CHANGELOG.md` as a second output format; publishing and tagging policy beyond the existing `vX.Y.Z` tag; lockstep versions across a monorepo — parts stay independent by design.

**Type consistency.** `levelForCommit` returns the same four-field object everywhere, including its error path; `accumulate` and `resolveDrain` both consume exactly that shape; `resolveDrain` returns `accumulate`'s fields plus `hashes`. `readQueue` keeps returning `string[]` so `clearHashes` and the `read` subcommand are untouched — that is the single most likely place to break something invisible.

**Three things a reviewer should push on.**

1. **Existing installs keep queueing bare hashes.** `ensurePostCommitHook` returns early when its marker is present, so no repository that already has the trigger gets `--classify` until the block is removed and reinstalled. Task 2's fallback classification makes that correct but slower. If that is not good enough, the fix is a version marker in the block, and it belongs in Task 3.
2. **`--version-only` has no changelog to check it against.** A part bumped that way can drift from its own history with nothing to notice. `lint` only sees the queue.
3. **Cross-part relevance is judgement per entry.** It will be wrong in both directions sometimes, and no test can catch it. That is stated in the spec and repeated here so it is not discovered as a surprise.
