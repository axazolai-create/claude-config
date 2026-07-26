# /pnpm-phantom-fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm-gated skill `/pnpm-phantom-fix` that, after any pnpm install, detects packages importing undeclared-but-installed modules (phantom deps like `@hookform/resolvers`→`zod`) and auto-adds optional-peer `packageExtensions` to `pnpm-workspace.yaml`, so pnpm links them by the graph — making `enableGlobalVirtualStore=true` safe.

**Architecture:** A pure detection lib + a scan CLI walk all `node_modules` trees, find undeclared imports whose package IS installed, and additively write `packageExtensions[P][Q]` as an optional peer. A self-gating PostToolUse hook runs the scan after Claude-invoked pnpm installs; a root `postinstall` (installed per-project) covers the user's own terminal. Both the hook and the postinstall are wired into a project ONLY when `/init-stack` detects pnpm.

**Tech Stack:** Node ≥20 stdlib only (`node:fs`, `node:path`, `node:module`), `node --test`. No npm dependencies (Node has no stdlib YAML parser → a minimal, fail-safe, line-oriented handler manages only the `packageExtensions` subtree).

## Global Constraints

- **No npm dependencies** — Node stdlib only in every `.mjs`.
- **Additive-only, never destructive** — the scan and installer only ADD; they never remove or rewrite existing `packageExtensions` entries, hook entries, or `postinstall` content. Uninstall-safety is structural (no removal path exists).
- **`devDependencies` are NOT "declared"** for phantom purposes — a consumer install does not install a package's devDeps, so an import satisfied only by a devDep IS a phantom (e.g. `@hookform/resolvers` lists `zod` only in `devDependencies`). Declared = `dependencies` ∪ `peerDependencies` ∪ `optionalDependencies` ∪ `{self name}` ∪ `bundledDependencies`.
- **Only flag installed phantoms** — report `P→Q` only when `Q` is actually resolvable somewhere in the workspace (a real by-luck phantom), not a genuinely-absent optional adapter.
- **Fix form: optional peer** — `peerDependencies: {Q: "*"}` + `peerDependenciesMeta: {Q: {optional: true}}`.
- **Fail-safe YAML** — if `pnpm-workspace.yaml` can't be safely parsed by the minimal handler, do NOT write; print the entries for manual addition.
- **Fail-open trigger** — the hook never blocks a tool; any error → silent.
- **pnpm-gated wiring** — hook + postinstall are added to a project only when pnpm is detected (`pnpm-lock.yaml`/`pnpm-workspace.yaml`).
- Repo sources only (edit `payload/…` and repo root); English throughout.

## File Structure

- Create `payload/bin/lib/pnpm-phantom-lib.mjs` — pure detection helpers.
- Create `payload/bin/lib/pnpm-phantom-lib.test.mjs`.
- Create `payload/bin/lib/pnpm-workspace-yaml.mjs` — minimal additive packageExtensions handler.
- Create `payload/bin/lib/pnpm-workspace-yaml.test.mjs`.
- Create `payload/bin/pnpm-phantom-scan.mjs` — scan CLI (FS + lib).
- Create `payload/hooks/pnpm-phantom-fix-hook.mjs` — PostToolUse Bash hook.
- Create `payload/hooks/pnpm-phantom-fix-hook.test.mjs` — command-parse tests.
- Create `payload/bin/pnpm-phantom-fix-install.mjs` — per-project wiring installer.
- Create `payload/bin/pnpm-phantom-fix-install.test.mjs`.
- Create `payload/commands/pnpm-phantom-fix.md` — the `/pnpm-phantom-fix` command.
- Modify `payload/commands/init-stack.md` — pnpm-gated wiring step.
- Modify `RISK_REGISTER.md` — RISK-PNPM-001..003.

---

## Task 1: Pure detection lib

**Files:** Create `payload/bin/lib/pnpm-phantom-lib.mjs`; Test `payload/bin/lib/pnpm-phantom-lib.test.mjs`

