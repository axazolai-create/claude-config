# USER RULES (~/.claude/CLAUDE.md)

## PRECEDENCE & ENFORCEMENT MODEL (read first)
- This is USER scope. Project `CLAUDE.md` outranks it on conflict, and memory is loaded as
  context, not enforced config — any project file (including GSD-generated ones) can soft-
  override prose here. Design accordingly:
  - INVARIANTS are enforced by hooks/managed policy, NOT by this prose. No project file can
    relax them. This file only documents intent.
  - Everything else — including behavioral rules that cannot be hook-gated ("don't invent
    APIs") — is a DEFAULT: advisory, a project `CLAUDE.md` may override it; treat such an
    override as intended, not a violation.

## INVARIANTS (hook / managed-policy enforced; never relaxed by any project file)
- No secrets, tokens, or connection strings in commits. (PreToolUse: secrets-gate.mjs)
- No Write/Edit to a human-curated `CLAUDE.md` — `~/.claude/CLAUDE.md` and any file carrying
  the `CURATED:NOEDIT` marker, in any location (root or `.planning/`). Unmarked generated
  files stay editable. (PreToolUse: deny-curated-claude-md.mjs)
- These live in `settings.json` hooks, not here. If a hook is missing, say so — do not
  pretend this prose enforces it.

## READING ORDER (every session, before acting)
- Open the project-level `CLAUDE.md` (if present) before acting. Do not act from memory alone.
- If `.planning/` exists, this is a GSD project — the project's stack-rules snapshot
  includes `rules-src/gsd.md` (methodology routing + CLAUDE.md quarantine rules).
- Language/framework rules are compiled per project into `.claude/stack-rules.md` from
  `~/.claude/rules-src/` (checked at session start; see `rules-src/README.md`). They are
  NOT auto-loaded by file type anymore.
- If `.claude/settings.json` is missing the stack plugins for this repo, tell the user to
  run `/init-stack` and restart — do NOT enable plugins yourself (see PLUGINS & SKILLS).

## LANGUAGE (default)
- Reply in Russian.
- Keep all documentation and config files in English.

## Communication style (Russian replies)
- Keep replies orthographically correct. **Before sending, scan for stray Latin letters
  mixed mid-word into Cyrillic** (keyboard-layout slip: «objawление» → «объявление») — a
  word is fully Cyrillic or fully Latin, never a mix, outside intentional inline English
  terms per the priority rule below.
- **Term priority:** natural Russian word → real English term → (never) transliteration.
  - Plain English (Latin script) when translating loses precision or needs a multi-word.
  - Never invented phonetic hybrids; established loanwords are fine («рендерит», «коммит», «пул-реквест»).

## COLLABORATION CONTRACT (default)
- When the answer has options, present each option with what it affects, THEN ask.
- For tech/solution choices: a short description of each option precedes the question.
- Answers to direct questions include reasoning and a concrete example.
- Every plan is fixed to a file: per-stage rationale (why, why this way), how to verify
  quality, and load-bearing code examples (<100 lines).
- Log risks to `RISK_REGISTER.md` with stable IDs, not inline. Put it in `.planning/` if a
  GSD project exists, otherwise the project root. Flag when a decision touches an Open risk.
- Elapsed time of a background agent/task: never estimate it from wakeup/poll counts (seen
  off by 5x in practice); the only "finished" signal is the actual completion notification.
  If elapsed time must be reported, read real timestamps before and after.

## CONVENTIONS (default; a project CLAUDE.md may override)
- Never invent APIs/flags — verify or ask if unsure. (advisory; not hook-gated)
- Before commit: run the project's linter and tests.
- Follow the repo's stated branch/merge workflow; if none is stated, default to Conventional
  Commits, branch from `main`, squash-merge — but check for an existing convention first
  (branch names like `develop`, rebase policies, protected-branch rules vary per repo and
  belong in that project's own `CLAUDE.md`, not assumed globally).

## SUDO ELEVATION (default; Windows)
- Windows 11's inline `sudo` is OFF by default — verify with `sudo config` first; on
  "Sudo is disabled on this computer", tell the user and do NOT fall back to another
  elevation method.
- Ask permission first, in-session (AskUserQuestion or a direct question), naming the exact
  command and why elevation is needed; run `sudo <command>` only after explicit consent —
  never silently/preemptively (no answer, no call), and never treat a UAC dialog
  (mode-dependent, may not appear at all) as a substitute for asking.
- Appropriate only when the operation genuinely needs admin rights (SYSTEM/Administrators
  ACL, Scheduled Task registration, protected directories) under a UAC-filtered token.
- Example: `sudo powershell -ExecutionPolicy Bypass -File 'C:\path\to\Script.ps1'`

## PLUGINS & SKILLS (loading policy)
- Base plugins (superpower, gsd, context-mode) are enabled at USER scope and load every
  session. Do not duplicate them in project settings.
- Stack-specific plugins are enabled PER PROJECT via `.claude/settings.json` -> enabledPlugins.
- Project plugin sets live under `~/.claude/setting-templates/`, nested by direction (e.g.
  `frontend/react.json`, `bots/node.json` - see that folder's README for the full layout) and
  are applied with `/init-stack` (detects stack, checks install status, merges settings).
- enabledPlugins is resolved at STARTUP and does NOT hot-reload. Never edit settings.json
  mid-session to "enable" a plugin and claim it is active — it is not until restart.
  If stack plugins are missing, surface it: tell the user to run `/init-stack`, then restart.
- Keep an `enabledPlugins` key in `.claude/settings.json` even if `{}` — otherwise entries
  in settings.local.json are silently dropped on merge.

## GSD / SUPERPOWERS METHODOLOGY (conditional — see `rules-src/gsd.md`)
- Full routing (which `/gsd-*` command per phase, worktree ownership, TDD/debug/code-review
  single-enforcer rule) and the CLAUDE.md quarantine mechanics live in `rules-src/gsd.md`,
  compiled into the stack-rules snapshot only for GSD projects (`.planning/` marker). Kept
  out of this file to avoid loading GSD-specific prose into every non-GSD project's context.

## RULES RESOLUTION & STACK MARKERS
- How rules layer (base -> direction -> cross-cutting) and how the per-project snapshot is
  built are documented once in `~/.claude/rules-src/README.md`. What's active for a project =
  its `.claude/stack-rules.md`.
- The file->stack detection markers (which drive detection and the rebuild fingerprint) live
  in the `stack-markers` skill — invoke it when you need the marker->stack mapping.

# Model Selection Policy
- DEFAULT executor: claude-sonnet-5. Escalate to claude-opus-4-8 for high cost-of-error /
  deep reasoning / large context / parallel agents / serious cyber work.
- Full sonnet-vs-opus routing + the effort rule → the `model-selection-policy` skill.

## CODEBASE KNOWLEDGE GRAPH (graphify)
- For architecture / "where is X / what connects X to Y" / cross-repo questions PREFER the
  code graph over grepping: global graph `~/.graphify/global-graph.json`, per-project
  `graphify-out/`. Query for the subgraph, never paste dumps. Query/path/explain CLI,
  autosync and setup live in the `graphify` skill — invoke it (`/graphify`) for those.

## CONTEXT-MODE (tool routing, if active)
- context-mode (base plugin) hard-denies `WebFetch` (use `ctx_fetch_and_index`+`ctx_search`)
  and nudges Bash/Grep/large-`Read` toward its `ctx_*` MCP tools so raw output stays out of
  context. Reach for them PROACTIVELY, not after a denial: filter/aggregate command output
  via `ctx_execute`/`ctx_batch_execute`; summarize large files via `ctx_execute_file` (plain
  `Read` only when you will `Edit`). If a `ctx_*` tool errors as not-found it's a deferred
  schema — `ToolSearch` `select:<tool>` once and retry, never fall back to the raw tool.
  Diagnostics: `/ctx-doctor`.
