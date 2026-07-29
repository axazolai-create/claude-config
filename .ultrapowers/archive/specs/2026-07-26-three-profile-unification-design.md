# Three-profile bundle unification + templates in every profile + composable CLAUDE.md — design

**Date:** 2026-07-26 · **Status:** DESIGN DRAFT (awaiting user review → writing-plans)

**Supersedes** the `full`/`lite` two-variant model in
`.ultrapowers/archive/specs/2026-07-22-lite-variant-design.md` §2.1 and the lite-specific
`/init-stack` overlay. That spec's component verdicts are reused as the starting inventory;
this spec re-slots them across three profiles.

---

## 1. Goal

Make **full**, **base**, and **lite** *architecturally identical* — one machinery, one code
path — so the only difference between them is the **set** of components (instructions, skills,
hooks, plugins, services) each includes. No profile has a bespoke implementation of anything.

Concretely, this kills three current divergences:

1. **Two `/init-stack` implementations** (full = Python `bin/init-stack.py` interactive
   selector; lite = model-driven markdown with markers inlined) → **one** Node
   `bin/init-stack.mjs` used by all profiles.
2. **`setting-templates/` exists only in full** (lite excludes it wholesale) → templates ship
   in **every** profile; each profile filters which stack *plugins* it will enable.
3. **Two monolithic `CLAUDE.md` files** (`payload/CLAUDE.md`, `payload-lite/CLAUDE.md`) → one
   **composable** fragment set assembled per profile, so a third profile adds no third monolith.

Two coupled deliverables, sequenced as phases:

- **Phase 1** — the three-profile unification above.
- **Phase 2** — replace `frontend-design` with **Impeccable** + **UI UX Pro Max**, wired into
  the frontend stack template so they apply **only to frontend projects**, in every profile.

## 2. Profile model

Nested subset gradient, each step removing one coherent layer:

```
full  = everything (GSD methodology + all infra + neo4j + services + design skills)
base  = full  − GSD-everything − stack-specific infra hooks
lite  = base  − universal infra hooks − neo4j − stack-plugin subset − CLAUDE.md trim
```

**Locked (user-confirmed):**
- `base` drops **GSD and everything GSD-related**, immediately (agents, gsd hooks/commands/
  skills, gsd managed plugin, worktree-executor-discipline, init-session, gsd-defaults-sync,
  context-mode-gsd-agents, apply-gsd-agent-patches, sync-gsd-context-mode-tool).
- `base` **keeps neo4j** and **includes the design skills** (Pro Max + Impeccable, frontend-scoped).
- Infra-hook boundary = the "middle" reading: **universal** infra hooks live in base;
  **stack-specific** ones do not (see §3 matrix; this is the *default*, refine at review).
- Every profile computes a **default set**; the installer lets the user **augment or trim** it
  at install/config time (§6).

### 2.1 Component matrix (default — adjust at review)

| Component | full | base | lite | Notes |
|---|:--:|:--:|:--:|---|
| secrets-gate, deny-curated-claude-md (INVARIANTS) | ✅ | ✅ | ✅ | hook-enforced, never relaxed |
| session-init, config-dir infra, rules-src (−gsd.md) | ✅ | ✅ | ✅ | |
| Stack system (`init-stack.mjs` + templates + rules) | ✅ | ✅ | ✅ | lite enables a plugin **subset** |
| model-selection-policy, token-usage, update-changelog | ✅ | ✅ | ✅ | lite shows model-selection as a pointer |
| graphify core (setup, sync, freshness, global-sync hook) | ✅ | ✅ | ✅ | |
| leanmode, risk register (add-risk) | ✅ | ✅ | ✅ | |
| Design: Pro Max + Impeccable (frontend-scoped) | ✅ | ✅ | ✅ | Phase 2; via frontend template |
| **Universal infra**: bg-supervision, task-lifecycle-probe, init-mcp | ✅ | ✅ | ❌ | |
| **Stack-specific infra**: pnpm-phantom-fix, db-live-access-gate, ci-watch-nudge | ✅ | ❌ | ❌ | |
| schedulewakeup-loop-only-nudge | ✅ | ✅ | ❌ | universal → base; single-session → out |
| Service: neo4j overlay | ✅ (opt-in) | ✅ (opt-in) | ❌ | |
| **GSD methodology** (all of it) + managed `gsd` plugin | ✅ | ❌ | ❌ | |
| using-git-worktrees shadow skill, stack-markers skill | ✅ | ⚠ | ⚠ | see §5 — markers fold into init-stack.mjs lib |

