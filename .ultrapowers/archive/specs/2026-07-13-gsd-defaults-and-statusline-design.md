# GSD global defaults sync + statusline context-meter override — design

Date: 2026-07-13
Status: approved (Plan A + Plan B), ready for implementation planning

## Context

Two independent, small features, bundled into one spec because they share the same
delivery mechanism (files added to this repo's bundle, deployed via `setup.mjs` and
`/init-stack`) and were designed in the same session.

- **Plan A** — this repo currently has no way to deploy the user's personal GSD config
  preferences into gsd-core's own native global-defaults file
  (`~/.gsd/defaults.json`, read by `gsd-core/bin/lib/config.cjs::buildNewProjectConfig()`
  at project-creation time), nor to resync an existing project's `.planning/config.json`
  against that curated set. The only existing mechanism,
  `payload/hooks/gsd-config-patch.mjs`, hardcodes its own `DEFAULT_MODEL_CONFIG`/
  `DEFAULT_WORKFLOW_CONFIG` objects and one-time-patches a project's `.planning/config.json`
  after the fact — left untouched by this change (reconciling the two is a separate,
  future task).
- **Plan B** — `~/.claude/hooks/gsd-statusline.js` (gsd-core-managed, versioned
  `gsd-hook-version` file, content gets regenerated on `gsd update`) renders the context
  window meter as a 10-segment block bar (`[████░░░░░░] 42%`). The user wants a token-count
  display instead (`[420k/1000k] 42%`), same color thresholds. Editing the managed file
  directly would silently revert on the next gsd-core update.
- **Plan C** (investigated, no action) — Claude Code's `/config` → "Dynamic workflow size"
  (`workflowSizeGuideline`, enum `small|medium|large|unrestricted`, stored in
  `~/.claude.json`) is an unrelated soft prompt-guideline for the model's own Ultracode
  workflow sizing, not a technical concurrency cap and not something this repo provisions.
  No changes follow from this.

## Plan A — `gsd-defaults.partial.json` sync

### Source of truth

New file at repo root: `gsd-defaults.partial.json` (sibling of `settings.partial.json`,
same "meta file, not walked by `placeFile()`" treatment — outside `payload/`, read
directly by path). Content = the user's finalized personal GSD defaults (moved from the
now-obsolete `.reference/defaults.json` scratch file):

```json
{
  "mode": "interactive",
  "granularity": "fine",
  "model_profile": "adaptive",
  "models": { "planning": "opus", "discuss": "sonnet", "research": "sonnet", "execution": "sonnet", "verification": "opus", "completion": "sonnet" },
  "model_overrides": {
    "gsd-planner": "opus", "gsd-roadmapper": "opus", "gsd-pattern-mapper": "haiku",
    "gsd-phase-researcher": "sonnet", "gsd-project-researcher": "sonnet",
    "gsd-research-synthesizer": "haiku", "gsd-codebase-mapper": "opus",
    "gsd-ui-researcher": "opus", "gsd-verifier": "sonnet", "gsd-plan-checker": "sonnet",
    "gsd-integration-checker": "haiku", "gsd-nyquist-auditor": "haiku",
    "gsd-ui-checker": "haiku", "gsd-ui-auditor": "haiku", "gsd-doc-verifier": "haiku",
    "gsd-code-reviewer": "opus", "gsd-security-auditor": "opus", "gsd-debugger": "opus",
    "gsd-executor": "sonnet", "gsd-code-fixer": "sonnet", "gsd-doc-writer": "opus"
  },
  "commit_docs": true,
  "parallelization": true,
  "branching_strategy": "phase",
  "quick_branch_template": null,
  "workflow": {
    "research": true, "plan_check": true, "verifier": true, "auto_advance": false,
    "nyquist_validation": true, "pattern_mapper": true, "ui_phase": true,
    "ui_safety_gate": true, "ai_integration_phase": true, "tdd_mode": true,
    "code_review": true, "code_review_depth": "standard", "ui_review": false,
    "skip_discuss": false, "use_worktrees": true
  },
  "plan_review": { "source_grounding": true },
  "intel": { "enabled": true },
  "features": { "global_learnings": true },
  "graphify": { "enabled": true, "auto_update": true },
  "git": { "create_tag": true },
  "hooks": { "context_warnings": true }
}
```