**Interfaces — Produces:**
- `pkgNameFromSpecifier(spec: string) -> string | null`
- `extractBareImports(src: string) -> Set<string>`
- `declaredDeps(pkg: object) -> Set<string>`  (EXCLUDES devDependencies)
- `phantomsForPackage(pkg: object, importedNames: Set<string>, installedNames: Set<string>) -> string[]`

- [ ] **Step 1: Write the failing test**

```js
// payload/bin/lib/pnpm-phantom-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pkgNameFromSpecifier, extractBareImports, declaredDeps, phantomsForPackage } from "./pnpm-phantom-lib.mjs";

test("pkgNameFromSpecifier reduces to package name, drops builtins/relative", () => {
  assert.equal(pkgNameFromSpecifier("zod"), "zod");
  assert.equal(pkgNameFromSpecifier("zod/lib/index"), "zod");
  assert.equal(pkgNameFromSpecifier("@hookform/resolvers/zod"), "@hookform/resolvers");
  assert.equal(pkgNameFromSpecifier("./local"), null);
  assert.equal(pkgNameFromSpecifier("/abs"), null);
  assert.equal(pkgNameFromSpecifier("node:fs"), null);
  assert.equal(pkgNameFromSpecifier("fs"), null);
  assert.equal(pkgNameFromSpecifier("path"), null);
});

test("extractBareImports finds import/require/export-from/dynamic-import", () => {
  const src = `import z from 'zod';\nconst y = require("yup");\nexport * from '@scope/pkg/sub';\nawait import('joi');\nimport './rel';\nimport n from 'node:path';`;
  assert.deepEqual([...extractBareImports(src)].sort(), ["@scope/pkg", "joi", "yup", "zod"]);
});

test("declaredDeps excludes devDependencies (zod-only-in-dev is NOT declared)", () => {
  const pkg = { name: "@hookform/resolvers", peerDependencies: { "react-hook-form": "^7" }, devDependencies: { zod: "^3.25.0" } };
  const d = declaredDeps(pkg);
  assert.ok(d.has("react-hook-form"));
  assert.ok(d.has("@hookform/resolvers")); // self
  assert.ok(!d.has("zod")); // dev-only => NOT declared
});

test("phantomsForPackage flags undeclared+installed, skips declared/self/absent", () => {
  const pkg = { name: "@hookform/resolvers", peerDependencies: { "react-hook-form": "^7" }, devDependencies: { zod: "^3.25.0" } };
  const imported = new Set(["zod", "yup", "react-hook-form", "@hookform/resolvers"]);
  const installed = new Set(["zod", "react-hook-form"]); // yup not installed
  assert.deepEqual(phantomsForPackage(pkg, imported, installed), ["zod"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/bin/lib/pnpm-phantom-lib.test.mjs`  → FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```js
// payload/bin/lib/pnpm-phantom-lib.mjs
import { builtinModules } from "node:module";

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => "node:" + m)]);

export function pkgNameFromSpecifier(spec) {
  if (!spec || spec.startsWith(".") || spec.startsWith("/")) return null;
  if (spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (!name || BUILTINS.has(name)) return null;
  return name;
}

export function extractBareImports(src) {
  const out = new Set();
  const patterns = [
    /\bimport\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g, // import ... from 'x' | import 'x'
    /\bexport\s+[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,       // export ... from 'x'
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,             // require('x')
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,              // import('x')
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) {
      const n = pkgNameFromSpecifier(m[1]);
      if (n) out.add(n);
    }
  }
  return out;
}

export function declaredDeps(pkg) {
  const s = new Set();
  for (const f of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    if (pkg && pkg[f] && typeof pkg[f] === "object") for (const k of Object.keys(pkg[f])) s.add(k);
  }
  if (pkg && pkg.name) s.add(pkg.name);
  if (pkg && Array.isArray(pkg.bundledDependencies)) for (const k of pkg.bundledDependencies) s.add(k);
  return s;
}

export function phantomsForPackage(pkg, importedNames, installedNames) {
  const declared = declaredDeps(pkg);
  const phantoms = [];
  for (const q of importedNames) {
    if (q === pkg?.name) continue;
    if (declared.has(q)) continue;
    if (!installedNames.has(q)) continue;
    phantoms.push(q);
  }
  return phantoms.sort();
}
```

