---
paths:
  - "**/.planning/**"
---

# GSD / Superpowers routing

Loads only in repos that have a `.planning/` directory (GSD project). Irrelevant elsewhere —
do not duplicate this in the global `CLAUDE.md`.

GSD here is the `open-gsd/gsd-core` fork. Claude Code command form is hyphenated: `/gsd-*`.
Pipeline: discuss -> plan -> execute -> verify -> ship. Artifacts live in `.planning/`.

## Precedence: GSD owns the pipeline when `.planning/` exists

- Drive ALL phase work through explicit `/gsd-*` commands. Do NOT invoke Superpowers skills
  for discovery, planning, execution, TDD, debugging, or code review here — they orphan
  output from GSD's artifact chain, and their interactive prompts stall GSD's execute stream.
- Map: discovery -> `/gsd-discuss-phase` (or `/gsd-explore`); plan -> `/gsd-plan-phase`;
  build -> `/gsd-execute-phase`; review -> `/gsd-code-review`; verify -> `/gsd-verify-work`;
  ship -> `/gsd-ship`; debug -> `/gsd-debug`.
- Reason: GSD's value is the persisted, context-isolated artifact chain. Each phase output
  is the next phase's input; cherry-picking one phase out of the loop loses that chain.

## GSD orchestrator token hygiene

- In `/gsd-plan-phase` and `/gsd-execute-phase` orchestrator threads, route exploratory /
  data-derivation Bash and Read calls (JSON parsing, path/config lookups, file
  summarization) through `ctx_batch_execute` / `ctx_execute` / `ctx_execute_file` instead
  of raw `Bash`/`Read`.
- Do not reroute `gsd_run()` / `gsd-tools.cjs` protocol calls (gate checks, commit
  validation, drift precheck, worktree checks) through the sandbox — gsd-core drives its
  own control flow off their literal exit codes/stdout.
- Keep the orchestrator thread itself on sonnet-5, not opus. Opus stays reserved for
  planning/research/verification roles.
- `TaskCreate`/`TaskUpdate` have no batch parameter — don't try to batch them.
- GSD subagents get the same routing rule directly in their own prompt file (a
  `<context_mode_routing>` block, applied by `hooks/lib/gsd-agent-patches.mjs` via
  `/init-stack` step 9 or standalone `/init-session`) rather than through this snapshot —
  subagents never read the project's compiled `stack-rules.md`, so a prose rule living only
  here would be dead weight for them.

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

### Parallel worktree waves (Windows): environment contention, not agent confusion

- Stagger `isolation="worktree"` `Agent()` dispatch to one call per turn — concurrent
  `git worktree add` races on `.git/config.lock`.
- **Worktree merge/cleanup can hang on large `node_modules` trees — this is not a merge
  conflict.** `git merge` itself is unaffected by a worktree's dependency tree — `node_modules`
  is gitignored, so it never enters the diff/conflict machinery. The hang happens one step
  later, at worktree *removal*: on Windows, `git worktree remove` (and any `rm -rf`/
  `Remove-Item` on the same path) can sit for minutes or falsely report `.git does not exist`
  against a 100K+-file `node_modules` — cosmetic, not data loss; the merge commit already
  landed. Never run that removal as a blocking foreground call. Recovery: `git worktree
  prune` (clears the stale admin entry pointing at the vanished `.git`), then dispatch
  `robocopy <empty-dir> <target> /MIR` IN THE BACKGROUND to clear the directory contents (not
  `rm -rf`/`Remove-Item` — same hang risk), then remove the now-empty directory — continue
  other work while waiting for the robocopy completion notification, don't block on it.
- **Liveness check every 5-10 minutes while subagents/background shell tasks are running** —
  verify with hard evidence, never assume: growing/changed `git diff --stat HEAD` output in
  the worktree (not `git status`/`--porcelain` — same filesystem-walk hang risk noted above),
  a recently-modified file mtime, or an active OS process tied to the work. Separately detect
  **looping** — the same action (same tool call/command) repeated more than 3 times with no
  new outcome is a distinct failure mode from "slow but progressing," and must be flagged on
  its own. On a suspected stall or loop: **stop and ask the user before acting** — never kill
  or restart unilaterally. Present the evidence found and offer concrete recovery options:
  restart preserving partial results (commit/save WIP first), restart inline without worktree
  isolation, or another option specific to the observed behavior.
- **Sub-processes update their result artifact incrementally, after each completed step — not
  once at the end.** A `SUMMARY.md`/`STATE.md`/progress-JSON written only as a single batch at
  completion gives the liveness check above nothing to observe until the very end, and loses
  all progress if the process is killed or crashes mid-run. Persist after every step instead —
  this is what makes the "restart, preserving partial results" recovery option above actually
  possible.