`phase_naming` deliberately omitted (gsd-core's own default is already `"sequential"`,
no need to pin it).

Two explicit, confirmed deviations from what's currently live everywhere
(`~/.gsd/defaults.json` has `branching_strategy: "none"`, `graphify.auto_update: false`):
`branching_strategy: "phase"` and `graphify.auto_update: true` are intentional new
decisions, not oversights. `tdd_mode`/`code_review`(+`_depth`)/`ui_phase`/`ui_review`/
`ui_safety_gate` reverse `docs/gsd-config-defaults.md`'s prior "deliberately excluded"
rationale for `gsd-config-patch.mjs`'s Tier 2 — that doc file gets a one-line update at
implementation time noting the reversal is specific to this new global-defaults path, not
a retraction for the (untouched) hook.

### Two merge targets, two different merge semantics

`payload/hooks/lib/gsd-defaults-sync.mjs` — new lib module, exports:

- **`syncGsdGlobalDefaults({ homeDir, partial })`** → target `~/.gsd/defaults.json`.
  Deep-additive merge (existing user values win, missing keys/array items added) — same
  semantics as `deepMerge()` already in `setup.mjs`, reimplemented locally (small,
  self-contained, matches this repo's existing convention of duplicating tiny helpers
  like `findRoot()` across hook files rather than cross-importing). Creates `~/.gsd/` and
  the file if absent. Silent, best-effort — no diff/prompt (unlike the settings.json JSON
  tier): single-user personal preference file, additive-only, low risk. Writes only when
  the merge actually changes something.

- **`syncProjectConfig({ projectRoot, partial })`** → target
  `<projectRoot>/.planning/config.json`. If `.planning/` doesn't exist: no-op, return
  without error. If it exists: merge where **the reference wins** on any key it defines —
  reusing `gsd-config-patch.mjs`'s existing `mergeNested()` shape (nested plain objects
  merge key-by-key; scalars/arrays are replaced outright) but with source/target order
  flipped so `partial`'s values overwrite `config.json`'s same-named keys. Keys
  `gsd-defaults.partial.json` never mentions (`project_code`, `ship`, `agent_skills`,
  `claude_md_path`, `search_gitignored`, per-key API-search flags, etc.) are left
  completely untouched. Runs every invocation (no one-time state gate — `/init-stack` is
  already a deliberate, occasional manual action, unlike the PostToolUse hook this
  deliberately doesn't touch).

`projectRoot` resolution reuses `gsd-config-patch.mjs`'s `findRoot()` walk (checks
`.planning`, `.git`, `package.json`, `pyproject.toml`, `go.mod`, `build.gradle.kts`,
40-level ascent) — same self-contained-duplicate treatment.

### CLI entry point

`payload/gsd-defaults-sync.mjs` — mirrors `payload/apply-gsd-agent-patches.mjs`'s shape
(thin argv-driven wrapper around the lib, prints a plain-text summary of what ran/skipped).
Runs **both** sync functions unconditionally: global defaults sync (idempotent, safe to
repeat) then project-config sync (no-op outside a `.planning/` project).

### Call sites