- [ ] **Step 4: Run test to verify it passes** — `node --test payload/bin/lib/pnpm-phantom-lib.test.mjs` → 4 pass.
- [ ] **Step 5: Commit** — `feat(pnpm-phantom): pure detection lib (specifier/import/declared/phantom)`.

---

## Task 2: Minimal additive `packageExtensions` YAML handler

**Files:** Create `payload/bin/lib/pnpm-workspace-yaml.mjs`; Test `payload/bin/lib/pnpm-workspace-yaml.test.mjs`

**Interfaces — Produces:**
- `addOptionalPeers(yamlText: string, additions: Map<string, string[]>) -> { text: string, added: Array<[string,string]>, skipped: Array<[string,string]>, safe: boolean }`
  - Additive: for each `P → [Q,...]`, ensure `packageExtensions[P]` declares `Q` as an optional peer. Never rewrites existing lines except inserting new ones. `safe:false` (with `text` unchanged) if the existing `packageExtensions` block uses a shape the handler can't safely edit (flow/JSON-style, anchors, tabs) — caller then prints for manual add.

The handler targets the canonical block-style pnpm writes:
```yaml
packageExtensions:
  "@hookform/resolvers":
    peerDependencies:
      zod: "*"
    peerDependenciesMeta:
      zod:
        optional: true
```

- [ ] **Step 1: Write the failing test**

```js
// payload/bin/lib/pnpm-workspace-yaml.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { addOptionalPeers } from "./pnpm-workspace-yaml.mjs";

test("creates packageExtensions block when absent", () => {
  const r = addOptionalPeers("packages:\n  - 'apps/*'\n", new Map([["@hookform/resolvers", ["zod"]]]));
  assert.equal(r.safe, true);
  assert.deepEqual(r.added, [["@hookform/resolvers", "zod"]]);
  assert.match(r.text, /packageExtensions:/);
  assert.match(r.text, /"@hookform\/resolvers":/);
  assert.match(r.text, /peerDependenciesMeta:/);
  assert.match(r.text, /optional:\s*true/);
});

test("idempotent: does not re-add an existing P->Q", () => {
  const first = addOptionalPeers("packages: []\n", new Map([["@hookform/resolvers", ["zod"]]])).text;
  const second = addOptionalPeers(first, new Map([["@hookform/resolvers", ["zod"]]]));
  assert.deepEqual(second.added, []);
  assert.deepEqual(second.skipped, [["@hookform/resolvers", "zod"]]);
  assert.equal(second.text, first);
});

test("fail-safe on flow-style packageExtensions (no write)", () => {
  const flow = "packageExtensions: { '@a/b': { peerDependencies: { zod: '*' } } }\n";
  const r = addOptionalPeers(flow, new Map([["@a/b", ["yup"]]]));
  assert.equal(r.safe, false);
  assert.equal(r.text, flow); // unchanged
});
```

- [ ] **Step 2: Run — FAIL (module missing).**
- [ ] **Step 3: Implement** — `payload/bin/lib/pnpm-workspace-yaml.mjs`:

```js
// Minimal, additive-only handler for the packageExtensions subtree of pnpm-workspace.yaml.
// Node has no stdlib YAML parser and npm deps are forbidden, so this handles ONLY the
// canonical block-style shape pnpm writes. Anything it can't safely edit => safe:false, no write.
const q = (name) => (/^[A-Za-z0-9_.-]+$/.test(name) ? name : `"${name}"`); // quote scoped/special keys

function findBlock(lines, key) {
  // returns {start, end} line indices of a top-level `key:` block (its indented children), or null
  const i = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}:`));
  if (i < 0) return null;
  if (lines[i].trim() !== `${key}:`) return { flow: true, start: i, end: i }; // inline/flow value
  let end = i + 1;
  while (end < lines.length && (lines[end].trim() === "" || /^\s+/.test(lines[end]))) end++;
  return { flow: false, start: i, end };
}

