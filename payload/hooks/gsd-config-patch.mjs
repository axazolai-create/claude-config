#!/usr/bin/env node
// gsd-config-patch.mjs - PostToolUse guard (matcher: Write|Edit|MultiEdit|Bash), cross-platform.
// When .planning/config.json exists for a project root, applies one-time patches:
//   tier 1: overwrite ONLY model_profile / models / model_overrides with the personal
//           defaults below (state key gsdModelConfigPatched);
//   tier 2: apply DEFAULT_WORKFLOW_CONFIG (state key gsdWorkflowConfigPatched); nested keys
//           merge key-by-key, sibling keys stay untouched.
// State file is shared with session-init.mjs (~/.claude/state/project-init.json); after the
// first patch each tier is a permanent no-op for that project - later manual edits win.
// Fires on all four tool types (not SessionStart) because gsd-core may create the config
// mid-session, via Claude's Write/Edit tools or a shelled-out script - so it checks
// filesystem state after the fact; cheap no-op on unrelated tool calls.
// Toggles: CLAUDE_GSD_CONFIG_AUTOPATCH=0 (both tiers), CLAUDE_GSD_CONFIG_AUTOPATCH_WORKFLOW=0
// (tier 2 only).
// The full per-key decision log (which gsd-core keys are patched / deliberately NOT patched
// and why; the model_overrides cross-check vs gsd-core's adaptive profile) lives in
// docs/gsd-config-defaults.md - update THAT file when changing TIER 2 keys or overrides.
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

// TIER 3: same "fallow enabled but not installed" gap check session-init.mjs runs
// unthrottled once per SessionStart - duplicated here (small, self-contained check, same
// deliberate duplication style as findRoot() above) so a `.planning/` folder created MID-
// SESSION (session-init.mjs already ran before it existed, won't re-check until next
// session) still gets caught. Unlike tier1/tier2, this is NOT one-time-then-forget - the gap
// is defined by current state (config says enabled, binary absent), not "have we ever told
// the user". But this hook fires on every Bash/Write/Edit/MultiEdit call, so unlike
// session-init.mjs's natural once-per-session cadence, this needs an explicit cooldown or
// it would re-check the filesystem on every single tool call. Opt out alongside tier2:
// CLAUDE_GSD_CONFIG_AUTOPATCH_WORKFLOW=0 (or CLAUDE_GSD_INITSTACK_SUGGEST=0 alone).
const TIER3_THROTTLE_MS = 2 * 60 * 60 * 1000; // 2h
const tier3Enabled = process.env.CLAUDE_GSD_INITSTACK_SUGGEST !== "0" && tier2Enabled;
const tier3Last = state[root] && state[root].gsdInitStackGapLastCheck
  ? Date.parse(state[root].gsdInitStackGapLastCheck) : 0;
const tier3Due = tier3Enabled && (!Number.isFinite(tier3Last) || Date.now() - tier3Last >= TIER3_THROTTLE_MS);

if (tier1Done && (tier2Done || !tier2Enabled) && !tier3Due) process.exit(0); // nothing left any tier could do right now

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
    "gsd-codebase-mapper": "opus",
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
  // fallow (structural dead-code/duplication/circular-dep pre-pass in code review) is only
  // enabled when this project root has a package.json - fallow is an npm/cargo-installable
  // binary with no meaning for non-Node stacks, and gsd-core FAILS the review workflow (not a
  // graceful skip) when enabled=true but the binary isn't resolvable. Gating on package.json
  // keeps this default from breaking review in Python/Kotlin/Swift/etc. projects. It still
  // doesn't guarantee the binary is actually installed in a given Node repo - that half is
  // handled by `/init-stack`'s fallow devDependency proposal (payload/commands/init-stack.md
  // step 5). If a Node project's `/gsd-code-review`/`/gsd-ship` hits this before `/init-stack`
  // ever ran, fallow's own error message tells the user exactly how to fix it
  // (`npm install -D fallow` / `cargo install fallow`) - a loud, actionable failure, not silent.
  code_quality: {
    fallow: {
      enabled: existsSync(join(root, "package.json")),
      scope: "phase",
      profile: "standard",
    },
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
    inline_plan_threshold: 4,
    auto_prune_state: true,
    plan_chunked: process.platform === "win32",
  },
  hooks: {
    context_warnings: true,
    workflow_guard: false,
  },
  features: {
    global_learnings: true,
    thinking_partner: true,
  },
  learnings: {
    max_inject: 10,
  },
  intel: {
    enabled: true,
  },
  plan_review: {
    source_grounding: true,
    source_grounding_authority: "grep",
  },
  statusline: {
    show_last_command: true,
    context_position: "front",
  },
  claude_md_assembly: {
    mode: "link",
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

// Tier 3 gap check - uses `parsed` AFTER the tier1/tier2 merge above, so a `fallow.enabled`
// flag written by tier2 in this SAME run is already visible. Read-only (never edits config);
// see the tier3Due comment above for why this needs its own throttled copy of the check
// session-init.mjs runs unthrottled every SessionStart.
let gapNote = "";
if (tier3Due) {
  const fallowCfg = parsed.code_quality && parsed.code_quality.fallow;
  if (fallowCfg && fallowCfg.enabled === true) {
    const fallowNames = process.platform === "win32"
      ? ["fallow.exe", "fallow.cmd", "fallow.bat"] : ["fallow"];
    const installed = fallowNames.some((n) => existsSync(join(root, "node_modules", ".bin", n)));
    if (!installed) {
      gapNote = "GSD settings gap: code_quality.fallow.enabled=true but the `fallow` binary " +
        "isn't installed - the next /gsd-code-review or /gsd-ship will hard-fail, not skip " +
        "gracefully. Run /init-stack (step 6) to install it, or set " +
        "code_quality.fallow.enabled: false for this project.";
    }
  }
  if (!state[root]) state[root] = {};
  state[root].gsdInitStackGapLastCheck = new Date().toISOString();
}

if (applied.length === 0 && !gapNote) process.exit(0);

if (applied.length > 0 && !writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n")) process.exit(0);

if (!state[root]) state[root] = {};
if (!tier1Done) state[root].gsdModelConfigPatched = new Date().toISOString();
if (!tier2Done && tier2Enabled) state[root].gsdWorkflowConfigPatched = new Date().toISOString();
writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");

emit([
  applied.length ? `Applied default ${applied.join(" and ")} to ${configPath} (one-time, freshly-created gsd-core config).` : "",
  gapNote
].filter(Boolean).join(" "));
