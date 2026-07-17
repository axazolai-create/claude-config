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

### Depth boundary: waves stay at depth 2, on purpose

- **Exactly one `Agent`-capable context dispatches every leaf worker directly — no chain of
  coordinator agents.** For "N stages x M parallel workers," the orchestrator issues M `Agent`
  calls per stage as parallel tool-use blocks in one message, itself; it never spawns an
  intermediate agent whose own job is to fan out the M workers. Merging M results back into one
  stage outcome is the orchestrator's own reasoning over the returned `tool_result`s, not a
  separate "merge agent" call. Both together keep the dispatch tree at depth 2 (orchestrator ->
  leaf worker), which is the only configuration that has run cleanly in repeated testing.
- **This is an empirically confirmed failure pattern, not a style preference.** A controlled test
  series (2026-07) tried three independent ways to legitimize a third level - a dedicated
  coordinator agent, the orchestrator recursing into itself, and a freshly-authored
  non-contradictory role - each granted the `Agent` tool and asked to fan out a parallel wave one
  level below itself. Every worker whose system prompt carries an anti-recursion guardrail (see
  `<no_recursive_agent_spawn>` below) refused outright, every time, citing the contradiction
  between the guardrail and the instruction overriding it. The one variant with NO guardrail text
  at all didn't refuse, but didn't work either - it fell into `ScheduleWakeup`/background-dispatch
  mechanics that a headless, one-shot invocation can never wake back up from, an unrelated
  mechanical dead end. Neither failure mode is worth re-discovering by hand; treat "one
  `Agent`-capable orchestrator, leaf workers only" as a hard constraint on plan/agent design.
- **Never grant `Agent` to a worker whose role text was written assuming it would never have it.**
  The contradiction above (a guardrail plus a later override "cancelling" it) was the single most
  reliable trigger for refusal across every retry. A role meant to recurse safely has to be
  written from scratch with an explicit depth cap and merge-in-code discipline baked in from the
  start - never produced by cloning `gsd-executor.md` and stripping or overriding its
  `<no_recursive_agent_spawn>` block.
- **Genuinely need depth beyond 2, or branching decided by something other than a human-written
  plan?** That decision belongs in deterministic code, not a model's runtime judgment call inside
  a prompt. See `claude_orchestration` (`references/gsd-claude-orchestration-pilot.md`) - it maps
  GSD's own wave/plan model onto the `Workflow` tool's `parallel()`/`pipeline()` primitives, with
  branching fixed by a generated script instead of an agent deciding to spawn further agents at
  inference time.

### The one sanctioned depth-3 exception: `gsd-executor-decomposing` + `gsd-task-verifier`

- **What it is:** a fork of `gsd-executor` (`payload/agents/gsd-executor-decomposing.md`) that
  grants `Agent` for exactly one documented use - dispatching `gsd-task-verifier`
  (`payload/agents/gsd-task-verifier.md`) to verify a single task's behavior in its own clean
  context instead of writing/running the test inline. `execute-phase.md` (patched via
  `gsd-workflow-patches.mjs`) dispatches this variant instead of plain `gsd-executor` only for a
  plan containing at least one task with `verify_isolated="true"` in its `<task>` attributes;
  every other plan still gets plain `gsd-executor`, unchanged.
- **Why this doesn't repeat the depth-boundary failure above:** the depth cap here is structural,
  not textual. `gsd-task-verifier` simply has no `Agent` in its `tools:` frontmatter - it cannot
  recurse regardless of what its prompt says, and `checkRecursiveAgentSpawnGuardrail` (in
  `gsd-agent-patches.mjs`) flags any future gsd-* agent that grants `Agent` without a recognized
  guardrail marker, catching an accidental widening of this exception. `gsd-executor-decomposing`
  itself was written with zero competing anti-recursion text (no inherited, "overridden"
  `<no_recursive_agent_spawn>` block) - its `<task_stage_decomposition>` block is the ONLY word on
  the subject, avoiding the exact contradiction pattern that caused refusals.