export function addOptionalPeers(yamlText, additions) {
  if (/\t/.test(yamlText)) return { text: yamlText, added: [], skipped: [], safe: false };
  const nl = yamlText.includes("\r\n") ? "\r\n" : "\n";
  let lines = yamlText.split(/\r?\n/);
  const blk = findBlock(lines, "packageExtensions");
  if (blk && blk.flow) return { text: yamlText, added: [], skipped: [], safe: false };

  // build the current set of P->Q optional peers present, by scanning the block text
  const blockText = blk ? lines.slice(blk.start, blk.end).join("\n") : "";
  const has = (P, Q) => {
    // crude but safe: within the block, look for the P key then a Q: under peerDependenciesMeta
    const pIdx = blockText.search(new RegExp(`^\\s{2}(?:"${P.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"|${P.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}):`, "m"));
    if (pIdx < 0) return false;
    const after = blockText.slice(pIdx);
    const nextP = after.slice(1).search(/^\s{2}\S/m);
    const pBody = nextP < 0 ? after : after.slice(0, nextP + 1);
    return new RegExp(`peerDependenciesMeta:[\\s\\S]*?\\b${Q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}:\\s*$`, "m").test(pBody)
        || new RegExp(`\\b${Q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}:\\s*['"]?\\*`, "m").test(pBody);
  };

  const added = [], skipped = [];
  const newEntries = []; // full P-blocks to append (only for P not already present)
  // NOTE: for simplicity and safety, if P already exists we only ADD when Q missing by
  // appending a fresh P-block is unsafe (dup key). So: if P exists but Q missing, we FAIL SAFE
  // for that pair (report skipped-needs-manual) rather than risk a duplicate mapping key.
  const pExists = (P) => new RegExp(`^\\s{2}(?:"${P.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"|${P.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}):`, "m").test(blockText);

  for (const [P, qs] of additions) {
    for (const Q of qs) {
      if (has(P, Q)) { skipped.push([P, Q]); continue; }
      if (pExists(P)) { skipped.push([P, Q]); continue; } // manual: P present, avoid dup-key
      added.push([P, Q]);
    }
  }
  // group added by P into fresh blocks
  const byP = new Map();
  for (const [P, Q] of added) { if (!byP.has(P)) byP.set(P, []); byP.get(P).push(Q); }
  for (const [P, qs] of byP) {
    const b = [`  ${q(P)}:`, `    peerDependencies:`];
    for (const Q of qs) b.push(`      ${q(Q)}: "*"`);
    b.push(`    peerDependenciesMeta:`);
    for (const Q of qs) b.push(`      ${q(Q)}:`, `        optional: true`);
    newEntries.push(...b);
  }

  if (!newEntries.length) return { text: yamlText, added: [], skipped, safe: true };

  if (!blk) {
    // append a new top-level packageExtensions block at EOF
    const pad = yamlText.endsWith("\n") || yamlText === "" ? "" : nl;
    const text = yamlText + pad + `packageExtensions:` + nl + newEntries.join(nl) + nl;
    return { text, added, skipped, safe: true };
  }
  // insert new entries at the end of the existing block
  const before = lines.slice(0, blk.end);
  const after = lines.slice(blk.end);
  const text = [...before, ...newEntries, ...after].join(nl);
  return { text, added, skipped, safe: true };
}
```

- [ ] **Step 4: Run — 3 pass.**
- [ ] **Step 5: Commit** — `feat(pnpm-phantom): minimal additive packageExtensions YAML handler`.

> NOTE: the "P exists but Q missing → skip for manual" rule keeps the handler from ever producing a duplicate mapping key. Real-world P blocks are rare and usually created by this tool, so a fresh full block is the common path. The command/report surfaces `skipped` pairs so the user can add them by hand when P pre-exists.

---

## Task 3: Scan CLI `payload/bin/pnpm-phantom-scan.mjs`

**Files:** Create `payload/bin/pnpm-phantom-scan.mjs`

**Interfaces — Consumes:** Task 1 lib, Task 2 handler. **Produces:** CLI `node pnpm-phantom-scan.mjs [--packages a,b,c] [--root <dir>]` — scans, writes, reports; exit 0.

**Behavior (implement exactly):**
1. Resolve workspace root: from `--root` or cwd, walk up to the nearest dir containing `pnpm-workspace.yaml`; if none, use the nearest dir with `pnpm-lock.yaml`; else the start dir.
2. Enumerate installed packages: recursively find every `package.json` under the root's `node_modules` trees, INCLUDING the `.pnpm/<name>@<ver>/node_modules/<name>/package.json` real copies and every workspace package's `node_modules`. Skip `node_modules` nested inside a package's own `node_modules` beyond the `.pnpm` real copy to bound cost. Build `installedNames` = set of all package `name`s found.
3. For each installed package `P`: read its `package.json`; gather its runtime source files (`*.js|*.mjs|*.cjs|*.jsx` within the package dir, excluding nested `node_modules`; cap per-package file count/size for performance); `extractBareImports` across them (union); `phantomsForPackage(pkg, imported, installedNames)`.
4. Scope filter: if `--packages` given, restrict the set of scanned `P` to those names ∪ their transitive deps (walk `dependencies`/`peerDependencies`/`optionalDependencies` from the given packages over the installed manifests).
5. Build `additions: Map<P, Q[]>` from all phantoms found.
6. Read `pnpm-workspace.yaml` (create empty if absent), `addOptionalPeers`. If `safe`, write the file back (only if `added.length`); else print the entries for manual add.
7. Report: list `added` (`P → Q (optional peer)`), any `skipped` needing manual add, and if anything added: `→ run \`pnpm install\` again to apply`. If nothing: `No phantom dependencies found.`

