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
  `/init-stack` step 10 or standalone `/init-session`) rather than through this snapshot —
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

### Depth boundary: waves stay at depth 2, on purpose

- **Exactly one `Agent`-capable context dispatches every leaf worker directly — no chain of
  coordinator agents.** For "N stages x M parallel workers," the orchestrator issues M `Agent`
  calls per stage as parallel tool-use blocks in one message, itself; it never spawns an
  intermediate agent whose own job is to fan out the M workers. Merging M results back into one
  stage outcome is the orchestrator's own reasoning over the returned `tool_result`s, not a
  separate "merge agent" call. Both together keep the dispatch tree at depth 2 (orchestrator ->
  leaf worker), which is the only configuration that has run cleanly in repeated testing.
- **This is an empirically confirmed failure pattern, not a style preference.** A 2026-07 test
  series tried three independent ways to add a third level — a dedicated coordinator agent, the
  orchestrator recursing into itself, and a freshly-authored role — each granted `Agent` and asked
  to fan out a wave one level below itself. Any worker carrying an anti-recursion guardrail (see
  `<no_recursive_agent_spawn>` below) refused every time, citing the guardrail-vs-override
  contradiction; the one variant with no guardrail didn't refuse but fell into
  `ScheduleWakeup`/background-dispatch mechanics a headless one-shot invocation can never wake from.
  Treat "one `Agent`-capable orchestrator, leaf workers only" as a hard constraint.
- **Never grant `Agent` to a worker whose role text assumed it would never have it** — that
  guardrail-plus-override contradiction was the single most reliable refusal trigger. A role meant
  to recurse safely must be written from scratch with an explicit depth cap and merge-in-code
  discipline, never produced by cloning `gsd-executor.md` and stripping or overriding its
  `<no_recursive_agent_spawn>` block.
- **Need depth beyond 2, or branching decided by something other than a human-written plan?** That
  decision belongs in deterministic code, not a model's runtime judgment inside a prompt. See
  `claude_orchestration` (`~/.claude/references/gsd-claude-orchestration-pilot.md`) — it maps GSD's
  own wave/plan model onto the `Workflow` tool's `parallel()`/`pipeline()` primitives, with branching
  fixed by a generated script instead of an agent spawning further agents at inference time.

### The one sanctioned depth-3 exception: `gsd-executor-decomposing` + `gsd-task-verifier`

- **What it is:** a fork of `gsd-executor` (`payload/agents/gsd-executor-decomposing.md`) that
  grants `Agent` for exactly one documented use - dispatching `gsd-task-verifier`
  (`payload/agents/gsd-task-verifier.md`) to verify a single task's behavior in its own clean
  context instead of writing/running the test inline. `execute-phase.md` (patched via
  `gsd-workflow-patches.mjs`) dispatches this variant instead of plain `gsd-executor` only for a
  plan containing at least one task with `verify_isolated="true"` in its `<task>` attributes;
  every other plan still gets plain `gsd-executor`, unchanged.
- **Why this doesn't repeat the depth-boundary failure above:** the depth cap here is structural,
  not textual. `gsd-task-verifier` has no `Agent` in its `tools:` frontmatter — it cannot recurse
  whatever its prompt says — and `checkRecursiveAgentSpawnGuardrail` (in `gsd-agent-patches.mjs`)
  flags any future gsd-* agent that grants `Agent` without a recognized guardrail marker, catching
  an accidental widening. `gsd-executor-decomposing` itself carries zero competing anti-recursion
  text (its `<task_stage_decomposition>` block is the only word on the subject), so there's no
  contradiction to trigger a refusal.
- **Why `Agent`, not `Workflow`, for this one case:** verified empirically (2026-07-17, live
  session, not headless `-p`) — `Workflow` is not available to a spawned subagent at all (`ToolSearch`
  returns no match from inside one); it only works from the top-level orchestrating session. A
  synchronous `Agent` call to a leaf with no further `Agent` access is the only mechanism at this
  level, and completes cleanly in a live/long-running session (the `ScheduleWakeup`/async-stuck dead
  end was specific to one-shot headless, not nested dispatch itself).
- **Maintenance cost:** `gsd-executor-decomposing.md` duplicates the entirety of `gsd-executor.md`'s
  execution machinery (commit protocol, deviation rules, TDD flow, checkpoint handling) because
  Claude Code agent files have no inheritance mechanism — an upstream change to `gsd-executor.md`
  does not reach this fork. See RISK-GSDEXEC-001 in `RISK_REGISTER.md` for the drift-detection
  procedure.

### Parallel worktree waves (Windows): environment contention, not agent confusion

- Stagger `isolation="worktree"` `Agent()` dispatch to one call per turn — concurrent
  `git worktree add` races on `.git/config.lock`.
