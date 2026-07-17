#!/usr/bin/env node
// SessionStart hook (cross-platform).
// - The RISK_REGISTER step runs EVERY session and is idempotent: it finds the shallowest
//   RISK_REGISTER.md (root / .planning / its subfolders) and ensures the GSD-clobber entry,
//   so it self-heals even if the register appears or moves after the first session.
// - Auto-mark root CLAUDE.md and the per-project .planning exclude ALSO run every session now
//   (see the "timing bug" note further down for why - they used to be gated on `firstTime` and
//   that was wrong).
// Reliable side effects (do NOT depend on additionalContext, which can be dropped on fresh
// sessions):
//   - unmarked root CLAUDE.md that is not GSD-generated -> auto-mark as curated (every session,
//     idempotent - opt out: CLAUDE_CURATED_AUTOMARK_ROOT=0)
//   - GSD-owned (unmarked) .planning/CLAUDE.md          -> add per-project claudeMdExcludes
//     (every session, idempotent)
//   - existing RISK_REGISTER.md                         -> append the GSD-clobber risk (every session)
//   - graphify installed, root CLAUDE.md not curated    -> `graphify claude install` (one-time,
//     runs before the auto-mark step above so it never touches an already-curated file;
//     opt out: CLAUDE_GRAPHIFY_CLAUDE_INSTALL=0)
//   - graphify installed                                -> register + keep this project synced
//     in the cross-project global graph (one-time + native post-commit hook; opt out both:
//     CLAUDE_GRAPHIFY_AUTOSYNC=0)
// Hint (additionalContext, best-effort, re-checked EACH session until the MCP is wired):
//   - a GitHub/GitLab remote or database usage, with no matching MCP wired -> suggest /init-mcp
//     (git/DB can appear later, so this is not one-time; opt out: CLAUDE_MCP_SUGGEST=0).
//     Never runs anything - just surfaces the command.
// Master switch: CLAUDE_CURATED_AUTOINIT=0 disables everything. Never blocks the session.
//
// CONVENTION for anyone adding a new step here (the timing bug this file already hit once -
// see below - and must not hit again): gating a file/settings MUTATION on `firstTime` is only
// safe when the thing you're checking is GUARANTEED to already exist by session 1. If what
// you're fixing is "some file/state that might not exist yet, might appear on session 5, 50,
// or never" - like a generated CLAUDE.md, a tool getting installed later, a config key someone
// adds by hand - `firstTime` will consume itself on session 1 (state[root] gets created
// unconditionally a few lines up) whether or not your condition was even checkable yet, and
// your step then NEVER RUNS AGAIN for that project. The fix is always the same shape: make the
// step re-check EVERY session and be naturally idempotent (it only WRITES when its own
// on-disk check says the fix isn't applied yet, so a no-op re-check costs one file read). See
// the root-CLAUDE.md auto-mark and the .planning/CLAUDE.md exclude below for the pattern -
// neither uses `firstTime` anymore, on purpose.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";
import { resolveDial } from "./lib/leanmode-rules.mjs";
import { syncGsdAgentsContextMode } from "./lib/context-mode-gsd-agents.mjs";
import { checkGsdAgentPatches, checkRetiredGsdAgentPatches, checkRecursiveAgentSpawnGuardrail } from "./lib/gsd-agent-patches.mjs";
import { checkGsdWorkflowPatches } from "./lib/gsd-workflow-patches.mjs";
import { pruneGlobalLogIfDue } from "./lib/token-usage-prune.mjs";

const MARKER = "CURATED:NOEDIT";
// Whole-line match only (never a substring inside a longer line, so prose that just NAMES the
// marker can't self-trigger "already marked") - but lenient on whitespace: any line, any amount
// of spaces/tabs around the line and between the `<!--`/`-->` brackets and the marker text
// itself. Mirrors deny-curated-claude-md.mjs's own detection exactly - keep both in sync.
const MARKER_RE = /^<!--\s*CURATED:NOEDIT\s*-->$/;
const AUTOMARK = process.env.CLAUDE_CURATED_AUTOMARK_ROOT !== "0"; // default ON
const ENABLED  = process.env.CLAUDE_CURATED_AUTOINIT      !== "0"; // default ON

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const writeFile = (p, content) => { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); return true; } catch { return false; } };
// Strips a leading UTF-8 BOM before parsing - project-init.json (shared with
// gsd-config-patch.mjs) can pick one up from an external tool (e.g. PowerShell's
// `Set-Content -Encoding utf8`) or a manual save; a raw JSON.parse throws on it, which the
// `safe()` wrapper silently swallows into `{}`, making every one-time gate in this file
// "forget" it ever ran. Cheap and always correct even when there's no BOM.
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
function emit(ctx) {
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx || "" }
    }));
  } catch { /* ignore */ }
  process.exit(0);
}

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { /* ignore */ }
if (!ENABLED) emit("");