- [ ] **Step 1: Implement per the behavior above** (complete code; stdlib `fs`/`path` only; use the two libs).
- [ ] **Step 2: Verify with a fixture** — create a temp workspace: `pnpm-workspace.yaml`, `node_modules/@hookform/resolvers/{package.json (peerDeps react-hook-form; devDeps zod), zod/dist/zod.mjs with `import 'zod'`}`, `node_modules/zod/package.json (name zod)`, `node_modules/react-hook-form/package.json`. Run the scan → asserts `packageExtensions` now has `@hookform/resolvers` → `zod` optional peer; `react-hook-form` NOT added (declared); a not-installed import NOT added. Re-run → nothing added (idempotent). Clean up temp.
- [ ] **Step 3: Commit** — `feat(pnpm-phantom): node_modules scan CLI with additive write + scope`.

---

## Task 4: PostToolUse hook `payload/hooks/pnpm-phantom-fix-hook.mjs`

**Files:** Create `payload/hooks/pnpm-phantom-fix-hook.mjs`; Test `payload/hooks/pnpm-phantom-fix-hook.test.mjs`

**Interfaces — Produces (exported for tests):** `classifyPnpmCommand(cmd: string) -> { run: boolean, packages: string[] | null }` — `run:true` only for install-family; `packages` non-null for targeted `add`/`i <pkgs>`, null for full install; `run:false` for remove/uninstall/rm/dlx/exec/run/etc.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/pnpm-phantom-fix-hook.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPnpmCommand } from "./pnpm-phantom-fix-hook.mjs";

