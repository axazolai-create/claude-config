# Executor task decomposition: research/testing in isolated sub-agent context (design)

Date: 2026-07-17
Status: implemented 2026-07-17 (see payload/agents/gsd-executor-decomposing.md,
payload/agents/gsd-task-verifier.md, payload/hooks/lib/gsd-workflow-patches.mjs)

## Problem

`gsd-executor` does research, implementation, and test-writing for every task in one flat,
accumulating context. For a task where verification genuinely benefits from a clean, separate
context (no accumulated implementation reasoning biasing the test), there was no mechanism to
split that out — `gsd-executor` deliberately has no `Agent` tool at all
(`<no_recursive_agent_spawn>`), and for good reason: a 2026-07 test series found that granting
`Agent` to any gsd-* worker whose prompt carries a competing anti-recursion guardrail causes a
principled refusal in 3/3 configurations tested (new coordinator agent, self-recursion, a
"legitimate" GSD context) — the contradiction itself, not the framing, was the trigger.

The user's ask, precisely: keep dispatch depth at exactly 3 (orchestrator → executor → one
verification leaf), make it a hard structural cap (not a prose instruction the leaf could
ignore), and route the leaf's result through this depth as a concrete answer, not an execution
stream.

## What was tested before deciding the mechanism

Two live (non-headless) tests, 2026-07-17, in the actual running session rather than the
one-shot `claude -p` harness the original test series used:

