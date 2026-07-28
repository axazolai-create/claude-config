# Design Records in `brainstorming`, and Stack Rules Resolved at Design Time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the design step answer four questions it currently skips — where behaviour is verified, what is out of scope, which terms were sharpened, which decision earned an ADR — and re-enable the stack-drift check at that same moment, workspace-aware and in both directions.

**Architecture:** One fork delta adds four rules to `brainstorming/SKILL.md`. In the bundle, `stack-rules-check.mjs` learns to fingerprint the root *plus every workspace* and grows a `compare` mode that names what appeared and what vanished; the workspace enumeration it needs is extracted out of the `update-changelog` skill into a shared library first. `sourceHash` takes no part in any of it.

**Tech Stack:** Node 20+ ESM (`node --test`), the ultrapowers fork's `transform/` build engine.

## Global Constraints

- **Depends on plan #1.** Delta `010-design-records.patch` is authored last, against the tree deltas 007–009 produce. Do not start Task 5 before plan #1's Task 8 has rebuilt `main`.
- Validate the delta with `node transform/build-cli.mjs check` — never `git apply`, which tolerates hunk geometry the fork's `parsePatch` refuses.
- No blank context lines inside a hunk; where the target line sits between blanks, use a zero-context single-line hunk.
- **`sourceHash` is not used in the design-time check, at all.** It hashes path + size + mtime, so every `setup.mjs` deploy moves it with no rule text changing. That is precisely why the check was switched off on 2026-07-13, and reusing it would switch it off a second time for the same reason.
- The seams rule goes in `brainstorming` and **must not** be duplicated into `payload/rules-src/testing.md`. Two files, two questions: *where* behaviour is verified versus *how* a test is written. Shared text between them is text that drifts apart.
- ADRs are written to `.ultrapowers/adr/NNNN-slug.md` (user ruling, 2026-07-28), not the root `docs/adr/` the decision-records spec assumed.
- Terse-code mode: no comments except a genuine non-obvious *why*.

## Assumptions recorded at planning time

1. **`/gsd-ingest-docs` no longer picks ADRs up for free.** It scans `docs/adr/`, `docs/prd/`, `docs/specs/`, `docs/rfc/`; `.ultrapowers/adr/` is in none of them. This is a knowing consequence of the ruling above. Plan #3 (decision-records CLI) owns whatever bridge that needs — this plan does not invent one.
2. **Existing snapshots must not all go stale at once.** Today's `.claude/stack-rules.md` files carry a fingerprint computed the old way, over root markers only. Task 3 therefore treats a snapshot whose `stacks:` is a flat list as *legacy*: reported, never flagged as drift, upgraded on the next explicit rebuild. Without this, every project reports divergence on first contact and the check trains the user to ignore it — the exact failure being fixed.
3. **The CLI tooling (`risks`, `adr`, `glossary`) is plan #3's.** This plan writes the instruction half only. The delta may name the commands; nothing here implements them.

## File Structure

| File | Responsibility |
|---|---|
| `payload/bin/lib/workspaces.mjs` | `listWorkspaces(root)` — pure enumeration, extracted from the changelog skill's CLI |
| `payload/bin/lib/workspaces.test.mjs` | its tests |
| `payload/skills/update-changelog/scripts/list-workspaces.mjs` | becomes a thin CLI over the library, output byte-identical |
| `payload/hooks/lib/stack-rules-check.mjs` | markers per workspace, fingerprint over the map, `compare` mode |
| `payload/hooks/lib/stack-rules-check.test.mjs` | new — the file has no tests today |
| `payload/rules-src/README.md` | `stacks:` as a map, scoped sections, additive layer add |
| `transform/deltas/010-design-records.patch` | the four rules in `brainstorming/SKILL.md` |

---

### Task 1: Extract `listWorkspaces` into a shared library

The stack fingerprint has to see `apps/web/next.config.ts`, and the only workspace enumerator in the bundle is a CLI buried in the changelog skill that prints JSON and exports nothing. Extract it unchanged; two implementations of "what are this repo's workspaces" would drift, and the changelog skill would be the one to notice last.

