# graphify → Neo4j autosync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every commit refreshes the global graph and carries it to Neo4j, with no human typing a flag and no LLM key required.

**Architecture:** The autosync worker keeps its shape — take a lock, spawn one detached shell, exit 0 — but the shell command it builds moves into a pure function so it can be tested, and gains a push step after the extract. The push script learns to find graphify's own interpreter, restore a missing driver, and serialise itself against other repositories' pushes. The lock, currently inline in the worker, becomes a module both share.

**Tech Stack:** Node ESM, `node:test`, no dependencies. Hooks never spawn a subprocess synchronously (the suite asserts this); the worker's one `spawn` is detached and unref'd.

## Global Constraints

- Payload-only: every change lives under `payload/`, except documentation in `README.md` / `README.en.md`. `payload/` is source; `~/.claude` is what runs, and only `node setup.mjs` moves one to the other.
- Nothing may block a commit. Every new failure path is a logged skip with exit 0 — no throw, no non-zero exit out of the worker.
- Cross-platform: Windows (`cmd /c`) and POSIX (`sh -c`) branches stay equivalent in behaviour and are tested as a pair.
- The push script is **absent by default**: profile `base` excludes `bin/graphify-neo4j-*` and offers it only as `optional/neo4j`. A missing script degrades to a plain sync, never to an error.
- Toggles, both honoured: `CLAUDE_GRAPHIFY_AUTOSYNC=0` disables the whole worker (already exists), `CLAUDE_GRAPHIFY_NEO4J_PUSH=0` disables only the push (new).
- Lock TTL stays ten minutes, the value the worker uses today.
- Run the whole suite with `node --test` from the repository root. It is green at 654 tests before this plan starts.
- Commit messages follow Conventional Commits, as the rest of the tree does.

---

### Task 1: The sync command becomes a testable function

Extraction only — the command string must come out byte-identical to what the worker builds today. This is the pin half of pin-then-edit for RISK-GRAPHFRESH-001: the test written here locks current behaviour, and Task 2 changes it deliberately.

**Files:**
- Create: `payload/hooks/lib/graphify-sync-command.mjs`
- Create: `payload/hooks/lib/graphify-sync-command.test.mjs`
- Modify: `payload/hooks/lib/graphify-global-sync-run.mjs:70-80`

**Interfaces:**
- Produces: `buildSyncCommand({ root, name, lock, isWin }) -> { shell, flag, inner }` where `shell` is `"cmd"` or `"sh"`, `flag` is `"/c"` or `"-c"`, and `inner` is the single shell string passed as that flag's argument.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/graphify-sync-command.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSyncCommand } from "./graphify-sync-command.mjs";

const args = { root: "C:/repo", name: "repo", lock: "C:/state/repo.lock" };

test("the windows command extracts then deletes the lock", () => {
  const c = buildSyncCommand({ ...args, isWin: true });
  assert.equal(c.shell, "cmd");
  assert.equal(c.flag, "/c");
  assert.equal(c.inner,
    'graphify "extract" "C:/repo" "--global" "--as" "repo" & del /f /q "C:/state/repo.lock"');
});

test("the posix command extracts then removes the lock", () => {
  const c = buildSyncCommand({ ...args, isWin: false });
  assert.equal(c.shell, "sh");
  assert.equal(c.flag, "-c");
  assert.equal(c.inner,
    'graphify "extract" "C:/repo" "--global" "--as" "repo"; rm -f "C:/state/repo.lock"');
});

