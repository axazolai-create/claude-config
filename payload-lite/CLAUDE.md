# USER RULES (~/.claude/CLAUDE.md) — lite variant

## PRECEDENCE & ENFORCEMENT MODEL (read first)
- This is USER scope. A project `CLAUDE.md` outranks it on conflict; treat such an
  override as intended, not a violation.
- INVARIANTS below are enforced by hooks, NOT by this prose. No project file can relax
  them. Everything else is a DEFAULT: advisory, overridable per project.
- Open the project-level `CLAUDE.md` (if present) before acting. Do not act from
  memory alone.

## INVARIANTS (hook-enforced; never relaxed by any project file)
- No secrets, tokens, or connection strings in commits. (PreToolUse: secrets-gate.mjs)
- No Write/Edit to a human-curated `CLAUDE.md` — `~/.claude/CLAUDE.md` and any file
  carrying the `CURATED:NOEDIT` marker. (PreToolUse: deny-curated-claude-md.mjs)
- These live in `settings.json` hooks, not here. If a hook is missing, say so — do not
  pretend this prose enforces it.

## LANGUAGE (default)
- Reply in Russian.
- Keep all documentation and config files in English.

## COLLABORATION CONTRACT (default)
- When the answer has options, present each option with what it affects, THEN ask.
- For tech/solution choices: a short description of each option precedes the question.
- Answers to direct questions include reasoning and a concrete example.
- Every plan is fixed to a file: per-stage rationale, how to verify quality, and
  load-bearing code examples (<100 lines).
- Log risks to `RISK_REGISTER.md` (project root) with stable IDs, not inline. Flag when
  a decision touches an Open risk.

## CONVENTIONS (default; a project CLAUDE.md may override)
- Never invent APIs/flags — verify or ask if unsure.
- Before commit: run the project's linter and tests.
- Follow the repo's stated branch/merge workflow; if none is stated, default to
  Conventional Commits, branch from `main`, squash-merge — but check for an existing
  convention first.

## SUDO ELEVATION (default; Windows)
- Windows 11's inline `sudo` is OFF by default — verify with `sudo config` first; on
  "Sudo is disabled on this computer", tell the user and do NOT fall back to another
  elevation method.
- Ask permission first, in-session, naming the exact command and why elevation is
  needed; run `sudo <command>` only after explicit consent — never silently, and never
  treat a UAC dialog as a substitute for asking.

## PLUGINS & SKILLS
- Plugins enabled at USER scope: superpowers, context-mode, context7. No per-project
  plugin machinery.
- enabledPlugins is resolved at STARTUP and does NOT hot-reload — a mid-session edit of
  settings.json does not activate a plugin; restart first.

## STACK RULES
- Per-project language/framework rules are compiled into `.claude/stack-rules.md` by
  `/init-stack` (stack detection + assembly from `~/.claude/rules-src/`). If the
  session-start check reports the snapshot stale or missing, suggest `/init-stack`.

## LAZY SKILLS (one-line pointers; invoke on demand)
- Codebase architecture / "where is X" questions → prefer the code graph: `graphify`
  skill (`/graphify`), global graph `~/.graphify/global-graph.json`.
- Choosing a model or effort for a task/subagent → `model-selection-policy` skill.

## CONTEXT-MODE (tool routing)
- context-mode hard-denies `WebFetch` (use `ctx_fetch_and_index`+`ctx_search`) and
  nudges Bash/Grep/large-`Read` toward its `ctx_*` MCP tools. Reach for them
  PROACTIVELY: filter/aggregate command output via `ctx_execute`/`ctx_batch_execute`;
  summarize large files via `ctx_execute_file` (plain `Read` only when you will
  `Edit`). If a `ctx_*` tool errors as not-found — `ToolSearch` `select:<tool>` once
  and retry. Diagnostics: `/ctx-doctor`.
