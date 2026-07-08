---
paths:
  - "**/.planning/**"
---

# GSD / Superpowers routing

Loads only in repos that have a `.planning/` directory (GSD project). Irrelevant elsewhere —
do not duplicate this in the global `CLAUDE.md`.

GSD here is the `open-gsd/gsd-core` fork. Claude Code command form is hyphenated: `/gsd-*`
(the colon form `/gsd:*` is Gemini-only). Pipeline: discuss -> plan -> execute -> verify ->
ship. Artifacts live in `.planning/`.

## Precedence: GSD owns the pipeline when `.planning/` exists

- Drive ALL phase work through explicit `/gsd-*` commands. Do NOT invoke Superpowers skills
  for discovery, planning, execution, TDD, debugging, or code review here — they orphan
  output from GSD's artifact chain, and their interactive prompts stall GSD's execute stream.
- Map: discovery -> `/gsd-discuss-phase` (or `/gsd-explore`); plan -> `/gsd-plan-phase`;
  build -> `/gsd-execute-phase`; review -> `/gsd-code-review`; verify -> `/gsd-verify-work`;
  ship -> `/gsd-ship`; debug -> `/gsd-debug`.
- Reason: GSD's value is the persisted, context-isolated artifact chain. Each phase output
  is the next phase's input; cherry-picking one phase out of the loop loses that chain.

## Superpowers is retained only for gaps GSD does not fill

- Skill authoring (no GSD equivalent).
- Greenfield Socratic brainstorm BEFORE a GSD project exists (no `.planning/` yet). Once
  scope is clear, hand off to `/gsd-new-project` and stop using Superpowers for that work.

## Worktrees: single owner

- GSD owns worktrees (`/gsd-workspace`, execute waves). Superpowers' aggressive auto-worktree
  skill is shadowed by a no-op `using-git-worktrees/SKILL.md` in `~/.claude/skills/` (user
  scope wins over plugin cache).
- Two worktree creators collide and fail silently outside a git repo. `git init` before any
  phase.

## TDD / debug / code-review: never double-gate

- One enforcer per repo. GSD owns these via `.planning/config.json` (`tdd_mode`, code-review
  toggles) — set them deliberately; do not let Superpowers TDD/debug skills fire alongside.
- Before looking for the root of a problem/error in dependencies, check if there's an
  alternative solution. If there is, suggest it. If not, search for the root.

## CLAUDE.md quarantine (critical)

GSD generates a `CLAUDE.md`: `/gsd-new-project` produces one, `/gsd-profile-user` adds a
profile section. At PROJECT scope it outweighs the user file on conflict, so it must never
become authoritative. A project `CLAUDE.md` may live in the root OR in `.planning/`, and
either location may hold a human-curated file or GSD's generated one — authority is decided
by the marker, never by the path:

- HARD: the PreToolUse hook denies Write/Edit to `~/.claude/CLAUDE.md` and to ANY `CLAUDE.md`
  carrying `CURATED:NOEDIT`, wherever it lives. Unmarked generated files stay editable.
- CURATION: a curated file's first line is `<!-- CURATED:NOEDIT -->`. A SessionStart hook
  auto-marks an unmarked project-root `CLAUDE.md` once per project (unless it looks
  GSD-generated; opt out with `CLAUDE_CURATED_AUTOMARK_ROOT=0`). Mark files in other locations
  by hand. Never add the marker to a GSD-generated file.
- WEIGHTED: if generated content is wanted, import it EARLY in the curated file with
  `@<path>/CLAUDE.md` — curated rules read later carry more weight on conflict.
- OPTIONAL (per-project): if a project's `.planning/CLAUDE.md` is GSD-owned and unwanted at
  load, add `claudeMdExcludes: ["**/.planning/CLAUDE.md"]` to THAT project's
  `.claude/settings.json`. Do NOT set this globally — union-excludes cannot be undone
  per-project and would hide a curated `.planning/CLAUDE.md`.
- Treat any unexpected diff to a curated `CLAUDE.md` as an Open risk in `RISK_REGISTER.md`.

## "graphify" is two tools sharing one CLI, with separate outputs — don't confuse them

