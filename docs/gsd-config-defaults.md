# gsd-config-patch: personal GSD config defaults — decision log

Moved verbatim (2026-07-12) from the header comment of `payload/hooks/gsd-config-patch.mjs`
so the hook file stays readable. Update THIS file when changing the hook's TIER 2 key set or
`model_overrides` — the hook header only points here.

## Why a PostToolUse hook alongside session-init.mjs (SessionStart)

SessionStart only runs once at the *start* of a session. If `.planning/config.json` is
created mid-session (e.g. the user runs /gsd-new-project or /gsd-settings partway through a
working session), a SessionStart-only check wouldn't see it until the *next* session
begins - a real gap, since gsd-core subagents spawned later in THIS session should already
pick up the patched model config. This hook closes that gap by firing right after the tool
call that (may have) created the file.

WHY IT'S TOOL-AGNOSTIC (four tools in one matcher, same script): I don't have confirmed
visibility into whether gsd-core's /gsd-new-project and /gsd-settings commands write
.planning/config.json directly via the Write/Edit tool, or shell out to a bundled script via
Bash. Rather than guess and pick one, this checks filesystem STATE after the fact (does the
file now exist and is it unpatched?) instead of trying to parse which tool/args produced it -
same defensive pattern graphify-global-sync.mjs uses (checks git state after any Bash call
rather than parsing the exact git subcommand). Cheap no-op (a couple of existsSync calls) on
every other tool call, so safe to leave on the broad matcher.

## Tier 1 — model keys

Exactly once per project (tracked in the SAME per-root state file session-init.mjs uses, key
`gsdModelConfigPatched`), the hook shallow-merges DEFAULT_MODEL_CONFIG's three keys
(model_profile / models / model_overrides) into an existing .planning/config.json,
overwriting only those three keys and leaving every other key gsd-core wrote (project name,
dynamic_routing, workflow toggles, ...) untouched. After the first patch, the hook is a
permanent no-op for that project - it will NOT fight the user's or gsd-core's own later
edits to model_profile/models/model_overrides. That's the point: apply personal defaults
once to a freshly-created config, then get out of the way.

NOTE ON THE VALUES: model_profile is "adaptive" per the user's call - it routes
gsd-codebase-mapper/gsd-research-synthesizer/gsd-integration-checker/gsd-nyquist-auditor/
gsd-pattern-mapper/gsd-ui-checker/gsd-ui-auditor/gsd-doc-verifier to haiku more aggressively
than "balanced" would, closer to what model_overrides already do.

## Tier 2 — workflow keys (2026-07-08, extended 2026-07-09 full settings audit)

