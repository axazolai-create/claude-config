#!/usr/bin/env node
// PostToolUse guard (matcher: Write|Edit|MultiEdit|Bash). Cross-platform (Node).
//
// WHY THIS EXISTS ALONGSIDE session-init.mjs (SessionStart): SessionStart only runs once at
// the *start* of a session. If `.planning/config.json` is created mid-session (e.g. the user
// runs /gsd-new-project or /gsd-settings partway through a working session), a SessionStart-only
// check wouldn't see it until the *next* session begins - a real gap, since gsd-core subagents
// spawned later in THIS session should already pick up the patched model config. This hook
// closes that gap by firing right after the tool call that (may have) created the file.
//
// WHY IT'S TOOL-AGNOSTIC (four tools in one matcher, same script): I don't have confirmed
// visibility into whether gsd-core's /gsd-new-project and /gsd-settings commands write
// .planning/config.json directly via the Write/Edit tool, or shell out to a bundled script via
// Bash. Rather than guess and pick one, this checks filesystem STATE after the fact (does the
// file now exist and is it unpatched?) instead of trying to parse which tool/args produced it -
// same defensive pattern graphify-global-sync.mjs uses (checks git state after any Bash call
// rather than parsing the exact git subcommand). Cheap no-op (a couple of existsSync calls) on
// every other tool call, so safe to leave on the broad matcher.
//
// WHAT IT DOES: exactly once per project (tracked in the SAME per-root state file
// session-init.mjs uses, key `gsdModelConfigPatched`), shallow-merges DEFAULT_MODEL_CONFIG's
// three keys (model_profile / models / model_overrides) into an existing .planning/config.json,
// overwriting only those three keys and leaving every other key gsd-core wrote (project name,
// dynamic_routing, workflow toggles, ...) untouched. After the first patch, this hook is a
// permanent no-op for that project - it will NOT fight the user's or gsd-core's own later edits
// to model_profile/models/model_overrides. That's the point: apply personal defaults once to a
// freshly-created config, then get out of the way.
//
// TIER 2 (2026-07-08): a second, independent one-time patch (state key
// `gsdWorkflowConfigPatched`) applies DEFAULT_WORKFLOW_CONFIG - top-level `commit_docs` /
// `parallelization` / `phase_naming` / `granularity`, plus a handful of keys NESTED under
// `git` / `workflow` / `hooks` / `graphify`. Classified as safe personal-preference defaults
// (not stack-dependent, not something gsd-core already asks well, not something this file's
// own advice says to set "deliberately per project"): QA-cadence/execution-style knobs
// (research/plan_check/verifier/nyquist_validation/pattern_mapper/post_planning_gaps/
// context_coverage_gate/human_verify_mode/auto_advance/node_repair(+budget)/
// research_before_questions/discuss_mode/skip_discuss/max_discuss_passes/subagent_timeout/
// plan_bounce(+passes)/ai_integration_phase/use_worktrees), `git.create_tag`, both `hooks.*`
// keys, and `graphify.enabled`/`graphify.auto_update`. Deliberately NOT included (see
// rules/gsd.md and this file's own commit history for why): `tdd_mode`, `code_review`(+
// `_depth`/`_command`), `security_enforcement`/`security_asvs_level`/`security_block_on` -
// this file already says set those deliberately per project, not defaulted. Also excluded:
// `ui_phase`/`ui_review`/`ui_safety_gate` (depend on whether the project even has a
// frontend - stack-dependent, not a personal preference) and `git.branching_strategy`(+
// templates) (depends on team workflow, not stack or preference). `graphify.auto_update` is
// deliberately `false` even though `enabled` is `true`: gsd-core's own auto-rebuild fires on
// every commit to the default branch, which is the "refresh on every edit" cadence
// `rules/templates/graphify.PROJECT.md` explicitly argues against - Claude driving
// `graphify update .` at the right checkpoints (review/verify pass) is preferred over
// gsd-core's blunter per-commit trigger. NESTED keys are merged key-by-key (not by replacing
// the whole `workflow`/`git`/`hooks`/`graphify` object), so sibling keys gsd-core or the user
// already set on those same objects (e.g. `workflow.tdd_mode`, `workflow.security_block_on`)
// are left untouched.
//
// Toggle tier 1 (models) + tier 2 (workflow) together: CLAUDE_GSD_CONFIG_AUTOPATCH=0
// Toggle tier 2 (workflow) alone, keep tier 1 (models): CLAUDE_GSD_CONFIG_AUTOPATCH_WORKFLOW=0
//
// NOTE ON THE VALUES BELOW: model_profile is "adaptive" per your call - it routes
// gsd-codebase-mapper/gsd-research-synthesizer/gsd-integration-checker/gsd-nyquist-auditor/
// gsd-pattern-mapper/gsd-ui-checker/gsd-ui-auditor/gsd-doc-verifier to haiku more aggressively
// than "balanced" would, closer to what model_overrides below already do.
//
// model_overrides was later evaluated against gsd-core's OWN adaptive-profile documentation
// (open-gsd/gsd-core, confirmed real, not a guess from agent names) and 8 entries were downgraded
// where the doc showed no quality reason to keep them higher:
//   - gsd-phase-researcher, gsd-project-researcher: opus -> sonnet (only planner/roadmapper/
//     debugger/ui-researcher/doc-writer are in gsd-core's adaptive "bump to opus" list - plain
//     researchers are not, and the "research" phase-type default is already sonnet).
//   - gsd-research-synthesizer, gsd-integration-checker, gsd-nyquist-auditor, gsd-ui-checker,
//     gsd-ui-auditor, gsd-doc-verifier: sonnet -> haiku (gsd-core's own doc puts all six in its
//     "always haiku under adaptive" group - structured-output/checking work, no open reasoning).
// Deliberately NOT downgraded despite looking similar: gsd-security-auditor, gsd-code-reviewer
// stay opus - not covered by gsd-core's documented table at all, but your own Model Selection
// Policy above (high-cost-of-error / cyber-adjacent -> opus) overrides on its own merits.
// Resolved 2026-07-08: gsd-doc-writer bumped sonnet -> opus, matching gsd-core's adaptive table
// (grouped with planner/roadmapper/debugger/ui-researcher) - no longer left as an open
// discrepancy.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const writeFile = (p, content) => { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); return true; } catch { return false; } };
// Strips a leading UTF-8 BOM before parsing - some external tool (PowerShell's
// `Set-Content -Encoding utf8`, or a manual save) can write project-init.json with one, and a
// raw JSON.parse throws on it, which the `safe()` wrapper then silently swallows into `{}` -
// i.e. every one-time gate in this file would silently "forget" it ever ran. Cheap and always
// correct even when there's no BOM (the regex just doesn't match).
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
function emit(ctx) {
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: ctx || "" }
    }));
  } catch { /* ignore */ }
  process.exit(0);
}