test("a quote inside an argument is escaped, not dropped", () => {
  const c = buildSyncCommand({ ...args, name: 'we"ird', isWin: false });
  assert.match(c.inner, /"we\\"ird"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/graphify-sync-command.test.mjs`
Expected: FAIL — `Cannot find module './graphify-sync-command.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// payload/hooks/lib/graphify-sync-command.mjs
// The one shell string the autosync worker spawns, as data rather than inline concatenation:
// the worker's own effects are untestable, this is not.
const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

export function buildSyncCommand({ root, name, lock, isWin }) {
  const steps = [`graphify ${["extract", root, "--global", "--as", name].map(quote).join(" ")}`];
  steps.push(isWin ? `del /f /q ${quote(lock)}` : `rm -f ${quote(lock)}`);
  return {
    shell: isWin ? "cmd" : "sh",
    flag: isWin ? "/c" : "-c",
    inner: steps.join(isWin ? " & " : "; "),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/graphify-sync-command.test.mjs`
Expected: PASS, 3 tests

- [ ] **Step 5: Point the worker at the function**

Replace `payload/hooks/lib/graphify-global-sync-run.mjs` lines 70–80 (from the `// Run graphify, then remove the lock` comment through the closing brace of the `else` branch) with:

```js
// Run graphify, then remove the lock, all inside one detached background process -
// the caller (Claude Code hook or git itself) is never delayed by this.
const cmd = buildSyncCommand({ root, name, lock, isWin: IS_WIN });
spawn(cmd.shell, [cmd.flag, cmd.inner],
  { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();
```

Add the import beside the existing ones at the top of the file:

```js
import { buildSyncCommand } from "./graphify-sync-command.mjs";
```

Delete the now-unused `const quoted = ...` line and the `args` const.

- [ ] **Step 6: Run the whole suite**

Run: `node --test`
Expected: PASS — 657 tests, 0 failures (654 before, 3 added).

- [ ] **Step 7: Commit**

```bash
git add payload/hooks/lib/graphify-sync-command.mjs payload/hooks/lib/graphify-sync-command.test.mjs payload/hooks/lib/graphify-global-sync-run.mjs
git commit -m "refactor(graphify-sync): build the spawned command as data

Pins the command the worker has always spawned, byte for byte, so the edits
that follow are visible in a diff of expectations rather than invisible in a
string. RISK-GRAPHFRESH-001 asks for exactly this before the file is touched."
```

---

### Task 2: Extraction stops needing an LLM key

**Files:**
- Modify: `payload/hooks/lib/graphify-sync-command.test.mjs`
- Modify: `payload/hooks/lib/graphify-sync-command.mjs`

**Interfaces:**
- Consumes: `buildSyncCommand` from Task 1.
- Produces: same signature; `inner` now carries `--code-only` between the target path and `--global`.

- [ ] **Step 1: Change the pinned expectations to the new behaviour**

In `graphify-sync-command.test.mjs`, update both command assertions and add one that names the reason:

```js
test("the windows command extracts then deletes the lock", () => {
  const c = buildSyncCommand({ ...args, isWin: true });
  assert.equal(c.inner,
    'graphify "extract" "C:/repo" "--code-only" "--global" "--as" "repo" & del /f /q "C:/state/repo.lock"');
});

test("the posix command extracts then removes the lock", () => {
  const c = buildSyncCommand({ ...args, isWin: false });
  assert.equal(c.inner,
    'graphify "extract" "C:/repo" "--code-only" "--global" "--as" "repo"; rm -f "C:/state/repo.lock"');
});

// Without it graphify demands semantic extraction for every markdown file and exits with
// "no LLM API key found", which is why the global graph stopped moving on 3 July.
test("extraction is code-only, so no API key is ever needed", () => {
  for (const isWin of [true, false]) {
    assert.match(buildSyncCommand({ ...args, isWin }).inner, /"--code-only"/);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/graphify-sync-command.test.mjs`
Expected: FAIL — 3 failures, all showing the expected string carries `"--code-only"` and the actual does not.

- [ ] **Step 3: Add the flag**

In `graphify-sync-command.mjs`, change the one array:

```js
  const steps = [`graphify ${["extract", root, "--code-only", "--global", "--as", name].map(quote).join(" ")}`];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/graphify-sync-command.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/graphify-sync-command.mjs payload/hooks/lib/graphify-sync-command.test.mjs
git commit -m "fix(graphify-sync): extract code-only, so the sync needs no API key

Every autosync run since 3 July has failed with 'no LLM API key found', because
172 markdown files ask for semantic extraction and a git hook has no key. Local
AST only: deterministic, free, and it works on a machine that has just run setup."
```

---

### Task 3: The lock becomes a module

Behaviour must not change: a fresh lock blocks, a lock past its TTL does not, and a filesystem error never stops the sync.

**Files:**
- Create: `payload/hooks/lib/state-lock.mjs`
- Create: `payload/hooks/lib/state-lock.test.mjs`
- Modify: `payload/hooks/lib/graphify-global-sync-run.mjs:38,58-68`

**Interfaces:**
- Produces: `STALE_LOCK_MS` (number, 600000), `isHeld(lockPath, { now, ttlMs }) -> boolean`, `take(lockPath) -> void`, `release(lockPath) -> void`. `take` and `release` are best-effort and never throw.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/state-lock.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHeld, take, release, STALE_LOCK_MS } from "./state-lock.mjs";

const fresh = () => join(mkdtempSync(join(tmpdir(), "lock-")), "a.lock");

test("a lock that does not exist is not held", () => {
  assert.equal(isHeld(fresh()), false);
});

test("a lock just taken is held", () => {
  const p = fresh();
  take(p);
  assert.ok(existsSync(p));
  assert.equal(isHeld(p), true);
});

// A crashed run must not wedge the sync forever, which is what the TTL is for.
test("a lock older than the TTL is not held", () => {
  const p = fresh();
  take(p);
  const now = statSync(p).mtimeMs + STALE_LOCK_MS + 1;
  assert.equal(isHeld(p, { now }), false);
});

test("release removes the lock and is safe to repeat", () => {
  const p = fresh();
  take(p);
  release(p);
  assert.equal(existsSync(p), false);
  release(p);
});

test("taking a lock in a directory that does not exist yet still works", () => {
  const p = join(mkdtempSync(join(tmpdir(), "lock-")), "nested", "b.lock");
  take(p);
  assert.ok(existsSync(p));
});

test("an unreadable lock reads as not held, so a broken state file never wedges the sync", () => {
  const p = fresh();
  writeFileSync(p, "x");
  assert.equal(isHeld(p, { now: NaN }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/state-lock.test.mjs`
Expected: FAIL — `Cannot find module './state-lock.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// payload/hooks/lib/state-lock.mjs
// A PID/mtime lock with a staleness TTL, shared by the autosync worker and the Neo4j push.
// Every call is best-effort: a filesystem that refuses must never stop the work the lock guards.
import { existsSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export const STALE_LOCK_MS = 10 * 60 * 1000;

export function isHeld(lockPath, { now = Date.now(), ttlMs = STALE_LOCK_MS } = {}) {
  if (!existsSync(lockPath)) return false;
  let mtimeMs;
  try { mtimeMs = statSync(lockPath).mtimeMs; } catch { return false; }
  const age = now - mtimeMs;
  return Number.isFinite(age) && age < ttlMs;
}

export function take(lockPath) {
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, String(process.pid));
  } catch { /* best-effort */ }
}

export function release(lockPath) {
  try { rmSync(lockPath, { force: true }); } catch { /* best-effort */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/state-lock.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Point the worker at the module**

In `payload/hooks/lib/graphify-global-sync-run.mjs`, delete the `STALE_LOCK_MS` const on line 38, add the import, and replace the lock block (lines 58–68, from the `// PID/mtime lock` comment through `safe(() => writeFileSync(lock, String(process.pid)));`) with:

```js
// PID/mtime lock so overlapping triggers (Claude's PostToolUse hook AND the native
// git hook firing for the same commit, or rapid consecutive commits) don't pile up
// concurrent extractions of the same project. A stale lock is ignored after TTL.
const stateDir = join(CLAUDE_DIR, "state");
const lock = join(stateDir, `graphify-sync-${name}.lock`);
if (isHeld(lock)) process.exit(0);
take(lock);
```

```js
import { isHeld, take } from "./state-lock.mjs";
```

The `safe(() => mkdirSync(stateDir, { recursive: true }))` line goes away too — `take` creates the directory. `statSync`, `mkdirSync` and `writeFileSync` are now unused in this file: drop them from the `node:fs` import, leaving `existsSync` (Task 6 needs it).

- [ ] **Step 6: Run the whole suite**

Run: `node --test`
Expected: PASS — 664 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add payload/hooks/lib/state-lock.mjs payload/hooks/lib/state-lock.test.mjs payload/hooks/lib/graphify-global-sync-run.mjs
git commit -m "refactor(state-lock): one lock, shared by the sync and the push

The push is about to need the same PID/mtime lock with the same TTL, and a
second copy of it would be a second thing to get wrong."
```

---

### Task 4: The push finds graphify's own interpreter, and restores the driver

`graphify-neo4j-push.mjs` runs prune through a bare `python`, which on this machine has no `neo4j` module — graphify's uv venv does. The decision moves into `neo4j-config.mjs`, where its neighbours already live and where injection makes it testable.

**Files:**
- Modify: `payload/bin/lib/neo4j-config.mjs` (append after `ensureNeo4jDriver`)
- Modify: `payload/bin/lib/neo4j-config.test.mjs` (append)
- Modify: `payload/bin/graphify-neo4j-push.mjs:43,47`

**Interfaces:**
- Consumes: `findGraphifyPython()`, `driverInstalled(python)`, `ensureNeo4jDriver(python)` — all already exported from `neo4j-config.mjs`.
- Produces: `resolveDriverPython({ find, installed, ensure }) -> { ok: true, python, recovered? } | { ok: false, error }`.

- [ ] **Step 1: Write the failing test**

```js
// append to payload/bin/lib/neo4j-config.test.mjs
import { resolveDriverPython } from "./neo4j-config.mjs";

test("an interpreter that already has the driver is used as is", () => {
  const r = resolveDriverPython({
    find: () => "py", installed: () => true,
    ensure: () => { throw new Error("must not install"); },
  });
  assert.deepEqual(r, { ok: true, python: "py" });
});

// The driver vanishes whenever graphify is upgraded without --with neo4j, and until now
// nothing could put it back without a human answering setup.mjs again.
test("a missing driver is installed once, then the interpreter is used", () => {
  let installs = 0;
  const r = resolveDriverPython({
    find: () => "py",
    installed: () => installs > 0,
    ensure: () => { installs += 1; return { ok: true }; },
  });
  assert.equal(r.ok, true);
  assert.equal(r.recovered, true);
  assert.equal(installs, 1);
});

test("recovery that fails is an error carrying the command to run, not a throw", () => {
  const r = resolveDriverPython({
    find: () => "py", installed: () => false, ensure: () => ({ ok: false, error: "no uv" }),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /uv tool install graphifyy --with neo4j/);
});

test("no interpreter at all is an error naming graphify-setup", () => {
  const r = resolveDriverPython({ find: () => null, installed: () => false, ensure: () => ({ ok: false }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /graphify-setup\.mjs/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/bin/lib/neo4j-config.test.mjs`
Expected: FAIL — `resolveDriverPython is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// append to payload/bin/lib/neo4j-config.mjs
// The interpreter prune and the driver both need. A machine that wrote neo4j.env has already
// consented to the driver, so a missing one is restored rather than reported and abandoned:
// `uv tool install graphifyy` without `--with neo4j` is the ordinary upgrade, and it drops it.
export function resolveDriverPython({
  find = findGraphifyPython, installed = driverInstalled, ensure = ensureNeo4jDriver,
} = {}) {
  const python = find();
  if (!python) {
    return { ok: false, error: "no python with graphify found (run: node ~/.claude/bin/graphify-setup.mjs)" };
  }
  if (installed(python)) return { ok: true, python };
  ensure(python);
  if (installed(python)) return { ok: true, python, recovered: true };
  return {
    ok: false,
    error: "neo4j driver missing and could not be installed (run: uv tool install graphifyy --with neo4j)",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/bin/lib/neo4j-config.test.mjs`
Expected: PASS — 4 added tests green.

- [ ] **Step 5: Use it in the push script**

In `payload/bin/graphify-neo4j-push.mjs`, extend the import list with `resolveDriverPython`, then replace line 43 (`const py = process.env.GRAPHIFY_PYTHON || "python";`) with:

```js
const driver = resolveDriverPython();
if (!driver.ok) { log(`[neo4j-push] skipped: ${driver.error}`); process.exit(0); }
if (driver.recovered) log("[neo4j-push] neo4j driver was missing and has been reinstalled");
const py = driver.python;
```

- [ ] **Step 6: Run the whole suite**

Run: `node --test`
Expected: PASS — 668 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add payload/bin/lib/neo4j-config.mjs payload/bin/lib/neo4j-config.test.mjs payload/bin/graphify-neo4j-push.mjs
git commit -m "fix(neo4j-push): use graphify's interpreter, and put the driver back

Prune ran through a bare python that has no neo4j module, while graphify's own
venv does. ensureNeo4jDriver had exactly one caller, inside an interactive
branch of setup.mjs that is skipped once the decision is recorded, so a driver
lost to a routine upgrade had no way back. It has a second caller now."
```

---

### Task 5: Two pushes never overlap

The worker's lock is per repository. Commits landing in two repositories at once produce two concurrent pushes, and prune's `DETACH DELETE` in one can remove what the other has just merged.

**Files:**
- Modify: `payload/bin/graphify-neo4j-push.mjs:14-27`

**Interfaces:**
- Consumes: `isHeld`, `take`, `release` from `payload/hooks/lib/state-lock.mjs` (Task 3).

- [ ] **Step 1: Add the lock around the whole push**

After the existing `const log = ...` line, add the import and the guard:

```js
import { isHeld, take, release } from "../hooks/lib/state-lock.mjs";

const PUSH_LOCK = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "state", "graphify-neo4j-push.lock");
if (isHeld(PUSH_LOCK)) { log("[neo4j-push] skipped: another push is already running"); process.exit(0); }
take(PUSH_LOCK);
process.on("exit", () => release(PUSH_LOCK));
```

Add `homedir` to the `node:os` imports (the file does not import it yet — add `import { homedir } from "node:os";`).

`process.on("exit", …)` covers every `process.exit(0)` the script already contains, so no skip branch has to remember to release.

- [ ] **Step 2: Verify the lock is taken and released**

Run:
```bash
node payload/bin/graphify-neo4j-push.mjs
ls ~/.claude/state/graphify-neo4j-push.lock 2>&1
```
Expected: the script prints a skip or a push result, and the `ls` reports the lock does **not** exist — it was released on exit.

- [ ] **Step 3: Verify a held lock is honoured**

Run:
```bash
mkdir -p ~/.claude/state && echo 1 > ~/.claude/state/graphify-neo4j-push.lock
node payload/bin/graphify-neo4j-push.mjs
rm -f ~/.claude/state/graphify-neo4j-push.lock
```
Expected: `[neo4j-push] skipped: another push is already running`

- [ ] **Step 4: Run the whole suite**

Run: `node --test`
Expected: PASS — 668 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add payload/bin/graphify-neo4j-push.mjs
git commit -m "fix(neo4j-push): serialise pushes across repositories

The worker's lock is per repository, so two commits landing at once could have
one push's DETACH DELETE remove what the other had just merged."
```

---

### Task 6: The worker calls the push

**Files:**
- Modify: `payload/hooks/lib/graphify-sync-command.test.mjs`
- Modify: `payload/hooks/lib/graphify-sync-command.mjs`
- Modify: `payload/hooks/lib/graphify-global-sync-run.mjs`

**Interfaces:**
- Consumes: `buildSyncCommand` from Task 1.
- Produces: `buildSyncCommand({ root, name, lock, isWin, pushScript, node, logPath }) -> { shell, flag, inner }`. `pushScript` is a path or `null`; when `null` the command is exactly what Task 2 produced.

- [ ] **Step 1: Write the failing test**

```js
// append to payload/hooks/lib/graphify-sync-command.test.mjs
const withPush = {
  ...args, pushScript: "C:/claude/bin/push.mjs", node: "C:/node.exe",
  logPath: "C:/state/push.log",
};

test("the push runs after the extract and before the lock is released", () => {
  for (const isWin of [true, false]) {
    const inner = buildSyncCommand({ ...withPush, isWin }).inner;
    const iExtract = inner.indexOf("extract");
    const iPush = inner.indexOf("push.mjs");
    const iUnlock = inner.search(isWin ? /del \/f \/q/ : /rm -f/);
    assert.ok(iExtract < iPush && iPush < iUnlock, `order wrong on ${isWin ? "win" : "posix"}: ${inner}`);
  }
});

// Nothing watches the console of a detached process, so a failed push is invisible
// without a file to read afterwards.
test("the push writes stdout and stderr to the log", () => {
  const inner = buildSyncCommand({ ...withPush, isWin: false }).inner;
  assert.match(inner, /> "C:\/state\/push\.log" 2>&1/);
});

// Profile `base` excludes bin/graphify-neo4j-*, so most installs have no push script at all.
test("no push script means the command is the plain sync", () => {
  const plain = buildSyncCommand({ ...args, isWin: true });
  const withNull = buildSyncCommand({ ...withPush, pushScript: null, isWin: true });
  assert.equal(withNull.inner, plain.inner);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/hooks/lib/graphify-sync-command.test.mjs`
Expected: FAIL — the first two tests, since `push.mjs` never appears in `inner`.

- [ ] **Step 3: Add the push step**

```js
export function buildSyncCommand({ root, name, lock, isWin, pushScript = null, node = "node", logPath }) {
  const steps = [`graphify ${["extract", root, "--code-only", "--global", "--as", name].map(quote).join(" ")}`];
  if (pushScript) steps.push(`${quote(node)} ${quote(pushScript)} > ${quote(logPath)} 2>&1`);
  steps.push(isWin ? `del /f /q ${quote(lock)}` : `rm -f ${quote(lock)}`);
  return {
    shell: isWin ? "cmd" : "sh",
    flag: isWin ? "/c" : "-c",
    inner: steps.join(isWin ? " & " : "; "),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/hooks/lib/graphify-sync-command.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Decide the push script in the worker**

In `payload/hooks/lib/graphify-global-sync-run.mjs`, replace the `buildSyncCommand` call from Task 1 with:

```js
// The push is opt-in twice over: the script only exists in installs that took the neo4j
// option, and CLAUDE_GRAPHIFY_NEO4J_PUSH=0 turns it off without touching the sync.
const pushScript = join(CLAUDE_DIR, "bin", "graphify-neo4j-push.mjs");
const pushWanted = process.env.CLAUDE_GRAPHIFY_NEO4J_PUSH !== "0" && existsSync(pushScript);
const cmd = buildSyncCommand({
  root, name, lock, isWin: IS_WIN,
  pushScript: pushWanted ? pushScript : null,
  node: process.execPath,
  logPath: join(stateDir, "graphify-neo4j-push.log"),
});
spawn(cmd.shell, [cmd.flag, cmd.inner],
  { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();
```

- [ ] **Step 6: Update the file header**

The header lists what the worker does. Add one line after the `Usage:` line:

```js
// Also pushes the refreshed global graph to Neo4j when bin/graphify-neo4j-push.mjs is
// installed - same detached process, inside the same lock. Toggle: CLAUDE_GRAPHIFY_NEO4J_PUSH=0.
```

- [ ] **Step 7: Run the whole suite**

Run: `node --test`
Expected: PASS — 671 tests, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add payload/hooks/lib/graphify-sync-command.mjs payload/hooks/lib/graphify-sync-command.test.mjs payload/hooks/lib/graphify-global-sync-run.mjs
git commit -m "feat(graphify-sync): every commit carries the graph to Neo4j

The push has only ever run when a human typed --neo4j-push. It now runs in the
tail of the worker's own detached process, inside the lock that already
serialises the sync, and writes what happened to a log nobody has to watch."
```

---

### Task 7: The mass sync agrees with the worker

`graphify-sync-all.mjs` calls `extract` without `--code-only` too, so it fails the same way. Its default changes; the full semantic run moves behind a flag.

**Files:**
- Modify: `payload/graphify-sync-all.mjs:12-21,94`

- [ ] **Step 1: Add the flag and use it**

Replace line 94's `spawnSync` argument array:

```js
  const exArgs = ["extract", dir, ...(SEMANTIC ? [] : ["--code-only"]),
                  "--global", "--as", name, "--max-workers", "8"];
  const ex = spawnSync("graphify", exArgs, { cwd: dir, encoding: "utf8" });
```

Declare the flag beside the others, after `const NEO4J_PUSH = flag("--neo4j-push");`:

```js
const SEMANTIC = flag("--semantic");
```

- [ ] **Step 2: Update the usage block**

In the header comment, extend the usage line and add the explanation:

```js
 *   node graphify-sync-all.mjs [--root <dir>] [--max-depth N] [--install-hooks]
 *                              [--exclude a,b,c] [--dry-run] [--neo4j-push] [--semantic]
 *   Defaults: --root = current directory, --max-depth 3.
 *   --semantic:   full extraction including docs (needs an LLM API key). Without it the
 *                 sync is code-only: local AST, no key, no cost - the same as the autosync.
```

- [ ] **Step 3: Verify the default is code-only**

Run: `node payload/graphify-sync-all.mjs --root . --max-depth 0 --dry-run`
Expected: the run completes and reports `DRY` for this project; no `no LLM API key found` anywhere in the output.

- [ ] **Step 4: Run the whole suite**

Run: `node --test`
Expected: PASS — 671 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add payload/graphify-sync-all.mjs
git commit -m "fix(sync-all): code-only by default, --semantic for the full run

Both callers of graphify now agree on what a routine sync costs: nothing."
```

---

### Task 8: The documentation says what the code now does

`docs-claims.test.mjs` checks that shipped prose names nothing that does not exist, so this is not optional decoration.

**Files:**
- Modify: `README.md` (the `graphify-global-sync.mjs` and `graphify → Neo4j` entries)
- Modify: `README.en.md` (the same two entries)

- [ ] **Step 1: Find both entries**

Run: `grep -n "graphify-global-sync\|graphify → Neo4j\|graphify -> Neo4j" README.md README.en.md`

- [ ] **Step 2: Update the Russian README**

In the `graphify → Neo4j` entry, replace the sentence that says the push is invoked by `graphify-sync-all --neo4j-push` with:

```markdown
  Пуш выполняется автоматически: `hooks/lib/graphify-global-sync-run.mjs` запускает его в хвосте
  того же фонового процесса, что и `extract`, внутри того же лока. Скрипт есть только в установках,
  взявших опцию `neo4j` (в профиле `base` он исключён); выключается `CLAUDE_GRAPHIFY_NEO4J_PUSH=0`.
  Результат пишется в `~/.claude/state/graphify-neo4j-push.log`. Ручной путь остался:
  `graphify-sync-all.mjs --neo4j-push`.
```

- [ ] **Step 3: Update the English README**

```markdown
  The push is automatic: `hooks/lib/graphify-global-sync-run.mjs` runs it in the tail of the same
  background process as the `extract`, inside the same lock. The script exists only in installs
  that took the `neo4j` option (profile `base` excludes it); `CLAUDE_GRAPHIFY_NEO4J_PUSH=0` turns
  it off. The result lands in `~/.claude/state/graphify-neo4j-push.log`. The manual path remains:
  `graphify-sync-all.mjs --neo4j-push`.
```

- [ ] **Step 4: Run the documentation tests**

Run: `node --test docs-claims.test.mjs docs-coverage.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md README.en.md
git commit -m "docs: the push is automatic, and says where it wrote its log"
```

---

### Task 9: Deploy, then prove the chain end to end

Unit tests cannot cross the network. This task is the live verification the spec names, and it is where `payload/` becomes `~/.claude`.

**Files:** none — this task runs commands and records results.

- [ ] **Step 1: Deploy the payload**

Run: `node setup.mjs`
Expected: it completes without prompting (no TTY), and the summary lists the changed hook files. `~/.claude/hooks/lib/state-lock.mjs` and `~/.claude/hooks/lib/graphify-sync-command.mjs` now exist.

- [ ] **Step 2: Rebuild the global graph, which does not exist**

Run: `node ~/.claude/graphify-sync-all.mjs --root "D:/6__Work" --max-depth 3`
Expected: projects are listed with `OK`, and no `no LLM API key found` appears. Afterwards `graphify global list` prints repositories with today's date, not 3 July.

- [ ] **Step 3: Confirm the file the push needs is back**

Run: `ls -la ~/.graphify/global-graph.json && graphify global path`
Expected: the file exists and the path printed matches it.

- [ ] **Step 4: Push once by hand, watching the output**

Run: `node ~/.claude/bin/graphify-neo4j-push.mjs`
Expected: `pruning N repo(s) before push...` then `Pushed to Neo4j: <n> nodes, <m> edges`. If it skips, the reason is printed and names the fix.

- [ ] **Step 5: Prove the automatic path**

Run:
```bash
cd D:/6__Work/AI_Projects/claude-config
git commit --allow-empty -m "chore: prove the autosync chain fires"
sleep 45
cat ~/.claude/state/graphify-neo4j-push.log
```
Expected: the log exists and its last line reads `Pushed to Neo4j: <n> nodes, <m> edges`. This is the whole point of the phase: nobody typed a push command.

- [ ] **Step 6: Read it back through Cypher**

Run (in a session started after `/init-mcp` added the `neo4j` server):
```
MATCH (n) RETURN count(n) AS nodes
MATCH (n) WHERE n.repo IS NOT NULL RETURN DISTINCT n.repo ORDER BY n.repo
```
Expected: the count is well above 269, and `claude-config` is among the repository tags.

If the MCP server is not available in the current session, the equivalent check is:
```bash
set -a; . ~/.graphify/neo4j.env; set +a
"$(node -e "import('file:///C:/Users/Axa/.claude/bin/lib/neo4j-config.mjs').then(m=>console.log(m.findGraphifyPython()))")" \
  -c "import os;from neo4j import GraphDatabase;d=GraphDatabase.driver(os.environ['NEO4J_URI'],auth=(os.environ['NEO4J_USER'],os.environ['NEO4J_PASSWORD']));s=d.session();print('nodes',s.run('MATCH (n) RETURN count(n) AS c').single()['c']);print('repos',s.run('MATCH (n) WHERE n.repo IS NOT NULL RETURN collect(DISTINCT n.repo) AS r').single()['r'])"
```

- [ ] **Step 7: Record the outcome and close the phase**

Write `.ultrapowers/phases/13-graphify-neo4j-autosync/13-SUMMARY.md` with the node and edge counts from steps 4–6, then set the phase row in `.ultrapowers/ROADMAP.md` to `status: complete, delivery: branch` and `current: null`.

- [ ] **Step 8: Commit**

```bash
git add .ultrapowers/phases/13-graphify-neo4j-autosync/13-SUMMARY.md .ultrapowers/ROADMAP.md
git commit -m "docs(phase-13): the chain runs unattended, with the counts to prove it"
```

---

## Self-review

**Spec coverage.** Component 1 (`--code-only` plus the push in the worker) → Tasks 1, 2, 6. Component 2 (push: global lock, graphify's interpreter, driver recovery, reasons in the log) → Tasks 4, 5; the log itself is Task 6 step 3, since the redirection lives in the command the worker builds. Component 3 (`sync-all`) → Task 7. Component 4 (`state-lock.mjs`) → Task 3. Testing decisions → the four seams map to Tasks 1/2/6, 3, 4 and 4 respectively. Live verification → Task 9. Documentation is not a spec section but `docs-claims.test.mjs` makes it mandatory → Task 8.

**Placeholders.** None: every code step carries the code, every run step carries the command and the expected output.

**Type consistency.** `buildSyncCommand` is introduced in Task 1 with `{ root, name, lock, isWin }` and widened in Task 6 with `{ pushScript, node, logPath }`, defaulted so Task 1's callers stay valid. `isHeld`/`take`/`release` keep the names Task 3 defines everywhere they are used (Tasks 3, 5). `resolveDriverPython` returns `{ ok, python, recovered?, error? }` in Task 4 and is consumed with exactly those fields.

**One deliberate gap.** No unit test covers `graphify-global-sync-run.mjs` itself. It has no exports and its only effect is a detached spawn; the suite forbids hooks from spawning synchronously, so a test would have to fake the process table. Every decision it makes lives in the two pure functions that *are* tested, and Task 9 step 5 exercises the file end to end for real.