⚠ `stack-markers` as a *standalone skill* likely disappears in favour of a shared marker
table inside the `init-stack.mjs` lib (§5); tracked as an open item, not a per-profile toggle.

### 2.2 `variants.json` restructure — `extends` chain

`full` stays identity (no `include` ⇒ ships everything). `base` and `lite` become deltas.
The resolver gains an `extends` key that unions the parent's `exclude` before applying the
child's, so no glob list is triplicated.

```jsonc
{
  "managedPlugins": {
    "superpowers": "superpowers@claude-plugins-official",
    "gsd": "gsd@claude-plugins-official",
    "context-mode": "context-mode@context-mode",
    "context7": "context7@claude-plugins-official"
  },
  "profiles": {                          // renamed from "variants" (alias kept 1 release)
    "full": { "plugins": ["superpowers", "gsd", "context-mode", "context7"] },

    "base": {
      "plugins": ["superpowers", "context-mode", "context7"],   // no gsd
      "exclude": [ /* GSD-everything + stack-specific infra hooks (see below) */ ],
      "optional": { "neo4j": [ /* … */ ] }
    },

    "lite": {
      "extends": "base",                 // inherit base's exclude set, then add
      "plugins": ["superpowers", "context-mode", "context7"],
      "overlay": "payload-lite",
      "exclude": [ /* universal infra hooks + neo4j + … on top of base */ ],
      "maxPluginTier": "core"            // §4 — keep only tier:core stack plugins
    }
  }
}
```

Resolver change (`variants.mjs`), sketch:

```js
function resolvedExclude(cfg, name) {          // union parent chain, child last
  const def = cfg.profiles[name];
  const parent = def.extends ? resolvedExclude(cfg, def.extends) : [];
  return [...parent, ...(def.exclude || [])];
}
```

`full` keeps the identity fast-path (`!def.include && !def.exclude`). `base`/`lite` run the
existing include/exclude/optional/overlay machinery with the unioned exclude list. The
`variant`↔`profile` rename is mechanical; keep a `variants` alias reading `profiles` for one
release so a stale `--variant=` flag and the installed manifest keep working.

## 3. init-stack.mjs (Node, single implementation)

Port `bin/init-stack.py` → `bin/init-stack.mjs`; **delete** the Python file, its
`test_init_stack.py`, `__pycache__`, and the lite `payload-lite/commands/init-stack.md`
overlay. `payload/commands/init-stack.md` becomes the single command doc for all profiles.

Responsibilities (unchanged from Python except language + the new plugin filter):
1. Detect stack(s) from marker files (§5 marker table, now a Node lib).
2. Resolve each stack's setting-template inheritance chain (`_resolve_chain` port).
3. **Filter** the resolved plugin list by the active profile's `pluginPolicy` (§4).
4. Present the interactive checklist (states: installed / available / marketplace_missing /
   unavailable / placeholder), install checked-but-missing, merge `enabledPlugins`.
5. Compile `rules-src/` → `.claude/stack-rules.md` (all profiles; unchanged).
6. Ensure `.claude/CLAUDE.md` has `@stack-rules.md`; mark done.

The active profile is read from the install manifest `~/.claude/<manifest>.json` (`setup.mjs`
already records `{ files, variant }` — rename the field to `profile`, keep reading `variant`
as fallback).

Non-interactive parity: `--enable` / `--apply-all` (activate only, no install) port verbatim.

## 4. Stack-plugin filter (profile-aware, centralized)

Setting-templates stay the single source of truth about stacks and are **variant-agnostic**.
Which plugins a profile is *willing to enable* is policy in `variants.json`, applied by
`init-stack.mjs` at step 3.

- Default policy: **keep LSP language servers + lightweight local guidance; drop plugins
  backed by an MCP server or browser automation.**