**Files:**
- Create: `payload/bin/lib/workspaces.mjs`
- Create: `payload/bin/lib/workspaces.test.mjs`
- Modify: `payload/skills/update-changelog/scripts/list-workspaces.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `listWorkspaces(root)` → `{ root, isMonorepo, detectionSource, workspaceGlobsUsed, workspaces }` where each workspace is `{ dir, relDir, hasPackageJson }`. `relDir` uses forward slashes on every platform. Detection order, first match wins: `pnpm-workspace.yaml` → `package.json#workspaces` → `turbo.json`/`nx.json` present → `apps/*`, `packages/*`.

- [ ] **Step 1: Write the failing tests**

Create `payload/bin/lib/workspaces.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspaces } from "./workspaces.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "workspaces-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}
const pkg = JSON.stringify({ name: "x" });

test("reads pnpm-workspace.yaml packages", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "apps/web/package.json": pkg,
    "apps/api/package.json": pkg,
  });
  const r = listWorkspaces(root);
  assert.equal(r.detectionSource, "pnpm-workspace.yaml");
  assert.deepEqual(r.workspaces.map((w) => w.relDir), ["apps/api", "apps/web"]);
  assert.equal(r.isMonorepo, true);
});

test("falls back to package.json workspaces", () => {
  const root = repo({
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "packages/ui/package.json": pkg,
  });
  const r = listWorkspaces(root);
  assert.equal(r.detectionSource, "package.json#workspaces");
  assert.deepEqual(r.workspaces.map((w) => w.relDir), ["packages/ui"]);
  assert.equal(r.isMonorepo, false);
});

test("falls back to conventional globs when only turbo.json is present", () => {
  const root = repo({ "turbo.json": "{}", "apps/web/package.json": pkg });
  assert.equal(listWorkspaces(root).detectionSource, "conventional-fallback");
});

test("a directory without package.json is not a workspace", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "apps/web/package.json": pkg,
    "apps/docs/README.md": "x",
  });
  assert.deepEqual(listWorkspaces(root).workspaces.map((w) => w.relDir), ["apps/web"]);
});

test("a single-package repository has no workspaces", () => {
  const root = repo({ "package.json": pkg });
  const r = listWorkspaces(root);
  assert.deepEqual(r.workspaces, []);
  assert.equal(r.detectionSource, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/bin/lib/workspaces.test.mjs`
Expected: FAIL — `Cannot find module './workspaces.mjs'`.

- [ ] **Step 3: Write the library**

Create `payload/bin/lib/workspaces.mjs`. This is the existing CLI's logic, moved verbatim behind a function — behaviour must not change, because the changelog skill's monorepo mode already depends on every one of these branches.

```js
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function parsePnpmWorkspaceYaml(path) {
  const globs = [];
  let inPackages = false;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
    if (!inPackages) continue;
    const m = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
    if (m) { globs.push(m[1]); continue; }
    if (/^\S/.test(line)) break;
  }
  return globs;
}

function expandGlob(root, glob) {
  if (glob.endsWith("/*")) {
    const base = join(root, glob.slice(0, -2));
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(base, e.name));
  }
  const exact = join(root, glob);
  return existsSync(exact) && statSync(exact).isDirectory() ? [exact] : [];
}

export function listWorkspaces(rootArg) {
  const root = resolve(rootArg);
  let workspaceGlobs = null;
  let source = null;

  const pnpmWsPath = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmWsPath)) {
    const globs = parsePnpmWorkspaceYaml(pnpmWsPath);
    if (globs.length > 0) { workspaceGlobs = globs; source = "pnpm-workspace.yaml"; }
  }

  if (!workspaceGlobs) {
    const rootPkg = readJsonSafe(join(root, "package.json"));
    const w = rootPkg?.workspaces;
    const globs = Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : null;
    if (globs?.length) { workspaceGlobs = globs; source = "package.json#workspaces"; }
  }

  if (!workspaceGlobs && (existsSync(join(root, "turbo.json")) || existsSync(join(root, "nx.json")))) {
    const fallback = ["apps/*", "packages/*"].filter((g) => existsSync(join(root, g.replace("/*", ""))));
    if (fallback.length > 0) { workspaceGlobs = fallback; source = "conventional-fallback"; }
  }

  const dirs = new Set();
  for (const g of workspaceGlobs ?? []) for (const d of expandGlob(root, g)) dirs.add(d);

  const workspaces = [...dirs]
    .map((dir) => ({
      dir,
      relDir: dir.slice(root.length + 1).split("\\").join("/"),
      hasPackageJson: existsSync(join(dir, "package.json")),
    }))
    .filter((w) => w.hasPackageJson)
    .sort((a, b) => a.relDir.localeCompare(b.relDir));

  return {
    root,
    isMonorepo: workspaces.length > 1,
    detectionSource: source,
    workspaceGlobsUsed: workspaceGlobs ?? [],
    workspaces,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/bin/lib/workspaces.test.mjs`