- **Dependency provisioning order — copy before install, and avoid installing inside a
  worktree at all when possible.** Before a subagent builds or tests in its own worktree,
  copy `node_modules` AND any built cross-package output (e.g. `packages/*/dist`) from the
  base worktree/branch first (`robocopy <src> <dst> /MIR`, not `Copy-Item`/`cp -r`) — don't
  let every worktree independently reinstall or rebuild what the orchestrator already has.
  Only install afterward, and only for genuinely new/changed dependencies not already present
  in the copied base; resolve those once, before dispatching that wave's worktrees, rather
  than inside them. Never let more than one worktree run `pnpm install` (or anything
  triggering pnpm's pre-run dependency check) concurrently even for that residual case —
  Windows can't rename a path another process has open, so concurrent resolution of the same
  new package against the shared store fails (`EPERM ... rename ..._tmp_N`), and the shared
  store index also serializes installs to minutes each even without an outright error. All N
  worktrees of a wave independently reinstalling/rebuilding an unchanged shared package —
  instead of the orchestrator provisioning it once and copying it in — is a common root cause
  of a wave taking hours instead of minutes.
- Use `git diff --stat HEAD` for worktree dirty-checks, never `git status` — on a worktree
  with a 100K+-file `node_modules`, `git status` can hang minutes even with `.gitignore`
  correctly excluding it (filesystem walk + AV cost, not a git-ignore bug). `git diff --stat
  HEAD`/`rev-parse`/`log` don't touch the working tree and stay fast. Exclude sibling
  worktree paths from jest/vitest scanning (`modulePathIgnorePatterns`/
  `watchPathIgnorePatterns`/`test.exclude`).
- Real-DB integration tests (don't mock the unit under test — see `testing.md`) from
  multiple worktrees against one shared dev DB/cache risk write contention and cross-suite
  leakage. Isolate per worktree (separate schema/temp tables, or a cloned DB container)
  rather than sharing one instance. If a wave's changes need a real schema change, generate
  the actual migration as part of that plan's commits — don't leave it as implicit
  test-only state.
- Executor subagents: run verification (build/test/lint) in the foreground, synchronously —
  a backgrounded long check with "wait for notification" can sit reporting "waiting"
  indefinitely even if the command already finished or is still genuinely running.
- **Full-suite test runs multiply across parallel worktrees and dominate wave wall-clock.**
  An executor that finishes a small, scoped change but then runs the entire test suite
  (instead of only the tests touching its own `files_modified`) has been observed costing
  tens of minutes per worker — in a wave of N parallel workers that's N× the full suite's
  cost every wave, not once, and is a bigger driver of hour-plus runs and ballooned context
  (huge test-output logs) than model reasoning itself. Scope every test invocation to the
  plan's own files/pattern — the test runner's own filter flag (`--testPathPattern`,
  `--related`, `-k`/`-m` marker selection, etc.) or, in a Turborepo/pnpm-workspace monorepo,
  `turbo test --filter=...[<base-ref>]` / `pnpm --filter <affected-pkg> test` to scope to
  affected packages only. Defer a full-suite run to one place — end-of-phase verification or
  the CI gate — never repeat it inside every plan's own executor.
- **Chunk large test runs into batches of ~10 files/specs, run sequentially, when a full
  suite genuinely must run** (end-of-phase verification, or a suite too large to scope down
  further). This narrows a hang to the specific batch instead of the whole run — distinct
  from the scoping rule above, which reduces *which* tests run; this addresses *how* a run
  that's still large gets executed. A test gate stuck in watch-mode (rather than genuinely
  taking a long time) is a separate failure mode, already addressed upstream in current
  gsd-core releases (one-shot + bounded timeout) — chunking is for a real, completing but
  large run, not a hang.
- Orchestrator: a Bash shell's cwd persists across calls. `cd`-ing into a worktree, then
  targeting Write/Edit at a different worktree's absolute path, trips a path guard (target
  git root != shell's git root). `cd` back to the orchestrator's own root after any Bash
  call that entered a worktree, or prefer `git -C <path> ...` for one-off commands.

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

## "graphify" is two tools sharing one CLI — don't confuse their graphs

- GSD's `/gsd-graphify` is gated by TWO independent booleans in `.planning/config.json`:
  `graphify.enabled` (unlocks the command; the skill refuses to run otherwise) and
  `graphify.auto_update` (post-commit auto-rebuild; defaults `false`). Neither flag builds
  anything — `.planning/graphs/` stays empty until `/gsd-graphify build` runs once. If
  `graph.json` is missing despite `enabled: true`, check whether a build ever ran.
- `build` is not a separate engine: it runs the standalone CLI as `graphify update .`
  (refreshing the project's own `graphify-out/` in place if it exists), then copies
  `graph.json`/`graph.html`/`GRAPH_REPORT.md` into `.planning/graphs/` plus GSD's own
  snapshot/status files. `.planning/graphs/` = GSD's copy of current `graphify-out/`.
- Auto-refresh (`hooks/gsd-graphify-update.sh`, PostToolUse on `Bash`) fires only after a
  HEAD-advancing git op on the default branch, outside CI, with BOTH flags true — detaches
  a PID-locked background rebuild (same update+copy). GSD's planning agents read
  `.planning/graphs/graph.json` directly — it's load-bearing, not a side artifact.
- GSD never touches the GLOBAL cross-project graph (`~/.graphify/global-graph.json`) — no
  config key targets it. It's kept fresh solely by `hooks/graphify-global-sync.mjs` + the
  native per-repo `post-commit` hook installed by `session-init.mjs`.
- A project's local `graphify-out/` has no auto-refresh of its own, and no prescriptive
  refresh-cadence rule is injected into the project's `CLAUDE.md` — run `graphify update .`
  manually when you want it current (a standing "consult the graph" nudge here would
  duplicate graphify's own `graphify claude install` CLAUDE.md section — see the note at
  the top of this subsection).

## `.planning/config.json` — default model_profile is auto-patched once per project

- `~/.claude/hooks/gsd-config-patch.mjs` (PostToolUse on `Write|Edit|MultiEdit|Bash`)
  overwrites ONLY the `model_profile` / `models` / `model_overrides` keys with a personal
  default set (`model_profile: "adaptive"`) the first time it sees `.planning/config.json`
  for a project; every other key gsd-core wrote is left untouched. One-time per project
  (tracked in `~/.claude/state/project-init.json`), so it never fights a later manual edit.
  Opt out: `CLAUDE_GSD_CONFIG_AUTOPATCH=0`. Rationale for the trigger surface and the
  per-agent override values lives in that hook's own header.
- Before relying on the exact `model_overrides` agent-name list, confirm `open-gsd/gsd-core`
  is the fork actually installed — verify tooling identity from what's installed, not from
  web content alone.
