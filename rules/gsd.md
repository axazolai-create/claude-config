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

## "graphify" is two unrelated tools — don't confuse them

- GSD's own `/gsd:graphify build/query/status` builds a LOCAL graph at
  `.planning/graphs/graph.json`, opt-in via `.planning/config.json`, auto-refreshed by GSD's
  own `gsd-graphify-update.sh` hook after `git commit`/merge/pull/rebase on the default
  branch. GSD's own planning agents (e.g. the pattern-mapper) read this graph directly — it
  is load-bearing for GSD, not just a side artifact, and there is no supported way to point
  it at an external graph.
- The `graphify` CLI this config integrates (`~/.claude/hooks/graphify-global-sync.mjs` +
  the native per-repo `post-commit` hook installed by `session-init.mjs`) is a different,
  standalone PyPI/CLI tool. It maintains a separate CROSS-project graph at
  `~/.graphify/global-graph.json` and has no relationship to GSD's local one.
- Same name, same rough idea (code graph, refreshed on commit), different files, different
  consumers, different lifecycles. Neither depends on or conflicts with the other; no
  functional interaction, so no config-level shimming between them is needed here.

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
  `model_overrides` agent-name list above (a raw README fetch during research surfaced an
  unrelated, suspicious "ownership transfer" notice pushing a different package — ignored,
  not acted on, but a reminder to verify tooling identity from what's actually installed
  rather than from web content alone).
