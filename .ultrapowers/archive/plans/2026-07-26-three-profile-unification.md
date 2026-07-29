# Three-Profile Bundle Unification (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `full`, `base`, and `lite` bundle profiles architecturally identical — one resolver, one installer, one `/init-stack`, one composable `CLAUDE.md` — so the only difference between them is the *set* of components each ships.

**Architecture:** `variants.json` becomes a `profiles` map with an `extends` chain (`lite ⊂ base ⊂ full`); `full` stays an identity fast-path, `base`/`lite` are exclude-only deltas whose parent excludes are unioned by the resolver. The single Node `bin/init-stack.mjs` (ported from the retired Python) filters stack plugins by a per-plugin `tier` against the active profile. Two monolithic `CLAUDE.md` files become numeric fragments under `payload/claude-md/`, assembled per profile at install time. `setup.mjs` gains a 3-way profile prompt, a manifest `profile` field (fallback-reads the old `variant`), and a single guided augment/trim flow.

**Tech Stack:** Node ESM (`.mjs`), `node --test` + `node:assert/strict`, no `package.json`, no third-party deps. Windows-first (forward-slash paths, `spawnSync`). Spec: `.ultrapowers/archive/specs/2026-07-26-three-profile-unification-design.md`.

## Global Constraints

- **Profile gradient is a strict subset chain:** `lite ⊂ base ⊂ full`. Every file in lite is in base; every file in base is in full.
- **`base = full − GSD-everything`.** GSD dropped from base: `agents/gsd-*.md`, `hooks/gsd-*`, `hooks/lib/gsd-*`, `rules-src/gsd.md`, gsd commands/skills, `apply-gsd-agent-patches.mjs`, `gsd-defaults-sync.mjs`, `sync-gsd-context-mode-tool.mjs`, `hooks/lib/context-mode-gsd-agents.mjs`, `worktree-executor-discipline-advisor.mjs`, `hooks/gsd-context-meter.mjs` (statusLine), and the managed `gsd` plugin.
- **base keeps** neo4j (opt-in) and the design skills (Phase 2, frontend-scoped).
- **Resolved infra-hook boundary (OI-4):**
  - In base (and full): `bg-supervision-nudge*` (+ `bin/supervise-bg.mjs`, `bin/lib/supervise-lib*`), `commands/init-mcp.md`, `schedulewakeup-loop-only-nudge*`, `pnpm-phantom-fix-hook*` (+ `bin/pnpm-phantom-*`, `bin/lib/pnpm-*`, `commands/pnpm-phantom-fix.md`).
  - full-only: `db-live-access-gate.mjs`, `ci-watch-nudge*`.
  - **Removed from ALL profiles' packaging:** `hooks/task-lifecycle-probe*` — stays in the repo as a dev-only probe; excluded in every profile including full (add to a shared `exclude` or drop from the bundle walk). It is NOT a shipped component.
- **lite = base − universal infra − neo4j − stack-plugin subset − CLAUDE.md trim.** lite drops from base: `bg-supervision*`, `supervise-bg*`, `init-mcp.md`, `schedulewakeup*`, `pnpm-phantom*`, neo4j (unless opted in), and keeps only `tier: core` stack plugins.
- **Resolved OI-1:** the `stack-markers` standalone skill is **retired**; its table lives once in `bin/lib/stack-markers.mjs`.
- **Resolved OI-2:** UI UX Pro Max is **vendored** as a generated skill (Phase 2, separate plan).
- **Resolved OI-3:** the §4 `tier` defaults hold as-is unless a specific plugin is re-tagged during review.
- **Resolved OI-5:** augment/trim is one guided flow inside `setup.mjs` (option: `--configure` screen). The install must NEVER hand the user a chain of manual "now run X with flag Y" commands — every toggle is applied in-process.
- **Compatibility shims (one release):** the resolver reads `cfg.profiles` but falls back to `cfg.variants`; a `variants` alias key is accepted. The manifest field is `profile` but every read site falls back to the old `variant`. A stale `--variant=` CLI flag still resolves.
- **Testing rules:** tests are `*.test.mjs` run with `node --test`; use `node:test` + `node:assert/strict`. There is NO `package.json` — never add one. Run the full suite once before each commit.
- **Commit hygiene:** commit with `git commit -F <msgfile>` (the secrets-gate hook false-positives on SQL-ish / config words in `-m`). `git add <explicit paths>` only — the working tree has untracked docs the user is editing; NEVER `git add -A`.
- **Language:** all code, docs, and config in English (per user rules).

## File Structure

**Resolver + manifest (Task 1–3)**
- `variants.json` — `variants`→`profiles` (alias kept), add `base`, `extends` chain, generalized `optional`, per-profile plugin lists.
- `variants.mjs` — `resolvedExclude()` parent-union, denylist mode for exclude-only profiles, `profiles`/`variants` fallback.
- `variants.test.mjs`, `setup-variants.e2e.test.mjs` — extended for 3 profiles.

**Stack system (Task 4–5)**
- `bin/lib/stack-markers.mjs` (new) — single source-of-truth marker table + detection helper.
- `bin/init-stack.mjs` (new) — Node port; `bin/init-stack.test.mjs` (new).
- Delete: `bin/init-stack.py`, `bin/test_init_stack.py`, `bin/__pycache__/**`, `payload-lite/commands/init-stack.md`, `payload/skills/stack-markers/**`.

**Composable CLAUDE.md (Task 6)**
- `payload/claude-md/NN-*.md` (+ `NN-*.<profile>.md` variants) — new fragments.
- `bin/lib/assemble-claude-md.mjs` (new) + `bin/lib/assemble-claude-md.test.mjs` (new).
- Delete: `payload/CLAUDE.md`, `payload-lite/CLAUDE.md`.

**Installer (Task 7–8)**
- `setup.mjs` — 3-way profile prompt, manifest `profile`, CLAUDE.md assembly call, single guided augment/trim flow.

---

### Task 1: Resolver — `extends` chain, denylist mode, `alwaysExclude`, `profiles` fallback

Add the machinery that makes `base`/`lite` exclude-only deltas without breaking the current allowlist `lite` (which still lives in `variants.json` until Task 2). All new behavior is unit-tested against injected fixture configs; the real `variants.json` is untouched here except for one additive `alwaysExclude` key.

**Files:**
- Modify: `variants.mjs` (add `profilesOf`, `resolvedExclude`; extend `resolveVariant` with an optional injected `cfg`, an `alwaysExclude` filter, and a denylist branch)
- Modify: `variants.json` (add top-level `"alwaysExclude": ["hooks/task-lifecycle-probe*"]` only)
- Modify: `settings.partial.json` (remove any `task-lifecycle-probe` hook registration, if present)
- Test: `variants.test.mjs` (new cases; existing cases must stay green)

**Interfaces:**
- Produces: `profilesOf(cfg) -> object` (returns `cfg.profiles || cfg.variants || {}`); `resolvedExclude(cfg, name) -> string[]` (parent-chain-unioned exclude globs, child last); `resolveVariant({repoRoot, variant, activeOptional?, cfg?})` unchanged return shape `{name, rels, srcFor, excludedSet, uncovered, orphanOverlay, plugins}`, now accepting an optional injected `cfg` (defaults to `loadVariants(repoRoot)`).
- Consumes: existing `globToRe`, `walkRels`, `matchAny` from `variants.mjs`.

