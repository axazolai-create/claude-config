# Lite Bundle Variant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `setup.mjs` installs one of two bundle variants (full/lite) declared in `variants.json`, switches between them safely (prune surplus, never touch foreign files), reconciles plugins, and ships lite overlay files (CLAUDE.md, /init-stack, cleaned rules-src README).

**Architecture:** Single `payload/` stays the full bundle. `variants.json` (repo root) declares lite via include/exclude globs + per-variant plugin sets; `payload-lite/` overlays files that differ. A pure resolver (`variants.mjs`) computes the variant file set and is shared by `setup.mjs` and the test suite. `session-init.mjs` becomes variant-aware via the `variant` field persisted in `bundle-manifest.json`.

**Tech Stack:** Node ≥18, zero npm dependencies, ESM `.mjs`, `node --test`. Spec: `.ultrapowers/archive/specs/2026-07-22-lite-variant-design.md` (APPROVED — authoritative for all content below).

## Global Constraints

- Zero npm dependencies; only `node:` builtins.
- All new code ESM `.mjs`; tests via `node --test`; existing `payload/**/*.test.mjs` must keep passing.
- Conventional Commits; branch `feat/lite-variant` off `master`.
- Docs/config files in English.
- `docs/` is gitignored — the spec/plan stay local; never `git add -f` them.
- Never touch foreign files in `~/.claude`: `settings.local.json`, `projects/`, `memory/`, `skills/graphify/`, user plugins outside `managedPlugins`.
- Lite hook set is exactly 6 scripts: secrets-gate, deny-curated-claude-md, graphify-global-sync, leanmode-subagent, token-usage-log, session-init. No `statusLine` in lite.
- Forbidden-token list (rules-src purity guard, lite scope): `gsd`, `init-stack.py`, `setting-templates`, `neo4j`, `pnpm-phantom`, `db-live-access`, `ci-watch`, `schedulewakeup`, `stack-markers`, `worktree-executor-discipline`, `bg-supervision`, `supervise-bg`, `task-lifecycle-probe`, `init-mcp`.
- Marketplace ids in `managedPlugins` must be read from the real machine (`claude plugin list` / user `settings.json` `enabledPlugins` keys) — never invented.

---

### Task 1: Variant resolver (`variants.mjs`) + `variants.json` + classification/orphan tests

**Files:**
- Create: `variants.json`
- Create: `variants.mjs`
- Test: `variants.test.mjs`

**Interfaces:**
- Produces (later tasks rely on these exact exports from `variants.mjs`):
  - `loadVariants(repoRoot) -> {managedPlugins: Object, variants: Object}`
  - `globToRe(glob: string) -> RegExp` (anchored; `**` = any path incl. `/`, `*` = any chars except `/`)
  - `resolveVariant({repoRoot, variant}) -> { name, rels: string[], srcFor(rel)->absPath, excludedSet: Set<string>, uncovered: string[], orphanOverlay: string[], plugins: string[] }`
  - `filterPartialHooks(partialHooks, variantBasenames: Set<string>) -> Object` (drops hook entries whose script basenames are not all in the variant set; drops now-empty events)

- [ ] **Step 1: branch**

```bash
git checkout -b feat/lite-variant
```

- [ ] **Step 2: Write `variants.json`** (repo root). Content = spec § 3 verbatim, with two implementation details: fill real marketplace ids for `gsd`/`context-mode` by inspecting the machine (`claude plugin list` output and/or `enabledPlugins` keys in `~/.claude/settings.json`) — if unavailable offline, use the same `name@claude-plugins-official` shape as the two known ids and flag it in the commit message; drop the `$comment` about globs if json parsing of comments is a concern (it is a plain string key, valid JSON — keep it).

```json
{
  "$comment": "Variant definitions for setup.mjs. Globs are relative to payload/. exclude wins over include.",
  "managedPlugins": {
    "superpowers":  "superpowers@claude-plugins-official",
    "gsd":          "<verified id>",
    "context-mode": "<verified id>",
    "context7":     "context7@claude-plugins-official"
  },
  "variants": {
    "full": { "plugins": ["superpowers", "gsd", "context-mode", "context7"] },
    "lite": {
      "plugins": ["superpowers", "context-mode", "context7"],
      "overlay": "payload-lite",
      "include": [
        "CLAUDE.md", "add-risk.mjs", "graphify-sync-all.mjs",
        "agents/leanmode-executor.md",
        "bin/graphify-freshness*", "bin/graphify-setup.mjs",
        "bin/lib/config-dir-validate*", "bin/lib/entrypoint-guard.test.mjs",
        "commands/init-stack.md", "commands/leanmode.md",
        "hooks/secrets-gate.mjs", "hooks/deny-curated-claude-md.mjs",
        "hooks/token-usage-log.mjs", "hooks/session-init.mjs",
        "hooks/graphify-global-sync.mjs", "hooks/leanmode-subagent.mjs",
        "hooks/lib/config-update-check-run.mjs", "hooks/lib/graphify-global-sync-run.mjs",
        "hooks/lib/leanmode-*", "hooks/lib/mark-initstack-done.mjs",
        "hooks/lib/stack-rules-check.mjs", "hooks/lib/token-usage-*",
        "rules-src/**",
        "skills/model-selection-policy/**", "skills/token-usage/**", "skills/update-changelog/**"
      ],
      "exclude": [
        "agents/gsd-*.md", "apply-gsd-agent-patches.mjs", "gsd-defaults-sync.mjs",
        "graphify-neo4j.cypher",
        "bin/init-stack.py", "bin/test_init_stack.py", "bin/__pycache__/**",
        "bin/graphify-neo4j-*", "bin/lib/neo4j-config*",
        "bin/lib/pnpm-*", "bin/lib/turbopack-gvs-*",
        "bin/pnpm-phantom-*", "bin/turbopack-gvs-check.mjs",
        "bin/supervise-bg.mjs", "bin/lib/supervise-lib*",
        "commands/init-mcp.md", "commands/init-session.md", "commands/pnpm-phantom-fix.md",
        "hooks/db-live-access-gate.mjs", "hooks/ci-watch-nudge*",
        "hooks/schedulewakeup-loop-only-nudge*",
        "hooks/bg-supervision-nudge*", "hooks/task-lifecycle-probe*",
        "hooks/gsd-*", "hooks/lib/gsd-*",
        "hooks/lib/context-mode-gsd-agents.mjs",
        "hooks/pnpm-phantom-fix-hook*",
        "hooks/worktree-executor-discipline-advisor.mjs",
        "references/**", "rules-src/gsd.md",
        "skills/stack-markers/**", "skills/using-git-worktrees/**",
        "setting-templates/**"
      ]
    }
  }
}
```