- Encoded as a per-plugin `tier` tag in the template entry plus a profile → max-tier map, OR a
  simple profile `denyPlugins: [id…]` list. **Chosen:** a `tier` field on each plugin entry
  (`"tier": "core" | "full"`), because it co-locates the weight signal with the plugin and
  keeps `init-stack.mjs` filtering to one predicate. Absent `tier` ⇒ `core` (always kept).

Frontend template result (post-Phase-2):

| Plugin / skill | tier | full | base | lite |
|---|---|:--:|:--:|:--:|
| typescript-lsp | core | ✅ | ✅ | ✅ |
| ui-ux-pro-max (Pro Max) | core | ✅ | ✅ | ✅ |
| Impeccable (npx skill) | core | ✅ | ✅ | ✅ |
| accesslint | core | ✅ | ✅ | ✅ |
| playwright | full | ✅ | ✅ | ❌ |
| chrome-devtools-mcp | full | ✅ | ✅ | ❌ |

`lite` keeps only `core`; `base`/`full` keep everything. (Default — the exact `tier`
assignment per plugin is a review knob.)

## 5. Marker table → shared Node lib

The stack→marker mapping currently exists twice (Python `STACK_PATHS` in `init-stack.py`; the
inlined table in `payload-lite/commands/init-stack.md`) and once more in the `stack-markers`
skill. Consolidate into `bin/lib/stack-markers.mjs` (single source), consumed by
`init-stack.mjs`. The `stack-markers` **skill** either re-exports a generated table or is
retired; decide during planning (open item OI-1).

## 6. Per-profile default + install-time augmentation

Generalize today's `optional` / `activeOptional` (currently lite-only, neo4j-only) so **any**
profile exposes promotable/demotable components:

- Each profile's resolved file set is its **default**.
- `setup.mjs --configure` (and the first-run prompt) lists augmentation groups with their
  current on/off state and lets the user toggle: e.g. `base + pnpm-phantom`, `lite + playwright`,
  `full − neo4j`. Groups map to glob bundles (like `optional.neo4j` today).
- Selections persist in the manifest; a later run that drops a group prunes its files (already
  how `optional` round-trips). Augmenting is purely additive over the profile default; trimming
  is expressed as promotable groups that default to on for that profile.

This keeps the profile a clean baseline while making every install adjustable without editing
`variants.json`.

## 7. Composable CLAUDE.md

Replace `payload/CLAUDE.md` and `payload-lite/CLAUDE.md` with `payload/claude-md/` fragments,
assembled per profile by `bin/lib/assemble-claude-md.mjs` (called from `setup.mjs`), mirroring
the `rules-src → stack-rules.md` pattern.

- Fragments `NN-<section>.md`, concatenated in numeric order.
- Frontmatter `profiles: [full, base, lite]` selects inclusion (default: all).
- Sections whose **text differs** get per-profile files `NN-<section>.<profile>.md`; the
  active profile's file wins over the shared one. Sections needing this (from the current two
  files): `PRECEDENCE`, `INVARIANTS`, `COLLABORATION CONTRACT` (lite drops the bg-elapsed-time
  rule; base keeps it since bg-supervision is in base), `SUDO`, `PLUGINS & SKILLS` (all three
  differ), `RULES RESOLUTION` vs lite `STACK RULES`, `Model-selection`/`graphify` (inline in
  full/base, pointer in lite).
- `GSD / SUPERPOWERS METHODOLOGY` fragment carries `profiles: [full]`.
- Output written to `~/.claude/CLAUDE.md` with a `GENERATED — edit fragments in the bundle`
  header. Source of truth = fragments. The `deny-curated-claude-md` invariant is unaffected:
  the AI still cannot Write/Edit `~/.claude/CLAUDE.md`; only the installer writes it, exactly as
  today (it just concatenates fragments instead of copying one file).

## 8. Phase 2 — design skills into the frontend template

In `payload/setting-templates/frontend/_base.json`, **remove** the `frontend-design` plugin
entry (and its `enabledPlugins` key) and add:

- **UI UX Pro Max** — a real plugin, but marketplace install fails on Windows for versions
  < 2.5.1 (`Zip file contains a symbolic link`). Install via the **CLI installer**
  (`npm i -g ui-ux-pro-max-cli && uipro init --ai claude --offline`) as a `skills[]`-style
  entry, not `plugins[]`/`enabledPlugins`. Basic version is MIT, fully local (BM25 over local
  CSV data), **no account/registration/API key** — verified from repo + docs; the `--offline`
  flag exists. Premium (brand/logo/AI-image) is a separate paid product at uupm.cc, unused.
- **Impeccable** — not a plugin; an npx skill. Add as a `skills[]` entry
  (`npx impeccable install`, then `/impeccable init`), same channel as the existing `shadcn`
  skill. Apache-2.0; deterministic detector rules run with no LLM/API key.

Both are `tier: core` ⇒ present in all three profiles, and — being in the frontend template —
surface **only when `/init-stack` detects a frontend stack**. Non-frontend projects (Kotlin,
Python) never load them.

Open item OI-2: confirm at implementation whether Pro Max's CLI-generated skill should be
**vendored** into the bundle (reproducible, offline, version-pinned) or installed live per
project via the template's `skills[]` command. Lean vendored for determinism on Windows.

## 9. Files touched (map)

- `variants.json` — `variants`→`profiles`, add `base`, `extends` chain, `pluginPolicy`/`tier`,
  generalized `optional`.
- `variants.mjs` — `extends` union, profile fast-paths, alias.
- `setup.mjs` — 3-way profile prompt, profile-aware setting-templates copy (no longer
  "full overwrite, no gating"), CLAUDE.md assembly call, augmentation UI, manifest `profile`.
- `bin/init-stack.mjs` (new), delete `bin/init-stack.py` + `bin/test_init_stack.py` +
  `payload-lite/commands/init-stack.md`.
- `bin/lib/stack-markers.mjs` (new), `bin/lib/assemble-claude-md.mjs` (new).
- `payload/claude-md/**` (new fragments); delete `payload/CLAUDE.md`, `payload-lite/CLAUDE.md`.
- `payload/setting-templates/frontend/_base.json` — Phase 2 swap.
- Tests: `variants.test.mjs`, `setup-variants.e2e.test.mjs` extended for 3 profiles +
  assembly + plugin filter; new `init-stack.mjs` unit tests.

## 10. Testing strategy

- **Resolver** (`variants.test.mjs`): for each profile, assert the resolved file set is the
  expected subset; assert `lite ⊂ base ⊂ full`; assert `extends` unions excludes; assert GSD
  files absent from base/lite, neo4j present in base, absent in lite.
- **CLAUDE.md assembly**: golden-file per profile; assert GSD section only in full, lite trims,
  no unresolved `profiles:` frontmatter leaks into output, header present.
- **init-stack.mjs**: stack detection parity vs the old Python (table-driven fixtures);
  plugin-filter drops `tier: full` plugins under `lite`; `enabledPlugins` merge shape unchanged.
- **e2e** (`setup-variants.e2e.test.mjs`): install full→base→lite→base transitions prune the
  right files, foreign files never touched, manifest `profile` round-trips, augmentation
  toggle adds/prunes a group.
- **Phase 2**: frontend template resolves Pro Max + Impeccable in all profiles; a non-frontend
  fixture never surfaces them; Windows offline install smoke for Pro Max.

## 11. Open items

- **OI-1** `stack-markers` skill: re-export generated table vs retire.
- **OI-2** Pro Max: vendored skill vs live per-project install (lean vendored).
- **OI-3** exact `tier` assignment per plugin across all templates (review knob).
- **OI-4** exact base infra keep-set (§2.1 default is the "middle" reading).
- **OI-5** augmentation UX: reuse `/init-stack -i` checklist styling vs a dedicated
  `setup.mjs --configure` screen.

## 12. Risks

Logged to `RISK_REGISTER.md` with stable IDs during planning. Seeds:
- Python→Node init-stack port drifts from current detection behavior (mitigate: fixture parity).
- Manifest field rename (`variant`→`profile`) breaks existing installs (mitigate: fallback read).
- Pro Max marketplace symlink failure on Windows (mitigate: CLI/offline install, vendoring).
- CLAUDE.md assembly regressions vs the two curated monoliths (mitigate: golden files, diff the
  full-profile output against today's `payload/CLAUDE.md` byte-for-byte modulo the header).