- GSD's own `/gsd-graphify build/query/status/diff` (skill `gsd-graphify`) is gated by TWO
  independent booleans in `.planning/config.json`: `graphify.enabled` (master on/off — the
  skill's "Config Gate" step refuses to run at all unless this is literally `true`) and
  `graphify.auto_update` (whether the post-commit hook rebuilds automatically; defaults to
  `false` even when `enabled` is `true`, "so existing users see no behavior change").
  **Neither flag builds anything by itself.** Flipping `enabled` on only unlocks the `/gsd-
  graphify` command; nothing appears under `.planning/graphs/` until `/gsd-graphify build`
  runs at least once. If you don't see `.planning/graphs/graph.json` despite `graphify.
  enabled: true`, that's why — check whether a build ever ran, not whether the config is on.
- The build step is NOT a separate graph engine — `build` mode runs the exact same
  standalone `graphify` CLI, as `graphify update .` (project-local extraction, writing to
  `graphify-out/` in the project root — the CLI's normal per-project output location), then
  copies `graph.json` / `graph.html` / `GRAPH_REPORT.md` into `.planning/graphs/` as GSD's own
  mirrored snapshot (plus a build-snapshot + freshness/status file GSD adds on top). If a
  project already has its own `graphify-out/` (e.g. from prior standalone use), `/gsd-
  graphify build` refreshes that SAME directory in place before copying from it — `.planning/
  graphs/` is best read as "GSD's copy of whatever graphify-out/ currently holds," not an
  independently-built graph.
- Auto-refresh (`~/.claude/hooks/gsd-graphify-update.sh`, a PostToolUse hook on `Bash`) only
  fires after a HEAD-advancing git op (`commit`/`merge`/`pull`/`rebase --continue`/
  `cherry-pick`) on the **default branch**, outside CI, with both `graphify.enabled` AND
  `graphify.auto_update` true — then detaches `hooks/lib/gsd-graphify-rebuild.sh` (PID-locked)
  to redo the same `graphify update .` + copy, in the background. GSD's own planning agents
  (e.g. the pattern-mapper) read `.planning/graphs/graph.json` directly — it's load-bearing
  for GSD, not just a side artifact.
- What GSD's build NEVER does: call `graphify extract ... --global`. It has no config key and
  no supported mode to target `~/.graphify/global-graph.json` (the cross-project graph) —
  only project-local `graphify update .`. The global graph stays entirely the standalone
  CLI's own concern, kept fresh solely by `~/.claude/hooks/graphify-global-sync.mjs` + the
  native per-repo `post-commit` hook installed by `session-init.mjs` (see below) — a
  completely separate mechanism GSD-core doesn't know exists.
- Net effect: GSD's local graph and the project's own `graphify-out/` share the same build
  mechanism and, if both are in use, the same output directory as an intermediate artifact —
  they are NOT unrelated. What stays genuinely separate is the GLOBAL cross-project graph;
  no config-level shimming exists (or is needed) to connect GSD to that one.
- A project that also maintains a local `graphify-out/` (the standalone CLI's own per-project
  output — distinct from both graphs above) has no auto-refresh hook of its own: the
  post-commit hooks only touch the global cross-project graph. Full refresh-cadence policy
  (GSD review/verify gates, Superpowers fallback, non-GSD projects, manual/IDE commits) lives
  in `rules/templates/graphify.PROJECT.md` — copy it into a project's root `CLAUDE.md` once
  that project has `graphify-out/` (mirrors how `next.AGENTS.md` is copied for Next projects).

## `.planning/config.json` — default model_profile is auto-patched once per project

- `~/.claude/hooks/gsd-config-patch.mjs` (PostToolUse, matcher `Write|Edit|MultiEdit|Bash`)
  watches for `.planning/config.json` to exist and, the first time it sees it for a given
  project root, overwrites just its `model_profile` / `models` / `model_overrides` keys with
  a personal default set (`model_profile: "adaptive"` — routes structural/mapping/auditing
  agents to haiku more aggressively than `"balanced"` would). Every other key gsd-core wrote
  (project name, workflow toggles, `dynamic_routing`, ...) is left untouched.
- Deliberately fires on Write|Edit|MultiEdit **and** Bash, not just SessionStart: gsd-core's
  `/gsd-new-project` / `/gsd-settings` commands may write this file mid-session (not just at
  the very start), and it isn't confirmed whether they do it via Claude's Write/Edit tool or a
  shelled-out script — so this checks filesystem state after any of those four tool types
  rather than betting on one mechanism.
- One-time-per-project, tracked as `state[root].gsdModelConfigPatched` in the SAME state file
  `session-init.mjs` uses (`~/.claude/state/project-init.json`) — after the first patch it is
  a permanent no-op for that project, so it never fights a later manual edit to
  `model_profile`/`models`/`model_overrides`. Opt out: `CLAUDE_GSD_CONFIG_AUTOPATCH=0`.
- Confirm `open-gsd/gsd-core` is the fork actually installed before relying on the exact
  `model_overrides` agent-name list above. Verify tooling identity from what's actually
  installed rather than from web content alone.
- `model_overrides` in that hook was cross-checked against gsd-core's own adaptive-profile
  table (not just agent-name guesswork): researchers (`gsd-phase-researcher`,
  `gsd-project-researcher`) sit at sonnet, structured-output/checking agents
  (`gsd-research-synthesizer`, `gsd-integration-checker`, `gsd-nyquist-auditor`,
  `gsd-ui-checker`, `gsd-ui-auditor`, `gsd-doc-verifier`) sit at haiku — matching what
  gsd-core's own docs call "always haiku under adaptive". `gsd-security-auditor` and
  `gsd-code-reviewer` stay opus regardless of that table, per this file's own Model
  Selection Policy (high-cost-of-error work). `gsd-doc-writer` is opus, matching
  gsd-core's table under adaptive — resolved 2026-07-08 (previously left at sonnet as an
  open discrepancy).