Expected: 5/5 PASS.

- [ ] **Step 5: Reduce the CLI to a wrapper**

Replace the body of `payload/skills/update-changelog/scripts/list-workspaces.mjs` with:

```js
#!/usr/bin/env node
// Enumerates monorepo workspace directories from the repo root. Used by the Monorepo mode
// section of SKILL.md to find candidate parts (web/backend/mobile/...) before running
// detect-project.mjs / write-changelog.mjs against each one with --root.
// The logic lives in ~/.claude/bin/lib/workspaces.mjs: the stack-rules fingerprint needs the
// same enumeration, and two implementations of "what are this repo's workspaces" would drift.
import { listWorkspaces } from "../../../bin/lib/workspaces.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--root");
console.log(JSON.stringify(listWorkspaces(i !== -1 && args[i + 1] ? args[i + 1] : process.cwd())));
```

- [ ] **Step 6: Verify the CLI output is unchanged**

```bash
node payload/skills/update-changelog/scripts/list-workspaces.mjs --root . | node -e "
  let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
    const o=JSON.parse(s);
    console.log(Object.keys(o).sort().join(','), '|', o.isMonorepo, o.detectionSource);
  })"
```

Expected: `detectionSource,isMonorepo,root,workspaceGlobsUsed,workspaces | false null` — the same five keys the old CLI printed, and this repository is not a monorepo.

The relative import (`../../../bin/lib/workspaces.mjs`) resolves inside `~/.claude` after deployment, where `skills/update-changelog/scripts/` and `bin/lib/` are siblings under the same root. Verify that after the next `node setup.mjs`, not from the source tree.

- [ ] **Step 7: Commit**

```bash
git add payload/bin/lib/workspaces.mjs payload/bin/lib/workspaces.test.mjs payload/skills/update-changelog/scripts/list-workspaces.mjs
git commit -m "refactor(workspaces): one enumerator, shared by the changelog skill and stack rules"
```

---

### Task 2: Fingerprint the root **and** every workspace

`ROOT_PATTERNS` only reads the repository root, so in a monorepo `next.config.ts` sitting in `apps/web/` is invisible and the frontend stack never registers. The fingerprint becomes a map of workspace to markers.

**Files:**
- Modify: `payload/hooks/lib/stack-rules-check.mjs`
- Create: `payload/hooks/lib/stack-rules-check.test.mjs`

**Interfaces:**
- Consumes: `listWorkspaces(root)` from Task 1.
- Produces: `detectMarkersByWorkspace(root)` → `{ ".": string[], "apps/web": string[], … }`, keys sorted, values sorted. `computeStackFingerprint(root)` now hashes that map. `detectMarkers(root)` keeps its old single-directory signature — Task 3 and the compiler both still need "markers of one directory".

- [ ] **Step 1: Write the failing tests**

Create `payload/hooks/lib/stack-rules-check.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectMarkers, detectMarkersByWorkspace, computeStackFingerprint } from "./stack-rules-check.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "stack-rules-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}
const pkg = JSON.stringify({ name: "x" });

test("a single-package repository reports only the root", () => {
  const root = repo({ "package.json": pkg, "next.config.ts": "" });
  assert.deepEqual(detectMarkersByWorkspace(root), { ".": ["next", "node"] });
});

test("a workspace's own markers are found and attributed to it", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "apps/web/package.json": pkg,
    "apps/web/next.config.ts": "",
    "apps/api/package.json": pkg,
    "apps/api/nest-cli.json": "{}",
  });
  assert.deepEqual(detectMarkersByWorkspace(root), {
    ".": ["node", "pnpm-ws"],
    "apps/api": ["nest", "node"],
    "apps/web": ["next", "node"],
  });
});

test("a nested stack changes the fingerprint", () => {
  const base = {
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "apps/web/package.json": pkg,
  };
  const before = computeStackFingerprint(repo(base));
  const after = computeStackFingerprint(repo({ ...base, "apps/web/next.config.ts": "" }));
  assert.notEqual(before, after);
});

test("the fingerprint is stable across two identical trees", () => {
  const files = { "package.json": pkg, "manage.py": "" };
  assert.equal(computeStackFingerprint(repo(files)), computeStackFingerprint(repo(files)));
});

test("detectMarkers still reads exactly one directory", () => {
  const root = repo({ "package.json": pkg, "apps/web/next.config.ts": "" });
  assert.deepEqual(detectMarkers(root), ["node"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/hooks/lib/stack-rules-check.test.mjs`
