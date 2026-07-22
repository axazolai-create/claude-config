#!/usr/bin/env node
// PreToolUse advisory hook (matcher: Bash|Read). Cross-platform (Node). ADVISORY ONLY - never
// blocks or asks; every path here resolves to permissionDecision:"allow" (or silent passthrough).
//
// Two independent, unrelated checks bundled into one hook file because both are cheap,
// stdin-driven, single-pass advisories with no state to share:
//
//   1. Worktree-parallelism discipline (Bash only, gated on cwd looking like a Claude Code
//      agent worktree: `.claude/worktrees/agent-*`) - see rules-src/gsd.md "Parallel worktree
//      waves" and the gsd-executor.md prose patches (gsd-agent-patches.mjs) this hook backs
//      up with a harness-level nudge instead of relying on prose alone:
//        - a pnpm/npm/yarn install command (pnpm without enableGlobalVirtualStore, or any
//          npm/yarn install, still pays the full per-worktree cost; even with the shared
//          store on, Windows can serialize/fail with EPERM under concurrent installs)
//        - a test-runner invocation with no visible scoping flag (running the full suite
//          per plan, multiplied across every parallel worktree, has been observed costing
//          tens of minutes per worker)
//        - a bare `git status` (hangs minutes on a large node_modules tree even with
//          .gitignore correctly excluding it - use `git diff --stat HEAD` instead)
//
//   2. context-mode Read backstop (Read only, no worktree gate - applies to any session).
//      context-mode's own large-file nudge (hooks/core/routing.mjs upstream) fires AT MOST
//      ONCE per session and never blocks - after the first large Read, every subsequent one
//      gets zero further reminder. This backstop re-fires every time (deliberately not
//      throttled - the whole point is to cover what the one-shot upstream nudge misses).
//
// Heuristic, not exhaustive: false negatives (an install/full-suite/status call this doesn't
// recognize) are expected and fine - this is a nudge, not an enforcement gate. Any parse
// failure => silent passthrough, matching house style (secrets-gate.mjs etc).
import { statSync } from "node:fs";
import { readFileSync } from "node:fs";

function stdin() { try { return readFileSync(0, "utf8"); } catch { return ""; } }

function advise(reason) {
  process.stdout.write(JSON.stringify({
    systemMessage: reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

let d = {};
try { d = JSON.parse(stdin() || "{}"); } catch { process.exit(0); }

const toolName = d.tool_name || "";
const cwd = d.cwd || process.cwd();
const IN_AGENT_WORKTREE_RE = /[\\/]\.claude[\\/]worktrees[\\/]agent-/;
const inAgentWorktree = IN_AGENT_WORKTREE_RE.test(cwd);

if (toolName === "Bash" && inAgentWorktree) {
  const cmd = ((d.tool_input || {}).command) || "";

  const INSTALL_RE = /(^|[;&|]\s*)(pnpm|npm|yarn)(\.cmd)?\s+(install|i|ci|add)(\s|$)/i;
  if (INSTALL_RE.test(cmd)) {
    const isPnpm = /(^|[;&|]\s*)pnpm(\.cmd)?\s/i.test(cmd);
    advise(
      isPnpm
        ? "worktree-discipline: pnpm install inside a parallel-wave worktree is expected and should be " +
          "fast (seconds) IF the project's pnpm-workspace.yaml has enableGlobalVirtualStore: true and the " +
          "orchestrator already resolved dependencies on the base branch before dispatch. If this install " +
          "is running minutes, that prerequisite is probably missing - see rules-src/gsd.md 'Parallel " +
          "worktree waves'. Never force-clear node_modules with Remove-Item -Recurse -Force/rm -rf on " +
          "Windows regardless - pnpm's internal reparse-point links make that unsafe."
        : "worktree-discipline: this is an npm/yarn install running inside a parallel-wave worktree - " +
          "there's no shared-store fast path for these like pnpm's enableGlobalVirtualStore, so every " +
          "worktree in a wave pays the full install cost independently (see rules-src/gsd.md 'Parallel " +
          "worktree waves'). Budget wave time for it, or consider whether this task needs worktree " +
          "isolation at all."
    );
  }

  const TEST_RUNNER_RE = /(^|[;&|]\s*)(pnpm|npm|yarn)(\.cmd)?\s+(run\s+)?test\b|(^|[;&|]\s*)(turbo\s+test|jest|vitest)\b/i;
  const SCOPE_FLAG_RE = /--filter|--testPathPattern|--related|-[a-zA-Z]*[km]\b|\.(test|spec)\.[jt]sx?\b/i;
  if (TEST_RUNNER_RE.test(cmd) && !SCOPE_FLAG_RE.test(cmd)) {
    advise(
      "worktree-discipline: this test invocation doesn't show a visible scoping flag (--filter/" +
      "--testPathPattern/--related/-k/-m, or a specific test file). If this runs the full suite, " +
      "scope it to this plan's own files_modified instead - a full-suite run inside every worker of " +
      "a wave has been observed costing tens of minutes per worker (see rules-src/gsd.md 'Parallel " +
      "worktree waves'). Defer full-suite runs to end-of-phase verification or the CI gate."
    );
  }

  const GIT_STATUS_RE = /(^|[;&|]\s*)git\s+status\b/i;
  if (GIT_STATUS_RE.test(cmd)) {
    advise(
      "worktree-discipline: `git status` can hang for minutes on a worktree with a 100K+-file " +
      "node_modules, even with .gitignore correctly excluding it (filesystem walk + AV cost, not a " +
      "git-ignore bug - `--porcelain` doesn't avoid this, same underlying walk). Use `git diff --stat " +
      "HEAD` for dirty-checks instead."
    );
  }
}

if (toolName === "Read") {
  const filePath = (d.tool_input || {}).file_path || (d.tool_input || {}).path || "";
  if (filePath) {
    try {
      const st = statSync(filePath);
      if (st.isFile() && st.size > 50_000) {
        advise(
          "context-mode-read-backstop: this file is " + Math.round(st.size / 1000) + "KB. context-mode's " +
          "own large-Read nudge fires at most once per session and never repeats - if you're reading this " +
          "to analyze/understand it (not about to Edit it), use ctx_execute_file instead, every time, not " +
          "just when reminded. If ctx_execute_file errors as not-found / invalid parameters, its schema is " +
          "deferred - load it once via ToolSearch (\"select:mcp__plugin_context-mode_context-mode__ctx_execute_file\") " +
          "and retry; don't fall back to a raw Read."
        );
      }
    } catch { /* file missing/unreadable - silent passthrough */ }
  }
}

process.exit(0);