- [ ] **Step 1: Write the failing tests** (append to `variants.test.mjs`)

```js
import { globToRe, resolveVariant, filterPartialHooks, resolvedExclude, profilesOf } from "./variants.mjs";

const FIXTURE = { profiles: {
  full: { plugins: [] },
  base: { exclude: ["a/*", "b/*"] },
  lite: { extends: "base", exclude: ["c/*"] },
}};

test("profilesOf: prefers profiles, falls back to variants", () => {
  assert.equal(profilesOf({ profiles: { x: 1 } }).x, 1);
  assert.equal(profilesOf({ variants: { y: 2 } }).y, 2);
  assert.deepEqual(profilesOf({}), {});
});

test("resolvedExclude: unions the extends chain, child last", () => {
  assert.deepEqual(resolvedExclude(FIXTURE, "full"), []);
  assert.deepEqual(resolvedExclude(FIXTURE, "base"), ["a/*", "b/*"]);
  assert.deepEqual(resolvedExclude(FIXTURE, "lite"), ["a/*", "b/*", "c/*"]);
});

test("full identity honors alwaysExclude (task-lifecycle-probe not shipped in any profile)", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "full" });
  assert.ok(!v.rels.some((r) => /task-lifecycle-probe/.test(r)),
    "task-lifecycle-probe must be excluded even from full");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test variants.test.mjs`
Expected: FAIL — `resolvedExclude`/`profilesOf` are not exported; the alwaysExclude assertion fails because `full` still ships `task-lifecycle-probe.mjs`.

- [ ] **Step 3: Implement in `variants.mjs`**

Add the two exports and rewire `resolveVariant`. Keep the existing allowlist branch verbatim as the final fallback.

```js
export function profilesOf(cfg) { return cfg.profiles || cfg.variants || {}; }

export function resolvedExclude(cfg, name) {
  const def = profilesOf(cfg)[name] || {};
  const parent = def.extends ? resolvedExclude(cfg, def.extends) : [];
  return [...parent, ...(def.exclude || [])];
}

export function resolveVariant({ repoRoot, variant, activeOptional = [], cfg = null }) {
  cfg = cfg || loadVariants(repoRoot);
  const profiles = profilesOf(cfg);
  const def = profiles[variant];
  if (!def) throw new Error(`unknown profile "${variant}" (known: ${Object.keys(profiles).join(", ")})`);
  const payloadDir = join(repoRoot, "payload");
  const payloadRels = walkRels(payloadDir);
  const alwaysRes = (cfg.alwaysExclude || []).map(globToRe);
  const isAlways = (rel) => matchAny(rel, alwaysRes);
  const srcForPayload = (rel) => join(payloadDir, ...rel.split("/"));

  // identity (full): ship everything except alwaysExclude
  if (!def.include && !def.exclude && !def.extends) {
    const rels = payloadRels.filter((r) => !isAlways(r));
    return { name: variant, rels, srcFor: srcForPayload,
      excludedSet: new Set(payloadRels.filter(isAlways)), uncovered: [], orphanOverlay: [], plugins: def.plugins };
  }

  const optGlobs = (activeOptional || []).flatMap((g) => (def.optional && def.optional[g]) || []);
  const optRes = optGlobs.map(globToRe);

  // denylist (base/lite via extends): everything not excluded; optional-active wins over exclude
  if (!def.include) {
    const excRes = resolvedExclude(cfg, variant).map(globToRe);
    const rels = [], excluded = [];
    for (const rel of payloadRels) {
      if (isAlways(rel)) { excluded.push(rel); continue; }
      if (matchAny(rel, optRes)) { rels.push(rel); continue; }   // optional promoted over exclude
      if (matchAny(rel, excRes)) { excluded.push(rel); continue; }
      rels.push(rel);
    }
    return finalizeResolved({ variant, def, repoRoot, payloadDir, rels, excluded, plugins: def.plugins });
  }

  // legacy allowlist (kept one release for back-compat) — existing include/exclude/optional body,
  // wrapped to also drop alwaysExclude and route through finalizeResolved().
  const incRes = def.include.map(globToRe);
  const excRes = def.exclude.map(globToRe);
  const rels = [], excluded = [], uncovered = [];
  for (const rel of payloadRels) {
    if (isAlways(rel)) { excluded.push(rel); continue; }
    if (matchAny(rel, optRes)) rels.push(rel);
    else if (matchAny(rel, excRes)) excluded.push(rel);
    else if (matchAny(rel, incRes)) rels.push(rel);
    else uncovered.push(rel);
  }
  return finalizeResolved({ variant, def, repoRoot, payloadDir, rels, excluded, uncovered, plugins: def.plugins });
}

// shared overlay/srcFor/orphan handling (was inline in the old allowlist path)
function finalizeResolved({ variant, def, repoRoot, payloadDir, rels, excluded, uncovered = [], plugins }) {
  const overlayDir = def.overlay ? join(repoRoot, def.overlay) : null;
  const overlayRels = overlayDir ? walkRels(overlayDir) : [];
  const relSet = new Set(rels);
  const orphanOverlay = overlayRels.filter((r) => !relSet.has(r));
  const overlaySet = new Set(overlayRels);
  const srcFor = (rel) => overlaySet.has(rel)
    ? join(overlayDir, ...rel.split("/"))
    : join(payloadDir, ...rel.split("/"));
  return { name: variant, rels, srcFor, excludedSet: new Set(excluded), uncovered, orphanOverlay, plugins };
}
```