- **Never remove or force-clear a worktree (or anything inside its `node_modules`) with
  `Remove-Item -Recurse -Force`, `rm -rf`, or `robocopy /MIR` on Windows.** pnpm links dependencies
  via NTFS junctions/reparse points, and PowerShell recursive delete, Git-Bash/MSYS `rm -rf`, AND
  `robocopy /MIR` (mirror-delete of the destination) all FOLLOW a reparse point into its real target
  instead of removing just the link. This caused two real Feb 2026 incidents where an entire Windows
  user profile was deleted — one triggered by Claude Code CLI running exactly this command against a
  worktree (pnpm/pnpm#10707). Separately, a `robocopy /MIR` cleanup on the pre-global-virtual-store
  version emptied the MAIN checkout's `node_modules`: the worktree's `apps/*/node_modules` were
  junctions pointing back at it, and mirror-delete followed them into the real target. In a monorepo
  EVERY nested `node_modules` (repo root AND each `apps/*/`, `packages/*/`) can be a separate junction
  — spot-checking one package is not sufficient; verify them all, or sidestep the question entirely.
  Normal cleanup: `git worktree
  remove <path>`; `git merge` never touches `node_modules` (gitignored, never enters diff/conflict
  machinery), so a slow or failed removal is never a lost merge — the commit already landed. If
  removal is refused or reports `.git does not exist` (stale admin entry), `git worktree prune`
  first, then clear any leftover directory with Node's reparse-safe primitive, never a shell
  recursive delete: `node -e
  "require('fs').rmSync(process.argv[1],{recursive:true,force:true})" <path>` (`fs.rmSync` unlinks a
  junction instead of descending into its target). Never run either removal path as a blocking
  foreground call on a large tree — background it and keep working.
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
- **Dependency provisioning across worktrees — rely on the toolchain's own global store, never a
  hand-rolled junction.** The language-independent question is: *does the toolchain keep dependencies
  in a shared, content-addressable store so that a fresh per-worktree install is both cheap and
  isolated?* A junction/symlink over a dependency or build tree is always the wrong fix — it collapses
  the wave onto one shared, mutable resource: anything a worktree writes at runtime (a lazily-fetched
  platform binary like `node_modules/turbo-<platform>/bin/`, `.bin` shims, compiled output) lands in
  the shared copy and can vanish or clash under concurrent use, and on Windows it is also a deletion
  hazard (see the reparse-point rule above). A hand-made junction or a `robocopy /MIR` / fresh full
  install of a 100K+-file tree into every worktree also runs minutes-to-tens-of-minutes PER WORKTREE.
  Per stack:
  - **Node (pnpm)** — has a shared store once `enableGlobalVirtualStore: true` is set in
    `pnpm-workspace.yaml` (one line, add if missing; https://pnpm.io/git-worktrees). Every worktree
    then gets its own real `node_modules` whose entries are pnpm-managed links into one shared
    content-addressable store, so a plain `pnpm install` per worktree is near-instant once the first
    has populated the store.
  - **Node (npm / yarn-classic)** — no shared store: deps are copied into each `node_modules`. Budget
    a real independent install per worktree, or drop worktree isolation for that wave.
  - **Go** — shared store already, nothing to do: `$GOMODCACHE` (`~/go/pkg/mod`) and `$GOCACHE` are
    global and concurrent-safe by design. Do not vendor.
  - **Rust / Cargo** — deps are shared already (`~/.cargo/registry` + git deps, immutable). The
    per-worktree cost is `target/` (compiled output), NOT deps — do NOT collapse it via one shared
    `CARGO_TARGET_DIR` (same shared-mutable-resource + Windows-rename hazard); use **sccache** for a
    concurrency-safe compile cache instead.
  - **Python** — shared store only with **uv** (global content-addressable cache, hardlinks into each
    `.venv`), so per-worktree `uv venv && uv sync` is cheap. pip / poetry copy into `site-packages` —
    budget a real per-worktree install, or migrate to uv. NEVER symlink/junction a `.venv` between
    worktrees: venvs hardcode absolute paths and break, and on Windows a `.venv` contains reparse
    points, so the deletion rule above applies to it exactly as to `node_modules`.
  - **Java / Kotlin (Gradle / Maven)** — deps are shared already (`~/.gradle/caches`,
    `~/.m2/repository`, file-lock safe). Per-worktree cost is `build/` / `.gradle/`; share compile
    output only via the purpose-built `--build-cache` (concurrent-read safe), never a hand-shared
    output dir.
  - **.NET** — shared already (`~/.nuget/packages` global); only `obj/` + `bin/` are per-worktree.
  - **Ruby** — shared with the default `GEM_HOME`; do NOT set `bundle install --path vendor/bundle`
    (that copies per project and defeats it).
  - **PHP / Composer** — no shared store: `vendor/` is copied per project. Budget a real per-worktree
    `composer install`, or drop worktree isolation for that wave.
  Two operational rules apply wherever a shared store exists. (1) **Warm the store on the base branch
  first** — resolve new/changed dependencies once before dispatching the wave, so each worktree's
  install reads from an already-populated store instead of the registry. (2) **Stagger the first
  populating install per worktree** — Windows can't rename a path another process holds open, so two
  worktrees resolving into the store at once can hit `EPERM ... rename ..._tmp_N` or serialize to
  minutes each; run the first install one-per-turn like `git worktree add`, never concurrently. For
  compiled stacks, prefer a concurrency-safe compile cache (sccache / ccache / Gradle `--build-cache`)
  over any hand-shared output directory. A stack with no shared store (npm/yarn, pip/poetry, Composer,
  or a pnpm repo whose workspace config can't change) has no fast path — budget a plain independent
  install per worktree, or drop worktree isolation for that wave.
- Use `git diff --stat HEAD` for worktree dirty-checks, never `git status` — on a worktree
  with a large `node_modules` tree, `git status` can hang minutes even with `.gitignore`
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
