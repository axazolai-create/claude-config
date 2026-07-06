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
// Toggle: CLAUDE_GSD_CONFIG_AUTOPATCH=0
//
// NOTE ON THE VALUES BELOW: model_profile is "adaptive" per your call - it routes
// gsd-codebase-mapper/gsd-research-synthesizer/gsd-integration-checker/gsd-nyquist-auditor/
// gsd-pattern-mapper/gsd-ui-checker/gsd-ui-auditor/gsd-doc-verifier to haiku more aggressively
// than "balanced" would, closer to what model_overrides below already do. Everything else in
// this block is your original model_overrides/models, unedited.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const writeFile = (p, content) => { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); return true; } catch { return false; } };
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
// just a new independent flag key so the two hooks never collide.
const stateFile = join(homedir(), ".claude", "state", "project-init.json");
let state = existsSync(stateFile) ? (safe(() => JSON.parse(readFileSync(stateFile, "utf8"))) || {}) : {};
if (state[root] && state[root].gsdModelConfigPatched) process.exit(0); // already done, forever

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
    "gsd-phase-researcher": "opus",
    "gsd-project-researcher": "opus",
    "gsd-research-synthesizer": "sonnet",
    "gsd-codebase-mapper": "haiku",
    "gsd-ui-researcher": "opus",
    "gsd-verifier": "sonnet",
    "gsd-plan-checker": "sonnet",
    "gsd-integration-checker": "sonnet",
    "gsd-nyquist-auditor": "sonnet",
    "gsd-ui-checker": "sonnet",
    "gsd-ui-auditor": "sonnet",
    "gsd-doc-verifier": "sonnet",
    "gsd-code-reviewer": "opus",
    "gsd-security-auditor": "opus",
    "gsd-debugger": "opus",
    "gsd-executor": "sonnet",
    "gsd-code-fixer": "sonnet",
    "gsd-doc-writer": "sonnet",
  },
};

const raw = safe(() => readFileSync(configPath, "utf8"));
if (raw === undefined) process.exit(0);
const parsed = safe(() => JSON.parse(raw));
if (parsed === undefined || typeof parsed !== "object" || parsed === null) process.exit(0); // don't touch malformed JSON

Object.assign(parsed, DEFAULT_MODEL_CONFIG);
if (!writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n")) process.exit(0);

if (!state[root]) state[root] = {};
state[root].gsdModelConfigPatched = new Date().toISOString();
writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");

emit(`Applied default model_profile/models/model_overrides to ${configPath} (one-time, freshly-created gsd-core config).`);