if (process.env.CLAUDE_GSD_CONFIG_AUTOPATCH === "0") process.exit(0);

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }

// Same root-finding walk as session-init.mjs, duplicated on purpose (small helper, keeps this
// hook independently readable/runnable without importing from a sibling file).
function findRoot(start) {
  let cur = resolve(start);
  for (let i = 0; i < 40; i++) {
    for (const m of [".planning", ".git", "package.json", "pyproject.toml", "go.mod", "build.gradle.kts"])
      if (existsSync(join(cur, m))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(start);
}

const root = findRoot(d.cwd || process.cwd());
const configPath = join(root, ".planning", "config.json");
if (!existsSync(configPath)) process.exit(0); // no config yet - nothing to do, cheapest exit

// Shared per-root state file with session-init.mjs - same namespace, same `state[root]` object,
// just new independent flag keys so the two hooks (and the two tiers below) never collide.
const stateFile = join(homedir(), ".claude", "state", "project-init.json");
let state = existsSync(stateFile) ? (safe(() => readJSON(stateFile)) || {}) : {};
const tier1Done = !!(state[root] && state[root].gsdModelConfigPatched);
const tier2Done = !!(state[root] && state[root].gsdWorkflowConfigPatched);
const tier2Enabled = process.env.CLAUDE_GSD_CONFIG_AUTOPATCH_WORKFLOW !== "0";
if (tier1Done && (tier2Done || !tier2Enabled)) process.exit(0); // nothing left either tier could do

const DEFAULT_MODEL_CONFIG = {
  model_profile: "adaptive",
  models: {
    planning: "opus",
    discuss: "sonnet",
    research: "sonnet",
    execution: "sonnet",
    verification: "opus",
    completion: "sonnet",
  },
  model_overrides: {
    "gsd-planner": "opus",
    "gsd-roadmapper": "opus",
    "gsd-pattern-mapper": "haiku",
    "gsd-phase-researcher": "sonnet",
    "gsd-project-researcher": "sonnet",
    "gsd-research-synthesizer": "haiku",
    "gsd-codebase-mapper": "haiku",
    "gsd-ui-researcher": "opus",
    "gsd-verifier": "sonnet",
    "gsd-plan-checker": "sonnet",
    "gsd-integration-checker": "haiku",
    "gsd-nyquist-auditor": "haiku",
    "gsd-ui-checker": "haiku",
    "gsd-ui-auditor": "haiku",
    "gsd-doc-verifier": "haiku",
    "gsd-code-reviewer": "opus",
    "gsd-security-auditor": "opus",
    "gsd-debugger": "opus",
    "gsd-executor": "sonnet",
    "gsd-code-fixer": "sonnet",
    "gsd-doc-writer": "opus"
  },
};

// Tier 2 - see the header comment above for the classification behind each key. Nested
// objects (git/workflow/hooks/graphify) are merged key-by-key via mergeNested(), never by
// replacing the whole object, so sibling keys already set (gsd-core's or the user's) survive.
const DEFAULT_WORKFLOW_CONFIG = {
  commit_docs: true,
  parallelization: true,
  phase_naming: "sequential",
  granularity: "fine",
  git: {
    create_tag: true,
  },
  workflow: {
    research: true,
    plan_check: true,
    verifier: true,
    nyquist_validation: true,
    ai_integration_phase: true,
    human_verify_mode: "end-of-phase",
    auto_advance: false,
    node_repair: true,
    node_repair_budget: 2,
    research_before_questions: false,
    discuss_mode: "discuss",
    skip_discuss: false,
    max_discuss_passes: 3,
    subagent_timeout: 300000,
    context_coverage_gate: true,
    pattern_mapper: true,
    plan_bounce: false,
    plan_bounce_passes: 2,
    post_planning_gaps: true,
    use_worktrees: true,
  },
  hooks: {
    context_warnings: true,
    workflow_guard: false,
  },
  graphify: {
    enabled: true,
    auto_update: false,
  },
};

// Merge each top-level key from `patch` into `target`: nested plain objects are merged
// key-by-key (Object.assign into the existing nested object, creating it if absent);
// everything else overwrites the top-level key directly.
function mergeNested(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object" || Array.isArray(target[k])) target[k] = {};
      Object.assign(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

const parsed = safe(() => readJSON(configPath));
if (parsed === undefined || typeof parsed !== "object" || parsed === null) process.exit(0); // don't touch malformed JSON

const applied = [];
if (!tier1Done) {
  Object.assign(parsed, DEFAULT_MODEL_CONFIG);
  applied.push("model_profile/models/model_overrides");
}
if (!tier2Done && tier2Enabled) {
  mergeNested(parsed, DEFAULT_WORKFLOW_CONFIG);
  applied.push("workflow/git/hooks/graphify defaults");
}
if (applied.length === 0) process.exit(0);

if (!writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n")) process.exit(0);

if (!state[root]) state[root] = {};
if (!tier1Done) state[root].gsdModelConfigPatched = new Date().toISOString();
if (!tier2Done && tier2Enabled) state[root].gsdWorkflowConfigPatched = new Date().toISOString();
writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");

emit(`Applied default ${applied.join(" and ")} to ${configPath} (one-time, freshly-created gsd-core config).`);