- **`setup.mjs`**: after the payload copy loop, alongside the existing
  `context-mode-gsd-agents.mjs` best-effort block — imports `syncGsdGlobalDefaults` from
  the just-installed `~/.claude/hooks/lib/gsd-defaults-sync.mjs` copy (not the repo's own),
  same pattern as that existing block. Reads `gsd-defaults.partial.json` from
  `REPO_ROOT` (like `settings.partial.json`). Does **not** call `syncProjectConfig` —
  `setup.mjs` has no meaningful "current project."
- **`/init-stack`** (`payload/commands/init-stack.md`): new step running
  `node ~/.claude/gsd-defaults-sync.mjs` (both functions), same invocation shape as the
  existing step 9 (`apply-gsd-agent-patches.mjs`) — catches drift on the entry point users
  actually run per-project, and applies the project-config resync.

### Known accepted overlap

`gsd-config-patch.mjs` (untouched) may still one-time-patch a project's
`.planning/config.json` with its own hardcoded values before or after this new sync runs;
whichever applies last wins on overlapping keys. Not a regression (today the hook is the
only writer), acceptable to defer.

## Plan B — statusline context-meter wrapper

### Mechanism: call-through + regex replace, not a rewrite

New file `payload/hooks/gsd-context-meter.js` — becomes the registered
`statusLine.command` (via a new `statusLine` key added to `settings.partial.json`,
Windows/POSIX path projected the same way the existing hook entries are). At runtime it:

1. Reads the statusline JSON payload once from stdin (buffers the raw text).
2. Spawns `node <same-dir>/gsd-statusline.js` (gsd-core's managed original), writes the
   captured stdin to its stdin, captures its stdout in full.
3. Independently parses the same input JSON to compute `totalCtx` (`context_window.total_tokens`,
   fallback `1_000_000`) and the buffer-normalized `used` percentage — duplicating just
   this ~10-line calculation from `gsd-statusline.js` (same self-contained-duplicate
   convention as Plan A; the alternative, importing gsd-core internals, is fragile across
   gsd-core versions).
4. Regex-replaces the bar segment in the captured stdout —
   `/\x1b\[([\d;]+)m(💀 )?[█░]{10} (\d+)%\x1b\[0m/` — with
   `\x1b[$1m$2[${k(usedTokens)}/${k(totalCtx)}] $3%\x1b[0m`, where `k(n) = Math.round(n/1000) + 'k'`
   and `usedTokens = Math.round(totalCtx * used / 100)` (uses the *same* normalized `used`
   the original already computed and printed, so the displayed `%` never disagrees with
   the token ratio next to it).
5. Writes the (possibly modified) line to stdout, exit 0.

Fallback behavior (must never break the statusline, matching `gsd-statusline.js`'s own
defensive style): if the regex doesn't match (context segment absent, or gsd-core changes
the bar's format upstream), the original captured output passes through unmodified. If
spawning the original script fails for any reason, catch and print nothing extra —
never throw past the wrapper.

### Why this survives `gsd update`

Confirmed via `gsd-core/bin/lib/shell-command-projection.cjs`: gsd-core's "managed hook"
reconciliation list (`MANAGED_HOOK_COMMAND_BASENAMES_BY_SURFACE`) is keyed by *basename*
matching (`gsd-statusline.js` and other `gsd-*` hook files) and is never invoked to touch
the top-level `statusLine` settings.json key at all — grepped the entire `gsd-core`
install tree for a literal `statusLine` write site and found none. The `statusLine.command`
value is not gsd-core-managed; only the *file content* of `gsd-statusline.js` is. Pointing
`statusLine.command` at our own differently-named wrapper is therefore stable across
gsd-core updates, and the wrapper keeps calling whatever `gsd-statusline.js` currently
contains, so it also survives upstream improvements to the other segments (model, task,
milestone bar) without any changes on our side.

### Delivery

`settings.partial.json` gains a `"statusLine"` key. `setup.mjs`'s existing settings.json
merge block (currently only rewrites `merged.hooks`/`merged.permissions`) gains a third
explicit case: if `merged.statusLine` is absent, or already points at our wrapper's
basename, set/refresh it to our wrapper's projected command string; if it points at
something else the user (or gsd-core docs) set up manually, leave it — surfaced in the
same diff-and-choose flow the settings.json JSON tier already uses (this key *is* worth a
conflict prompt, unlike Plan A's defaults.json: it's a single highly-visible per-machine
value, not an additive personal-preference set).

## Open items carried into implementation

- `docs/gsd-config-defaults.md` needs a short addendum noting the Plan A reversal on
  `tdd_mode`/`code_review`/`ui_*` is scoped to the new global-defaults path, not a
  retraction of the hook's own rationale.
- No test suite exists for `setup.mjs`/`payload/hooks/lib/*` today beyond `.test/` bench
  scripts; verification is manual (`--dry-run`, then a real run against a scratch
  `~/.claude`/`~/.gsd` per `.test/setup-envs.mjs`'s pattern) — follow that existing
  convention rather than inventing a new one.