Expected: FAIL — `detectMarkersByWorkspace is not a function`.

- [ ] **Step 3: Add the workspace-aware detection**

In `payload/hooks/lib/stack-rules-check.mjs`, add the import beside the existing ones:

```js
import { listWorkspaces } from "../../bin/lib/workspaces.mjs";
```

Then, immediately after `detectMarkers`, replace the one-line `computeStackFingerprint` export with:

```js
// Root markers alone miss a monorepo's real stacks: in a pnpm workspace next.config.ts sits in
// apps/web/, so the frontend never registers and its rules never arrive. Keys are workspace-
// relative, "." for the root.
export function detectMarkersByWorkspace(root) {
  const out = { ".": detectMarkers(root) };
  for (const w of listWorkspaces(root).workspaces) out[w.relDir] = detectMarkers(w.dir);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export const computeStackFingerprint = (root) =>
  sha16(JSON.stringify(detectMarkersByWorkspace(root)));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test payload/hooks/lib/stack-rules-check.test.mjs`
Expected: 5/5 PASS.

- [ ] **Step 5: Verify the CLI still prints usable JSON**

Run: `node payload/hooks/lib/stack-rules-check.mjs .`
Expected: JSON containing `"status"`, `"sourceHash"`, `"stackFingerprint"`, `"markers"`, `"snapshotPath"`. On this repository `markers` includes `"node"` and `"gsd"` is absent (no `.planning/`).

The `stackFingerprint` value changes for every existing project, because the hash input changed shape. That is expected and is handled in Task 3 — do not try to preserve the old value.

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/lib/stack-rules-check.mjs payload/hooks/lib/stack-rules-check.test.mjs
git commit -m "feat(stack-rules): fingerprint the root and every workspace"
```

---

### Task 3: `compare` — name what appeared and what vanished

A hash tells you that something changed and nothing about what. Naming the change is the whole value at design time, so the snapshot must record the markers themselves, not only their digest. Drift is symmetric: a stack can disappear — Vite removed, migrated to Next — and rules that no longer apply are as wrong as rules that never arrived.

**Files:**
- Modify: `payload/hooks/lib/stack-rules-check.mjs`
- Modify: `payload/hooks/lib/stack-rules-check.test.mjs`

**Interfaces:**
- Consumes: `detectMarkersByWorkspace` from Task 2.
- Produces: `checkStackRules(root, srcDir?)` → `{ status, sourceHash, stackFingerprint, markers, added, removed, snapshotPath }`. `status` is `"ok"`, `"stale"`, `"missing"` or `"legacy"`. `added` and `removed` are arrays of `{ workspace, marker }`, both empty unless `status === "stale"`.

- [ ] **Step 1: Write the failing tests**

Append to `payload/hooks/lib/stack-rules-check.test.mjs`:

```js
import { checkStackRules } from "./stack-rules-check.mjs";

function snapshot(root, frontmatter) {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "stack-rules.md"), `---\n${frontmatter}\n---\n\nrules\n`);
}

test("a snapshot whose markers match reports ok", () => {
  const root = repo({ "package.json": pkg });
  const fp = computeStackFingerprint(root);
  snapshot(root, `sourceHash: x\nstackFingerprint: ${fp}\nmarkers: {".": ["node"]}`);
  const r = checkStackRules(root, root);
  assert.equal(r.status, "ok");
  assert.deepEqual([r.added, r.removed], [[], []]);
});