- **Test A — `Agent` from a clean coordinator role, live session.** A `general-purpose` agent
  given coordinator instructions (no persistent file — mid-session agent registration doesn't
  hot-reload) dispatched 2 nested `Agent` calls (implementation, verification) for a trivial
  compound-interest task. Both nested calls resolved via the normal async dispatch pattern
  (agentId → completion notification) and completed cleanly — real file created, real test
  passed. **This refutes the earlier series' assumption that async/background dispatch is a
  dead end for nested agents** — that dead end was specific to a one-shot headless process that
  can never receive a later notification, not to nested dispatch itself.
  - Caveat found: the leaf type used (`general-purpose`) has `Tools: *`, which always includes
    `Agent` — the depth cap in that test was enforced only by instruction ("don't recurse
    further"), not by tool grant. Not acceptable for a real, structural cap.
- **Test B — `Workflow` tool from within a subagent.** A `general-purpose` agent was instructed
  to use `Workflow` instead of `Agent` for the same kind of pipeline. `ToolSearch` returned no
  match for `Workflow` at all from inside the subagent — it is not available to a spawned
  subagent, only to the true top-level orchestrating session. This rules out `Workflow` as a
  mechanism for anything below the orchestrator's own level entirely.

Conclusion: `Agent`, not `Workflow`, is the only mechanism available at this depth — and the
missing piece from Test A is a leaf type with NO `Agent` in its `tools:` frontmatter, so the cap
is enforced by the runtime's own tool-permission system, not by the coordinator's good behavior.

## Decisions

| Axis | Choice |
| --- | --- |
| Mechanism | `Agent` tool, dispatched from a NEW fork of `gsd-executor`, to a NEW narrow leaf agent with no `Agent` grant |
| New agent 1 | `gsd-executor-decomposing` (`payload/agents/`) — fork of `gsd-executor`, `Agent` added to `tools:`, `<no_recursive_agent_spawn>` replaced by `<task_stage_decomposition>` (zero competing anti-recursion text — avoids the exact contradiction the test series found fatal) |
| New agent 2 | `gsd-task-verifier` (`payload/agents/`) — task-scoped sibling of `gsd-nyquist-auditor` (same adversarial generate→run→debug≤3→escalate loop, read-only impl files, context-mode routing), scoped to ONE task instead of a whole phase's gap list. No `Agent` in `tools:` — structural leaf. |
| Reused vs. new for the leaf | New file, not a reuse of `gsd-nyquist-auditor.md` or `gsd-phase-researcher.md` — both inspected in full; both are phase-scoped (input is a computed `<gaps>` list / phase requirement IDs, output is a phase-level `VALIDATION.md`/`RESEARCH.md`, phase-level structured-return format) and reusing either via a scoped prompt risked wrong-artifact writes or confused phase/task terminology. |
| Scope of decomposition | Verification (testing) only. Research stays inline in the executor when trivial (as the coordinator in Test A correctly chose on its own); genuinely phase-scale research is `gsd-phase-researcher`'s job, unchanged, called by the planner, not this mechanism. Coding stays with `gsd-executor`/`gsd-executor-decomposing` itself — it IS the coding agent; a separate coding leaf was considered and explicitly rejected (would just be `gsd-executor` calling a copy of itself for no isolation benefit). |
| Task-level trigger | New `<task>` attribute: `verify_isolated="true"` (orthogonal to `tdd="true"` — the two are not meant to combine on one task) |
| Plan-level dispatch selection | `execute-phase.md`'s per-plan Agent() dispatch (step 3) checks `grep -q 'verify_isolated="true"' "{plan_file}"` before choosing `subagent_type`; `gsd-executor-decomposing` only for a plan containing such a task, `gsd-executor` otherwise |
| Depth cap enforcement | Structural: `gsd-task-verifier` has no `Agent` in `tools:`. Verified by `checkRecursiveAgentSpawnGuardrail` (`gsd-agent-patches.mjs`) — extended to recognize `<task_stage_decomposition>` as a reviewed, intentional (not accidental) `Agent` grant |
| Dispatch style | Synchronous from the coordinator's perspective (one `Agent()` call, wait for result, merge in own reasoning) — **not** a visible parallel task-list-and-background-poll loop like a top-level session uses. Verified empirically: `TaskCreate`/`TaskUpdate`/`TaskList` are NOT available to a spawned subagent (`ToolSearch` found no match; direct call errored "not enabled in this context") |
| `execute-phase.md` patch mechanism | New sibling module `gsd-workflow-patches.mjs` (same versioned-marker pattern as `gsd-agent-patches.mjs`, applied via the same `apply-gsd-agent-patches.mjs` CLI so `/init-stack` step 9 applies both in one command) — NOT a one-off hand-edit of the live install, since changes must be reproducible via bootstrap on any machine |

## Why not reuse `gsd-nyquist-auditor.md`/`gsd-phase-researcher.md` directly

Read both in full before deciding:

- `gsd-nyquist-auditor.md`: `<execution_flow>` and `<structured_returns>` are keyed to
  `**Phase:** {N} — {name}`, a pre-computed `<gaps>` list, and a phase-level `VALIDATION.md` +
  `Files for Commit` tied to the phase's own commit. Its core loop (adversarial stance, generate
  → run → debug ≤3 → escalate, read-only impl) is exactly right — that's why `gsd-task-verifier`
  borrows the SAME loop — but repurposing the file itself via a scoped prompt risked either
  confusing phase/task terminology in its own report or writing to the wrong `VALIDATION.md`.
- `gsd-phase-researcher.md`: an order of magnitude heavier — `gsd_run query init.phase-op`, graph
  queries, npm/PyPI package-legitimacy protocol, ASVS security-domain mapping, a ~15-section
  `RESEARCH.md` template, mandatory git commit, `effort: high`. Repurposing it for "resolve one
  fact for one task" would mean overriding most of its own instructions — not a lighter use of
  the same file, effectively a different agent under its name.

## Depth-3 guarantee, restated precisely

`execute-phase.md` (orchestrator, level 1) → `gsd-executor-decomposing` (level 2, this is what
the user counts as "the executor," not a new level) → `gsd-task-verifier` (level 3, structurally
incapable of a level 4 — no `Agent` grant at all). Never deeper, by construction, not by
instruction alone.

## Fork-sync procedure (for RISK-GSDEXEC-001)