Then add `"alwaysExclude": ["hooks/task-lifecycle-probe*"]` as a top-level key in `variants.json`, and remove the `task-lifecycle-probe` registration from `settings.partial.json` if one exists (search it for `task-lifecycle-probe`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test variants.test.mjs`
Expected: PASS — all new cases plus every pre-existing case (the real `variants.json` `lite` still resolves through the retained allowlist branch).

- [ ] **Step 5: Commit**

```bash
git add variants.mjs variants.json variants.test.mjs settings.partial.json
git commit -F .git/COMMIT_MSG   # message: "feat(variants): extends chain + denylist mode + alwaysExclude in resolver"
```

---

### Task 2: `variants.json` — `profiles` map, `base` profile, denylist deltas

Rewrite `variants.json` from the two-`variants` allowlist model to the three-`profiles` `extends`-chain denylist model. `full` = identity, `base` = `full − GSD − full-only-infra`, `lite` = `base − universal-infra − neo4j − CLAUDE.md-trim`.

**Files:**
- Modify: `variants.json` (restructure; keep a `variants` alias only if a consumer still needs it — the resolver already falls back, so the alias is optional and OMITTED to avoid duplication)
- Test: `variants.test.mjs` (rewrite the lite-specific cases for the denylist + add base)

**Interfaces:**
- Consumes: `resolveVariant`, `resolvedExclude`, `profilesOf` from Task 1.
- Produces: the canonical profile set `{full, base, lite}` consumed by `setup.mjs` (Task 7–8) and `init-stack.mjs` (Task 5).

- [ ] **Step 1: Write the failing tests** (replace the lite allowlist cases in `variants.test.mjs`)

```js
test("profile chain is a strict subset: lite ⊂ base ⊂ full", () => {
  const full = new Set(resolveVariant({ repoRoot: ROOT, variant: "full" }).rels);
  const base = new Set(resolveVariant({ repoRoot: ROOT, variant: "base" }).rels);
  const lite = new Set(resolveVariant({ repoRoot: ROOT, variant: "lite" }).rels);
  for (const r of base) assert.ok(full.has(r), `base file not in full: ${r}`);
  for (const r of lite) assert.ok(base.has(r), `lite file not in base: ${r}`);
  assert.ok(base.size < full.size && lite.size < base.size, "each step must be a proper subset");
});

test("base drops all GSD, keeps neo4j opt-in and design/infra keep-set", () => {
  const base = resolveVariant({ repoRoot: ROOT, variant: "base" });
  for (const r of base.rels) {
    assert.ok(!/^(agents\/gsd-|hooks\/gsd-|hooks\/lib\/gsd-)/.test(r), `GSD leaked into base: ${r}`);
    assert.notEqual(r, "rules-src/gsd.md");
  }
  const baseWithNeo = resolveVariant({ repoRoot: ROOT, variant: "base", activeOptional: ["neo4j"] });
  assert.ok(baseWithNeo.rels.includes("bin/lib/neo4j-config.mjs"), "base neo4j promotable");
  assert.ok(!base.rels.includes("bin/lib/neo4j-config.mjs"), "base neo4j excluded by default");
  // OI-4 keep-set present in base:
  for (const f of ["hooks/bg-supervision-nudge.mjs", "commands/init-mcp.md",
                   "hooks/schedulewakeup-loop-only-nudge.mjs", "hooks/pnpm-phantom-fix-hook.mjs"])
    assert.ok(base.rels.includes(f), `base must keep ${f}`);
  // full-only infra absent from base:
  for (const f of ["hooks/db-live-access-gate.mjs", "hooks/ci-watch-nudge.mjs"])
    assert.ok(!base.rels.includes(f), `full-only infra leaked into base: ${f}`);
});

test("lite drops base's universal infra + neo4j", () => {
  const lite = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  for (const f of ["hooks/bg-supervision-nudge.mjs", "commands/init-mcp.md",
                   "hooks/schedulewakeup-loop-only-nudge.mjs", "hooks/pnpm-phantom-fix-hook.mjs",
                   "bin/lib/neo4j-config.mjs"])
    assert.ok(!lite.rels.includes(f), `lite must drop ${f}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test variants.test.mjs`
Expected: FAIL — `unknown profile "base"` (no `base` key yet); lite still resolves via allowlist so subset/keep-set assertions fail.

- [ ] **Step 3: Rewrite `variants.json`**

```jsonc
{
  "$comment": "Profile definitions for setup.mjs. Globs relative to payload/. exclude wins over include; extends unions the parent chain's exclude first. optional groups are promoted over exclude when active.",
  "alwaysExclude": ["hooks/task-lifecycle-probe*"],
  "managedPlugins": {
    "superpowers":  "superpowers@claude-plugins-official",
    "gsd":          "gsd@claude-plugins-official",
    "context-mode": "context-mode@context-mode",
    "context7":     "context7@claude-plugins-official"
  },
  "profiles": {
    "full": { "plugins": ["superpowers", "gsd", "context-mode", "context7"] },

    "base": {
      "plugins": ["superpowers", "context-mode", "context7"],
      "exclude": [
        "agents/gsd-*.md", "apply-gsd-agent-patches.mjs", "gsd-defaults-sync.mjs",
        "sync-gsd-context-mode-tool.mjs", "commands/init-session.md",
        "hooks/gsd-*", "hooks/lib/gsd-*", "hooks/lib/context-mode-gsd-agents.mjs",
        "hooks/worktree-executor-discipline-advisor.mjs",
        "rules-src/gsd.md", "skills/using-git-worktrees/**",
        "hooks/db-live-access-gate.mjs", "hooks/ci-watch-nudge*",
        "bin/lib/neo4j-config*", "bin/graphify-neo4j-*", "graphify-neo4j.cypher", "commands/init-mcp-neo4j.md"
      ],
      "optional": {
        "$comment": "Excluded by default, promotable at install time via setup.mjs. When active, globs win over exclude and files are installed (pruned again on opt-out).",
        "neo4j": ["bin/lib/neo4j-config*", "bin/graphify-neo4j-*", "graphify-neo4j.cypher"]
      }
    },

    "lite": {
      "extends": "base",
      "plugins": ["superpowers", "context-mode", "context7"],
      "overlay": "payload-lite",
      "maxPluginTier": "core",
      "exclude": [
        "hooks/bg-supervision-nudge*", "bin/supervise-bg.mjs", "bin/lib/supervise-lib*",
        "commands/init-mcp.md",
        "hooks/schedulewakeup-loop-only-nudge*",
        "hooks/pnpm-phantom-fix-hook*", "bin/pnpm-phantom-*", "bin/lib/pnpm-*",
        "bin/turbopack-gvs-check.mjs", "bin/lib/turbopack-gvs-*", "commands/pnpm-phantom-fix.md",
        "references/**"
      ]
    }
  }
}
```

> **CRITICAL correction vs the old lite model (spec §1, headline change #2):** under unification, `setting-templates/**` and the stack system ship in **every** profile including lite — lite no longer excludes templates wholesale; instead `maxPluginTier: "core"` makes `init-stack.mjs` (Task 6) enable only `tier: core` plugins. So `setting-templates/**` is **NOT** in `lite.exclude`. The `stack-markers` skill is deleted from `payload/` entirely (Task 4), so it needs no lite exclude line either.
>
> NOTE for the implementer: the `exclude` globs above are the DEFAULT from the spec matrix + resolved OI-4. Before committing, resolve all three profiles and eyeball the `lite ⊂ base ⊂ full` diff (via the Task 2 subset test output) to confirm nothing GSD/full-only leaked and nothing wanted was dropped. Neo4j lives in `base.exclude` + `base.optional.neo4j`; `lite` inherits the exclusion via `extends` and offers no neo4j opt-in. Verify `references/**` — if it holds GSD reference docs it belongs in `base.exclude` instead (move it up); classify it against the real `payload/references/` before committing. `commands/init-mcp.md`: confirm whether neo4j-specific MCP docs are a separate file; if init-mcp is one file kept in base, the neo4j `optional` group needs no init-mcp entry.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test variants.test.mjs`
Expected: PASS — subset chain holds, base/lite keep-sets correct.

- [ ] **Step 5: Commit**

```bash
git add variants.json variants.test.mjs
git commit -F .git/COMMIT_MSG   # message: "feat(variants): three-profile model (full/base/lite) via extends deltas"
```

---

### Task 3: Resolver test-suite hardening for three profiles

Replace the now-void allowlist-era guards (the `include ∪ exclude` classification-coverage test that a denylist trivially satisfies) with denylist-appropriate guards, and confirm hook-registration filtering works for all three profiles. (The e2e installer test is extended in Task 8.)

**Files:**
- Modify: `variants.test.mjs` (retire the classification-coverage test; add family-purity per profile; update the hook-count case for base)

**Interfaces:**
- Consumes: the finalized `{full, base, lite}` profiles from Task 2, `filterPartialHooks` from `variants.mjs`.

- [ ] **Step 1: Write/replace the tests**

```js
// Retire: "classification: every payload file is covered by include ∪ exclude (lite)"
// (denylist makes uncovered==[] trivially). Replace with a leak guard per profile.

test("no orphan files in payload-lite/ overlay", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  assert.deepEqual(v.orphanOverlay, [], `orphan overlay files: ${v.orphanOverlay.join(", ")}`);
});

test("base hook registrations resolve to base's file set", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "base" });
  const partial = JSON.parse(readFileSync(join(ROOT, "settings.partial.json"), "utf8"));
  const basenames = new Set(v.rels.map((r) => r.split("/").pop()));
  const filtered = filterPartialHooks(partial.hooks, basenames);
  const scripts = new Set();
  for (const entries of Object.values(filtered))
    for (const e of entries) for (const h of (e.hooks || []))
      for (const a of (h.args || [])) scripts.add(String(a).split(/[\\/]/).pop());
  // base MUST include its OI-4 keep-set hooks and MUST NOT include gsd/full-only ones:
  for (const s of ["bg-supervision-nudge.mjs", "schedulewakeup-loop-only-nudge.mjs", "pnpm-phantom-fix-hook.mjs"])
    assert.ok(scripts.has(s), `base settings must register ${s}`);
  for (const s of ["db-live-access-gate.mjs", "ci-watch-nudge.mjs", "gsd-context-meter.mjs", "task-lifecycle-probe.mjs"])
    assert.ok(!scripts.has(s), `base settings must NOT register ${s}`);
});
```

Update the existing `"hook registrations: lite keeps exactly the 7 lite hooks"` case: its expected script list is unchanged by this refactor (lite's hook set did not change), but confirm it still passes after the `variants.json` rewrite; if `task-lifecycle-probe.mjs` was never in the lite list, no edit is needed.

- [ ] **Step 2: Run tests**

Run: `node --test variants.test.mjs`
Expected: FAIL first (new base case has no matching registration until you confirm base isn't accidentally filtering its hooks), then PASS after verifying `settings.partial.json` registers the base keep-set hooks under the right events.

- [ ] **Step 3: Commit**

```bash
git add variants.test.mjs
git commit -F .git/COMMIT_MSG   # message: "test(variants): denylist-era guards + base hook-registration coverage"
```

---

### Task 4: `bin/lib/stack-markers.mjs` — single-source detection + STACK_PATHS; retire the skill

Port the detection half of `bin/init-stack.py` into a pure, injectable Node lib and delete the `stack-markers` skill. **Source of truth = `bin/init-stack.py`** — port these ranges preserving behavior exactly: `STACK_PATHS` (`:320-343`), `detect()` (`:151-225`) and its helpers `_node_deps`, `_py_requirements`, `_csproj_text`, `_glob_any`, `_glob_any_dir`, and the `PRUNE` set.

**Files:**
- Create: `bin/lib/stack-markers.mjs`
- Create: `bin/lib/stack-markers.test.mjs`
- Modify: `README.md`, `README.en.md` (drop the `stack-markers` skill pointer; point at the marker lib)
- Delete: `payload/skills/stack-markers/**`

**Interfaces:**
- Produces: `export const STACK_PATHS` (the 22-entry stack→template-relpath map, verbatim); `export function detect(root)` → ordered, de-duplicated stack-id array; `export function detectStacks({root})` wrapper. `root` is a parameter (never a module-global `cwd`) so tests can point it at a temp dir.
- Consumed by: `bin/init-stack.mjs` (Task 5–6).

**STACK_PATHS (verbatim — must reproduce exactly):**
```
react→frontend/react.json  next→frontend/next.json  react-native→frontend/react-native.json
nest→backend/node/nest.json  node→backend/node/_base.json
django→backend/python/django.json  fastapi→backend/python/fastapi.json  flask→backend/python/flask.json
python→backend/python/_base.json
android→mobile/android.json  swift→mobile/swift.json  dart→mobile/dart.json
kotlin→CLI/kotlin.json  sql→DB/_base.json
turbo→monorepo/turbo.json  nx→monorepo/nx.json
telegram-node→bots/node.json  telegram-python→bots/python.json
csharp→backend/csharp/_base.json  aspnet→backend/csharp/aspnet.json  csharp-cli→CLI/csharp.json  wpf→desktop/wpf.json
```

**detect() precedence rules that MUST be preserved (see `init-stack.py:151-225`):** node deps come from `package.json` deps+devDeps+peerDeps; python text from `pyproject.toml`+`requirements*.txt` (lowercased); `.csproj` from a pruned tree walk (lowercased); `PRUNE = {.git, node_modules, .venv, venv, dist, build, __pycache__, .next, target, .gradle, .idea, obj, bin}`. Ordering: **react-native before react** (RN pulls react); android gated only on `AndroidManifest.xml`; **dart before swift**, swift suppressed if dart/RN already matched; C# subtypes mutually exclusive in order **aspnet→wpf→csharp-cli→csharp**; bare `node`/`python` fallbacks fire only when no framework matched; return value dedups preserving first-seen order.

- [ ] **Step 1: Write failing tests** `bin/lib/stack-markers.test.mjs` — mirror `test_init_stack.py::DetectCSharpTests` + glob/dep cases against `fs.mkdtempSync` temp roots.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STACK_PATHS, detect } from "./stack-markers.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
function tmp(files) {
  const d = mkdtempSync(join(tmpdir(), "sm-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(d, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content);
  }
  return d;
}

test("react-native wins over react (RN pulls react in)", () => {
  const d = tmp({ "package.json": JSON.stringify({ dependencies: { react: "18", "react-native": "0.74" } }) });
  const s = detect(d);
  assert.ok(s.includes("react-native") && !s.includes("react"), s.join(","));
});
test("csharp subtypes are mutually exclusive: WPF from <UseWPF>", () => {
  const d = tmp({ "App.csproj": "<Project><PropertyGroup><UseWPF>true</UseWPF></PropertyGroup></Project>" });
  const s = detect(d);
  assert.ok(s.includes("wpf") && !s.includes("aspnet") && !s.includes("csharp-cli"), s.join(","));
});
test("every STACK_PATHS value resolves to a real shipped template", () => {
  const tplDir = join(ROOT, "..", "..", "payload", "setting-templates");
  for (const rel of Object.values(STACK_PATHS))
    assert.ok(existsSync(join(tplDir, ...rel.split("/"))), `missing template: ${rel}`);
});
```

- [ ] **Step 2: Run → fail** (`node --test bin/lib/stack-markers.test.mjs` — module missing).
- [ ] **Step 3: Implement `bin/lib/stack-markers.mjs`** porting the ranges above. Use `readdirSync`+recursion for the pruned walks; `JSON.parse` for `package.json`; plain lowercase substring checks for py/csproj text; `fnmatch`-equivalent via `globToRe` (reuse from `variants.mjs`, or a small local matcher) for file/dir globs. Keep every ordering rule.
- [ ] **Step 4: Run → pass.** Then update `README.md`/`README.en.md` to drop the `stack-markers` skill pointer, and delete `payload/skills/stack-markers/**`.
- [ ] **Step 5: Commit**

```bash
node --test bin/lib/stack-markers.test.mjs
git add bin/lib/stack-markers.mjs bin/lib/stack-markers.test.mjs README.md README.en.md
git rm -r payload/skills/stack-markers
git commit -F .git/COMMIT_MSG   # "feat(stack): single-source marker/detect lib; retire stack-markers skill"
```

---

### Task 5: `bin/init-stack.mjs` core — template inheritance resolver + gather (pure, read-only)

Port the pure logic half of `init-stack.py`: `_vertical_ancestors`, `_resolve_chain`, template loading, `classify` (5 states), `gather`, `gather_skills`. No writes, no subprocess — this is the part parity-tested against synthetic + real templates. The side-effecting CLI/apply lands in Task 6.

**Files:**
- Create: `bin/init-stack.mjs` (core exports only this task)
- Create: `bin/init-stack.test.mjs`

**Interfaces:**
- Consumes: `STACK_PATHS`, `detect` from `bin/lib/stack-markers.mjs`.
- Produces: `resolveChain(relPath, {templatesDir, visited})` → `[[label, tplObj], …]` in application order; `verticalAncestors(relPath)` → ancestor `_base.json` rel-paths root-most first (excl. self); `classify(pid, {installed, known, marketplacesDir})` → one of `placeholder|installed|marketplace_missing|available|unavailable`; `gather(stacks, {templatesDir, installed, known})` → `{entries, nonpluginMerge}`; `gatherSkills(stacks, {templatesDir, installedSkills})`. `templatesDir` is injectable (defaults to `~/.claude/setting-templates`).

**`resolveChain` — port `init-stack.py:361-393` precisely:** (1) cycle-guard on `visited` keyed by relPath, self-extends silently ignored; (2) missing template file → `[]`; (3) splice each vertical ancestor's chain (root-most `_base.json` first) via `verticalAncestors`; (4) for each `parent` in `tpl.extends`, recurse and — if `tpl.pick[parent]` names keys — filter EVERY tuple in that sub-chain to those top-level keys; (5) append `(relPath, tpl)` LAST.

- [ ] **Step 1: Write failing tests** — mirror `test_init_stack.py::SyntheticFixtureTests` (resolver mechanics) + the parity cases from `RealTemplatesTests`.

```js
// synthetic: vertical inheritance order + pick filtering + cycle safety, against a temp templatesDir
test("resolveChain: vertical ancestors apply root-most first, self last", () => {
  const dir = writeTemplates({
    "_base.json": { plugins: ["root"] },
    "d/_base.json": { plugins: ["dbase"] },
    "d/leaf.json": { plugins: ["leaf"] },
  });
  const labels = resolveChain("d/leaf.json", { templatesDir: dir }).map(([l]) => l);
  assert.deepEqual(labels, ["_base.json", "d/_base.json", "d/leaf.json"]);
});
test("resolveChain: pick restricts an extended sub-chain to named keys", () => { /* … extends + pick, assert merge/_notes dropped … */ });
test("resolveChain: cycle terminates", () => { /* a extends b, b extends a → no throw, finite */ });