test("classifies install-family and scope", () => {
  assert.deepEqual(classifyPnpmCommand("pnpm install"), { run: true, packages: null });
  assert.deepEqual(classifyPnpmCommand("pnpm i"), { run: true, packages: null });
  assert.deepEqual(classifyPnpmCommand("pnpm add zod react"), { run: true, packages: ["zod", "react"] });
  assert.deepEqual(classifyPnpmCommand("pnpm i -w @hookform/resolvers"), { run: true, packages: ["@hookform/resolvers"] });
  assert.equal(classifyPnpmCommand("pnpm remove zod").run, false);
  assert.equal(classifyPnpmCommand("pnpm uninstall zod").run, false);
  assert.equal(classifyPnpmCommand("pnpm rm zod").run, false);
  assert.equal(classifyPnpmCommand("pnpm run build").run, false);
  assert.equal(classifyPnpmCommand("npm install").run, false); // pnpm only
  assert.equal(classifyPnpmCommand("echo pnpm install").run, false); // not a leading pnpm cmd
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — parse the command; export `classifyPnpmCommand`; in the hook body (only when invoked as the hook, guarded like Task 9 of the neo4j feature via `pathToFileURL`): read the PostToolUse JSON from stdin, extract `tool_input.command` and cwd, `classifyPnpmCommand`, self-gate on a `pnpm-lock.yaml`/`pnpm-workspace.yaml` at/above cwd, and if `run`, spawn `node <dir>/pnpm-phantom-scan.mjs [--packages …] --root <cwd>` and emit its output as `additionalContext`. Fail-open (wrap everything; any throw → exit 0, no output). `classifyPnpmCommand` rules: split the command on `&&`/`;`/`|`; a segment matches if its first token is `pnpm`/`pnpm.cmd` and the subcommand ∈ {install, i, add}; strip flags (`-w`, `--filter …`, `-D`, `--save-dev`, etc.) to get package positionals; `add`/`i`-with-positionals → `packages`, bare `install`/`i` → `null`.

- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Commit** — `feat(pnpm-phantom): self-gating PostToolUse hook`.

---

## Task 5: Per-project installer `payload/bin/pnpm-phantom-fix-install.mjs`

**Files:** Create `payload/bin/pnpm-phantom-fix-install.mjs`; Test `payload/bin/pnpm-phantom-fix-install.test.mjs`

**Interfaces — Produces (exported):** `isPnpmProject(root) -> boolean`; `addPostinstall(pkgJsonObj) -> {changed, obj}` (append the scan to root `postinstall`, no dup); `addHookToSettings(settingsObj) -> {changed, obj}` (add the PostToolUse Bash hook entry, no dup). CLI `node pnpm-phantom-fix-install.mjs <projectRoot>`.

- [ ] **Step 1: Write failing test** covering: `isPnpmProject` true when `pnpm-workspace.yaml` or `pnpm-lock.yaml` present; `addPostinstall` adds when absent, appends with `&&` when present, no-op when already contains the scan; `addHookToSettings` adds the hook once and is idempotent (second call `changed:false`). (Use temp dirs / plain objects.)
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement:** `isPnpmProject(root)` walks up for the lockfiles. CLI: if `!isPnpmProject` → print `not a pnpm project, skipping` + exit 0. Else read `<root>/package.json` → `addPostinstall` (postinstall runs `node ~/.claude/bin/pnpm-phantom-scan.mjs`) → write back; read/create `<root>/.claude/settings.json` → `addHookToSettings` (PostToolUse Bash → `node <HOME>/.claude/hooks/pnpm-phantom-fix-hook.mjs`, matching the shape in settings.partial.json) → write back. Idempotent, additive, English output of what changed.
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Commit** — `feat(pnpm-phantom): pnpm-gated per-project installer (hook + postinstall)`.

---

## Task 6: Command `payload/commands/pnpm-phantom-fix.md`

**Files:** Create `payload/commands/pnpm-phantom-fix.md`

- [ ] **Step 1: Write the command** with frontmatter:
```markdown
---
description: Detect pnpm phantom dependencies (undeclared-but-imported, e.g. @hookform/resolvers→zod) and additively declare them as optional peers in packageExtensions, so an out-of-tree store (enableGlobalVirtualStore) resolves them.
allowed-tools: Bash(node *), Bash(pnpm *), Read, Edit, Write
---
```
Body (prose the agent follows): (1) confirm this is a pnpm project (else stop). (2) Run `node ~/.claude/bin/pnpm-phantom-scan.mjs --root <project root>`; show its report. (3) If entries were added, remind: run `pnpm install` to apply the new peer links. (4) Offer to install the always-on trigger for this project: `node ~/.claude/bin/pnpm-phantom-fix-install.mjs <project root>` (adds the PostToolUse hook + root postinstall) — consent-gated. (5) Note the sub-package-install coverage caveat.
- [ ] **Step 2: Verify** `grep -n "pnpm-phantom-scan" payload/commands/pnpm-phantom-fix.md`.
- [ ] **Step 3: Commit** — `feat(pnpm-phantom): /pnpm-phantom-fix command`.

---

## Task 7: pnpm-gated wiring step in `init-stack.md`

**Files:** Modify `payload/commands/init-stack.md`

- [ ] **Step 1:** Read `init-stack.md`; near the existing pnpm/monorepo step (the `fallow` step that checks `pnpm-workspace.yaml`/`turbo`/`nx`, ~lines 178-186), add a new step:
```markdown
### Step N - pnpm phantom-dependency guard (only if pnpm)
Only if this project uses pnpm (a `pnpm-lock.yaml` or `pnpm-workspace.yaml` at/above root).
With my consent, wire the phantom-dependency guard so an out-of-tree store
(`enableGlobalVirtualStore`) can't break undeclared imports:
`node ~/.claude/bin/pnpm-phantom-fix-install.mjs <project root>`
This adds a PostToolUse hook (runs after Claude-invoked `pnpm install`/`add`) and a root
`postinstall` (covers my own terminal), both idempotent. For a non-pnpm project, skip entirely.
```
- [ ] **Step 2: Verify** `grep -n "pnpm-phantom-fix-install" payload/commands/init-stack.md`.
- [ ] **Step 3: Commit** — `feat(init-stack): wire pnpm phantom guard when pnpm detected`.

---

## Task 8: Risk register

**Files:** Modify `RISK_REGISTER.md`

- [ ] **Step 1:** Append `RISK-PNPM-001` (false positives from dynamic/conditional imports — mitigated by the installed-in-workspace gate + optional-peer harmlessness + additive-only), `RISK-PNPM-002` (native-trigger coverage gap for sub-package installs in the user's own terminal — Claude hook + manual command backstop), `RISK-PNPM-003` (auto-writing pnpm-workspace.yaml — minimal additive handler with fail-safe on unparseable shapes). Use the register's `## RISK-<AREA>-NNN` + Status/Context/Mitigation/Residual format.
- [ ] **Step 2: Commit** — `docs(risk): register pnpm phantom-fix risks (RISK-PNPM-001..003)`.

---

## Self-Review

- Spec coverage: C1→T1+T3; YAML→T2; C2 hook→T4; C3+C6 installer→T5; C4 command→T6; C6 init-stack→T7; risks→T8; C5 (setup deploys files, no global wiring) is inherent (no settings.partial.json change — deliberately absent). ✓
- Placeholder scan: none; the `<project root>`/`<HOME>` are runtime path placeholders. ✓
- Type consistency: `additions: Map<P, Q[]>` produced by T3, consumed by T2 `addOptionalPeers`; `classifyPnpmCommand` shape shared T4 impl/test; installer exports shared T5 impl/test. ✓
- Critical correctness locked by tests: devDependencies excluded (T1), installed-gate (T1/T3), idempotent+fail-safe YAML (T2), install-family-only classification (T4), idempotent wiring (T5).