test("a marker that appeared is named, with its workspace", () => {
  const root = repo({ "package.json": pkg, "next.config.ts": "" });
  snapshot(root, `sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nmarkers: {".": ["node"]}`);
  const r = checkStackRules(root, root);
  assert.equal(r.status, "stale");
  assert.deepEqual(r.added, [{ workspace: ".", marker: "next" }]);
  assert.deepEqual(r.removed, []);
});

test("a marker that vanished is named too", () => {
  const root = repo({ "package.json": pkg });
  snapshot(root, `sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nmarkers: {".": ["node","vite"]}`);
  const r = checkStackRules(root, root);
  assert.deepEqual(r.removed, [{ workspace: ".", marker: "vite" }]);
  assert.deepEqual(r.added, []);
});

test("a snapshot without a markers line is legacy, never stale", () => {
  const root = repo({ "package.json": pkg, "next.config.ts": "" });
  snapshot(root, "sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nstacks: [next]");
  const r = checkStackRules(root, root);
  assert.equal(r.status, "legacy");
  assert.deepEqual([r.added, r.removed], [[], []]);
});

test("no snapshot at all is missing", () => {
  assert.equal(checkStackRules(repo({ "package.json": pkg }), ".").status, "missing");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test payload/hooks/lib/stack-rules-check.test.mjs`
Expected: the five new cases FAIL; `r.added` is `undefined`.

- [ ] **Step 3: Record markers in the frontmatter and compare them**

Replace `checkStackRules` in `payload/hooks/lib/stack-rules-check.mjs` with:

```js
// markers: and stacks: are written as YAML flow mappings, which are also valid JSON. That keeps
// the frontmatter a nested map without adding a YAML parser to a hook that must stay cheap.
function parseFlowMap(head, key) {
  const line = head.match(new RegExp(`^${key}:\\s*(\\{.*\\})\\s*$`, "m"));
  if (!line) return null;
  try { return JSON.parse(line[1]); } catch { return null; }
}

function diffMarkers(before, after) {
  const added = [];
  const removed = [];
  for (const ws of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = new Set(before[ws] ?? []);
    const is = new Set(after[ws] ?? []);
    for (const m of is) if (!was.has(m)) added.push({ workspace: ws, marker: m });
    for (const m of was) if (!is.has(m)) removed.push({ workspace: ws, marker: m });
  }
  const order = (a, b) => a.workspace.localeCompare(b.workspace) || a.marker.localeCompare(b.marker);
  return { added: added.sort(order), removed: removed.sort(order) };
}

export function checkStackRules(root, srcDir = join(CLAUDE_DIR, "rules-src")) {
  const sourceHash = computeSourceHash(srcDir);
  const markers = detectMarkersByWorkspace(root);
  const stackFingerprint = sha16(JSON.stringify(markers));
  const snapshotPath = join(root, ".claude", "stack-rules.md");
  const empty = { sourceHash, stackFingerprint, markers, added: [], removed: [], snapshotPath };
  if (!existsSync(snapshotPath)) return { status: "missing", ...empty };

  let head = "";
  try { head = readFileSync(snapshotPath, "utf8").slice(0, 2000); } catch { return { status: "missing", ...empty }; }
  const recorded = parseFlowMap(head, "markers");
  // A snapshot predating workspace-aware fingerprints cannot be compared: its hash was computed
  // over a different shape, so every project would report drift on first contact and the check
  // would be switched off a second time. Reported, never flagged; upgraded on the next rebuild.
  if (!recorded) return { status: "legacy", ...empty };

  const { added, removed } = diffMarkers(recorded, markers);
  const status = added.length || removed.length ? "stale" : "ok";
  return { status, ...empty, added, removed };
}
```

Note that `sourceHash` is still computed and still reported — the compiler stamps it — but no longer takes any part in deciding `status`. That is the whole point: it hashes mtime, and every deploy moves it.

- [ ] **Step 4: Update the CLI block**

At the bottom of the file, replace the `isMainModule()` body's `console.log` line with:

```js
  console.log(JSON.stringify(checkStackRules(root), null, 2));
```

`markers` now comes from `checkStackRules` itself, so the CLI no longer needs to append it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test payload/hooks/lib/stack-rules-check.test.mjs`
Expected: 10/10 PASS.

- [ ] **Step 6: Verify against this repository**

Run: `node payload/hooks/lib/stack-rules-check.mjs .`
Expected: `"status": "legacy"` — this repository's own `.claude/stack-rules.md` predates the `markers:` line. That is the correct answer, and it is the answer every existing project gives until its next rebuild.

- [ ] **Step 7: Commit**

```bash
git add payload/hooks/lib/stack-rules-check.mjs payload/hooks/lib/stack-rules-check.test.mjs
git commit -m "feat(stack-rules): compare markers in both directions, name what changed"
```

---

### Task 4: Teach the compiler the workspace-scoped snapshot

`stacks:` is a flat list today, so a monorepo cannot say that Next belongs to `apps/web` and Nest to `apps/backend` — and the rules arrive everywhere. It becomes a map, and the snapshot's sections are scoped to match.

**Files:**
- Modify: `payload/rules-src/README.md` (§ "Building stack-rules")

**Interfaces:**
- Consumes: the frontmatter shape Task 3 parses — `markers:` and `stacks:` as YAML flow mappings.
- Produces: the compiler contract that Task 5's delta points at.

- [ ] **Step 1: Replace the frontmatter block**

In `payload/rules-src/README.md`, in step 5 of § "Building stack-rules", replace the fenced YAML block with:

```yaml
---
generated: stack-rules compiler   # machine-owned; edit rules-src and rebuild, not this file
sourceHash: <16-hex>
stackFingerprint: <16-hex>
stacks: {".": ["node"], "apps/web": ["next"], "apps/api": ["nest"]}
markers: {".": ["node","pnpm-ws"], "apps/web": ["next","node"], "apps/api": ["nest","node"]}
generatedAt: <ISO timestamp>
---
```

- [ ] **Step 2: State why the flow mapping, and what `markers:` is for**

Immediately after that block, add:

```markdown
`stacks:` and `markers:` are written as YAML flow mappings, which are also valid JSON. The
desync check parses them with `JSON.parse` on one line, so the frontmatter can be a nested map
without a YAML parser in a hook that must stay cheap.

`markers:` is not a duplicate of `stackFingerprint`. The hash says *that* the stack changed;
the map is what lets the next design session say *what* changed — `next appeared in apps/web`,
`vite vanished from the root`. A hash alone cannot name either, and naming it is the whole
value of the check.

Take both values from `node ~/.claude/hooks/lib/stack-rules-check.mjs <root>`, which now
reports `markers` per workspace. Never hand-write them.
```

- [ ] **Step 3: Scope the snapshot's sections**

In step 3 ("Compile into one document, deduplicated"), add after the existing text:

```markdown
When more than the root carries markers, scope each rule section to the workspace it answers:
a `## apps/web — next` heading, then that stack's rules. Rules shared by every workspace stay
in one unscoped section at the top. A monorepo that states its frontend rules once, unscoped,
applies them to its backend too — which is how a Next rule ends up governing a Nest service.

Write rules **only for what was actually detected**. A project with no Python marker never
receives Python rules, and the snapshot says so explicitly — a `## Not detected` line listing
the layers deliberately absent — rather than leaving it to be inferred from omission.
```

- [ ] **Step 4: Document the additive update**

Add a new step after step 10:

```markdown
11. **Updating an existing snapshot after drift.** When `stack-rules-check.mjs` reports
    `stale`, do NOT regenerate the snapshot from scratch. Add the `rules-src/` layers that
    answer each `added` marker, remove the sections belonging to each `removed` marker, and
    restamp `stackFingerprint` and `markers`. A full rebuild discards any hand-tuning in the
    snapshot and produces a diff nobody can review. A `legacy` status means the snapshot
    predates the `markers:` line: rebuild it once, fully, and it becomes comparable from then on.
```

- [ ] **Step 5: Verify the document is internally consistent**

```bash
grep -n "stacks: \[" payload/rules-src/README.md || echo "no flat stacks list remains"
grep -c "markers:" payload/rules-src/README.md
```

Expected: `no flat stacks list remains`, and a count of at least 3.

- [ ] **Step 6: Commit**

```bash
git add payload/rules-src/README.md
git commit -m "docs(rules-src): workspace-scoped stacks, recorded markers, additive updates"
```

---

### Task 5: Delta `010-design-records` — four rules in `brainstorming`

Each of these is a judgement no code can make: whether a term is overloaded, whether a decision was a real trade-off, where a seam belongs. The deterministic halves — next ADR number, format checks, finding undefined terms — are plan #3's CLI. This delta carries only what a thinking reader must decide.

**Files:**
- Create: `transform/deltas/010-design-records.patch` (in the fork, branch `patch`)

**Interfaces:**
- Consumes: deltas 007–009 from plan #1 — hunk 3's context is delta 007's rewritten line 111 region, and `.ultrapowers/adr/` only makes sense once the tree exists.
- Produces: nothing later depends on it.

- [ ] **Step 1: Confirm the base is what you think it is**

```bash
cd /d/6__Work/AI_Projects/ultrapowers
node transform/build-cli.mjs check
node transform/build-cli.mjs emit .build
sed -n '110,115p' .build/plugins/ultrapowers/skills/brainstorming/SKILL.md
```

Expected: `deltas applied 9`, and line 111 already naming `phase-dir`. If it still says `docs/ultrapowers/specs/`, plan #1 has not landed — stop.

- [ ] **Step 2: Write the delta**

Create `transform/deltas/010-design-records.patch`:

```diff
--- a/plugins/ultrapowers/skills/brainstorming/SKILL.md
+++ b/plugins/ultrapowers/skills/brainstorming/SKILL.md
@@ -67,2 +67,4 @@
 - Check out the current project state first (files, docs, recent commits)
+- Check whether the project's stack has drifted from its compiled rules: run `node ~/.claude/hooks/lib/stack-rules-check.mjs <root>`. On `stale`, name what appeared and what vanished, and add the `rules-src/` layers answering the new markers — a stack that vanished leaves rules that no longer apply, which is as wrong as rules that never arrived. On `ok`, `missing` or `legacy`, say nothing.
+- This is the right moment for that question and the only one. Design happens orders of magnitude less often than a session starts, and "have we drifted from the stack?" is meaningful here and noise everywhere else.
 - Before asking detailed questions, assess scope: if the request describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
@@ -90,3 +90,5 @@
 - Ask after each section whether it looks right so far
 - Cover: architecture, components, data flow, error handling, testing
+- **Testing Decisions** — name the seams at which the behaviour will be verified. Prefer an existing seam to a new one, take the highest one available, aim for one per change. State a seam as an intent to verify — "behaviour is checked at the HTTP contract" — never as a file or a class, so it survives a change of structure. Required only when the work produces executable behaviour; for documentation or configuration, omit it explicitly, not silently.
+- **Out of Scope** — a required section naming what this design deliberately does not cover. Cheap insurance against creep, and the one section a reader checks first when the work later grows.
 - Be ready to go back and clarify if something doesn't make sense
@@ -113,2 +113,5 @@
 - Use elements-of-style:writing-clearly-and-concisely skill if available
 - Commit the design document to git
+<!-- design-records:v1 - ADR shape from gsd-doc-classifier; glossary discipline from `grill-with-docs` in mattpocock/skills (MIT, (c) Matt Pocock) -->
+- **Glossary** — when a term is sharpened during the session, write it to `GLOSSARY.md` at that moment, not batched at the end. Inline capture is what separates a living glossary from a dead one. Definition only: no implementation, no decisions.
+- **ADR** — write one only when all three hold: the decision is hard to reverse, it is surprising without context, and it was a real trade-off. Failing any one, no ADR — a register of rubber-stamped entries stops being read, the same failure mode as a bloated risk register. Format `.ultrapowers/adr/NNNN-slug.md`, with frontmatter `status:`, a `# ADR-NNNN Title` heading, and `## Context` / `## Decision` / `## Consequences` sections.
```

Every header counts context plus added lines: `2/4`, `3/5`, `2/5`. Recount them against the body before running the build — `parsePatch` asserts geometry exactly and refuses the file with `header declares N/M, body has …` on any mismatch.

The bullets are single long lines on purpose. Wrapping them would put more lines in the hunk for no gain, and every wrapped line is another chance for an editor to eat a leading space.

- [ ] **Step 3: Verify the delta applies**

Run: `node transform/build-cli.mjs check`
Expected: `files 59 | deltas applied 10 obsolete 0 failed 0`, no `REFUSE` lines.

- [ ] **Step 4: Verify the four rules landed and nothing was duplicated**

```bash
node transform/build-cli.mjs emit .build
B=.build/plugins/ultrapowers/skills/brainstorming/SKILL.md
grep -c "Testing Decisions\|Out of Scope\|\*\*Glossary\*\*\|\*\*ADR\*\*" "$B"
grep -n "stack-rules-check.mjs" "$B"
```

Expected: `4`, and one line naming the check.

Then confirm the seams rule was **not** duplicated into the bundle's testing rules:

```bash
grep -n "seam" /d/6__Work/AI_Projects/claude-config/payload/rules-src/testing.md || echo "testing.md untouched, as designed"
```

Expected: `testing.md untouched, as designed`.

- [ ] **Step 5: Commit**

```bash
git add transform/deltas/010-design-records.patch
git commit -m "delta: seams, Out of Scope, glossary and ADRs in the design step"
```

---

### Task 6: Publish the fork and deploy the bundle

**Files:**
- Modify: `transform/config.json` (`version.revision`)

**Interfaces:**
- Consumes: Task 5.
- Produces: `6.2.0-up.3` installed, and the bundle's new library and hook lib deployed to `~/.claude`.

- [ ] **Step 1: Bump, rebuild, verify, push**

```bash
cd /d/6__Work/AI_Projects/ultrapowers
# transform/config.json: "revision": 2 -> 3
git add transform/config.json
git commit -m "transform: revision 3 - design records in the design step"
node transform/build-cli.mjs commit
node transform/build-cli.mjs drift
git push origin patch main
```

Expected: `main -> <sha>`, then `main is exactly what original + patch produce`.

- [ ] **Step 2: Deploy the bundle and verify the cross-directory import resolves**

```bash
cd /d/6__Work/AI_Projects/claude-config
node setup.mjs
node ~/.claude/skills/update-changelog/scripts/list-workspaces.mjs --root . | head -c 80
node ~/.claude/hooks/lib/stack-rules-check.mjs .
```

Expected: the changelog script prints JSON (proving `../../../bin/lib/workspaces.mjs` resolves under `~/.claude`), and the check prints `"status": "legacy"` for this repository.

A `Cannot find module` from either command means `payload/bin/lib/workspaces.mjs` did not deploy — check `variants.json` for an exclude rule that catches `bin/lib/**` before assuming the import path is wrong.

- [ ] **Step 3: Run the full bundle test suite**

Run: `node --test payload/ *.test.mjs`
Expected: every test passing, including the two new files.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: deploy design records and workspace-aware stack rules"
```

---

## Self-Review

**Spec coverage.** Delta 007 spec (now 010): hunk A's Testing Decisions and Out of Scope (Task 5), hunk B's Glossary and ADR (Task 5), the marker comment in delta 006's style (Task 5), the `parsePatch`-not-`git apply` acceptance test (Task 5 Steps 3–4), the open decision on spec location (resolved in plan #1, Task 3). Stack-rules spec: the trigger moves to design time (Task 5 hunk 1), `stackFingerprint` compared and `sourceHash` excluded (Task 3), risk 2's monorepo blindness (Task 2), risk 3's one-snapshot-several-stacks (Task 4), risk 4's symmetric drift (Task 3), the "rules only for what was detected" rule (Task 4), the seams/`testing.md` split held apart (Task 5 Step 4).

**Deliberately not covered here.** The `risks`, `adr` and `glossary` CLIs; the nudge hook; retrospective ADRs; anything in `session-init.mjs`, whose existence-only check stays exactly as it is; automatic editing of `rules-src/` itself.

**Type consistency.** `listWorkspaces(root)` returns the same object shape the old CLI printed, asserted in Task 1 Step 6. `detectMarkersByWorkspace` returns `Record<string, string[]>` and is the sole input to both `computeStackFingerprint` and `diffMarkers`. `checkStackRules` returns one object shape across all four statuses — `added` and `removed` always present, empty when not `stale`, so no caller needs an existence check.

**One thing a reviewer should push on.** Task 3 makes every existing snapshot report `legacy`, which means the check is silent on every project until each is rebuilt once. That is deliberate — the alternative is a drift report on first contact everywhere, which is what got the check disabled in the first place — but it does mean the feature delivers nothing until `/init-stack` runs per project. If that trade is wrong, the place to change it is `checkStackRules`'s legacy branch, not the fingerprint.