// parity against the REAL shipped templates:
test("react inherits the frontend chain (typescript-lsp, accesslint)", () => {
  const chain = resolveChain(STACK_PATHS.react, {});   // default real templatesDir
  const ids = chain.flatMap(([, t]) => Object.keys(t.plugins || t.enabledPlugins || {}));
  assert.ok(ids.some((i) => /typescript-lsp/.test(i)));
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement the core exports** in `bin/init-stack.mjs`. Mirror the Python semantics; use `JSON.parse(readFileSync(...))` for templates, `load_json`-equivalent that returns `{}` on missing and **throws/exits** on invalid JSON (match `init-stack.py:load_json` behavior — invalid template JSON is a hard error).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
node --test bin/init-stack.test.mjs
git add bin/init-stack.mjs bin/init-stack.test.mjs
git commit -F .git/COMMIT_MSG   # "feat(init-stack): Node template-inheritance resolver + gather (core, read-only)"
```

---

### Task 6: `bin/init-stack.mjs` CLI/apply + profile tier filter; delete Python

Port the side-effecting half and add the **profile-aware plugin tier filter** (spec §4). Then delete the Python implementation and the lite model-driven overlay.

**Files:**
- Modify: `bin/init-stack.mjs` (add `apply`, `commandsFor`, `installMissing`, rules-src→`stack-rules.md` compile, `mark-initstack-done` call, tier filter, CLI dispatch)
- Modify: `bin/init-stack.test.mjs` (apply writes settings; tier filter drops `tier:full` under lite)
- Modify: `payload/commands/init-stack.md` (single command doc for all profiles; ensure it invokes `node bin/init-stack.mjs`, not the Python)
- Modify: `payload/setting-templates/**/*.json` — add `"tier": "full"` to the browser/MCP-backed plugin entries per spec §4 (`playwright`, `chrome-devtools-mcp`, and any MCP-server-backed plugin); everything else defaults to `core` (absent `tier` ⇒ `core`)
- Delete: `bin/init-stack.py`, `bin/test_init_stack.py`, `bin/__pycache__/**`, `payload-lite/commands/init-stack.md`

**Interfaces:**
- Consumes: Task 5 core; the active profile from the manifest (`profile || variant || "full"`) and `maxPluginTier` from `variants.json` (via `resolveVariant`/`loadVariants`).
- Produces: the CLI (`--status <pid>`, `--apply-all`, `-i`/`--interactive`, `--enable <ids…>`, `--remove <ids…>`, default report ending in `=== STATUS_JSON ===`). **Simplification (documented):** the raw-keypress arrow-TUI (`init-stack.py:_enable_vt/_getch/interactive_select`) is reimplemented as a readline numbered checklist matching `setup.mjs`'s `ask()` style — the checklist *semantics* (pre-checked = present ∪ autoenable; orphan-enabled preserved unless unchecked; install-missing→enable→remove) are preserved; the exact arrow-key interaction is not a behavioral requirement. Non-interactive paths (`--status/--apply-all/--enable/--remove/report`) are ported faithfully — these are what parity tests and other scripts depend on.

**Tier filter (new, spec §4):**
```js
// tierRank: core < full. A plugin entry may carry {tier:"core"|"full"}; absent ⇒ "core".
const TIER_RANK = { core: 0, full: 1 };
function keepPlugin(entry, maxPluginTier) {
  const t = (entry && entry.tier) || "core";
  const max = maxPluginTier || "full";               // no cap ⇒ keep everything
  return (TIER_RANK[t] ?? 0) <= (TIER_RANK[max] ?? 1);
}
// In gather(): after resolving a stack's plugin list, drop entries failing keepPlugin(entry, profile.maxPluginTier).
```

- [ ] **Step 1: Write failing tests**

```js
test("apply writes enabledPlugins into .claude/settings.json", () => { /* temp ROOT, apply(["x@mp"],[],stacks) → settings.enabledPlugins["x@mp"]===true */ });
test("tier filter: lite (maxPluginTier=core) drops a tier:full plugin", () => {
  const dir = writeTemplates({ "frontend/react.json": { plugins: { "typescript-lsp@mp": {}, "playwright@mp": { tier: "full" } } } });
  const kept = gather(["react"], { templatesDir: dir, maxPluginTier: "core" }).entries.map((e) => e.id);
  assert.ok(kept.includes("typescript-lsp@mp") && !kept.includes("playwright@mp"), kept.join(","));
});
test("no maxPluginTier keeps tier:full plugins", () => { /* same template, maxPluginTier undefined → playwright kept */ });
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the apply/install/compile/CLI + tier filter. Port `apply` (`init-stack.py:apply` — merges nonplugin keys, sets/deletes `enabledPlugins`, writes settings, prints restart notice), `commandsFor`, `installMissing` (spawnSync `claude plugin …`), the rules-src→`stack-rules.md` compilation (base→direction→cross-cutting concat + dedupe + source-hash header consumed by `hooks/lib/stack-rules-check.mjs`), and the `mark-initstack-done` step (`node hooks/lib/mark-initstack-done.mjs`). Add `"tier":"full"` tags to the browser/MCP template entries.
- [ ] **Step 4: Run → pass.** Then delete the Python files + lite overlay; verify `payload/commands/init-stack.md` references the Node script and applies to all profiles.
- [ ] **Step 5: Commit**