- [ ] **Step 3: Write the failing tests** in `variants.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVariants, globToRe, resolveVariant, filterPartialHooks } from "./variants.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

test("globToRe: * does not cross /, ** does", () => {
  assert.ok(globToRe("hooks/lib/leanmode-*").test("hooks/lib/leanmode-rules.mjs"));
  assert.ok(!globToRe("hooks/*").test("hooks/lib/leanmode-rules.mjs"));
  assert.ok(globToRe("rules-src/**").test("rules-src/templates/next.AGENTS.md"));
  assert.ok(!globToRe("CLAUDE.md").test("payload-lite/CLAUDE.md"));
});

test("classification: every payload file is covered by include ∪ exclude (lite)", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  assert.deepEqual(v.uncovered, [], `unclassified payload files: ${v.uncovered.join(", ")}`);
});

test("overlay: no orphan files in payload-lite/", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  assert.deepEqual(v.orphanOverlay, [], `orphan overlay files: ${v.orphanOverlay.join(", ")}`);
});

test("lite set has no excluded families", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  for (const rel of v.rels) {
    assert.ok(!/^(agents\/gsd-|hooks\/gsd-|hooks\/lib\/gsd-|references\/|setting-templates\/)/.test(rel), rel);
    assert.notEqual(rel, "rules-src/gsd.md");
  }
});

test("full variant is identity over payload/", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "full" });
  assert.ok(v.rels.includes("hooks/gsd-context-meter.mjs"));
  assert.equal(v.excludedSet.size, 0);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `node --test variants.test.mjs`
Expected: FAIL — `Cannot find module ... variants.mjs`

- [ ] **Step 5: Implement `variants.mjs`** (repo root, self-contained, no imports from setup.mjs):

```js
// Variant resolver for setup.mjs and the test suite. Pure logic + fs reads; no side effects.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function loadVariants(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, "variants.json"), "utf8"));
}

// Glob → anchored RegExp. Supports ** (any chars incl. /), * (any chars except /), literal rest.
export function globToRe(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")     // placeholder so single-* rule doesn't eat it
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, ".*");
  return new RegExp(`^${esc}$`);
}

const matchAny = (rel, res) => res.some((re) => re.test(rel));

function walkRels(dir, rel = "") {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.name === "__pycache__" || e.name.endsWith(".pyc")) continue; // mirror walkBundle()
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkRels(join(dir, e.name), childRel));
    else out.push(childRel);
  }
  return out;
}

export function resolveVariant({ repoRoot, variant }) {
  const cfg = loadVariants(repoRoot);
  const def = cfg.variants[variant];
  if (!def) throw new Error(`unknown variant "${variant}" (known: ${Object.keys(cfg.variants).join(", ")})`);
  const payloadDir = join(repoRoot, "payload");
  const payloadRels = walkRels(payloadDir);

  if (!def.include) { // full: identity
    return { name: variant, rels: payloadRels, srcFor: (rel) => join(payloadDir, ...rel.split("/")),
             excludedSet: new Set(), uncovered: [], orphanOverlay: [], plugins: def.plugins };
  }
  const incRes = def.include.map(globToRe);
  const excRes = def.exclude.map(globToRe);
  const rels = [], excluded = [], uncovered = [];
  for (const rel of payloadRels) {
    if (matchAny(rel, excRes)) excluded.push(rel);       // exclude wins over include
    else if (matchAny(rel, incRes)) rels.push(rel);
    else uncovered.push(rel);
  }
  const overlayDir = def.overlay ? join(repoRoot, def.overlay) : null;
  const overlayRels = overlayDir ? walkRels(overlayDir) : [];
  const relSet = new Set(rels);
  const orphanOverlay = overlayRels.filter((r) => !relSet.has(r));
  const overlaySet = new Set(overlayRels);
  const srcFor = (rel) => overlaySet.has(rel)
    ? join(overlayDir, ...rel.split("/"))
    : join(payloadDir, ...rel.split("/"));
  return { name: variant, rels, srcFor, excludedSet: new Set(excluded), uncovered, orphanOverlay, plugins: def.plugins };
}

// Drop hook entries whose script basenames are not all inside the variant set; drop empty events.
export function filterPartialHooks(partialHooks, variantBasenames) {
  const out = {};
  for (const [ev, entries] of Object.entries(partialHooks || {})) {
    const kept = entries.filter((e) => (e.hooks || []).every((h) =>
      (h.args || []).every((a) => variantBasenames.has(String(a).split(/[\\/]/).pop()))));
    if (kept.length) out[ev] = kept;
  }
  return out;
}
```

- [ ] **Step 6: Run tests — orphan test will FAIL** (payload-lite/ doesn't exist yet → `orphanOverlay` is `[]`, that passes; classification may fail if a payload file slipped the globs). Fix `variants.json` globs until classification passes — every fix is a conscious decision, consult spec § 2.2. The `commands/init-session.md` file must land in exclude (it is — verify).

Run: `node --test variants.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add variants.json variants.mjs variants.test.mjs
git commit -m "feat(variants): variant resolver, lite include/exclude map, classification tests"
```

---

### Task 2: Lite overlay content — CLAUDE.md, /init-stack, cleaned rules-src README + purity guard

**Files:**
- Create: `payload-lite/CLAUDE.md`
- Create: `payload-lite/commands/init-stack.md`
- Create: `payload-lite/rules-src/README.md`
- Modify: `variants.test.mjs` (append purity-guard test)

**Interfaces:**
- Consumes: `resolveVariant` from Task 1.
- Produces: the three overlay files later installed by Task 4's overlay-aware `placeFile`.

- [ ] **Step 1: Write the failing purity-guard test** — append to `variants.test.mjs`:

```js
import { readFileSync } from "node:fs";