`gsd-executor-decomposing.md` was created via a byte-exact `cp` of `gsd-executor.md`, then two
targeted deltas: (1) frontmatter (`name`, `description`, `tools:` +`Agent`), (2) the
`<no_recursive_agent_spawn>` block replaced by `<task_stage_decomposition>`, plus one line added
to `<step name="execute_tasks">`'s task-type branch. Every other section is byte-identical to
`gsd-executor.md` as of 2026-07-17.

When `gsd-agent-patches.mjs`'s `PATCHES` registry gains a new entry, or an existing entry's
`version` bumps, for `gsd-executor.md`: apply (or hand-port) the identical change to
`gsd-executor-decomposing.md`, skipping only the two delta points above. No automated diff/sync
check exists yet — this is a manual step, tracked as accepted risk (see RISK_REGISTER.md).

## Addendum 2026-07-17: producer side (who sets `verify_isolated="true"`)

The mechanism above only described the consumer side (execute-phase.md reads the attribute,
`gsd-executor-decomposing` acts on it). Nothing set it automatically — the only path was a human
hand-editing `PLAN.md` after `/gsd-plan-phase` generated it. Added a companion patch,
`planner-verify-isolated-detection` (`gsd-agent-patches.mjs`, targets `gsd-planner.md`), giving
`gsd-planner` a producer rule co-located with its existing `tdd="true"` detection:

- **Primary, automatic criterion:** the plan's own `<threat_model>` STRIDE register — a task
  touching a component the register already marked `critical`/`high` severity with a `mitigate`
  disposition gets `verify_isolated="true"` instead of `tdd="true"`. Reuses an existing,
  already-computed risk signal rather than inventing a new complexity heuristic.
- **Additive-only criterion:** an explicit `/gsd-discuss-phase` decision in CONTEXT.md can ADD
  more tasks to `verify_isolated="true"`, never remove ones the threat-model criterion already
  selected.
- The two attributes are mutually exclusive per task (never both `tdd="true"` and
  `verify_isolated="true"` on the same task) — one replaces the other for the risk-flagged
  subset; every other behavior-adding task keeps the existing `tdd="true"` default unchanged.

Applied via the same `apply-gsd-agent-patches.mjs` CLI, deployed via `payload/` → `node setup.mjs`
→ verified byte-identical, same as every other change in this document.

## Risks

- **RISK-GSDEXEC-001** (new, `RISK_REGISTER.md`): fork-sync burden, no inheritance mechanism.
  Accepted — see rationale above (only mechanism giving a structural, not prose, depth-3 cap).
- `execute-phase.md`'s patch anchor (`gsd-workflow-patches.mjs`'s `ANCHOR` constant) is a literal
  string match against the installed file's current formatting. If a future `gsd-core` release
  reformats that section, the patch degrades to `skippedNoAnchor` (surfaced every session via
  `session-init.mjs`) rather than a silent or corrupt write — same fail-safe behavior as
  `gsd-agent-patches.mjs`'s existing anchor checks.

## Verification plan

1. `node --check` on all three new/edited `.mjs` files — done, all pass.
2. `checkRecursiveAgentSpawnGuardrail({ claudeDir })` against the real install — confirms
   `gsd-executor-decomposing.md` is NOT flagged (recognized guardrail marker) and no OTHER
   unrelated agent regressed.
3. `applyGsdWorkflowPatches`/`checkGsdWorkflowPatches` round-trip against the real installed
   `execute-phase.md` — confirmed: pending → applied → idempotent (pending empty on re-check).
4. `node setup.mjs` deployed both new `payload/agents/*.md` files byte-identical to the live
   install — confirms `payload/` → `~/.claude/` reproducibility, not a hand-edited live file.
5. Not yet done: an actual `/gsd-execute-phase` run against a real `verify_isolated="true"` task
   end-to-end (would need a real `.planning/` project) — the mechanism is wired and unit-verified
   piece by piece, but not exercised as a full live phase execution.