```bash
node --test bin/init-stack.test.mjs
git add bin/init-stack.mjs bin/init-stack.test.mjs payload/commands/init-stack.md payload/setting-templates
git rm bin/init-stack.py bin/test_init_stack.py payload-lite/commands/init-stack.md
git commit -F .git/COMMIT_MSG   # "feat(init-stack): CLI/apply + profile tier filter; delete Python impl"
```

---

### Task 7: Composable CLAUDE.md — fragments + `assemble-claude-md.mjs`

Replace `payload/CLAUDE.md` and `payload-lite/CLAUDE.md` with numbered fragments assembled per profile. **Correction vs the recon of the *current* files:** under unification lite now HAS the stack system, model-selection, graphify, and context-mode components, so its CLAUDE.md is no longer the old lean 69-line machinery-less version. Author fragments from **full's** text as the shared baseline, and create per-profile overrides **only where a profile's component set differs**. The genuine deltas are:

| Fragment stem | shared `profiles:` | per-profile override | Why the delta |
|---|---|---|---|
| `01-title` | full, base | `01-title.lite.md` = `# USER RULES (~/.claude/CLAUDE.md) — lite variant` | test asserts `lite variant` (`setup-variants.e2e.test.mjs:48`) |
| `02-precedence` | base, lite | `02-precedence.full.md` (adds the GSD soft-override note) | GSD is full-only |
| `03-invariants` | all | — | identical |
| `04-reading-order` | all | — | all profiles have the stack-rules system now |
| `05-language` | all | — | identical |
| `06-collaboration` | full, base | `06-collaboration.lite.md` (drops the bg-elapsed-time bullet) | lite has no bg-supervision |
| `07-conventions` | all | — | shared |
| `08-sudo` | all | — | shared |
| `09-plugins` | base, lite | `09-plugins.full.md` (base-plugins list includes `gsd`; mentions managed gsd plugin) | full has gsd; the shared base/lite text lists `superpowers, context-mode, context7` and DOES describe the per-project stack-template/`init-stack`/tier machinery (lite now has it) |
| `10-gsd-methodology` | full | — | full-only (frontmatter `profiles: [full]`) |
| `11-rules-resolution` | all | — | shared; **drop** the retired `stack-markers` skill pointer (OI-1) — point at `.claude/stack-rules.md` + `rules-src/README.md` |
| `12-model-selection` | all | — | all profiles ship model-selection-policy |
| `13-graphify` | all | — | all profiles ship graphify core |
| `14-context-mode` | all | — | all profiles ship context-mode |