See also MEMORY.md / project_gsd_core_settings_audit for the category-by-category decision
log. A second, independent one-time patch (state key `gsdWorkflowConfigPatched`) applies
DEFAULT_WORKFLOW_CONFIG - top-level `commit_docs` / `parallelization` / `phase_naming` /
`granularity`, plus a handful of keys NESTED under `git` / `workflow` / `code_quality` /
`hooks` / `features` / `learnings` / `intel` / `plan_review` / `statusline` /
`claude_md_assembly` / `graphify`. Classified as safe personal-preference defaults (not
stack-dependent, not something gsd-core already asks well, not something the user-level
CLAUDE.md's own advice says to set "deliberately per project"):

- QA-cadence/execution-style knobs (research/plan_check/verifier/nyquist_validation/
  pattern_mapper/post_planning_gaps/context_coverage_gate/human_verify_mode/auto_advance/
  node_repair(+budget)/research_before_questions/discuss_mode/skip_discuss/
  max_discuss_passes/subagent_timeout/plan_bounce(+passes)/ai_integration_phase/
  use_worktrees/inline_plan_threshold/auto_prune_state/plan_chunked), `git.create_tag`,
  both `hooks.*` keys.
- `features.global_learnings` + `features.thinking_partner` (cross-project learning reuse
  and conditional extended-thinking at architectural decision points - both pure
  quality-of-decision upgrades with no stack dependency and no downside for solo work),
  `learnings.max_inject: 10` (pins gsd-core's own default so it survives an upstream
  default change), `intel.enabled` (queryable codebase index for `/gsd-map-codebase
  --query` - same knowledge-graph instinct already applied via graphify elsewhere in this
  config), `plan_review.source_grounding`/`source_grounding_authority` (pins gsd-core's own
  already-true default - plan-checker verifies plans against real code, not just docs),
  `statusline.show_last_command`/`context_position: "front"` (personal statusline taste),
  `claude_md_assembly.mode: "link"` (matches this repo's own curated/generated CLAUDE.md
  separation pattern - see the CLAUDE.md quarantine section of rules-src/gsd.md - by having
  gsd-core write `@path` references for generated profile sections instead of embedding
  them inline), and `graphify.enabled`.
- `code_quality.fallow.enabled` is NOT a flat `true` - it's computed as
  `existsSync(join(root, "package.json"))`. fallow is an npm/cargo-installable external
  binary (structural dead-code/duplication/circular-dependency pre-pass folded into code
  review's prompt) with no meaning for non-Node stacks, and gsd-core FAILS the review
  workflow outright (not a graceful skip) when `enabled: true` but the binary isn't
  resolvable. Gating on `package.json` keeps this default from breaking review in
  Python/Kotlin/Swift/etc. projects. It still doesn't guarantee the binary is actually
  installed in a given Node repo - an interactive `/init-stack` fallow-install step used to
  cover that half, but was removed in the GSD-free rewrite (eaf1a50; see RISK-INITSTACK-001),
  so nothing installs it interactively now. If a Node project's `/gsd-code-review`/`/gsd-ship`
  hits this before fallow is installed, the failure is loud and actionable (fallow's own error
  names the exact install command), not silent.

Deliberately NOT included (see rules-src/gsd.md and the hook's own commit history for why):
`tdd_mode`, `code_review`(+`_depth`/`_command`), `security_enforcement`/
`security_asvs_level`/`security_block_on` - the user-level CLAUDE.md already says set those
deliberately per project, not defaulted. Also excluded: `ui_phase`/`ui_review`/
`ui_safety_gate` (depend on whether the project even has a frontend - stack-dependent, not a
personal preference), `git.branching_strategy`(+templates) (depends on team workflow, not
stack or preference), `test_command`/`build_command`/`plan_bounce_script`/`mvp_mode`
(project-specific: no universal default makes sense across repos - the stack-aware
`/init-stack` proposal that used to set `test_command`/`build_command` was removed in eaf1a50
(see RISK-INITSTACK-001); gsd-core auto-detects a default),
`cross_ai_*`/`plan_review_convergence` (require an actually-configured external AI
CLI/reviewer - not universal), `runtime`/`model_profile_overrides`/`dynamic_routing`/
`model_policy` (this config already targets Claude Code directly via
`model_profile`/`model_overrides` - a second model-selection mechanism would be redundant or
conflicting), `effort.*`/`fast_mode.*` (currently a no-op on the `claude` runtime -
gsd-core's own `runtimeTierDefaults.claude` has no `reasoning_effort` entries and
`RUNTIMES_WITH_FAST_MODE` only contains `"api"` - revisit if that ever changes upstream),
`executor.stall_detect_interval_minutes`/`stall_threshold_minutes` (gsd-core's 5/10 min
defaults have no reason to change universally), `search_gitignored`/`response_language`/
`context_window`/`claude_md_path` (already-correct gsd-core defaults or project-specific),
`capabilities.*`/`agent_skills_security.trusted_global_roots` (`strict_known_registries`
left permissive - gsd-core's own consent gate already covers external installs;
`auto_update` is currently unwired/no-op in gsd-core; `trusted_global_roots` is
project-specific), and `security.injection_blocking` (unwired/no-op in this gsd-core
version). `graphify.auto_update` stays `false` even though `enabled` is `true`: gsd-core's
own auto-rebuild fires on every commit to the default branch, which is the "refresh on
every edit" cadence `rules-src/templates/graphify.PROJECT.md` explicitly argues against -
Claude driving `graphify update .` at the right checkpoints (review/verify pass) is
preferred over gsd-core's blunter per-commit trigger. `plan_chunked` is computed from
`process.platform` rather than hardcoded: it's a workaround for long-lived planner Tasks
hanging on stdio, which gsd-core's own docs (references/planning-config.md) call out as a
Windows-specific issue - `true` only when the hook actually runs on win32, so a config
synced to a Mac/Linux box (or the hook file copied there) doesn't force on a fix for a bug
that platform doesn't have. NESTED keys are merged key-by-key (not by replacing the whole
nested object), so sibling keys gsd-core or the user already set on those same objects
(e.g. `workflow.tdd_mode`, `workflow.security_block_on`) are left untouched.

Toggles: tier 1 (models) + tier 2 (workflow) together: `CLAUDE_GSD_CONFIG_AUTOPATCH=0`;
tier 2 alone, keep tier 1: `CLAUDE_GSD_CONFIG_AUTOPATCH_WORKFLOW=0`.

## model_overrides cross-check history

model_overrides was later evaluated against gsd-core's OWN adaptive-profile documentation
(open-gsd/gsd-core, confirmed real, not a guess from agent names) and 8 entries were
downgraded where the doc showed no quality reason to keep them higher:

- gsd-phase-researcher, gsd-project-researcher: opus -> sonnet (only planner/roadmapper/
  debugger/ui-researcher/doc-writer are in gsd-core's adaptive "bump to opus" list - plain
  researchers are not, and the "research" phase-type default is already sonnet).
- gsd-research-synthesizer, gsd-integration-checker, gsd-nyquist-auditor, gsd-ui-checker,
  gsd-ui-auditor, gsd-doc-verifier: sonnet -> haiku (gsd-core's own doc puts all six in its
  "always haiku under adaptive" group - structured-output/checking work, no open reasoning).

Deliberately NOT downgraded despite looking similar: gsd-security-auditor, gsd-code-reviewer
stay opus - not covered by gsd-core's documented table at all, but the user's own Model
Selection Policy (high-cost-of-error / cyber-adjacent -> opus) overrides on its own merits.

Resolved 2026-07-08: gsd-doc-writer bumped sonnet -> opus, matching gsd-core's adaptive
table (grouped with planner/roadmapper/debugger/ui-researcher) - no longer left as an open
discrepancy.

## Addendum (2026-07-13) — gsd-defaults.partial.json and the Tier 2 exclusions above

A second, independent delivery path now exists: `gsd-defaults.partial.json` (repo root),
applied to gsd-core's own native `~/.gsd/defaults.json` and to the current project's
`.planning/config.json` via `payload/hooks/lib/gsd-defaults-sync.mjs` (see
`docs/superpowers/plans/2026-07-13-gsd-defaults-and-statusline.md`).

That file deliberately includes `tdd_mode`, `code_review`(+`_depth`), and
`ui_phase`/`ui_review`/`ui_safety_gate` - a reversal of this document's Tier 2 "deliberately
NOT included" list above. The reversal is scoped to that new path only: this hook
(`gsd-config-patch.mjs`) and its `DEFAULT_WORKFLOW_CONFIG` are unchanged, still exclude
those keys, and the original rationale (set deliberately per project; UI keys are
stack-dependent) still applies to *this* hook's own Tier 2 patch. Reconciling the two
mechanisms into one is a separate, not-yet-scheduled task.
