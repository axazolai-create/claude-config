# Ultrapowers Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design:** `.ultrapowers/archive/specs/2026-07-27-ultrapowers-fork-design.md`
**Supersedes:** `.ultrapowers/archive/plans/2026-07-27-ultrapowers-layer0-patcher.md` in full.

**Goal:** `ultrapowers` exists as an owned, fully rebranded fork of `superpowers@claude-plugins-official`, installed instead of upstream, and stays current via one command (`/up-update`) runnable from any project — which either completes the update or refuses and says what needs work.

**Architecture:** Two repositories. The **fork repo** (`axazolai/ultrapowers`, public) holds three branches: `original` (pristine upstream snapshots, one commit per release, tagged), `patch` (the rename transform, its config/keep-list, and our deltas as discrete patch files), `main` (generated: `original` + `patch`, installable, carries its own `.claude-plugin/marketplace.json`). **`claude-config`** owns the install wiring (`variants.json → managedPlugins`, reconciled by `setup.mjs` at user scope) and ships `/up-update`, which drives the fork repo but never lives in it.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert`, `git` CLI via `spawnSync`. No new deps.

## Scope of installation, and what this plan may touch (user-directed, 2026-07-27)

**Where the plugin ends up:** `ultrapowers` is a **user-scope** plugin, installed through `setup.mjs` alongside `context7` and `context-mode` — i.e. `variants.json → managedPlugins` plus the profiles' `plugins` arrays, exactly as the design specified. It is a base capability, not a per-stack one, so the per-project `setting-templates` path would be the wrong shape for it.

**What the plan itself may not do:** no task here writes a live `settings.json`, `settings.local.json`, or anything under `~/.claude/**`. Tasks change *sources* in the repository — `variants.json`, `plugin-reconcile.mjs`, `setup.mjs`, the payload — and the actual reconciliation happens when the human runs `setup.mjs`. Development-time marketplace probing goes against a throwaway `CLAUDE_CONFIG_DIR`, never the real one. `/up-update` likewise keeps no state outside a repository.

The distinction matters because these two are easy to conflate: the *product* installs machine-wide; the *work of building it* touches nothing but the two repositories.

**Development happens in its own branch and folder**: the fork in `D:\6__Work\AI_Projects\ultrapowers`, the `claude-config` wiring on `feat/ultrapowers-rework`.

## Global Constraints

- **`main` is generated, never hand-edited.** Every task that changes the plugin's content changes `patch` (or `original`), then rebuilds. A change on `main` not derivable from `original` + `patch` is a defect the build must detect.
- **The keep-list is legal, not technical.** `LICENSE` verbatim; upstream authorship and the `obra/superpowers` URL in README and `plugin.json` `description`. Every entry carries a recorded reason, printed by `/up-update`.
- **Upstream is disabled, not uninstalled.** Rollback stays one command, and two enabled plugins with 14 colliding skill names is undocumented behaviour we do not test in production.
- ESM `.mjs`, `node:test`. Reuse existing `claude-config` patterns: `isMain()` symlink-robust entry guard and `CLAUDE_CONFIG_DIR || join(homedir(),".claude")` resolution (copy from `hooks/lib/stack-rules-check.mjs`).
- **No network in tests.** GitHub release detection is injected as a function; tests pass a fake.
- **`/up-update` never pushes without confirmation.** It refuses on a dirty `claude-config` tree (a human may be mid-edit there); the fork side has no such check because the command works in a throwaway clone, not in anyone's checkout.
- **No persistent state outside a repository.** No file under `~/.claude/**` is created, read for configuration, or written by anything in this plan.

## Decisions (the design's "Open assumptions", resolved by the user 2026-07-27)

| # | Decision | Where it is parameterised |
|---|---|---|
| A1 | Repository is **`axazolai/ultrapowers`**, **public**, plugin at `./plugins/ultrapowers`, marketplace at repo root | Constants in `up-update.mjs`; the id also appears in `variants.json → managedPlugins` |
| A2 | **`/up-update` always works through GitHub**, never through a local checkout. The sibling folder `D:\6__Work\AI_Projects\ultrapowers` is a *development* checkout only — the command neither reads nor writes it | Repository identity is a constant in the command's own source, overridable per run by `--repo`; no state file anywhere |
| A3 | Refusal threshold = upstream touched >25% of transform-rewritten files, **or** any keep-list file. *Chosen by me, not measured* | `transform/config.json` on `patch` (it is a property of the transform) |
| A4 | Forked upstream version is the **latest release, `v6.2.0`** (published 2026-07-24) — which is also the version currently installed, so the first build has a local reference to compare against | `original` tag `upstream/6.2.0` |
| A5 | Name is **plural, `ultrapowers`** — a single substitution pair per case form keeps prose grammatical (`gives you ultrapowers`) | `transform/config.json → substitutions` |

**A2, and why it matters more than it looks.** The command's stated property is "runnable from any project" — a dependency on a development checkout would quietly break that on every machine that does not have one, which is every machine except this one. So `/up-update` owns its own git state and treats GitHub as the only source of truth:

- A **throwaway clone into an OS temp directory**, made fresh per run and removed afterwards. Not a cached mirror under `~/.claude/`: caching would be faster, but it is persistent user-scope state, which this plan does not create — and a stale cache would make "which tree is `main` built from" ambiguous, the exact failure the `original` branch exists to prevent. The clone is shallow except for the `original` branch's tags, which the version comparison needs.
- **No configuration file.** Owner/repo/upstream are constants in `up-update.mjs`, overridable per run by `--repo owner/name`. Config that lives in one place cannot drift from config that lives in another.
- The dev checkout is out of scope entirely: not read, not written, not required to exist, and its state cannot make the command behave differently.

This also removes a coupling the earlier draft had: refusal semantics no longer depend on the cleanliness of a tree a human might be working in.

**Where configuration lives:** thresholds belong to the transform and must version with it, so they live in `transform/config.json` on `patch`. Repository identity is a constant in the command's source with a `--repo` override. Nothing is written to `~/.claude/**` — which also sidesteps the "payload redeploy overwrites user edits" problem instead of inventing a merge rule for it.

## File Structure

**Fork repo — `patch` branch (new)**
- `transform/inventory.json` — the plugin map: ordered `rules`, the confirmed `manifest` of every known upstream path, and `forkOwned` *(built)*
- `transform/classify.mjs` + `.test.mjs` — pure classifier/reconciler; no fs *(built)*
- `transform/inventory.mjs` — `sync` / `check` CLI over the recorded upstream tree *(built)*
- `transform/config.json` — substitution table, attribution assertions, thresholds *(built)*
- `transform/rename.mjs` — pure substitution engine (no fs)
- `transform/rename.test.mjs`
- `transform/build.mjs` — read `original` → filter by the map → rename → relocate under `pluginRoot` → overlay `forkOwned` → apply deltas → assert attribution → write build tree
- `transform/build.test.mjs`
- `transform/fork-owned/` — files we author, no upstream counterpart (`marketplace.json`, `gitattributes`, `README.plugin.md`, `README.repo.md`)
- `transform/deltas/NNN-*.patch` — our own changes, discrete and individually applicable
  - `001-fallow-graft.patch` — the graft `claude-config` applies at runtime today
  - `002-drop-platform-adaptation.patch` — removes the section linking the ignored per-harness references
  - `003-plugin-version-source.patch` — `server.cjs` reads the version from `.claude-plugin/plugin.json`
  - `004-plugin-manifest.patch` — `plugin.json`: version, author, homepage/repository become ours, description gains the attribution the build asserts
  - `005-brand-link.patch` — the brainstorming UI brand link points at this fork
  - *(no delta for `hooks/session-start`'s citation of upstream issue 571 — it stays `obra/superpowers` by design)*

**Fork repo — `main` branch (generated)**
- `.claude-plugin/marketplace.json`
- `plugins/ultrapowers/**` (the rebuilt plugin)
- `LICENSE` (byte-identical to upstream)

**`claude-config` — new**
- `payload/bin/up-update.mjs` — CLI dispatch (`check` / `update` / `status`)
- `payload/bin/lib/up-update-lib.mjs` — pure: version compare, assessment, refusal decisions
- `payload/bin/lib/up-update-lib.test.mjs`
- `payload/commands/up-update.md` — prose orchestration
- `payload/bin/up-progress.mjs` — resume-point reconstruction CLI (Task 0b)
- `payload/bin/lib/up-progress-lib.mjs` + `.test.mjs` — pure: probe reconciliation
- `payload/bin/lib/up-progress-probes.json` — the plan→probe table (data, not code)
- `payload/commands/up-resume.md`, `payload/commands/up-progress.md` — resume / report-only
- `.ultrapowers/archive/plans/2026-07-27-ultrapowers-fork.STATE.md` — the STATE file (generated)

**`claude-config` — modified**
- `variants.json` — `managedPlugins` gains `ultrapowers`; new `keepInstalled`; profiles swap the name
- `plugin-reconcile.mjs` + `.test.mjs` — disable-without-uninstall
- `setup.mjs` — marketplace registration before install; pass `keepInstalled`
- `RISK_REGISTER.md` — per the design's risk table
- `.ultrapowers/archive/plans/2026-07-27-ultrapowers-layer0-patcher.md` — superseded header
- `README.md` / `README.en.md` — the fork replaces upstream in the plugin list

---

### Task 0: Create the repository and the development checkout

**Why separate from Task 1:** this is the only task that is pure infrastructure — it creates an empty remote and a local working copy, and produces nothing that any later task can get wrong. Splitting it out keeps Task 1 about the thing that actually needs care (the immutable `original` seed), and makes the "did the repo get created with the right visibility" question answerable on its own.

**Files:** none. Creates `axazolai/ultrapowers` and `D:\6__Work\AI_Projects\ultrapowers`.

**Interfaces — Produces:** an empty public remote; a clone at the sibling path. **No config file, no settings change** — the plugin is not installed or enabled anywhere by this task.

- [x] **Step 1: Create the repository** — `axazolai/ultrapowers`, **public** (A1). Public is load-bearing, not a preference: `/plugin marketplace add` on a fresh machine has no git authentication, and the bootstrap install depends on that working.
- [x] **Step 2: Clone it** to `D:\6__Work\AI_Projects\ultrapowers` (A2). This is the *development* checkout — used to build Tasks 1–5 by hand. `/up-update` will never read or write it.
- [x] **Step 3: Do not initialise the repo with a README, license, or `.gitignore`.** Every branch created in Task 1 is orphan-rooted; a default initial commit would become an ancestor of `original` and quietly break "one commit per upstream release".

**Verification:**
- `gh repo view axazolai/ultrapowers --json visibility` reports `PUBLIC`.
- `git log --all` in the clone is empty — no initial commit exists.
- `~/.claude/settings.json` and the project's `.claude/settings.json` are byte-identical to before this task.

---

### Task 1: Branch skeleton and the `original` seed

**Why:** `original` is the recorded base `main` is built from. Acceptance 2 (byte-for-byte rebuild) is only checkable against an immutable base held in our own repository — `upstream/main` moves and can be force-pushed.

**Files:** none in `claude-config`. Populates the fork repository.

**Interfaces — Produces:** branches `original`, `patch`, `main`; tag `upstream/6.2.0`.

- [x] **Step 1: Push three orphan-rooted branches** — `original` (upstream 6.2.0 tree, verbatim), `patch` (empty but for `transform/`), `main` (empty placeholder until Task 4 builds it). Orphan roots, so the three histories never share ancestry: they hold different kinds of thing and merging them is never the right operation.
- [x] **Step 3: Seed `original`** from the upstream release tarball for `v6.2.0` — **not** from the local plugin cache, which may carry local drift. Tag it `upstream/6.2.0`. Cross-check against the installed cache afterwards: a difference means the cache drifted and is worth knowing about, but the tarball wins.
- [x] **Step 4: Record the seed's tree hash** in `transform/config.json` as `originalTree`, so a later rebuild can prove which base it used.

**Verification:**
- [x] `git ls-tree -r upstream/6.2.0` hash equals the hash of the extracted upstream tarball tree (compute both, compare — do not eyeball).
- [x] `LICENSE` present on `original` and unmodified.
- [x] `git log original` has exactly one commit.

**As built (2026-07-28).** The tarball could not be extracted on Windows — it carries one symlink (`AGENTS.md -> CLAUDE.md`) and `tar` aborts. So `original` was seeded from the **upstream tag's tree object** (`git fetch` of `refs/tags/v6.2.0`), which makes it byte-identical to upstream *by construction* rather than by comparison, and preserves the symlink as mode `120000`. The tarball was still downloaded and used as the independent cross-check the verification asks for: all 180 files matched (`TARBALL_MATCH=true`).

Identity of the seed: annotated tag `0e5cc50e…` → commit `3dcbd5c4…` → tree `da1e7bb9…`. GitHub's tarball prefix (`obra-superpowers-0e5cc50`) is the **tag object** sha, not a commit — worth recording, because it looks like a mismatch and is not one.

**Cache cross-check result:** 22 files differ by line endings only (CRLF on checkout — benign), and exactly **one** differs in substance: `skills/requesting-code-review/code-reviewer.md`, carrying our own `fallow-graft`. That is our modification, not upstream drift; per the user's 2026-07-28 decision it becomes `transform/deltas/001-fallow-graft.patch` and the runtime graft in `claude-config` is retired in Task 10.

---

### Task 2: The plugin map, transform config and attribution assertions

> **Revised 2026-07-28 (user-directed).** The original task took the whole upstream tree and
> renamed it. It now takes **only what is actually the plugin**. Everything else — other
> harnesses, upstream's own test suite, their docs and release tooling — is recorded as
> *deliberately ignored* rather than silently dropped, and any upstream file in neither
> bucket is **new** and blocks the build until a human classifies it.

**Why:** the substitution table and the map are data, not code — they are what a human reviews when an upstream release lands, and what `/up-update` prints. Keeping them in code would make every review a code review.

**Files (as built):**
- `transform/inventory.json` — rules + manifest + `forkOwned`
- `transform/classify.mjs` + `transform/classify.test.mjs` — pure classifier and reconciler
- `transform/inventory.mjs` — `sync` / `check` CLI over the recorded upstream tree
- `transform/config.json` — substitutions, attribution assertions, thresholds

**Interfaces — Produces:** `classify(path, rules) → rule|null`, `reconcile({paths, rules, manifest}) → {tracked, ignored, added, removed, unclassified, reclassified}`.

**Rules propose, the manifest confirms.** Globs alone would auto-adopt any file upstream adds under `skills/**`; a literal 180-path list alone would be unmaintainable. Both together give maintainability *and* the assessment gate: a path missing from the manifest is reported `NEW` with the class its rule *proposes*, and `check` exits non-zero until it is recorded.

**Result — 51 tracked / 129 ignored of 180:**

| tracked (carried across, renamed, watched) | ignored (not shipped) |
|---|---|
| `.claude-plugin/plugin.json` | `tests/` 53, `docs/` 39, `.github/` 6, `scripts/` 4, `assets/` 2 |
| `hooks/hooks.json`, `run-hook.cmd`, `session-start` | `.agents/ .codex-plugin/ .cursor-plugin/ .kimi-plugin/ .opencode/ .pi/`, `gemini-extension.json`, `hooks/hooks-cursor.json` |
| `skills/**` (46) | `.claude-plugin/marketplace.json`, `README.md` (both fork-owned instead) |
| `LICENSE` (verbatim, legal) | upstream repo infra + `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`/`CODE_OF_CONDUCT.md`/`RELEASE-NOTES.md` |

**Reference closure was checked, not assumed** — no tracked file may reference an ignored one. Three real edges, all resolved:
- `assets/*` is referenced only by `.codex-plugin/plugin.json`; they leave together.
- `skills/brainstorming/scripts/server.cjs` reads a version from `package.json` / `.codex-plugin/plugin.json` (fallback `'unknown'`) → delta 003 repoints it at `.claude-plugin/plugin.json`.
- `skills/using-superpowers/references/**` (Codex/Pi/Gemini/Antigravity notes) → ignored per user decision; delta 002 removes the *Platform Adaptation* section that links them.

**The keep-list became an assertion.** The plan's `protect-matches` on `README.md` was a defect: all nine `obra/superpowers` occurrences there are **install instructions for upstream's own channels**, so freezing them ships a README that installs the wrong plugin. README is therefore fork-owned, and MIT attribution is discharged by `config.attribution.require` — the build asserts the credit is present in the built tree and refuses without it. `LICENSE` stays verbatim. An assertion cannot rot into a stale protected string the way a freeze can.

- [x] **Step 1: Write the config** (shape below is the pre-revision draft, kept for the record; the built `config.json` replaces `keepList` with `attribution.require` and adds `unclassifiedRefuses`)

```json
{
  "originalTree": "<filled by Task 1 step 4>",
  "substitutions": [
    { "from": "superpowers", "to": "ultrapowers" },
    { "from": "Superpowers", "to": "Ultrapowers" },
    { "from": "SUPERPOWERS", "to": "ULTRAPOWERS" }
  ],
  "keepList": [
    { "path": "LICENSE", "mode": "verbatim",
      "reason": "MIT obligation: upstream copyright notice must survive redistribution" },
    { "path": "README.md", "mode": "protect-matches",
      "protect": ["obra/superpowers", "github.com/obra/superpowers", "Jesse Vincent"],
      "reason": "MIT attribution: fork must name upstream and its repository, stated as a fork" },
    { "path": ".claude-plugin/plugin.json", "mode": "protect-matches",
      "protect": ["obra/superpowers"],
      "reason": "attribution in description; author field is ours because we maintain this artifact" }
  ],
  "thresholds": {
    "changedFilesPct": 25,
    "keepListTouchedRefuses": true,
    "$comment": "A3: starting value, not measured. Calibrate over the first real updates - a threshold that never fires is decoration, one that always fires is noise."
  }
}
```

- [x] **Step 2: No test of its own** — ~~it is data, exercised by Tasks 3 and 4~~. **Revised:** the map is data, but classifying and reconciling it is code, so `classify.mjs` carries a real suite (14 tests) that also asserts properties of the data itself: every rule and every fork-owned entry has a usable reason, the map and the config describe the same upstream base, and the recorded manifest reproduces exactly from the rules with nothing unclassified.

**Verification:**
- [x] `node --test` (repo root) → 14/14 green. **Note:** the plan's `node --test transform/` does not work on Node 25 — a bare directory is resolved as a module and fails with `MODULE_NOT_FOUND`. Use `node --test` from the repo root or `node --test transform/*.test.mjs`.
- [x] `node transform/inventory.mjs check` → `tracked 51 | ignored 129 | new 0 | removed 0 | unclassified 0 | reclassified 0`.
- [x] Every rule and every attribution requirement carries a non-empty `reason` — asserted in the suite, since an unreasoned entry is exactly the drift the design guards against.

---

### Task 3: The rename engine (pure)

**Why this way:** inside our own fork the rename is a *wholesale* substitution — there is no foreign identity left to protect, which is precisely what killed the two classifier designs. The engine therefore has no heuristics at all: it substitutes everywhere and consults the keep-list only for the small set of legally-motivated exceptions. Any rule that needs judgement is a bug in this design, not a feature of the engine.

**Files:**
- Create: `transform/rename.mjs`
- Test: `transform/rename.test.mjs`

**Interfaces — Produces (as built):** `renameText(text, cfg) → string`, `renamePath(relPath, cfg) → string`.

> **Revised 2026-07-28.** `relPath` is gone from `renameText`, and `keepEntryFor` is gone entirely — the map (Task 2) already decided which files are renamed, so the engine has *no* path argument and therefore no place for path-shaped judgement to hide. This is stronger than the verification below asks for: instead of grepping for stray `if (relPath` branches, the signature makes them unrepresentable, and a test asserts `renameText.length === 2` so the parameter cannot come back.

**One thing the engine deliberately does not rename: `obra/superpowers`.** Measured on 6.2.0 there are four occurrences across three tracked files, and they do not want the same treatment — the brainstorming brand link and `plugin.json`'s `homepage`/`repository` should become ours, while the comment citing upstream issue 571 must stay theirs or it becomes a dead link and a false claim about where the bug was filed. That difference is *intent*, which no rule over paths or strings can infer. So the engine leaves all four standing (global `config.protect`) and each is decided once, in a numbered delta. The failure mode this avoids is the one that matters: when a future upstream release adds a link we have never seen, doing nothing is always safe and inventing an owner name is not.

- [x] **Step 1: Write the failing tests** (12 tests, RED confirmed before implementing)

```javascript
// transform/rename.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renameText, renamePath, keepEntryFor } from "./rename.mjs";

const cfg = JSON.parse(await import("node:fs").then(fs => fs.readFileSync("./transform/config.json", "utf8")));

test("substitutes every case form in prose", () => {
  assert.equal(renameText("Superpowers gives you superpowers", cfg, "skills/x/SKILL.md"),
    "Ultrapowers gives you ultrapowers");
});

test("substitutes the skill namespace so invocation names are real", () => {
  assert.equal(renameText("superpowers:brainstorming", cfg, "skills/x/SKILL.md"),
    "ultrapowers:brainstorming");
});

test("rewrites paths, including directory components", () => {
  assert.equal(renamePath("plugins/superpowers/skills/superpowers-x/SKILL.md", cfg),
    "plugins/ultrapowers/skills/ultrapowers-x/SKILL.md");
});

test("LICENSE is verbatim - not one byte changes", () => {
  const src = "MIT License\n\nCopyright (c) Jesse Vincent\nsuperpowers\n";
  assert.equal(renameText(src, cfg, "LICENSE"), src);
});

test("attribution survives inside an otherwise-renamed README", () => {
  const out = renameText("Ultrapowers is a fork of obra/superpowers by Jesse Vincent. superpowers rocks.",
    cfg, "README.md");
  assert.match(out, /obra\/superpowers/);
  assert.match(out, /ultrapowers rocks/);
});

test("every keep-list entry carries a reason", () => {
  for (const e of cfg.keepList) assert.ok(e.reason && e.reason.length > 10, `${e.path} has no reason`);
});
```

- [x] **Step 2: Implement `rename.mjs`** — ~~`mode: "verbatim"` / `mode: "protect-matches"` per keep-list entry~~. **As built:** verbatim is a property of the map (`LICENSE`, decided by the caller), and protection is a single **global** `protect` list masked with a `NUL`-delimited placeholder, substituted, then unmasked. Longest protected string first, so an overlapping pair cannot half-match. `NUL` in the input throws rather than corrupting the mask. No path-shape guessing anywhere.
- [x] **Step 3: Confirm the tests pass and that `rename.mjs` imports no `node:fs`** — purity is what makes it testable without a tree.

**Verification:**
- [x] `node --test` green — 25/25 across the whole suite (12 of them this task's).
- [x] Path branching: `grep -c "if (relPath" transform/rename.mjs` → 0, `grep -c "node:fs"` → 0. The signature assertion is the durable guard; the grep only confirms today's state.
- [x] **Empirical dry run over the real tracked tree** (not just fixtures): all 51 tracked files renamed, 1 path rewritten (`skills/using-superpowers` → `skills/using-ultrapowers`), `LICENSE` byte-identical, and exactly the 4 protected `obra/superpowers` occurrences left standing. This is the evidence that acceptance 3 will hold once deltas 004/005 resolve three of those four and the fourth is kept on purpose.

---

### Task 4: `build.mjs` — `original` + `patch` → `main`

**Why:** the build *is* the guarantee. If a rebuild is not byte-for-byte reproducible, "no local modifications are lost on upstream update" is a claim nobody can check, and the fork degrades into the hand-maintained copy this design exists to avoid.

**Files (as built):**
- `transform/patch.mjs` + `.test.mjs` — pure unified-diff parser and applier (12 tests)
- `transform/build.mjs` + `.test.mjs` — pure pipeline (15 tests)
- `transform/build-cli.mjs` — the git I/O: `check` / `emit` / `tree` / `drift` / `commit`
- `transform/fork-owned/` — `marketplace.json`, `gitattributes`, `README.plugin.md`, `README.repo.md`
- `transform/deltas/001..005` — the five deltas

**Interfaces — Produces (as built):** `build({ tree, cfg, inventory, forkOwned, deltas }) → { files, mapDrift, applied[], obsolete[], failed[], failures[], attributionMissing[], residual[] }`. Pure: no fs, no git, no network — the CLI supplies the tree and writes the result, which is what makes the fixture tests possible.

**A from-scratch patch applier, not `git apply`.** Shelling out would make the build impure and untestable without a checkout. `patch.mjs` matches hunks **by context with drift tolerance** (upstream edits move our line numbers), distinguishes *already applied* from *cannot apply*, and refuses to half-write a file whose later hunk fails. A hunk whose body contradicts its own `@@` header throws — a blank context line stripped of its leading space would otherwise corrupt a delta silently, and that is precisely the failure this fork cannot afford to have go quiet.

- [x] **Step 1: Write the failing tests** over a fixture tree (RED confirmed for both modules before implementing) (a handful of files with the upstream name in path, prose and JSON), not over the real 111-file plugin — the real tree is the acceptance check, not the unit test.
- [ ] **Step 2: Implement the pipeline**, in this order and no other:

```javascript
// transform/build.mjs (shape, not the whole file)
export function build({ tree, cfg, deltas }) {
  // 1. rename: paths first, then contents - a delta authored against the renamed tree
  //    must see final paths, otherwise every delta encodes the rename too
  const renamed = new Map();
  for (const [rel, buf] of tree) {
    const keep = keepEntryFor(rel, cfg);
    const outRel = keep?.mode === "verbatim" ? rel : renamePath(rel, cfg);
    renamed.set(outRel, isText(rel) ? renameText(buf.toString("utf8"), cfg, rel) : buf);
  }
  // 2. deltas: discrete, ordered, individually applicable. A delta that applies to zero
  //    lines is NOT an error here - it is reported upward as "upstream did this".
  const applied = [], obsolete = [], failed = [];
  for (const d of deltas) {
    const r = applyPatch(renamed, d);
    (r.hunks === 0 ? obsolete : r.ok ? applied : failed).push(d.name);
  }
  return { files: renamed, applied, obsolete, failed };
}
```

- [x] **Step 3: Rename before deltas, always.** Deltas are authored against the built tree, so they must not carry the rename themselves — that is what keeps "upstream implemented this for us" detectable (Task 9). Authoring loop as built: `build-cli emit` → hand-edit a copy → `diff -u` → save as `NNN-*.patch`.
- [x] **Step 4: Commit the result to `main`** as a single commit whose message records `original` tag + `patch` commit sha. `main`'s history is a build log, not a development history. The tree is assembled with `git update-index --index-info` against a throwaway index, so modes are set explicitly and **no checkout filter can touch the bytes** — the 9 executable files keep their bit and CRLF conversion cannot enter.
- [x] **Step 5: Push `main`.**

**The five deltas (authored this task):**

| delta | does |
|---|---|
| `001-fallow-graft` | the structural pre-pass `claude-config` grafts at runtime today |
| `002-drop-platform-adaptation` | removes the section linking the ignored per-harness references |
| `003-plugin-version-source` | `server.cjs` reads its version from `.claude-plugin/plugin.json` |
| `004-plugin-manifest` | `6.2.0-up.1`, our `author`/`homepage`/`repository`, and the attribution in `description` that the build asserts |
| `005-brand-link` | the brainstorming UI links to this fork |

`hooks/session-start` keeps its `obra/superpowers` citation of upstream issue 571 and gets **no** delta — it is a statement about where a bug was filed, and that is still true.

**Verification (acceptance 2, 3, 4) — all run 2026-07-28:**
- [x] **Determinism:** two independent builds → tree `2b89330…` both times, identical.
- [x] **Deltas reproduce the hand edits byte-for-byte:** `diff -rq` between the built tree and the hand-authored copy → no differences.
- [x] **Acceptance 3:** `node ultrapowers-patches/scan-inventory.mjs <built>/plugins/ultrapowers` → **4 occurrences, all `obra/superpowers`**: the attribution in `plugin.json` `description`, two in the fork-owned `README.md`, and the issue-571 citation. Every one is either required by the licence or deliberately kept; nothing survives that should not.
- [x] **Acceptance 4:** `cmp` of the built `LICENSE` against `original`'s at **both** emitted paths — byte-identical, and in fact the same git blob (`abf03903…`).
- [x] **Hand-edited `main` is detected:** `build-cli drift` against a tampered `main` exits 1 and names the file; against a clean `main` it exits 0. This is the check Task 9 consumes.
- [x] `node --test` → 52/52; `inventory.mjs check` → `new 0 | removed 0 | unclassified 0`.

**Built result:** `main` = `1ca818f`, tree `2b89330`, 56 files — 51 tracked under `plugins/ultrapowers/`, `LICENSE` also at the root, and 4 fork-owned files.

---

### Task 5: Marketplace manifest, version policy, first install

**Why:** the repository is its own marketplace so a new machine needs only `/plugin marketplace add axazolai/ultrapowers` with no git authentication — which is exactly what the bootstrap install depends on. The explicit `version` is what makes updates deliberate: without it every commit on `main` ships to every machine, including a half-finished build.

**Files:**
- Create (on `patch`, emitted to `main` by the build): `.claude-plugin/marketplace.json`
- Modify: `plugins/ultrapowers/.claude-plugin/plugin.json` — `name`, `version`, `author`, `description`

- [x] **Step 1: Write the marketplace manifest** — done in Task 4 as `transform/fork-owned/marketplace.json`, emitted to the repo root by the build. Shape below, plus a `description` on both the marketplace and the plugin entry (user-visible in `/plugin`):

```json
{
  "name": "ultrapowers",
  "owner": { "name": "axazolai" },
  "plugins": [
    { "name": "ultrapowers", "source": "./plugins/ultrapowers" }
  ]
}
```

- [x] **Step 2: Version `6.2.0-up.1`** in `plugin.json` — `<upstream version>-up.<our revision>`. Delivered by delta `004-plugin-manifest`. `author` becomes ours; upstream is credited in `description` — ~~protected by the keep-list~~ **asserted by the build** (`config.attribution.require`), per the Task 2 revision.
- [x] **Step 3: Verify the manifest is installable without installing it.** `.test/ultrapowers-marketplace-probe.mjs`, isolation copied from `.test/gsd-marketplace-probe.mjs` (`HOME`/`USERPROFILE` + `CLAUDE_CONFIG_DIR` + a credentials copy). Nothing was registered against the live config.
- [x] **Step 4: Do not install or enable the plugin here.** Asserted by the probe, not merely avoided: probe `plugins/cache` empty, `enabledPlugins` still `{}`.

**Verification — run 2026-07-28, 9/9 PASS.** `claude plugin marketplace list --json` returns only marketplace metadata, so asserting on it would have proved little more than that the CLI parsed a name. The probe therefore verifies **the clone a fresh machine would actually get**:

| check | result |
|---|---|
| marketplace registered (`✔ Successfully added marketplace: ultrapowers`) | PASS |
| the clone's manifest declares the plugin, and its `source` directory exists | PASS |
| shipped `plugin.json` is ours and versioned `6.2.0-up.1` | PASS |
| attribution (`obra/superpowers`) survived into the shipped `description` | PASS |
| skills shipped and renamed (`using-ultrapowers` present, `using-superpowers` absent) | PASS |
| `hooks/hooks.json` present | PASS |
| nothing enabled, nothing cached | PASS |
| real `settings.json`, `plugins/known_marketplaces.json`, `plugins/config.json` byte-identical before/after | PASS |

**Cleanup note:** the probe copies the real `.credentials.json` into its fake home (the established pattern — a config dir without credentials fails immediately). The probe directory was removed after the run rather than left on disk.

---

### Task 6: `claude-config` — managed plugin swap, disable without uninstall

**Why this way:** `ultrapowers` joins `managedPlugins` next to `context7` and `context-mode`, and replaces `superpowers` in the profiles' `plugins` arrays. But `buildPluginPlan` currently emits `uninstall` **and** `disable` for every managed plugin outside the required list — so a bare swap would *uninstall* upstream, and the design's rollback-in-one-command property would be gone before anyone noticed. The fix is a small explicit set, not a special case buried in a branch.

**Files:**
- Modify: `variants.json`, `plugin-reconcile.mjs`, `setup.mjs`
- Test: `plugin-reconcile.test.mjs`

**Interfaces — Produces:** `buildPluginPlan({ required, managed, enabledPlugins, installedIds, keepInstalled })`.

- [ ] **Step 1: Write the failing tests**

```javascript
// plugin-reconcile.test.mjs (added cases)
const MANAGED = { ultrapowers: "ultrapowers@ultrapowers", superpowers: "superpowers@claude-plugins-official",
                  gsd: "gsd@m", "context-mode": "cm@m", context7: "c7@m" };

test("upstream superpowers is disabled but never uninstalled", () => {
  const { actions } = buildPluginPlan({
    required: ["ultrapowers", "context-mode", "context7"], managed: MANAGED,
    enabledPlugins: { "superpowers@claude-plugins-official": true },
    installedIds: ["superpowers@claude-plugins-official"],
    keepInstalled: ["superpowers"] });
  assert.ok(actions.some(a => a.type === "disable" && a.id === "superpowers@claude-plugins-official"));
  assert.ok(!actions.some(a => a.type === "uninstall"));
});

test("keepInstalled does not suppress uninstall for other managed plugins", () => {
  const { actions } = buildPluginPlan({
    required: ["ultrapowers"], managed: MANAGED,
    enabledPlugins: { "gsd@m": true }, installedIds: ["gsd@m"], keepInstalled: ["superpowers"] });
  assert.ok(actions.some(a => a.type === "uninstall" && a.id === "gsd@m"));
});

test("the fork is installed and enabled like any other managed plugin", () => {
  const { actions } = buildPluginPlan({
    required: ["ultrapowers"], managed: MANAGED,
    enabledPlugins: {}, installedIds: [], keepInstalled: ["superpowers"] });
  assert.ok(actions.some(a => a.type === "install" && a.id === "ultrapowers@ultrapowers"));
  assert.ok(actions.some(a => a.type === "enable" && a.id === "ultrapowers@ultrapowers"));
});
```

- [x] **Step 1: Write the failing tests** — 3 from the plan plus one it did not anticipate: with the CLI unavailable, `keepInstalled` must also suppress the *manual-uninstall note*. Telling the human to run `claude plugin uninstall superpowers@…` by hand defeats the point of keeping it installed just as thoroughly as emitting the action would. RED on 2 of 4; the other two passed before the feature existed, which is itself the useful signal.
- [x] **Step 2: Add `keepInstalled` to `variants.json`** as a top-level array alongside `managedPlugins`, with a `$comment` recording *why*. Added `ultrapowers` to `managedPlugins`; **kept** the `superpowers` entry.
- [x] **Step 3: Swap the name in all three profiles'** `plugins` arrays (`full`, `base`, `lite`).
- [x] **Step 4: Implement** — `uninstall` skipped when the name is in `keepInstalled`; `disable` unaffected; a note explains *why* it survives, so the dry-run a human approves is self-explanatory. Default `keepInstalled = []`.
- [x] **Step 5: Update `setup.mjs`** to pass `keepInstalled` from the loaded variants.
- [x] **Step 6: Do not run `setup.mjs` against the live config as part of this task.**

**Verification — run 2026-07-28.** `node --test plugin-reconcile.test.mjs variants.test.mjs setup-variants.e2e.test.mjs payload/bin/init-stack.test.mjs` → **99/100**. The single failure, `purity: resolved lite rules-src + overlay docs carry no forbidden tokens` (`commands/init-stack.md: gsd`), **predates this work**: verified by stashing all four changed files and re-running on HEAD, where it fails identically. Not caused here and not fixed here.

Dry-run output, with `~/.claude/settings.json` and `plugins/known_marketplaces.json` sha256-identical before and after:

```
--- plugin reconciliation ---
  marketplace_add axazolai/ultrapowers (marketplace "ultrapowers", needed by ultrapowers@ultrapowers)
  install   ultrapowers@ultrapowers
  enable    ultrapowers@ultrapowers
  ...
  disable   superpowers@claude-plugins-official
  NOTE: superpowers@claude-plugins-official stays installed on purpose (kept for rollback); it is only disabled
  (dry-run: no plugin changes)
```

No `uninstall` line for upstream — the rollback property holds.

**Hard precondition — the first real `setup.mjs` run happens only after the plugin exists and is published.** `managedPlugins` naming a plugin that no marketplace serves turns the next reconciliation into a failed `claude plugin install`, on this machine and on every other one. So `main` must be built (Task 4), versioned (Task 5) and **pushed** before this task's changes are deployed. Landing Task 6 in the repository is safe at any time; running `setup.mjs` for real is not.

**Verification (acceptance 1), performed by the human afterwards:** run `setup.mjs` for real, then **restart** — `enabledPlugins` resolves at startup and does not hot-reload, so a check before restart proves nothing. The available-skills listing then shows every skill as `ultrapowers:<name>` and no `superpowers:<name>`. Read the listing; do not invoke one skill and generalise.

---

### Task 7: Marketplace registration before install

**Why:** `setup.mjs` runs `claude plugin install <id>`, which fails when the marketplace is unknown. The four existing managed plugins live in marketplaces already registered on any machine that ever ran the bootstrap, so this gap has never fired. `ultrapowers@ultrapowers` is the first managed plugin in a marketplace of our own, and on a fresh machine it will be missing — the fork does not cause this bug, it is merely the first thing to trip it.

**Files:**
- Modify: `setup.mjs` (plugin reconciliation block, ~line 940)
- Test: `payload/bin/init-stack.test.mjs`

- [x] **Step 1: Reuse, do not reinvent.** `setup.mjs` imports `knownMarketplaces()` from `init-stack.mjs` — the same reader, not a second one that could drift.
- [x] **Step 2: Write the failing test.** The plan predicted the classification would already pass and the wiring would be what fails, and that is what happened: `classify: unknown marketplace -> marketplace_missing` was already covered generically. So the tests added are the ones that were actually missing — the *plan-building* cases (RED 3/5), plus two **data invariants** that catch the real recurring hazard: every marketplace named by `managedPlugins` has a recorded source, and every `keepInstalled` name is still managed (a plugin we stop managing is a plugin we can no longer disable).
- [x] **Step 3: Emit the `marketplace add` before install.** Implemented **inside `buildPluginPlan`**, not in `setup.mjs`'s loop, so the ordering is a property of the plan rather than of the caller — and it is once per marketplace, not once per plugin. It obeys the **same `execInstall` gate** as install/uninstall: registering a marketplace fetches and trusts remote code, so it does not get a weaker gate than installing does.

**Sources are transcribed, never guessed.** `variants.json → marketplaces` maps marketplace name → repo, read off a real `known_marketplaces.json`. A marketplace with no recorded source produces a **note telling the human to add one** — the plan must never invent a repository to clone from.

**Verification — run 2026-07-28:** the dry-run above prints `marketplace_add axazolai/ultrapowers` as the *first* action, ahead of the install that depends on it; `node --test payload/bin/init-stack.test.mjs plugin-reconcile.test.mjs variants.test.mjs setup-variants.e2e.test.mjs` → 99/100 (the one failure pre-dates this work, see Task 6). The live `known_marketplaces.json` is byte-identical before and after — registration was planned, not performed.

---

### Task 8: `/up-update` — detect and report (read-only half)

**Why split:** the read-only half is what runs often and must be safe to run from anywhere, including a dirty repo. Shipping it first means the release watch is useful before the rebuild machinery exists.

**Files:**
- Create: `payload/bin/lib/up-update-lib.mjs`, `payload/bin/lib/up-update-lib.test.mjs`, `payload/bin/up-update.mjs`, `payload/commands/up-update.md`

**Interfaces — Produces (as built):** `compareVersions(upstreamLatest, originalTag)`, `resolveRepo(argv)`, `latestUpstreamTag(tags)`, `formatReport(assessment)`, plus `check(argv, fetchers)` and `legalEntries(config, inventory)` in the CLI.

- [x] **Step 1: Write the failing tests** — 16 for the library, 8 for the CLI. Two cases the plan did not list turned out to matter most: an **unparseable version** must report a problem rather than defaulting to "up to date", and a fork with **no `upstream/*` tag** must do the same. Both are the failure where a broken check reads as a clean bill of health.
- [x] **Step 1b:** `check` never clones — `git ls-remote` for the tags plus three HTTPS reads. The scratch clone belongs to Task 9.
- [x] **Step 2: Implement detection.** GitHub releases API for `obra/superpowers`, compared against the newest `upstream/*` tag on the fork. Note: unauthenticated, so it shares the 60-requests/hour per-IP limit — irrelevant for a command run by hand, worth knowing before anything automates it.
- [x] **Step 3: Inject the fetchers.** All four (`listRemoteTags`, `latestRelease`, `rawFile`, `listDir`) are parameters with real defaults; tests pass fakes and never touch the network.
- [x] **Step 4: `check` prints current/behind and the legal entries with their reasons.** ~~keep-list~~ — after the Task 2 revision the printed set is the map's `verbatim` rules plus the build's attribution requirements, which is the same obligation expressed as an assertion instead of a freeze.
- [x] **Step 5: Write `payload/commands/up-update.md`** — prose only, no logic. It explicitly forbids two things: acting on the report by installing anything, and reading a local clone of the fork.

**A2 is defended structurally, not by comment.** A test reads `up-update-lib.mjs`'s own source and fails if it mentions `node:fs`, `node:os`, `homedir`, `CLAUDE_CONFIG_DIR` or `process.cwd`. "We decided not to cache" is one convenience commit away from being false; this makes that commit fail.

**Verification (acceptance 5) — run 2026-07-28 from `/tmp/unrelated-project`, against the live GitHub:**
- [x] prints `status      up to date`, with all four legal entries and their full reasons, and the five deltas.
- [x] `git status --porcelain` in `claude-config` byte-identical before and after (hashed, not eyeballed).
- [x] `~/.claude/settings.json` and `~/.claude/plugins/known_marketplaces.json` sha256-identical before and after.
- [x] Run from an unrelated directory, proving "runnable from any project" rather than assuming it.
- [x] `node --test` across the whole repo: **351/352** — the only failure is the pre-existing `purity` one (see Task 6).
- [x] All three files resolve into all three profiles (`bin/up-update.mjs`, `bin/lib/up-update-lib.mjs`, `commands/up-update.md`); the `.test.mjs` files are excluded by `alwaysExclude`, as intended.

---

### Task 9: `/up-update` — fetch, rebuild, assess, refuse

**Why this way:** the command's value is not that it updates — it is that it can say *"I did not manage this"* instead of producing a plausible-looking broken build. The four refusal conditions are therefore the primary deliverable, and the happy path falls out of them.

**Files:**
- Modify: `payload/bin/lib/up-update-lib.mjs` (+ tests), `payload/bin/up-update.mjs`

**Interfaces — Produces:** `assess({ buildResult, upstreamDiff, mainDrift, cfg }) → { verdict: "ok"|"needs-work", reasons[], obsolete[] }`.

- [ ] **Step 1: Write the failing tests** — one per refusal condition, each asserting `verdict === "needs-work"` *and* the specific reason string, because a refusal that does not say which condition fired is not actionable:

```javascript
test("a delta that fails to apply refuses", () => {
  const a = assess({ buildResult: { failed: ["003-agent-registry.patch"], obsolete: [] },
    upstreamDiff: { changedPct: 2, keepListTouched: [] }, mainDrift: [], cfg: CFG });
  assert.equal(a.verdict, "needs-work");
  assert.match(a.reasons.join(" "), /003-agent-registry\.patch/);
});

test("upstream name surviving outside the keep-list refuses", () => {
  const a = assess({ buildResult: { failed: [], obsolete: [], strayOccurrences: 7 },
    upstreamDiff: { changedPct: 2, keepListTouched: [] }, mainDrift: [], cfg: CFG });
  assert.equal(a.verdict, "needs-work");
});

test("a large upstream diff refuses even when everything applied", () => {
  const a = assess({ buildResult: { failed: [], obsolete: [] },
    upstreamDiff: { changedPct: 40, keepListTouched: [] }, mainDrift: [], cfg: CFG });
  assert.equal(a.verdict, "needs-work");
});

test("a hand-edited main refuses", () => {
  const a = assess({ buildResult: { failed: [], obsolete: [] },
    upstreamDiff: { changedPct: 1, keepListTouched: [] },
    mainDrift: ["plugins/ultrapowers/skills/brainstorming/SKILL.md"], cfg: CFG });
  assert.equal(a.verdict, "needs-work");
});

test("an obsolete delta reports but does not refuse", () => {
  const a = assess({ buildResult: { failed: [], obsolete: ["002-fallow.patch"] },
    upstreamDiff: { changedPct: 1, keepListTouched: [] }, mainDrift: [], cfg: CFG });
  assert.equal(a.verdict, "ok");
  assert.deepEqual(a.obsolete, ["002-fallow.patch"]);
});
```

- [x] **Step 2: Implement `assess`** as a pure function over already-gathered facts — 11 tests, one per condition plus the "every condition is reported, not just the first" case. Facts come from the fork's own `build-cli.mjs facts` (a JSON contract added this task) rather than a second implementation of the build on the `claude-config` side, which would drift from the first at the first change to either.
- [x] **Step 3: Implement the sequence** — ~~dirty-tree guard on `claude-config`~~ → clone the fork into temp → **drift-check at the current base** → fetch the upstream release → commit + tag on `original` in the temp clone → rebuild → gather `upstreamDiff` → `assess`.

  Two corrections to this step, both found by building it:
  - **The `claude-config` dirty-tree guard was dropped.** It exists to protect a tree the command turns out never to write. Checked: `claude-config` records the fork version **nowhere** (only a comment in the file Task 10 retires), and contains **zero** `superpowers:` skill invocations — so Step 6's "the version wherever it is recorded" has no referent. The stronger property replaces the guard: the update touches the fork only, never `claude-config`.
  - **`mainDrift` must be measured before the base moves.** Measured after, every file legitimately differs and the check fires on every update instead of on a hand edit — it would have been a guard that is always on, which is the same as no guard.
- [x] **Step 4: On `needs-work`, nothing survives the run.** Verified, not assumed: the synthetic refusal leaves no `up-update-*` directory behind.
- [x] **Step 5: Report obsolete deltas** and never drop them automatically.
- [x] **Step 6: On `ok`, prepare and stop.** ~~then print the plan and **ask**~~ — **publishing requires an explicit `--publish` flag** instead of an interactive prompt. The command is driven by an agent through a non-interactive shell, where a prompt is either unanswerable or answerable by accident; a flag the human has to ask for cannot be confirmed by mistake. The command markdown instructs the agent to show the summary, ask, and only then re-run with `--publish`. On stopping it prints the temp path so the human can inspect the prepared build.
- [x] **Step 7: The plugin is not reinstalled or re-enabled by the update** — stated in the output and in the command file.

**A version baked into a delta is wrong exactly when it matters.** Delta 004 set `"version": "6.2.0-up.1"` literally, which stays correct right up to the moment upstream publishes — the one moment nobody thinks to edit a patch file. The version is now **derived** by the build from `originalTag` + `config.version.revision`, and delta 004 is a zero-context diff that does not touch the version line at all (the line sits between `description` and `author`, so any context would carry the upstream version into the patch and break it on the next bump for reasons unrelated to the delta's purpose).

**Verification (acceptance 6, 7) — `.test/up-update-synthetic.mjs`, run 2026-07-28 from `/tmp/unrelated-project`, 7/7 PASS.** Two synthetic upstream releases built from the real 6.2.0 tree, served from **scratch local remotes** so neither real repository is involved:

| scenario | result |
|---|---|
| **A** — upstream 6.3.0 edits one tracked file | `OK`, version `6.2.0-up.1 → 6.3.0-up.1`, `main` gets 1 new commit, **nothing pushed**, clone kept for inspection |
| **B** — upstream 6.4.0 guts the file delta 001 targets | `NEEDS WORK`, names `001-fallow-graft.patch` and where its context went, **nothing pushed**, temp directory gone |

Both: scratch fork refs byte-identical before and after; `claude-config` working tree unchanged. Real-repo `update` correctly reports `already built from the latest upstream release (6.2.0)`; `~/.claude/settings.json` and `plugins/known_marketplaces.json` unchanged; the real fork's refs unmoved.

**The synthetic run earned its keep immediately** by catching a bug no unit test could: the temp clone used the platform default `core.autocrlf`, so on Windows the deltas and fork-owned files came back with CRLF and **every delta failed with "context not found"** — a failure that reads as an upstream change and is nothing of the sort. Fixed in two places: the clone now forces LF, and the `patch` branch carries a `.gitattributes` so a hand clone cannot hit it either. The local dev checkout had never shown this because `autocrlf` was turned off there by hand on day one.

- [x] `node --test`: `claude-config` 362/363 (the one failure pre-dates this work), fork repo 55/55, `main` still reproduces byte-for-byte.

---

### Task 10: `claude-config` sweep, risks, superseded docs

**Why last:** the sweep is only correct once the fork's real skill namespace exists. Doing it earlier means rewriting references to names that have not been proven to resolve.

**Scope, re-measured 2026-07-28 (the plan's 25 predated Tasks 8–9):** 59 in `payload/`, 2 in `payload-lite/`, 0 in `gsd-core-patches/`. Of the 59, **9 were added by `/up-update` itself** and name upstream on purpose, and **20 belonged to the fallow graft** now retired. Ending state: **22 total, 0 unclassified** — 13 repo doc paths, 9 deliberate upstream references.

**Files:** `payload/**`, `payload-lite/**`, `variants.test.mjs`, `RISK_REGISTER.md`, `README.md`, `README.en.md`, `.ultrapowers/archive/plans/2026-07-27-ultrapowers-layer0-patcher.md`

**Already covered by Tasks 6–7:** `variants.json`, `plugin-reconcile.mjs`, `setup.mjs`. Task 10 must not touch them again.

- [x] **Step 1: Classify every occurrence before changing any.** Three buckets, as planned — but the first one needed widening. There are **no `superpowers:` skill invocations anywhere in the payload** (measured: zero). What actually needed rewriting was prose that *names the plugin as a thing the rules route around*: `rules-src/gsd.md`'s six "do not let Superpowers skills fire alongside GSD" rules, the `GSD / SUPERPOWERS METHODOLOGY` CLAUDE.md section (and its three test assertions), the base-plugin list in `claude-md/09-plugins.md`, and three graphify-sync comments. A rule that names a plugin nobody has installed routes nothing.
  - *the plugin id* (`superpowers@claude-plugins-official`) → **kept**, it is the upstream plugin we disable and must stay nameable.
  - *repo doc paths* (`docs/superpowers/**`) → **kept**. These are real files in this repository; renaming them would break the references and falsify the record.
- [x] **Step 2: `hooks/lib/superpowers-fallow-graft.mjs` — retired, not renamed.** The question the plan posed (rename or not) was overtaken: the graft's job is now `transform/deltas/001-fallow-graft.patch` inside the fork, so the runtime version was code that re-patched a plugin no profile enables. Deleted along with its test and its `session-init.mjs` call site; `variants.test.mjs`'s Category-II expectation updated in the same change. The capability and its `.planning/` guard are unchanged — what improved is that the fork's rebuild now **fails loudly** if upstream rewrites the anchor, where the runtime graft would simply have stopped finding it.
- [x] **Step 3: `RISK_REGISTER.md`.** `-001` (merge burden), `-002` and `-003` (both Resolved), `-005`/`-006`, and the two new ones — `-007` fork divergence, `-008` upstream licence/direction — were already aligned by `c45bcc1`. This task's work was `-004`, which changed *kind*: the keep-list mechanism was itself the defect for `README.md`, so the entry now records the assertion-based replacement. Also updated the two references to the now-deleted graft file so they say where the mechanism went.
- [x] **Step 4: Mark the layer-0 patcher plan superseded** — header added, file kept. It records why two classification designs failed, and two premises that turned out false (a machine-wide cache cannot be gated per project; a patcher must re-apply after every `/plugin update`).
- [x] **Step 5: READMEs** — a new section in both, stating the fork's provenance (MIT, © Jesse Vincent), the three-branch model, that only the plugin is carried across, that upstream is disabled rather than removed, and how `/up-update` works.

**Verification (2026-07-28):**
- [x] `grep -rniI "superpowers" payload payload-lite` → **22 occurrences, 0 unclassified**: 13 repo doc paths, 9 deliberate upstream references in `/up-update`. Every one traceable to a bucket.
- [x] `node --test` → 352/353; the single failure is the pre-existing `purity` one (see Task 6).

---

## Acceptance mapping

| Design criterion | Proven by |
|---|---|
| 1 — every skill resolves as `ultrapowers:<name>`, no upstream skill loaded | Task 6 verification (human runs `setup.mjs`, restarts, reads the listing) |
| 2 — rebuild reproduces `main` byte-for-byte | Task 4 verification (two builds, equal tree hashes) |
| 3 — zero upstream-name occurrences outside the keep-list | Task 4 verification (`scan-inventory.mjs` over built `main`) |
| 4 — `LICENSE` byte-identical to upstream's | Task 4 verification (`cmp`) |
| 5 — unchanged upstream: "up to date", writes nothing | Task 8 verification (clean `claude-config`, no new mirror refs) |
| 6 — synthetic bump: rebuild, version bump, prepare both sides, stop before push | Task 9 verification (`git log origin/main..main` non-empty in the mirror) |
| 7 — broken delta: refuse, nothing survives the run | Task 9 verification (mirror refs unmoved, `claude-config` clean) |

## Self-Review

- **The riskiest task is 4, not 1.** If the build is not deterministic, acceptance 2 fails and every later guarantee is unverifiable. Do not proceed past Task 4 on a "looks the same" comparison — compare hashes.
- **Task 6 is the one that can silently destroy a rollback.** Without `keepInstalled`, the first real `setup.mjs` run after the profile swap uninstalls upstream, and one-command rollback is gone before anyone notices. Its test is the guard, and it must be written before the swap, not after.
- **Tasks 6–7 change files that reconcile every machine's plugin state.** That is the blast radius of this plan, and it is why no task here runs `setup.mjs` for real: dry-run plus tests during development, deliberate human execution afterwards.
- **Task 7 fixes a latent bug that predates this work** — marketplace registration was never needed because all four managed plugins lived in already-known marketplaces. Worth stating plainly so nobody later reads it as fallout from the fork.
- **A2 is a property to defend, not just a setting.** "Works through GitHub, never through a local checkout" is trivially easy to violate later by adding one convenience path. Task 8's config test and Task 9's rename-the-dev-checkout verification exist specifically to make that violation fail loudly.
- **Where I chose rather than being told:** the 25% threshold (design A3, explicitly a starting value), the scratch clone over a cached mirror (slower, but no persistent state and no cleanup logic to get wrong), and giving `marketplace add` the same bulk-mode gate as `install` rather than a weaker one.
- **Known cost accepted:** merge burden per upstream release. That was upstream's own argument against forking, and this plan does not eliminate it — it bounds it with `/up-update` and its refusals.

## Execution Handoff

Order: **0 → 1 → 2 → 3 → 4 → 5** (fork repo, sequential — each depends on the previous), then **6, 7** (`claude-config`, independent of each other and parallelisable), then **8 → 9** (`/up-update`), then **10** (sweep).

**Nothing in this plan writes live settings.** Tasks 6–7 change the *sources* `setup.mjs` reads; the reconciliation itself is a human action taken afterwards, deliberately and separately. Marketplace registration during development happens against a probe `CLAUDE_CONFIG_DIR`, never the real one.

**The first real `setup.mjs` run comes after the plugin is implemented and pushed** — i.e. after Tasks 0–5, not merely after Task 6 lands in the repository. Deploying a `managedPlugins` entry for a plugin no marketplace serves breaks the next reconciliation on every machine, not just this one. This is the plan's one ordering constraint that survives even if the tasks are reordered.

**Nothing is blocked.** The design's four open assumptions were resolved by the user on 2026-07-27 and are recorded in the Decisions table above; A3 (the 25% threshold) remains my choice rather than a measurement, and is to be calibrated over the first few real updates.