const FORBIDDEN = [
  "gsd", "init-stack.py", "setting-templates", "neo4j", "pnpm-phantom",
  "db-live-access", "ci-watch", "schedulewakeup", "stack-markers",
  "worktree-executor-discipline", "bg-supervision", "supervise-bg",
  "task-lifecycle-probe", "init-mcp",
];

test("purity: resolved lite rules-src + overlay docs carry no forbidden tokens", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const scope = v.rels.filter((r) => r.startsWith("rules-src/") || r === "CLAUDE.md" || r === "commands/init-stack.md");
  const bad = [];
  for (const rel of scope) {
    const text = readFileSync(v.srcFor(rel), "utf8").toLowerCase();
    for (const tok of FORBIDDEN) if (text.includes(tok)) bad.push(`${rel}: ${tok}`);
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test variants.test.mjs`
Expected: FAIL — `rules-src/README.md: gsd` (lines 26 and 78 of the payload README mention `gsd.md`), plus `CLAUDE.md: gsd` etc. (overlay files don't exist yet → `srcFor` returns the payload versions).

- [ ] **Step 3: Create `payload-lite/CLAUDE.md`** — the spec § 6 text VERBATIM (starts `# USER RULES (~/.claude/CLAUDE.md) — lite variant`, ends with the CONTEXT-MODE section). Copy it from the spec file, do not retype. Add the curated marker as the first line, matching payload/CLAUDE.md's convention:

```
<!-- CURATED:NOEDIT -->
```

(Check `head -3 payload/CLAUDE.md` first — mirror exactly how the full file carries the marker: same position, same spelling.)

- [ ] **Step 4: Create `payload-lite/commands/init-stack.md`** — the spec § 7 text VERBATIM (the fenced markdown block: detection table + assemble + wire steps). Before writing, open `payload/skills/stack-markers/SKILL.md` and reconcile the marker table rows against it — the spec table is representative; the skill is authoritative for row content. Keep the три-step structure and the "Always include testing.md, security.md" line.

- [ ] **Step 5: Create `payload-lite/rules-src/README.md`** — copy `payload/rules-src/README.md`, then two edits:
  - Line ~26 (section "Rule layers"): remove the `gsd.md` clause from the sentence listing conditional rules (keep `api-contracts.md` / `mobile.md`).
  - Line ~78 (section "Current files" table): delete the whole `| gsd.md | GSD projects: .planning/ exists |` row.
  - Then re-grep the copy for every forbidden token (case-insensitive) and scrub any remaining hit the same way (remove the clause/row, never leave a dangling reference).

- [ ] **Step 6: Run tests to verify pass** (purity + orphan: the three new overlay files all correspond to lite rels, so `orphanOverlay` stays empty)

Run: `node --test variants.test.mjs`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add payload-lite/ variants.test.mjs
git commit -m "feat(variants): lite overlay (CLAUDE.md, /init-stack, cleaned rules-src README) + purity guard"
```

---

### Task 3: Variant-aware `session-init.mjs` + import-graph test

**Files:**
- Modify: `payload/hooks/session-init.mjs` (imports at lines 45-49; call sites ~368, ~455-499; RISK_REGISTER and `.planning` steps)
- Modify: `variants.test.mjs` (append import-graph test)

**Interfaces:**
- Consumes: `resolveVariant` (Task 1); `bundle-manifest.json` `variant` field written by Task 4 (until then the field is absent ⇒ session-init treats it as `full` — today's behavior, safe to land first).
- Produces: `session-init.mjs` that never statically imports a lite-excluded file.

- [ ] **Step 1: Write the failing import-graph test** — append to `variants.test.mjs`:

```js
test("import graph: no static import in the lite set resolves to an excluded file", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const relSet = new Set(v.rels);
  const bad = [];
  for (const rel of v.rels) {
    if (!rel.endsWith(".mjs")) continue;
    const text = readFileSync(v.srcFor(rel), "utf8");
    // static imports only: `import ... from "./x.mjs"` / `import "./x.mjs"` at line start
    for (const m of text.matchAll(/^\s*import\s+(?:[^"'\n]+\s+from\s+)?["'](\.[^"']+)["']/gm)) {
      const target = new URL(m[1], `file:///${rel}`).pathname.replace(/^\//, "");
      if (!relSet.has(target)) bad.push(`${rel} -> ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test variants.test.mjs`
Expected: FAIL — `hooks/session-init.mjs -> ./lib/context-mode-gsd-agents.mjs` (+ `./lib/gsd-agent-patches.mjs`, `./lib/gsd-workflow-patches.mjs`)

- [ ] **Step 3: Edit `payload/hooks/session-init.mjs`.** Three edits:

(a) Delete the three static GSD imports (current lines 46-48):

```js
import { syncGsdAgentsContextMode } from "./lib/context-mode-gsd-agents.mjs";
import { checkGsdAgentPatches, checkRetiredGsdAgentPatches, checkRecursiveAgentSpawnGuardrail } from "./lib/gsd-agent-patches.mjs";
import { checkGsdWorkflowPatches } from "./lib/gsd-workflow-patches.mjs";
```

(b) After the existing const/setup block near the top (right after the imports and the `safe`-style helpers are available), add variant detection. Reuse the file's own config-dir resolution (it already computes the claude dir; anchor on however `claudeDir`/`CDIR` is named there):

```js
// Bundle variant (spec: .ultrapowers/archive/specs/2026-07-22-lite-variant-design.md § 5).
// Manifest without the field = pre-variant bundle = full. Lite skips every GSD step below.
const VARIANT = (() => {
  try { return JSON.parse(readFileSync(join(claudeDir, "state", "bundle-manifest.json"), "utf8")).variant || "full"; }
  catch { return "full"; }
})();
const FULL = VARIANT === "full";
```

(c) Gate each full-only step. The GSD block around lines 455-499 currently calls the imported functions directly; wrap the whole block and switch to dynamic imports:

```js
if (FULL) {
  try {
    const { syncGsdAgentsContextMode } = await import("./lib/context-mode-gsd-agents.mjs");
    const { checkGsdAgentPatches, checkRetiredGsdAgentPatches, checkRecursiveAgentSpawnGuardrail } =
      await import("./lib/gsd-agent-patches.mjs");
    const { checkGsdWorkflowPatches } = await import("./lib/gsd-workflow-patches.mjs");
    // ... existing bodies of the sync/patch-check steps, unchanged, moved inside ...
  } catch { /* half-install: skip GSD maintenance, never block the session */ }
}
```

Note: if the file's top-level flow is not inside an async function, `await import()` at top level is legal in ESM — no wrapper needed. Keep each existing `safe(() => ...)` call intact inside the block.

Also gate, with plain `if (FULL) { ... }` around the existing code (no dynamic import needed — these steps don't touch gsd libs):
- the RISK_REGISTER GSD-clobber step (the writer that appends the GSD-clobber entry; discovery helpers at lines ~112-130 can stay unconditional),
- the `.planning/CLAUDE.md` exclude step,
- the `/init-mcp` suggestion block (line ~368 `if (process.env.CLAUDE_MCP_SUGGEST !== "0")` → `if (FULL && process.env.CLAUDE_MCP_SUGGEST !== "0")`).

- [ ] **Step 4: Verify parse + tests**

Run: `node --check payload/hooks/session-init.mjs && node --test variants.test.mjs`
Expected: PASS (import-graph green)

- [ ] **Step 5: Regression: full behavior unchanged** — run whatever session-init self-checks exist:

Run: `node --test payload/hooks`
Expected: PASS (same count as on master)

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/session-init.mjs variants.test.mjs
git commit -m "feat(session-init): variant-aware gating of GSD/init-mcp/risk steps via manifest variant"
```

---

### Task 4: `setup.mjs` — variant selection, resolver-driven install, overlay, manifest.variant

**Files:**
- Modify: `setup.mjs` (top constants ~line 41-75; `placeFile` line 297-300; `main()` install loop line 518-526; manifest write line 858-867)
- Modify: `variants.test.mjs` (append hook-registration static test — it needs `filterPartialHooks` only, no setup.mjs)

**Interfaces:**
- Consumes: `resolveVariant`, `filterPartialHooks` (Task 1).
- Produces: module-scope `VARIANT` (string) and `V` (resolved variant) used by Task 5's prune/merge edits; `bundle-manifest.json` gains `variant`.

- [ ] **Step 1: Write the failing hook-registration test** — append to `variants.test.mjs`:

```js
test("hook registrations: lite keeps exactly the 6 lite hooks and no statusLine", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const partial = JSON.parse(readFileSync(join(ROOT, "settings.partial.json"), "utf8"));
  const basenames = new Set(v.rels.map((r) => r.split("/").pop()));
  const filtered = filterPartialHooks(partial.hooks, basenames);
  const scripts = new Set();
  for (const entries of Object.values(filtered))
    for (const e of entries) for (const h of (e.hooks || []))
      for (const a of (h.args || [])) scripts.add(String(a).split(/[\\/]/).pop());
  assert.deepEqual([...scripts].sort(), [
    "deny-curated-claude-md.mjs", "graphify-global-sync.mjs", "leanmode-subagent.mjs",
    "secrets-gate.mjs", "session-init.mjs", "token-usage-log.mjs",
  ]);
  // statusLine script must NOT be in the lite set (Task 5 uses this fact to drop statusLine)
  assert.ok(!basenames.has("gsd-context-meter.mjs"));
});
```

Run: `node --test variants.test.mjs` → PASS already (pure functions from Task 1) — this test is the *specification lock* for Task 5's merge wiring; keep it.

- [ ] **Step 2: setup.mjs — flag + selection.** After line 71 (`const DRY = ...`) add:

```js
const VARIANT_ARG = (() => {
  const a = [...argv].find((x) => x.startsWith("--variant="));
  return a ? a.slice("--variant=".length) : null;
})();
```

Add the import at the top (next to the `config-dir-validate` import, line 41):

```js
import { resolveVariant, filterPartialHooks, loadVariants } from "./variants.mjs";
```

- [ ] **Step 3: setup.mjs — resolve variant in `main()`.** At the start of `main()` (line 518, right after `await proposeConfigDir();`), insert:

```js
// ---------- variant selection (spec § 9) ----------
const oldManifestEarly = safe(() => JSON.parse(readFileSync(MANIFEST, "utf8")));
const installedVariant = oldManifestEarly ? (oldManifestEarly.variant || "full") : null;
let VARIANT = VARIANT_ARG;
if (VARIANT && !loadVariants(REPO_ROOT).variants[VARIANT]) {
  log(`Unknown --variant=${VARIANT}. Known: ${Object.keys(loadVariants(REPO_ROOT).variants).join(", ")}`);
  process.exit(1);
}
if (!VARIANT && INTERACTIVE) {
  const def = installedVariant || "full";
  const a = (await ask(`  bundle variant [full/lite] (Enter = ${def}) > `)).trim().toLowerCase();
  VARIANT = a === "lite" || a === "full" ? a : def;
}
if (!VARIANT) VARIANT = installedVariant || "full";   // non-TTY: detected, or full on fresh
const V = resolveVariant({ repoRoot: REPO_ROOT, variant: VARIANT });
if (installedVariant && installedVariant !== VARIANT)
  log(`Switching variant: ${installedVariant} -> ${VARIANT} (surplus files listed for removal below)`);
log(`Variant: ${VARIANT} (${V.rels.length} files)`);
```

`VARIANT` and `V` must be visible to `pruneStale()` and the settings merge — hoist them to module scope: declare `let VARIANT = null, V = null;` near line 75 and assign (not re-declare) inside `main()`.

- [ ] **Step 4: setup.mjs — resolver-driven install + overlay.** Change `placeFile` (line 297-300) to accept a source path:

```js
async function placeFile(rel, srcPath) {
  const parts = rel.split("/");
  const src = srcPath || join(SRC, ...parts);
  const dst = join(CDIR, ...parts);
```

Change the install loop (line 526) from `for (const rel of walkBundle(SRC)) await placeFile(rel);` to:

```js
for (const rel of V.rels) await placeFile(rel, V.srcFor(rel));
```

(`walkBundle` stays for `bundleAllText` until Task 5 rewires it. The root-level `META` skip is preserved automatically: `resolveVariant` walks `payload/` only, and META names never appear there — `walkBundle`'s META check guarded the same thing.)

- [ ] **Step 5: setup.mjs — persist variant.** In the manifest write block (line 860):

```js
const manifestPayload = { files: manifestNow, variant: VARIANT };
```

- [ ] **Step 6: Smoke-verify with dry-run** (uses a scratch config dir; nothing written):

Run (bash): `CLAUDE_CONFIG_DIR=/tmp/lite-smoke node setup.mjs --variant=lite --dry-run --skip-all | grep -c "gsd"`
Expected: no `created`/`updated` lines for gsd files (grep count reflects only prose/summary mentions; eyeball the file list — no `agents/gsd-*`, no `hooks/gsd-*`). Also run `--variant=full --dry-run` — file count matches master behavior.

- [ ] **Step 7: Commit**

```bash
git add setup.mjs variants.test.mjs
git commit -m "feat(setup): --variant flag, interactive selection, resolver-driven install with overlay, manifest.variant"
```

---

### Task 5: `setup.mjs` — variant-aware prune, settings merge, statusLine, full-only steps

**Files:**
- Modify: `setup.mjs` (`bundleAllText` line 382-386; `pruneStale` line 454-490; settings merge line 694-708; statusLine line 736-751; gsd-agents step ~545-560; gsd-defaults step ~570-595; gsd-core patches section ~600-660; final summary lines 889-959)

**Interfaces:**
- Consumes: module-scope `VARIANT`, `V` (Task 4); `filterPartialHooks` (Task 1).
- Produces: full→lite switch that actually removes GSD files; lite settings.json with exactly the 6 lite hooks and no statusLine.

- [ ] **Step 1: `bundleAllText` must reflect the variant** (otherwise excluded-file names in full payload text would "protect" stale files forever). Replace lines 382-386 with:

```js
function bundleAllText() {
  let t = "";
  for (const rel of V.rels) t += "\n" + (read(V.srcFor(rel)) || "");
  return t;
}
```

- [ ] **Step 2: `pruneStale` — variant-excluded files bypass the name-reference gate.** CRITICAL correctness point: lite's `session-init.mjs` contains the *strings* `context-mode-gsd-agents.mjs` etc. in its dynamic-import calls, so the `allText.includes(basename)` gate would KEEP every gsd lib on a full→lite switch. Exclusion by the variant map is authoritative — bypass that single gate (curated + modified-hash gates still apply). In `pruneStale()` (line 465-473), change the loop body:

```js
  for (const rel of candidates) {
    const dst = join(CDIR, ...rel.split("/"));
    if (!existsSync(dst)) continue;                                  // already gone
    const cur = read(dst);
    if (typeof cur === "string" && isCurated(cur)) { kept.push([rel, "curated"]); continue; }
    const variantExcluded = V.excludedSet.has(rel);
    if (!variantExcluded && allText.includes(rel.split("/").pop())) { kept.push([rel, "still referenced in bundle"]); continue; }
    const oldHash = oldByRel.get(rel);
    if (oldHash && cur !== undefined && sha(cur) !== oldHash) { kept.push([rel, "modified since install"]); continue; }
    del.push({ rel, dst });
  }
```

Also add the gsd-defaults mirror (written outside `placeFile`, so never in any manifest) as a lite prune candidate — after line 460 (`for (const rel of SEED_REMOVED) ...`):

```js
  if (VARIANT !== "full") candidates.add("gsd-defaults.partial.json"); // full-only mirror, never manifest-tracked
```

(Its curated gate can't fire — JSON; hash gate can't fire — no oldHash; name gate is bypassed by adding `"gsd-defaults.partial.json"` to the excluded-set check: extend the `variantExcluded` line to `V.excludedSet.has(rel) || rel === "gsd-defaults.partial.json" && VARIANT !== "full"`.)

- [ ] **Step 3: settings merge — add only variant-included hook entries.** `ourFiles`/`mentionsOurs` (lines 688-692) stay built from the FULL partial — that's what strips stale gsd hook entries out of an existing settings.json on switch. Change only the re-add side (lines 694-708):

```js
    const variantBasenames = new Set(V.rels.map((r) => r.split("/").pop()));
    const partialHooksForVariant = filterPartialHooks(partial.hooks, variantBasenames);

    for (const [ev, entries] of Object.entries(partialHooksForVariant)) {
      const arr = (merged.hooks[ev] || []).filter(e => !mentionsOurs(e));
      for (const w of entries) arr.push(w);
      merged.hooks[ev] = arr;
    }
    for (const ev of Object.keys(merged.hooks)) {
      if (ev in partialHooksForVariant) continue;
      merged.hooks[ev] = (merged.hooks[ev] || []).filter(e => !mentionsOurs(e));
    }
```

- [ ] **Step 4: statusLine — full-only, removed on switch to lite.** Replace the guard at line 740 (`if (partial.statusLine) {`) with:

```js
    if (partial.statusLine && VARIANT === "full") {
      // ... existing body unchanged ...
    } else if (VARIANT !== "full") {
      const curCmd = merged.statusLine && merged.statusLine.command;
      if (typeof curCmd === "string" && curCmd.includes("gsd-context-meter")) delete merged.statusLine;
    }
```

- [ ] **Step 5: gate the four full-only `main()` steps.** Wrap each of these blocks in `if (VARIANT === "full") { ... }` (each already starts with a banner comment — anchor on it):
  - `/* ---------- gsd-* agents: add the context-mode MCP tool ... */` (~line 545)
  - `/* ---------- gsd-defaults.partial.json: mirror + apply ... */` (~line 570)
  - `/* ---------- gsd-core hand-patches ... */` (~line 600, the whole patches section)
  - the graphify-neo4j opt-in section (~line 800-850, the block that asks about and writes `GRAPHIFY_NEO4J` / `~/.graphify/neo4j.env`) — lite excludes the whole neo4j overlay (spec § 2.1), so the opt-in must not fire there

- [ ] **Step 6: variant-aware closing summary.** In the final "Project setup" block (lines 921-959): print `Variant: ${VARIANT}` after "Done."; wrap the GSD bullet lines (GSD-generated CLAUDE.md note, `.planning` exclude, GSD-clobber risk, `/init-mcp` suggestion, "for GSD projects" block, and Steps 3-4 about `init-stack.py` plugins) in `if (VARIANT === "full")`. For lite print instead:

```js
  else {
    log("Step 3 - For per-project stack rules run /init-stack in that project's session");
    log("         (compiles .claude/stack-rules.md; no plugin machinery in lite).");
  }
```

- [ ] **Step 7: Verify — dry-run switch simulation + full non-regression**

Run (bash):
```bash
CLAUDE_CONFIG_DIR=/tmp/lite-smoke2 node setup.mjs --variant=full --replace-all >/dev/null && \
CLAUDE_CONFIG_DIR=/tmp/lite-smoke2 node setup.mjs --variant=lite --dry-run --replace-all | tail -40
```
Expected: the stale-files section lists `agents/gsd-*`, `hooks/gsd-*`, `hooks/lib/gsd-*`, `bin/supervise-bg.mjs`, `commands/init-mcp.md`, `gsd-defaults.partial.json`, ... as removal candidates (dry-run: not removed); settings diff shows gsd hook entries dropped and statusLine deleted.

Run: `node --test variants.test.mjs && node --test payload/`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add setup.mjs
git commit -m "feat(setup): variant-aware prune (excluded bypass), settings/statusLine filtering, full-only GSD steps"
```

---

### Task 6: Plugin reconciliation — pure plan builder + unit tests

**Files:**
- Create: `plugin-reconcile.mjs`
- Test: `plugin-reconcile.test.mjs`

**Interfaces:**
- Produces: `buildPluginPlan({required, managed, enabledPlugins, installedIds}) -> Action[]` where `Action = {type: "install"|"uninstall"|"enable"|"disable", name, id}`; `installedIds: string[]|null` (null = CLI unavailable → no install/uninstall actions, only a `notes` array telling the user what to run). Also `formatPlan(actions, notes) -> string` for display.

- [ ] **Step 1: Write the failing tests** in `plugin-reconcile.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPluginPlan } from "./plugin-reconcile.mjs";

const MANAGED = { superpowers: "superpowers@m", gsd: "gsd@m", "context-mode": "cm@m", context7: "c7@m" };
const LITE = ["superpowers", "context-mode", "context7"];

test("surplus gsd: uninstall + disable when installed and enabled", () => {
  const { actions } = buildPluginPlan({ required: LITE, managed: MANAGED,
    enabledPlugins: { "superpowers@m": true, "gsd@m": true, "cm@m": true, "c7@m": true },
    installedIds: ["superpowers@m", "gsd@m", "cm@m", "c7@m"] });
  assert.deepEqual(actions, [
    { type: "uninstall", name: "gsd", id: "gsd@m" },
    { type: "disable",  name: "gsd", id: "gsd@m" },
  ]);
});

test("missing required: install + enable", () => {
  const { actions } = buildPluginPlan({ required: LITE, managed: MANAGED,
    enabledPlugins: { "superpowers@m": true }, installedIds: ["superpowers@m"] });
  assert.deepEqual(actions, [
    { type: "install", name: "context-mode", id: "cm@m" },
    { type: "enable",  name: "context-mode", id: "cm@m" },
    { type: "install", name: "context7", id: "c7@m" },
    { type: "enable",  name: "context7", id: "c7@m" },
  ]);
});

test("CLI unavailable: enabledPlugins edits still planned, install/uninstall become notes", () => {
  const { actions, notes } = buildPluginPlan({ required: LITE, managed: MANAGED,
    enabledPlugins: { "gsd@m": true }, installedIds: null });
  assert.ok(actions.every((a) => a.type === "enable" || a.type === "disable"));
  assert.ok(notes.some((n) => n.includes("claude plugin uninstall gsd@m")));
  assert.ok(notes.some((n) => n.includes("claude plugin install cm@m")));
});

test("unknown user plugins untouched; empty enabledPlugins object preserved semantics", () => {
  const { actions } = buildPluginPlan({ required: LITE, managed: MANAGED,
    enabledPlugins: { "my-own@x": true, "superpowers@m": true, "cm@m": true, "c7@m": true },
    installedIds: ["my-own@x", "superpowers@m", "cm@m", "c7@m"] });
  assert.deepEqual(actions, []);   // my-own@x invisible; nothing to do
});
```

- [ ] **Step 2: Run to verify failure** — `node --test plugin-reconcile.test.mjs` → FAIL (module missing)

- [ ] **Step 3: Implement `plugin-reconcile.mjs`:**

```js
// Pure plugin reconciliation plan (spec § 4). No fs/process access here — setup.mjs executes.
export function buildPluginPlan({ required, managed, enabledPlugins, installedIds }) {
  const actions = [], notes = [];
  const enabled = enabledPlugins || {};
  const cli = Array.isArray(installedIds);
  for (const name of required) {
    const id = managed[name];
    if (!id) continue;
    if (cli && !installedIds.includes(id)) actions.push({ type: "install", name, id });
    else if (!cli && !(id in enabled)) notes.push(`if not installed yet, run: claude plugin install ${id}`);
    if (!(id in enabled)) actions.push({ type: "enable", name, id });
  }
  for (const name of Object.keys(managed)) {
    if (required.includes(name)) continue;
    const id = managed[name];
    if (cli && installedIds.includes(id)) actions.push({ type: "uninstall", name, id });
    else if (!cli && id in enabled) notes.push(`run manually: claude plugin uninstall ${id}`);
    if (id in enabled) actions.push({ type: "disable", name, id });
  }
  return { actions, notes };
}

export function formatPlan(actions, notes) {
  const lines = actions.map((a) => `  ${a.type.padEnd(9)} ${a.id}`);
  return [...lines, ...notes.map((n) => `  NOTE: ${n}`)].join("\n") || "  (plugins already match the variant)";
}
```

Adjust ordering in the implementation until the test's expected action order passes (required in `required` order, then surplus in `managed` key order; install before enable, uninstall before disable).

- [ ] **Step 4: Run tests** — `node --test plugin-reconcile.test.mjs` → PASS

- [ ] **Step 5: Commit**

```bash
git add plugin-reconcile.mjs plugin-reconcile.test.mjs
git commit -m "feat(plugins): pure reconciliation plan builder with CLI-absent fallback"
```

---

### Task 7: Wire plugin reconciliation into `setup.mjs`

**Files:**
- Modify: `setup.mjs` (insert after the settings merge block ends at line 774, before the update-check opt-in at 776)

**Interfaces:**
- Consumes: `buildPluginPlan`, `formatPlan` (Task 6); `V.plugins`, `loadVariants` (Task 1); existing `ask`, `write`, `log`, `summary`, `DRY`, `BULK`, `INTERACTIVE`.

- [ ] **Step 1: Add the import** next to the variants import:

```js
import { buildPluginPlan, formatPlan } from "./plugin-reconcile.mjs";
```

- [ ] **Step 2: Insert the reconciliation block** (after line 774 `}` closing the settings-merge `if`):

```js
  /* ---------- plugin reconciliation (spec § 4): only managedPlugins are ever touched ---------- */
  {
    const managed = loadVariants(REPO_ROOT).managedPlugins;
    const cliProbe = spawnSync("claude", ["plugin", "list", "--json"], { encoding: "utf8" });
    const installedIds = cliProbe.status === 0
      ? (safe(() => JSON.parse(cliProbe.stdout)) || []).map((p) => p.id || p.name).filter(Boolean)
      : null;   // CLI unavailable or errored -> fallback notes
    const curSettings = safe(() => JSON.parse(readFileSync(SETTINGS, "utf8"))) || {};
    const { actions, notes } = buildPluginPlan({
      required: V.plugins, managed, enabledPlugins: curSettings.enabledPlugins, installedIds });
    if (actions.length || notes.length) {
      log("\n--- plugin reconciliation ---");
      log(formatPlan(actions, notes));
      let go = false;
      if (DRY) log("  (dry-run: no plugin changes)");
      else if (BULK === "skip") log("  (--skip-all: no plugin changes)");
      else if (BULK) go = true;
      else if (INTERACTIVE) { const a = await ask(`    apply ${actions.length} plugin action(s)? (y/N) > `); go = a[0] === "y"; }
      else log("  (non-interactive: printed only - re-run in a terminal or with --replace-all)");
      if (go) {
        const s = safe(() => JSON.parse(readFileSync(SETTINGS, "utf8"))) || {};
        s.enabledPlugins = s.enabledPlugins || {};
        for (const a of actions) {
          if (a.type === "install" || a.type === "uninstall") {
            const r = spawnSync("claude", ["plugin", a.type, a.id], { encoding: "utf8", stdio: "inherit" });
            summary.push(`${r.status === 0 ? "plugin-" + a.type : "plugin-" + a.type + "-FAILED"} ${a.id}`);
          }
          if (a.type === "enable") s.enabledPlugins[a.id] = true;
          if (a.type === "disable") delete s.enabledPlugins[a.id];
        }
        if (write(SETTINGS, JSON.stringify(s, null, 2) + "\n")) summary.push(`updated  ${SETTINGS} (enabledPlugins reconciled)`);
        log("  NOTE: restart Claude Code - enabledPlugins does not hot-reload.");
      }
    }
  }
```

Implementation check before coding: run `claude plugin list --json` once on the real machine to confirm the JSON shape (`.id` vs `.name` key) and adjust the `.map()` accordingly; also confirm whether `enabledPlugins` keys on this machine are `name@marketplace` ids — mirror what's actually there.

- [ ] **Step 3: Verify** — `node --check setup.mjs`, then dry-run:

Run (bash): `CLAUDE_CONFIG_DIR=/tmp/lite-smoke3 node setup.mjs --variant=lite --dry-run --skip-all | grep -A8 "plugin reconciliation"`
Expected: plan printed (uninstall/disable gsd if this machine has it; installs for anything missing in the scratch dir), `(dry-run: no plugin changes)`.

- [ ] **Step 4: Commit**

```bash
git add setup.mjs
git commit -m "feat(setup): wire plugin reconciliation with confirmation and CLI-absent fallback"
```

---

### Task 8: E2E test — install lite, switch both ways, foreign files, dry-run

**Files:**
- Test: `setup-variants.e2e.test.mjs`

**Interfaces:**
- Consumes: everything shipped in Tasks 1-7; `resolveVariant` for the expected tree.

- [ ] **Step 1: Write the E2E suite:**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveVariant } from "./variants.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const run = (dir, args) => spawnSync(process.execPath, [join(ROOT, "setup.mjs"), ...args],
  { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, timeout: 120000 });

function walk(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), r));
    else out.push(r);
  }
  return out;
}
const FOREIGN = ["settings.local.json", "projects/p/notes.md", "memory/MEMORY.md", "skills/graphify/SKILL.md"];
function plantForeign(dir) {
  for (const f of FOREIGN) { mkdirSync(join(dir, dirname(f)), { recursive: true }); writeFileSync(join(dir, f), `foreign:${f}`); }
}

test("lite install: exact tree, 6 hooks, no statusLine, manifest.variant", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-lite-"));
  plantForeign(dir);
  const r = run(dir, ["--variant=lite", "--replace-all"]);
  assert.equal(r.status, 0, r.stderr);
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const installed = new Set(walk(dir));
  for (const rel of v.rels) assert.ok(installed.has(rel), `missing: ${rel}`);
  for (const rel of installed)
    if (!rel.startsWith("state/") && rel !== "settings.json" && !FOREIGN.includes(rel))
      assert.ok(v.rels.includes(rel), `unexpected: ${rel}`);
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  const scripts = new Set();
  for (const entries of Object.values(settings.hooks || {}))
    for (const e of entries) for (const h of (e.hooks || []))
      for (const a of (h.args || [])) scripts.add(String(a).split(/[\\/]/).pop());
  assert.equal(scripts.size, 6);
  assert.ok(!("statusLine" in settings));
  assert.equal(JSON.parse(readFileSync(join(dir, "state/bundle-manifest.json"), "utf8")).variant, "lite");
  // lite CLAUDE.md is the overlay version
  assert.match(readFileSync(join(dir, "CLAUDE.md"), "utf8"), /lite variant/);
  for (const f of FOREIGN) assert.equal(readFileSync(join(dir, f), "utf8"), `foreign:${f}`);
  rmSync(dir, { recursive: true, force: true });
});

test("switch full->lite prunes surplus; lite->full restores; foreign untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-sw-"));
  plantForeign(dir);
  assert.equal(run(dir, ["--variant=full", "--replace-all"]).status, 0);
  assert.ok(existsSync(join(dir, "hooks/gsd-context-meter.mjs")));
  assert.equal(run(dir, ["--variant=lite", "--replace-all"]).status, 0);
  assert.ok(!existsSync(join(dir, "hooks/gsd-context-meter.mjs")), "gsd hook not pruned");
  assert.ok(!existsSync(join(dir, "hooks/lib/context-mode-gsd-agents.mjs")), "gsd lib not pruned (name-gate bypass broken?)");
  assert.ok(!existsSync(join(dir, "gsd-defaults.partial.json")), "gsd-defaults mirror not pruned");
  assert.equal(run(dir, ["--variant=full", "--replace-all"]).status, 0);
  assert.ok(existsSync(join(dir, "hooks/gsd-context-meter.mjs")), "full files not restored");
  assert.equal(JSON.parse(readFileSync(join(dir, "state/bundle-manifest.json"), "utf8")).variant, "full");
  for (const f of FOREIGN) assert.equal(readFileSync(join(dir, f), "utf8"), `foreign:${f}`);
  rmSync(dir, { recursive: true, force: true });
});

test("manifest without variant field = full (no surplus prune on full reinstall)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-legacy-"));
  assert.equal(run(dir, ["--variant=full", "--replace-all"]).status, 0);
  const mPath = join(dir, "state/bundle-manifest.json");
  const m = JSON.parse(readFileSync(mPath, "utf8"));
  delete m.variant;                      // simulate pre-variant bundle
  writeFileSync(mPath, JSON.stringify(m, null, 2));
  const r = run(dir, ["--replace-all"]); // no flag, non-TTY -> detected = full
  assert.equal(r.status, 0);
  assert.ok(existsSync(join(dir, "hooks/gsd-context-meter.mjs")));
  rmSync(dir, { recursive: true, force: true });
});