const startDir = d.cwd || process.cwd();

function findRoot(start) {
  let cur = resolve(start);
  for (let i = 0; i < 40; i++) {
    for (const m of [".git", ".planning", "package.json", "pyproject.toml", "go.mod", "build.gradle.kts"])
      if (existsSync(join(cur, m))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(start);
}
const root = findRoot(startDir);

// per-user state registry - keeps project trees clean; "unknown on THIS machine"
const stateFile = join(homedir(), ".claude", "state", "project-init.json");
let state = existsSync(stateFile) ? (safe(() => readJSON(stateFile)) || {}) : {};
const firstTime = !state[root]; // do not early-exit: the risk-register step must retry every session
if (!state[root]) state[root] = {}; // ensure the record exists so later independent one-time flags can attach

const isMarked = (p) => {
  const t = safe(() => readFileSync(p, "utf8"));
  return !!t && t.split(/\r?\n/).some((line) => MARKER_RE.test(line.trim()));
};
const looksGsd = (p) => {
  const t = safe(() => readFileSync(p, "utf8")) || "";
  return /gsd-core|\/gsd-|GSD project|\.planning\/(PROJECT|ROADMAP|STATE)\.md/i.test(t);
};

// ---- RISK_REGISTER.md discovery (mirrors add-risk.mjs): root, .planning, its subfolders ----
const SIG = "deny-curated-claude-md.mjs";
function listRegisters(rootDir) {
  const found = [];
  const rf = join(rootDir, "RISK_REGISTER.md");
  if (existsSync(rf)) found.push(rf);
  const base = join(rootDir, ".planning");
  if (existsSync(base)) {
    const stack = [base];
    while (stack.length) {
      const dir = stack.pop();
      let ents = [];
      try { ents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const ap = join(dir, e.name);
        if (e.isFile() && e.name === "RISK_REGISTER.md") found.push(ap);
        else if (e.isDirectory() && !e.name.startsWith(".")) stack.push(ap);
      }
    }
  }
  return found;
}
function pendingRegisters(rootDir) {
  const files = listRegisters(rootDir);
  if (!files.length) return [];
  const depth = (f) => relative(rootDir, f).split(/[\\/]+/).filter(Boolean).length - 1;
  const min = Math.min(...files.map(depth));
  return files.filter((f) => depth(f) === min).filter((p) => {
    const t = safe(() => readFileSync(p, "utf8")) || "";
    return !t.includes(SIG) && !/GSD-generated CLAUDE\.md/i.test(t);
  });
}

const actions = [], notes = [];
const gsdProject = existsSync(join(root, ".planning"));

// ALWAYS (every session, idempotent): ensure the GSD risk is in the shallowest register(s).
// Only spawns add-risk.mjs when a register actually lacks the entry, so steady state is cheap.
let riskAdded = 0;
if (gsdProject && pendingRegisters(root).length) {
  const addRisk = join(dirname(fileURLToPath(import.meta.url)), "..", "add-risk.mjs");
  if (existsSync(addRisk)) {
    const r = spawnSync(process.execPath, [addRisk, "--no-create", "--root", root], { encoding: "utf8" });
    if (r.status === 0) riskAdded = (r.stdout || "").split(/\r?\n/).filter((l) => /^appended /.test(l)).length;
  }
}
if (riskAdded > 0) actions.push(`ensured GSD-clobber risk in ${riskAdded} register(s)`);

// graphify claude install: registers graphify's OWN "always consult the graph" mechanism for
// THIS project - a CLAUDE.md section + a PreToolUse hook that fires before search-style tool
// calls / one-by-one file reads and nudges toward `graphify query` instead. Independent
// one-time flag (state[root].graphifyClaudeInstalled), like graphifySynced below, so it keeps
// retrying cheaply (just `--version`) until graphify is installed, then fires once.
// MUST run before the "root CLAUDE.md auto-mark" step just below: on a brand-new project's
// first session the file is still unmarked here, so graphify gets one chance to write into it
// before automark locks it in as curated a few lines down. On a RETROFIT session for an older
// project (automark already ran in the past), the curated-check below correctly finds the file
// already protected and skips - see the note it leaves for why.
// Why the pre-check at all: graphify's installer writes via a plain CLI subprocess, outside
// Claude's Edit/Write tool path, so `deny-curated-claude-md.mjs` (a PreToolUse hook gated on
// the Edit|Write|MultiEdit tool matcher) structurally cannot intercept it - this check is the
// only guard against it silently touching an already-curated file. Opt out just this piece
// (keep global-graph registration/sync): CLAUDE_GRAPHIFY_CLAUDE_INSTALL=0.
if (process.env.CLAUDE_GRAPHIFY_AUTOSYNC !== "0" && process.env.CLAUDE_GRAPHIFY_CLAUDE_INSTALL !== "0"
    && !state[root].graphifyClaudeInstalled) {
  const gv0 = safe(() => spawnSync("graphify", ["--version"], { encoding: "utf8" }));
  if (gv0 && !gv0.error && gv0.status === 0) {
    const rootClaudePre = join(root, "CLAUDE.md");
    if (!existsSync(rootClaudePre) || !isMarked(rootClaudePre)) {
      const ci = safe(() => spawnSync("graphify", ["claude", "install"], { cwd: root, encoding: "utf8", timeout: 15000 }));
      if (ci && !ci.error && ci.status === 0)
        actions.push("installed graphify's query-first CLAUDE.md section + PreToolUse hook");
    } else {
      notes.push(`Skipped 'graphify claude install': ${rootClaudePre} is already curated ` +
        `(CURATED:NOEDIT) - its installer writes via a plain CLI process outside Claude's tool ` +
        `path, so deny-curated-claude-md.mjs can't gate it. Run 'graphify claude install' by ` +
        `hand if you want it there, after reviewing the diff yourself.`);
    }
    state[root].graphifyClaudeInstalled = true;
  }
}

// EVERY session, idempotent - NOT `if (firstTime)`; this pair is the original victim of the
// timing bug described in the header CONVENTION. Both checks are cheap (existsSync + one
// read) and self-limiting, so re-checking indefinitely costs nothing.

// 1) GSD-owned (unmarked) .planning/CLAUDE.md -> per-project exclude
const planningClaude = join(root, ".planning", "CLAUDE.md");
if (existsSync(planningClaude) && !isMarked(planningClaude)) {
  const sp = join(root, ".claude", "settings.json");
  const s = existsSync(sp) ? safe(() => JSON.parse(readFileSync(sp, "utf8"))) : {};
  if (s) {
    const ex = new Set(s.claudeMdExcludes || []); const before = ex.size;
    ex.add("**/.planning/CLAUDE.md");
    if (ex.size !== before) {
      s.claudeMdExcludes = [...ex];
      if (writeFile(sp, JSON.stringify(s, null, 2) + "\n"))
        actions.push("excluded GSD .planning/CLAUDE.md from auto-load");
    }
  }
}

// 2) root CLAUDE.md: auto-mark unless it looks GSD-generated
const rootClaude = join(root, "CLAUDE.md");
if (existsSync(rootClaude) && !isMarked(rootClaude)) {
  if (AUTOMARK && !looksGsd(rootClaude)) {
    const t = safe(() => readFileSync(rootClaude, "utf8"));
    if (t !== undefined && writeFile(rootClaude, `<!-- ${MARKER} -->\n` + t))
      actions.push("marked root CLAUDE.md as curated");
  } else if (!AUTOMARK) {
    notes.push(`Unmarked CLAUDE.md at ${rootClaude}` +
      (looksGsd(rootClaude) ? " looks GSD-generated; left as-is." : `. If it's yours, add '<!-- ${MARKER} -->' as the first line.`));
  }
}

// Graphify cross-project sync: an INDEPENDENT one-time flag, not gated by `firstTime` -
// so a project that was already initialized before this feature existed still gets it
// on its next session, instead of being permanently skipped.
//   - registers this project in the global graph (~/.graphify/global-graph.json)
//   - installs a native <repo>/.git/hooks/post-commit hook so EVERY commit keeps that
//     entry fresh afterwards: manual/IDE commits and `--amend` included, not just
//     commits Claude runs through its own Bash tool (hooks/graphify-global-sync.mjs is
//     the Claude-Code-level fallback for that narrower case - see its header for why
//     both exist).
// No-op if graphify isn't installed. Toggle: CLAUDE_GRAPHIFY_AUTOSYNC=0.
if (process.env.CLAUDE_GRAPHIFY_AUTOSYNC !== "0" && !state[root].graphifySynced) {
  const gv = safe(() => spawnSync("graphify", ["--version"], { encoding: "utf8" }));
  if (gv && !gv.error && gv.status === 0) {
    // The whole point of the global graph is knowledge ACCUMULATION: a brand-new project
    // should see, on its very first session, that other repos' patterns/decisions already
    // exist and are queryable - instead of silently joining the pool while nobody ever
    // reads from it. Surface a preview of `graphify global list` once, right here, before
    // this project's own registration below. Best-effort: additionalContext can be dropped
    // on a fresh session (see file header), but this is cheap (local JSON read, no LLM call)
    // so there's no cost to trying every time this block fires.
    const gl = safe(() => spawnSync("graphify", ["global", "list"], { encoding: "utf8", timeout: 5000 }));
    if (gl && !gl.error && gl.status === 0 && (gl.stdout || "").trim()) {
      const preview = gl.stdout.trim().split(/\r?\n/).slice(0, 12).join(" | ");
      notes.push(`Global knowledge graph already has other repos registered - query it for ` +
        `existing patterns/decisions before re-deriving them from scratch: ` +
        `graphify query "<question>" --graph ~/.graphify/global-graph.json. Registered so far: ${preview}`);
    }

    const name = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "repo";
    safe(() => spawn("graphify", ["extract", root, "--global", "--as", name],
      { cwd: root, detached: true, stdio: "ignore" }).unref());
    actions.push(`queued graphify global registration as '${name}'`);

    const gitDir = join(root, ".git");
    if (existsSync(gitDir)) {
      const hooksDir = join(gitDir, "hooks");
      const hookPath = join(hooksDir, "post-commit");
      const marker = "# graphify-global-sync (added by ~/.claude/hooks/session-init.mjs)";
      const libScript = join(dirname(fileURLToPath(import.meta.url)), "lib", "graphify-global-sync-run.mjs");
      const invocation = `node "${libScript}" >/dev/null 2>&1 &\n`;
      const existing = existsSync(hookPath) ? (safe(() => readFileSync(hookPath, "utf8")) || "") : "";
      if (!existing.includes(marker)) {
        safe(() => mkdirSync(hooksDir, { recursive: true }));
        // Append to any pre-existing post-commit hook (husky, pre-commit, graphify's
        // own local-graph hook, ...) rather than replacing it - the same courtesy
        // graphify's own `hook install` extends to hooks that predate it.
        const content = existing
          ? existing.replace(/\n?$/, "\n") + `\n${marker}\n${invocation}`
          : `#!/bin/sh\n${marker}\n${invocation}`;
        if (writeFile(hookPath, content)) {
          safe(() => chmodSync(hookPath, 0o755));
          actions.push("installed native post-commit hook for graphify global sync");
        }
      }
    }

    state[root].graphifySynced = true;
  }
}

// Periodic self-upgrade check for known CLI tools this config integrates with (context-mode,
// graphify). Machine-wide, NOT scoped to this project - tracked in its own state file so it
// fires on its throttle window regardless of which project happens to trigger the session.
// Detached/background, never blocks, never surfaces an error if the tool is missing.
//   - context-mode ships its own `context-mode upgrade` CLI subcommand: pulls latest from
//     GitHub, rebuilds, reconfigures hooks. Its own `doctor` command already reports "outdated"
//     only when a newer version exists, so re-running `upgrade` when already current is
//     expected to be a cheap no-op (same assumption self-update commands like `brew upgrade`
//     make) - not independently verified against this specific CLI's source.
//   - graphify has no built-in self-upgrade subcommand; its own README documents
//     `uv tool upgrade graphifyy` as the update path. Only attempted if `uv` is on PATH
//     (bin/graphify-setup.mjs is the only installer here that guarantees that) - silently
//     skipped otherwise rather than guessing at pip/pipx equivalents.
// Throttled to once per 24h per tool (state timestamp) so a burst of sessions in one day
// doesn't re-trigger a rebuild/network check repeatedly. Toggle globally: CLAUDE_TOOL_AUTOUPGRADE=0.
// Toggle per tool: CLAUDE_TOOL_AUTOUPGRADE_<NAME> (dashes -> underscores, e.g.
// CLAUDE_TOOL_AUTOUPGRADE_CONTEXT_MODE=0).
// Accepted risk: this runs detached at session start, so an upgrade could in principle still be
// rewriting a tool's files while the very first few tool calls of the SAME session use it - the
// same trade-off already accepted for graphify's background extract above; no reports of it
// causing problems there.
const KNOWN_TOOLS = [
  { name: "context-mode", cmd: "context-mode", upgradeArgs: ["upgrade"] },
  { name: "graphify", cmd: "graphify", upgradeCmd: "uv", upgradeArgs: ["tool", "upgrade", "graphifyy"] },
];
if (process.env.CLAUDE_TOOL_AUTOUPGRADE !== "0") {
  const UPGRADE_THROTTLE_MS = 24 * 60 * 60 * 1000; // 24h
  const toolStateFile = join(homedir(), ".claude", "state", "tool-upgrade.json");
  let toolState = existsSync(toolStateFile) ? (safe(() => JSON.parse(readFileSync(toolStateFile, "utf8"))) || {}) : {};
  let toolStateChanged = false;

  for (const tool of KNOWN_TOOLS) {
    const envKey = `CLAUDE_TOOL_AUTOUPGRADE_${tool.name.toUpperCase().replace(/-/g, "_")}`;
    if (process.env[envKey] === "0") continue;

    const last = toolState[tool.name] ? Date.parse(toolState[tool.name]) : 0;
    if (Number.isFinite(last) && Date.now() - last < UPGRADE_THROTTLE_MS) continue;

    const installed = safe(() => spawnSync(tool.cmd, ["--version"], { encoding: "utf8" }));
    if (!installed || installed.error || installed.status !== 0) continue; // not installed - skip silently

    const upgradeBin = tool.upgradeCmd || tool.cmd;
    if (tool.upgradeCmd) {
      // Only attempt when the delegate binary (e.g. `uv`) is itself present.
      const delegatePresent = safe(() => spawnSync(tool.upgradeCmd, ["--version"], { encoding: "utf8" }));
      if (!delegatePresent || delegatePresent.error || delegatePresent.status !== 0) continue;
    }
    safe(() => spawn(upgradeBin, tool.upgradeArgs, { detached: true, stdio: "ignore" }).unref());
    actions.push(`queued background self-upgrade check for '${tool.name}'`);
    toolState[tool.name] = new Date().toISOString();
    toolStateChanged = true;
  }

  if (toolStateChanged) writeFile(toolStateFile, JSON.stringify(toolState, null, 2) + "\n");
}

// ---- stack-rules snapshot check ----
// Rules live in ~/.claude/rules-src/ (NOT auto-loaded) and reach the session as a compiled
// per-project snapshot .claude/stack-rules.md, @imported from .claude/CLAUDE.md. Existence-only
// check, no automatic staleness/drift detection (simplified 2026-07-13 - the prior sourceHash/
// stackFingerprint desync check via hooks/lib/stack-rules-check.mjs was too eager to fire a
// rebuild instruction every session; that lib is still used by the compiler subagent itself,
// just no longer imported here). When the snapshot is missing, point at /init-stack, which now
// owns generating it (rules-src/README.md § "Building stack-rules"). Once a snapshot exists it
// stays as-is until the next explicit /init-stack run or rebuild request. Opt out:
// CLAUDE_STACK_RULES=0.
if (process.env.CLAUDE_STACK_RULES !== "0") {
  const snapshotPath = join(root, ".claude", "stack-rules.md");
  if (!existsSync(snapshotPath)) {
    notes.push(`stack-rules: .claude/stack-rules.md does not exist for this project. Run ` +
      `/init-stack to generate it (it detects the stack and builds the snapshot as part of ` +
      `its own steps).`);
  }
}

// ---- proactive MCP suggestion (git host / database) -> /init-mcp ----
// A HINT only - never auto-runs anything. Surfaces /init-mcp when the repo shows a signal it helps
// with (a GitHub/GitLab remote, or database usage), unless that MCP is already wired. Re-checked
// EVERY session on purpose: git init / a DB dependency can appear later, and a one-time flag would
// miss it - instead it stops on its own once the matching MCP is configured. Web search is
// on-demand (no passive signal) - mentioned as an option. Opt out: CLAUDE_MCP_SUGGEST=0.
if (process.env.CLAUDE_MCP_SUGGEST !== "0") {
  const rd = (p) => safe(() => readFileSync(join(root, p), "utf8")) || "";
  const cfg = (rd(".claude/settings.json") + "\n" + rd(".mcp.json")).toLowerCase();  // already-wired MCPs
  const has = (k) => cfg.includes(`"${k}"`);
  const suggestions = [];

  const gitCfg = rd(".git/config").toLowerCase();
  const isGithub = /github\.com/.test(gitCfg), isGitlab = /gitlab/.test(gitCfg);
  if ((isGithub || isGitlab) && !has("github") && !has("gitlab"))
    suggestions.push(`the git remote is ${isGithub ? "GitHub" : "GitLab"} and no git-host MCP is configured`);

  const dbHay = (rd("package.json") + rd("pyproject.toml") + rd("requirements.txt") + rd(".env")
    + rd(".env.local") + rd("docker-compose.yml") + rd("docker-compose.yaml")).toLowerCase();
  if (/postgres|postgresql:\/\/|database_url|psycopg|asyncpg|sqlalchemy|"pg"|prisma|typeorm/.test(dbHay) && !has("postgres"))
    suggestions.push("the project touches a database (a local read-only Postgres MCP is available)");

  if (suggestions.length)
    notes.push(`MCP suggestion: ${suggestions.join("; ")}. Run /init-mcp to wire it (also offers a self-hosted SearXNG web-search MCP); it asks before changing anything and is re-runnable to switch/remove.`);
}

// ---- leanmode announcement convention reminder ----
// Not a mutation, not gated on firstTime - a standing behavioral instruction for the assistant
// itself, re-surfaced every session (additionalContext isn't guaranteed to survive across a
// long conversation - see the file header). Only worth showing when leanmode actually does
// something for this project (dial != "off"); a project with the dial off gets no reminder,
// same silence the SubagentStart hook itself already applies at "off".
// The banner a subagent launch prints (`agent_type(description) Model`) is drawn by the harness
// before any hook runs, so leanmode-subagent.mjs's own SubagentStart-emitted systemMessage
// cannot appear on it or as a separate line - confirmed empirically (2026-07-11, debug-log
// instrumentation + three real subagent launches): the hook fires and emits correctly, but
// systemMessage from SubagentStart never renders anywhere. The only way to surface the level
// BEFORE that banner is the assistant announcing it as plain prose.
if (process.env.CLAUDE_LEANMODE !== "0" && resolveDial(root) !== "off") {
  notes.push("leanmode is active for this project - before dispatching any subagent via the " +
    "Agent tool, resolve its effective level (resolveEffectiveLevel(subagentType, root) from " +
    "~/.claude/hooks/lib/leanmode-rules.mjs) and fold '(leanmode=<level>)' into the line that " +
    "already narrates that dispatch; a standalone one-line announcement only when nothing " +
    "else narrates the launch. Skip entirely when the resolved level is off.");
}

// ---- GSD /init-stack settings gap check -> suggest /init-stack ----
// A HINT only - never installs/edits anything itself. `/init-stack` steps 5-6
// (payload/commands/init-stack.md) propose workflow.test_command/build_command and a
// `fallow` devDependency install, but those steps only run when the user actually invokes
// /init-stack - which doesn't reliably happen right after `.planning/` first appears.
// gsd-config-patch.mjs's tier2 patch already writes `code_quality.fallow.enabled: true` for
// any Node project independent of whether /init-stack ever ran, and gsd-core HARD-FAILS
// /gsd-code-review / /gsd-ship (not a graceful skip) when that flag is true but the binary
// isn't resolvable. Re-checked EVERY session, like the MCP suggestion above - not a one-time
// flag, because the gap is defined by CURRENT STATE (config says enabled, binary absent),
// not "did we ever tell the user once". It stops surfacing on its own once fallow is
// actually installed, or the user declines via step 6 (which writes `fallow.enabled: false`
// and closes the gap for good - unlike a silent decline, which would leave this nagging
// forever). gsd-config-patch.mjs runs the SAME check on a throttle for the mid-session case
// (`.planning/` created after this session already started) - see that file for why both
// exist, same reasoning as the tier1/tier2 split at the top of that file.
// Opt out: CLAUDE_GSD_INITSTACK_SUGGEST=0.
if (process.env.CLAUDE_GSD_INITSTACK_SUGGEST !== "0" && gsdProject) {
  const cfgPath = join(root, ".planning", "config.json");
  const cfg = existsSync(cfgPath) ? (safe(() => readJSON(cfgPath)) || {}) : null;
  if (cfg && typeof cfg === "object") {
    const fallowCfg = cfg.code_quality && cfg.code_quality.fallow;
    if (fallowCfg && fallowCfg.enabled === true) {
      const fallowNames = process.platform === "win32"
        ? ["fallow.exe", "fallow.cmd", "fallow.bat"] : ["fallow"];
      const installed = fallowNames.some((n) => existsSync(join(root, "node_modules", ".bin", n)));
      if (!installed)
        notes.push("GSD settings gap: code_quality.fallow.enabled=true but the `fallow` " +
          "binary isn't installed - the next /gsd-code-review or /gsd-ship will hard-fail, " +
          "not skip gracefully. Run /init-stack (step 6) to install it, or explicitly set " +
          "code_quality.fallow.enabled: false for this project.");
    }
  }
}

// ---- gsd-* agents: add the context-mode MCP tool, only if that plugin is active ----
// Machine-wide, not project-scoped (gsd-* agents live in ~/.claude/agents/, owned by the
// separate gsd-core tool - not this bundle), so it runs regardless of whether THIS session's
// project is a GSD project. Every session, idempotent and self-healing: if context-mode isn't
// installed/enabled it's a no-op, and if gsd-core's own updater later rewrites an agent file and
// drops the tool, this puts it back on the next session. Opt out: CLAUDE_GSD_CONTEXTMODE_SYNC=0.
if (process.env.CLAUDE_GSD_CONTEXTMODE_SYNC !== "0") {
  const claudeDir = join(homedir(), ".claude");
  const r = safe(() => syncGsdAgentsContextMode({ claudeDir }));
  if (r && r.active && r.updated.length)
    actions.push(`added context-mode MCP tool to ${r.updated.length} gsd-* agent(s)`);
}

// ---- gsd-* agents: check (never write) for pending content patches ----
// Deliberately CHECK-ONLY, unlike the tool-grant sync just above: hooks/lib/gsd-agent-patches.mjs
// injects prose across 30+ files, so it's review-gated behind an explicit invocation (step 9 of
// payload/commands/init-stack.md, or standalone via /init-session) instead of silently
// rewriting every session. Every session, idempotent - cheap (file reads only), stops
// surfacing on its own once the patches have been applied and nothing is pending.
// Opt out: CLAUDE_GSD_AGENT_PATCHES_CHECK=0.
if (process.env.CLAUDE_GSD_AGENT_PATCHES_CHECK !== "0") {
  const claudeDir = join(homedir(), ".claude");
  const pending = safe(() => checkGsdAgentPatches({ claudeDir })) || {};
  const files = Object.keys(pending);
  if (files.length)
    notes.push(`gsd-* agent patches pending for ${files.length} file(s) ` +
      `(${files.slice(0, 5).join(", ")}${files.length > 5 ? ", ..." : ""}) - run /init-stack ` +
      `(step 9 applies these) or /init-session to apply.`);

  // Same check-only/apply-gated split, but for the inverse direction: a file still holding text
  // from a patch that's since been dropped from PATCHES entirely (see RETIRED_PATCHES) - stale
  // content nothing else ever cleans up, since gsd-* agents aren't rewritten by this bundle.
  const retiredPending = safe(() => checkRetiredGsdAgentPatches({ claudeDir })) || {};
  const retiredFiles = Object.keys(retiredPending);
  if (retiredFiles.length)
    notes.push(`gsd-* agent file(s) still carry text from ${retiredFiles.length} retired patch ` +
      `target(s) (${retiredFiles.slice(0, 5).join(", ")}${retiredFiles.length > 5 ? ", ..." : ""}) ` +
      `- run /init-stack (step 9) or /init-session to clean up.`);

  // Same check-only/apply-gated split, for gsd-core's own execute-phase.md dispatch template
  // (not an agents/*.md file, so tracked separately - see gsd-workflow-patches.mjs).
  const wfPending = safe(() => checkGsdWorkflowPatches({ claudeDir })) || {};
  const wfFiles = Object.keys(wfPending);
  if (wfFiles.length)
    notes.push(`gsd-core workflow patch pending for ${wfFiles.join(", ")} ` +
      `(routes verify_isolated="true" plans to gsd-executor-decomposing) - run /init-stack ` +
      `(step 9 applies this) or /init-session to apply.`);

  // Standing invariant, not a pending patch: an agent granting `Agent` with no anti-recursion
  // guardrail caused refusals/silent stuck states in the 2026-07 recursive-delegation test
  // series (see gsd.md's "Depth boundary" section). No auto-fix - flag for human review.
  const unguarded = safe(() => checkRecursiveAgentSpawnGuardrail({ claudeDir })) || [];
  if (unguarded.length)
    notes.push(`WARNING: ${unguarded.length} gsd-* agent(s) grant the Agent tool with no ` +
      `anti-recursion guardrail (${unguarded.slice(0, 5).join(", ")}${unguarded.length > 5 ? ", ..." : ""}) ` +
      `- review by hand before shipping; this combination is a known refusal/stuck-state trigger.`);
}

// ---- token-usage global log pruning: SessionStart only ----
// Retention for ~/.claude/state/token-usage.jsonl (the cross-project log; per-project
// .claude/token-usage.jsonl is never pruned) used to run from token-usage-log.mjs's
// SubagentStop/Stop handler - tied to the wrong event for a retention sweep (it fired after
// every subagent completion and every main-agent turn, throttled internally to once/24h but
// still triggered from per-event hooks instead of session start). Moved here 2026-07-13:
// token-usage-log.mjs now only appends, never prunes. pruneGlobalLogIfDue() keeps its own
// 24h throttle (state file), so calling it every session is still a cheap no-op most of the
// time. Toggle: CLAUDE_TOKEN_USAGE_PRUNE=0 (checked inside the function itself).
if (process.env.CLAUDE_TOKEN_USAGE_LOG !== "0") {
  const globalLog = join(homedir(), ".claude", "state", "token-usage.jsonl");
  const pruneStateFile = join(homedir(), ".claude", "state", "token-usage-prune.json");
  safe(() => pruneGlobalLogIfDue(globalLog, pruneStateFile));
}

// ONE-TIME per project (soft nudge, not urgent like the fallow gap above - gsd-core's own
// test_command/build_command auto-detect already works fine without an explicit value):
// suggest /init-stack's step 5 (stack-aware test_command/build_command proposal) once, the
// first session that sees BOTH a `.planning/` project and a recognizable stack signal with
// no explicit override yet. One-time (not recurring like the fallow check) because there's
// no hard-failure risk here to keep chasing - re-suggesting every session for something
// purely optional would just be noise.
if (firstTime && gsdProject) {
  const cfgPath = join(root, ".planning", "config.json");
  const cfg = existsSync(cfgPath) ? (safe(() => readJSON(cfgPath)) || {}) : null;
  if (cfg && typeof cfg === "object") {
    const wf = cfg.workflow || {};
    const hasStackSignal = existsSync(join(root, "package.json"))
      || existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "build.gradle.kts"));
    if (hasStackSignal && !wf.test_command && !wf.build_command)
      notes.push("workflow.test_command/build_command are unset - gsd-core auto-detects a " +
        "reasonable default, but /init-stack (step 5) can propose a more specific one from " +
        "the detected stack if you want to set it explicitly.");
  }
}

// record/update state (the risk step is allowed to run again on later sessions)
if (firstTime) { state[root].initialized = new Date().toISOString(); state[root].actions = actions.slice(); state[root].notes = notes.slice(); }
if (riskAdded > 0) state[root].lastRisk = new Date().toISOString();
writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");

emit([
  actions.length ? `Project auto-init (${root}): ${actions.join("; ")}.` : "",
  notes.join(" ")
].filter(Boolean).join(" "));