> The old lite-only condensed `STACK RULES` and `LAZY SKILLS` sections are **dropped** — they existed only because old-lite lacked the machinery; new-lite uses the shared `04`/`11`/`12`/`13`. Net: `full` = every fragment incl. `10-gsd`; `base` = shared + base overrides, no `10-gsd`; `lite` = shared + lite overrides, no `10-gsd`.

**Files:**
- Create: `payload/claude-md/NN-*.md` (+ overrides above)
- Create: `bin/lib/assemble-claude-md.mjs`, `bin/lib/assemble-claude-md.test.mjs`
- Modify: `variants.json` (append `"claude-md/**"` to `alwaysExclude` — fragments are build inputs, never copied to `~/.claude`)
- Modify: `variants.test.mjs` (remove `"setting-templates"` and `"init-stack.py"` from the lite `FORBIDDEN` token list — lite now legitimately ships/describes templates and the Python is gone; keep `"gsd"` forbidden)
- Delete: `payload/CLAUDE.md`, `payload-lite/CLAUDE.md`

**Interfaces:**
- Produces: `parseFragment(text)→{profiles:string[]|null, body:string}`; `assembleClaudeMd(fragmentsDir, profile)→string` (full text incl. `CURATED:NOEDIT` + `GENERATED` header).
- Consumed by: `setup.mjs` (Task 8).

- [ ] **Step 1: Write failing test** `bin/lib/assemble-claude-md.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFragment, assembleClaudeMd } from "./assemble-claude-md.mjs";

function fixture() {
  const d = mkdtempSync(join(tmpdir(), "cmd-"));
  const w = (n, s) => writeFileSync(join(d, n), s);
  w("05-language.md", "## LANGUAGE\nshared-lang\n");
  w("06-collab.md", "---\nprofiles: [full, base]\n---\n## COLLAB\nkeeps-bg-elapsed\n");
  w("06-collab.lite.md", "## COLLAB\nno-bg-elapsed\n");
  w("10-gsd.md", "---\nprofiles: [full]\n---\n## GSD\nmethodology\n");
  return d;
}
test("parseFragment strips frontmatter, returns profiles + body", () => {
  const r = parseFragment("---\nprofiles: [full, lite]\n---\n## X\nbody\n");
  assert.deepEqual(r.profiles, ["full", "lite"]);
  assert.equal(r.body.trimEnd(), "## X\nbody");
  assert.equal(parseFragment("## Y\nz").profiles, null);
});
test("full: GSD + shared + full/base side of split", () => {
  const o = assembleClaudeMd(fixture(), "full");
  assert.match(o, /## GSD/); assert.match(o, /keeps-bg-elapsed/); assert.doesNotMatch(o, /no-bg-elapsed/);
});
test("base: no GSD, keeps bg-elapsed", () => {
  const o = assembleClaudeMd(fixture(), "base");
  assert.doesNotMatch(o, /## GSD/); assert.match(o, /keeps-bg-elapsed/);
});
test("lite: override wins, no GSD, no shared collab", () => {
  const o = assembleClaudeMd(fixture(), "lite");
  assert.doesNotMatch(o, /## GSD/); assert.match(o, /no-bg-elapsed/); assert.doesNotMatch(o, /keeps-bg-elapsed/);
});
test("header present, no frontmatter leaks", () => {
  const o = assembleClaudeMd(fixture(), "full");
  assert.match(o, /CURATED:NOEDIT/); assert.match(o, /GENERATED/);
  assert.doesNotMatch(o, /^profiles:/m); assert.doesNotMatch(o, /^---$/m);
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `bin/lib/assemble-claude-md.mjs`**

```js
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HEADER =
  "<!-- CURATED:NOEDIT -->\n" +
  "<!-- GENERATED by assemble-claude-md.mjs — edit fragments in payload/claude-md/, not this file. -->\n";