test("--dry-run writes nothing for both variants", () => {
  for (const variant of ["lite", "full"]) {
    const dir = mkdtempSync(join(tmpdir(), "cc-dry-"));
    const r = run(dir, [`--variant=${variant}`, "--dry-run", "--skip-all"]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(walk(dir), [], `dry-run wrote files (${variant})`);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run** — `node --test setup-variants.e2e.test.mjs`

Expected: PASS. Known flake sources to fix if hit: the plugin-reconciliation step must not block non-interactively (it doesn't — `--replace-all` implies `go=true` but `claude` CLI actions in a scratch env act on the REAL machine's plugins. **Guard against that**: in the reconciliation block from Task 7, skip execution entirely when `process.env.CLAUDE_SETUP_SKIP_PLUGINS === "1"`, and set that env var in this test's `run()` helper. Add the env check as part of this task, one line: `else if (process.env.CLAUDE_SETUP_SKIP_PLUGINS === "1") log("  (skipped: CLAUDE_SETUP_SKIP_PLUGINS=1)");` before the `else if (BULK)` line.)

- [ ] **Step 3: Full suite**

Run: `node --test variants.test.mjs plugin-reconcile.test.mjs setup-variants.e2e.test.mjs && node --test payload/`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add setup-variants.e2e.test.mjs setup.mjs
git commit -m "test(variants): e2e install/switch/foreign/dry-run suite + plugin-exec guard env"
```

---

### Task 9: Docs + risk register

**Files:**
- Modify: `README.md`, `README.en.md` (new "Variants" section)
- Modify: `RISK_REGISTER.md` (two new entries)

- [ ] **Step 1: README section** (both files; RU in README.md, EN in README.en.md — follow each file's existing structure and heading style). Content to cover: what lite contains (plugin set; the 6 hooks; graphify without neo4j; lazy skills; lite /init-stack), how to select (`node setup.mjs` interactive question; `--variant=lite|full`; bootstrap one-liner via `CLAUDE_SETUP_ARGS='--variant=lite'` or positional flag), how switching works (surplus prune with confirmation, plugin reconciliation, restart required), and that the manifest records the installed variant.

- [ ] **Step 2: RISK_REGISTER.md** — read the file first, follow its existing entry schema and ID sequence exactly; add two Open risks:
  - variant switch removing a file the user edited in place under `~/.claude` — mitigations: pruneStale hash gate keeps modified files (verified by e2e switch test), dry-run preview, confirmation prompt;
  - `managedPlugins` marketplace ids drifting from the live marketplace — mitigations: reconciliation always shows the plan before acting; ids sourced from the real machine at implementation.

- [ ] **Step 3: Final verification + commit**

Run: `node --test variants.test.mjs plugin-reconcile.test.mjs setup-variants.e2e.test.mjs && node --test payload/`
Expected: ALL PASS

```bash
git add README.md README.en.md RISK_REGISTER.md
git commit -m "docs(readme): document bundle variants (selection, switching, lite contents); log variant risks"
```

- [ ] **Step 4: Merge readiness** — use superpowers:finishing-a-development-branch (squash-merge to master per repo convention).