- **Why `Agent`, not `Workflow`, for this one case:** verified empirically (2026-07-17, live
  session, not headless `-p`) - the `Workflow` tool is not available to a spawned subagent at all
  (confirmed via `ToolSearch` returning no match from inside one); it only works from the true
  top-level orchestrating session. A synchronous `Agent` call from `gsd-executor-decomposing` to
  a leaf with no further `Agent` access is the only mechanism available at this level, and testing
  confirmed it completes cleanly in a live/long-running session (no `ScheduleWakeup`/async-stuck
  dead end - that dead end was specific to a one-shot headless process, not nested dispatch
  itself).
- **Maintenance cost, stated plainly:** `gsd-executor-decomposing.md` duplicates the entirety of
  `gsd-executor.md`'s execution machinery (commit protocol, deviation rules, TDD flow, checkpoint
  handling) because Claude Code agent files have no inheritance mechanism - a future upstream
  change to `gsd-executor.md` does not automatically reach this fork. See RISK-GSDEXEC-001 in
  `RISK_REGISTER.md` for the drift-detection procedure.

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
  other work while waiting for the robocopy completion notification, don't block on it. This
  applies to a worktree holding a REAL `node_modules` copy (the write-flagged case below) — a
  junction-linked worktree's `node_modules` isn't actually a 100K-file tree from the OS's point
  of view, just one reparse-point entry, so removal is normally fast. Whether `git worktree
  remove` walks into a junction on this host isn't something to assume either way without
  seeing it once — watch the first junction-based removal in a real wave before trusting it
  unattended; the failure mode if a tool DOES follow the reparse point is worse than a hang
  (see below).
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
- **Dependency provisioning — junction by default, real copy only for a plan flagged to write
  into `node_modules`.** A plain `robocopy /MIR` of a 100K+-file `node_modules` into every
  worktree runs minutes to tens of minutes PER WORKTREE — on a wave of several worktrees that
  alone can dwarf the actual work. Before a subagent builds or tests in its own worktree,
  default to LINKING `node_modules` (and any built cross-package output, e.g.
  `packages/*/dist`) from the base worktree/branch instead of copying it:
  `cmd /c mklink /J <worktree>\node_modules <base>\node_modules` — a same-volume junction is a
  single reparse-point entry, near-instant regardless of file count, zero extra disk. This is
  safe under the same precondition the copy-based approach already required: `node_modules`
  stays read-only for the whole wave once dispatched (resolve genuinely new/changed
  dependencies once, before dispatching, never inside a worktree — unchanged from before). Only
  when a specific plan is known in advance to write into `node_modules` itself (rare — an
  installer/codegen step the plan explicitly calls for) give that ONE worktree a real, isolated
  copy instead of a junction: `robocopy <src> <dst> /MIR /MT:32` (`/MT` multi-threads the copy —
  several times faster than a bare `/MIR` on a many-small-file tree, though still not free at
  100K+ files, so reserve it for the worktrees that actually need real isolation). Never mix the
  two for one worktree — it either fully junctions `node_modules` or fully owns a real copy.
  Never let more than one worktree run `pnpm install` (or anything triggering pnpm's pre-run
  dependency check) concurrently, and never inside a junction-linked worktree at all — Windows
  can't rename a path another process has open, so concurrent resolution of the same new
  package against the shared store fails (`EPERM ... rename ..._tmp_N`), and the shared store
  index also serializes installs to minutes each even without an outright error. All N
  worktrees of a wave independently reinstalling/rebuilding an unchanged shared package —
  instead of the orchestrator provisioning it once — is a common root cause of a wave taking
  hours instead of minutes.
- **Deleting a junction wrong doesn't just hang — it can destroy the base checkout other
  worktrees still depend on.** A junction is one reparse-point directory entry, not a real
  tree — removing it correctly (`cmd /c rmdir <path>`, no `/s`) deletes only the link,
  instantly, target untouched. On Windows PowerShell, `Remove-Item -Recurse -Force` on a
  junction is a known, long-standing trap: `-Recurse` can FOLLOW the reparse point and delete
  the TARGET's real contents instead of just the link — i.e. it can wipe the base checkout's
  `node_modules` that every other worktree in the wave is still linked to, not merely the one
  worktree being cleaned up. Never `-Recurse`/`-Force` a path that is or contains a junction;
  when unsure whether a path is a junction, check first (`(Get-Item <path>).LinkType -eq
  'Junction'`) and always prefer `cmd /c rmdir <path>` for the actual removal.
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