export function parseFragment(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { profiles: null, body: text.replace(/^\n+/, "") };
  const body = text.slice(m[0].length).replace(/^\n+/, "");
  const pm = m[1].match(/^profiles:\s*\[(.*)\]\s*$/m);
  const profiles = pm ? pm[1].split(",").map((s) => s.trim()).filter(Boolean) : null;
  return { profiles, body };
}

export function assembleClaudeMd(fragmentsDir, profile) {
  const files = readdirSync(fragmentsDir).filter((f) => /^\d\d-.*\.md$/.test(f));
  const bySection = new Map(); // stem -> { shared, overrides:Map<profile,file> }
  for (const f of files) {
    const mo = f.match(/^(\d\d-[a-z0-9-]+?)(?:\.(full|base|lite))?\.md$/);
    if (!mo) continue;
    const [, stem, ovr] = mo;
    if (!bySection.has(stem)) bySection.set(stem, { shared: null, overrides: new Map() });
    const rec = bySection.get(stem);
    if (ovr) rec.overrides.set(ovr, f); else rec.shared = f;
  }
  const parts = [];
  for (const stem of [...bySection.keys()].sort()) {
    const rec = bySection.get(stem);
    const overrideFile = rec.overrides.get(profile);
    const file = overrideFile || rec.shared;
    if (!file) continue;
    const { profiles, body } = parseFragment(readFileSync(join(fragmentsDir, file), "utf8"));
    if (!overrideFile && profiles && !profiles.includes(profile)) continue; // shared gated by profiles list
    parts.push(body.trimEnd());
  }
  return HEADER + "\n" + parts.join("\n\n") + "\n";
}
```

- [ ] **Step 4: Author the real fragments** per the delta table (extract each section verbatim from the current `payload/CLAUDE.md`; build the small lite/full overrides). Delete both monoliths; append `"claude-md/**"` to `alwaysExclude`; trim the lite `FORBIDDEN` list.
- [ ] **Step 5: Integration test against the real fragments** (append)

```js
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const REAL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "payload", "claude-md");
test("real fragments: GSD full-only; base keeps bg-elapsed; lite drops it + says 'lite variant'", () => {
  const full = assembleClaudeMd(REAL, "full"), base = assembleClaudeMd(REAL, "base"), lite = assembleClaudeMd(REAL, "lite");
  assert.match(full, /GSD \/ SUPERPOWERS METHODOLOGY/);
  assert.doesNotMatch(base, /GSD \/ SUPERPOWERS METHODOLOGY/);
  assert.doesNotMatch(lite, /GSD \/ SUPERPOWERS METHODOLOGY/);
  assert.match(base, /Elapsed time of a background/);
  assert.doesNotMatch(lite, /Elapsed time of a background/);
  assert.match(lite, /lite variant/);
  for (const o of [full, base, lite]) { assert.match(o, /CURATED:NOEDIT/); assert.doesNotMatch(o, /^---$/m); }
});
```

- [ ] **Step 6: Full suite + commit**

```bash
node --test
git add payload/claude-md bin/lib/assemble-claude-md.mjs bin/lib/assemble-claude-md.test.mjs variants.json variants.test.mjs
git rm payload/CLAUDE.md payload-lite/CLAUDE.md
git commit -F .git/COMMIT_MSG   # "feat(claude-md): composable per-profile CLAUDE.md fragments + assembler"
```

---

### Task 8: `setup.mjs` — 3-way profile, manifest `profile`, assembled CLAUDE.md

Wire the profile into the installer: offer `full/base/lite`, write+read the manifest `profile` field (fallback to `variant`), and assemble+write `~/.claude/CLAUDE.md` from fragments.

**Files:**
- Modify: `setup.mjs` (profile prompt; manifest read ~`:537-538` + write ~`:1002`; neo4j opt-in gate; CLAUDE.md assembly step)
- Modify: `payload/hooks/session-init.mjs:52` (manifest read → add `.profile` fallback)

**Interfaces:**
- Consumes: `assembleClaudeMd` (Task 7), `resolveVariant`/`profilesOf` (Task 1–2).
- Produces: manifest `{ files, profile, variant }` (both keys one release); assembled `~/.claude/CLAUDE.md`.

- [ ] **Step 1: Profile selection** — replace the `[full/lite]` prompt:

```js
const known = Object.keys(profilesOf(loadVariants(REPO_ROOT)));                 // ["full","base","lite"]
const installedProfile = oldManifestEarly ? (oldManifestEarly.profile || oldManifestEarly.variant || "full") : null;
VARIANT = VARIANT_ARG;
if (VARIANT && !known.includes(VARIANT)) { log(`Unknown --variant=${VARIANT}. Known: ${known.join(", ")}`); process.exit(1); }
if (!VARIANT && INTERACTIVE) {
  const def = installedProfile || "full";
  const a = (await ask(`  bundle profile [full/base/lite] (Enter = ${def}) > `)).trim().toLowerCase();
  VARIANT = known.includes(a) ? a : def;
}
if (!VARIANT) VARIANT = installedProfile || "full";
```

- [ ] **Step 2: neo4j opt-in** — change the `if (VARIANT === "lite")` guard to `if (VARIANT === "base")`: neo4j is opt-in for **base** (and always-on for full); **lite never offers it** (its `extends`-inherited exclude drops neo4j and it has no `optional.neo4j` group). Verify: `resolveVariant({variant:"lite", activeOptional:["neo4j"]})` still yields no neo4j files.
- [ ] **Step 3: Manifest field**

```js
// write (was ~:1002): const manifestPayload = { files: manifestNow, profile: VARIANT, variant: VARIANT };
// read (~:537-538): oldManifestEarly ? (oldManifestEarly.profile || oldManifestEarly.variant || "full") : null
// session-init.mjs:52: ).profile || <that json>.variant || "full"
```

- [ ] **Step 4: CLAUDE.md assembly** — after the `placeFile` loop, before the "ensure curated marker" block, assemble from fragments and write with the curated-file conflict flow:

```js
import { assembleClaudeMd } from "./payload/bin/lib/assemble-claude-md.mjs";
// ...
if (!DRY) {
  const assembled = assembleClaudeMd(join(SRC, "claude-md"), VARIANT);
  const dst = join(CDIR, "CLAUDE.md");
  const cur = read(dst);
  if (cur === undefined) { if (write(dst, assembled)) summary.push(`created  ${dst} (assembled ${VARIANT})`); }
  else if (cur === assembled) summary.push(`unchanged ${dst}`);
  else { log(`\n~ conflict (assembled CLAUDE.md): ${dst}`); log(renderDiff(cur, assembled));
    const act = await choose(dst, "merge");
    if (act === "replace") { if (write(dst, assembled)) summary.push(`replaced ${dst} (assembled ${VARIANT})`); }
    else summary.push(`kept (see diff above) ${dst}`); }
}
```
The existing "always ensure curated marker" block still runs and is a no-op (the assembler already emits `CURATED:NOEDIT`).

- [ ] **Step 5: Full suite + commit**

```bash
node --test
git add setup.mjs payload/hooks/session-init.mjs
git commit -F .git/COMMIT_MSG   # "feat(setup): 3-way profile, manifest profile field, assembled CLAUDE.md"
```

---

### Task 9: `setup.mjs` — guided augment/trim flow + e2e for three profiles

Generalize today's `optional`/`activeOptional` (lite-only, neo4j-only) into a per-profile augment/trim step that runs as **one guided flow** — never a chain of manual "now run X" commands (OI-5). Extend the e2e for base and the new transitions.

**Files:**
- Modify: `setup.mjs` (add a `--configure` step / first-run prompt listing augment groups with on/off state, applied in-process; persist selections in the manifest)
- Modify: `variants.json` (any promotable groups beyond `neo4j` per profile, if the review surfaces them; `neo4j` on base is the seed)
- Modify: `setup-variants.e2e.test.mjs` (add base; full→base→lite transitions; manifest `profile` round-trip; augment toggle add/prune)

**Interfaces:**
- Consumes: `resolveVariant`'s `activeOptional` machinery (already round-trips via the manifest + `pruneStale`).
- Produces: manifest carries the active augment groups; re-running with a group toggled off prunes its files (existing `optional` behavior generalized).

- [ ] **Step 1: Write failing e2e cases** (extend `setup-variants.e2e.test.mjs`)

```js
test("base install: exact tree, base keep-set present, gsd absent", () => {
  const dir = freshDir();
  run(dir, ["--variant=base", "--skip-all"]);
  const v = resolveVariant({ repoRoot: ROOT, variant: "base" });
  assertTreeEquals(dir, v.rels);                             // every base rel present, no surplus
  assert.ok(existsSync(join(dir, "hooks/bg-supervision-nudge.mjs")));
  assert.ok(!existsSync(join(dir, "hooks/gsd-context-meter.mjs")));
  assert.equal(readManifest(dir).profile, "base");
});
test("full→base→lite prunes GSD then universal infra; foreign untouched", () => { /* transitions + FOREIGN intact */ });
test("manifest profile round-trips and falls back to variant", () => { /* delete .profile keep .variant → still resolves */ });
test("augment toggle: base + neo4j adds files; toggling off prunes them", () => {
  const dir = freshDir();
  run(dir, ["--variant=base", "--skip-all"]);               // neo4j off by default in base
  assert.ok(!existsSync(join(dir, "bin/lib/neo4j-config.mjs")));
  run(dir, ["--variant=base", "--configure-neo4j=on", "--skip-all"]); // in-process toggle, no manual chain
  assert.ok(existsSync(join(dir, "bin/lib/neo4j-config.mjs")));
  run(dir, ["--variant=base", "--configure-neo4j=off", "--skip-all"]);
  assert.ok(!existsSync(join(dir, "bin/lib/neo4j-config.mjs")));
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the guided augment flow. Interactive: after profile selection, print each promotable group (from the profile's `optional`) with its current on/off state (derived from the filesystem, same idiom as today's neo4j check) and toggle in one pass; non-interactive: accept `--configure-<group>=on|off` flags so the e2e (and CI) never needs a command chain. Feed the resulting `activeOptional` into the single `resolveVariant` call. Persist active groups in the manifest.
- [ ] **Step 4: Run → pass. Full suite.**
- [ ] **Step 5: Commit**

```bash
node --test
git add setup.mjs variants.json setup-variants.e2e.test.mjs
git commit -F .git/COMMIT_MSG   # "feat(setup): guided per-profile augment/trim + three-profile e2e"
```

---

## Self-Review (against the spec)

**Spec coverage:** §2 profile model → Tasks 1–2; §2.2 `extends` chain → Task 1; §3 `init-stack.mjs` → Tasks 4–6; §4 tier filter → Task 6; §5 marker lib + retire skill → Task 4; §6 per-profile augment → Task 9; §7 composable CLAUDE.md → Task 7; §9 file map → all tasks; §10 testing strategy → each task's tests + Task 9 e2e. **§8 Phase 2 (Pro Max + Impeccable) is intentionally a SEPARATE plan** (`2026-07-26-three-profile-design-skills.md`) — it depends on the tier mechanism (Task 6) and the frontend template, and is orthogonal to unification.

**Deferred to review during execution (do not block):** exact `references/**` classification (base vs lite); exact `tier` tags per plugin across all templates (OI-3 — Task 6 seeds only the known browser/MCP ones); whether any promotable group beyond `neo4j` is worth exposing (Task 9).

## Risks (log to RISK_REGISTER.md with stable IDs at execution start)

- **RISK-PORT-001** — Python→Node `init-stack` port drifts from current detection/inheritance behavior. Mitigate: fixture-parity tests (Tasks 4–5 mirror `test_init_stack.py`); the `every STACK_PATHS resolves` invariant.
- **RISK-DENYLIST-001** — moving lite from allowlist to denylist means a NEW payload file is auto-included in lite unless excluded (the old allowlist forced classification). Mitigate: the `lite ⊂ base ⊂ full` subset test + the per-profile family-purity guards (Tasks 2–3); document the flip.
- **RISK-MANIFEST-001** — manifest `variant`→`profile` rename breaks existing installs. Mitigate: dual-write + fallback-read for one release (Task 8), covered by the e2e round-trip test.
- **RISK-CLAUDEMD-001** — assembled CLAUDE.md regresses vs the two curated monoliths. Mitigate: golden + real-fragment integration tests (Task 7); the curated-marker invariant is preserved by the header + the setup ensure-marker block.
- **RISK-TUI-001** — reimplementing init-stack's arrow-TUI as a readline checklist changes interactive UX. Mitigate: non-interactive paths ported faithfully (parity-tested); checklist semantics preserved; flagged for user confirmation.

## Execution Handoff

Recommended: **subagent-driven-development** (fresh subagent per task + two-stage review), matching the AI-dev-mode work. Tasks are ordered by dependency: 1→2→3 (resolver/config), 4→5→6 (stack system), 7 (CLAUDE.md), 8→9 (installer). Task 7 depends on Task 1's `alwaysExclude`; Task 8 depends on Task 7's assembler; Task 6's tier filter depends on Task 2's `maxPluginTier`.

