# USER RULES (~/.claude/CLAUDE.md)

## PRECEDENCE & ENFORCEMENT MODEL (read first)
- This is USER scope. Project `CLAUDE.md` outranks it on conflict, and memory is loaded as
  context, not enforced config — any project file (including GSD-generated ones) can soft-
  override prose here. Design accordingly:
  - INVARIANTS are enforced by hooks/managed policy, NOT by this prose. No project file can
    relax them. This file only documents intent.
  - Everything else is a DEFAULT. A project `CLAUDE.md` may override it; treat such an
    override as intended, not a violation.
- Behavioral rules that cannot be hook-gated (e.g. "don't invent APIs") are DEFAULTS by
  nature — they are advisory and degrade gracefully.

## INVARIANTS (hook / managed-policy enforced; never relaxed by any project file)
- No secrets, tokens, or connection strings in commits. (PreToolUse: secrets-gate.mjs)
- No Write/Edit to a human-curated `CLAUDE.md` — `~/.claude/CLAUDE.md` and any file carrying
  the `CURATED:NOEDIT` marker, in any location (root or `.planning/`). Unmarked generated
  files stay editable. (PreToolUse: deny-curated-claude-md.mjs)
- These live in `settings.json` hooks, not here. If a hook is missing, say so — do not
  pretend this prose enforces it.

## READING ORDER (every session, before acting)
- Open the project-level `CLAUDE.md` (if present) before acting. Do not act from memory alone.
- If `.planning/` exists, this is a GSD project — `rules/gsd.md` auto-loads (path-scoped to
  `.planning/**`) with the full methodology routing and CLAUDE.md quarantine rules.
- Language/framework rules in `~/.claude/rules/` load automatically by file type.
- If `.claude/settings.json` is missing the stack plugins for this repo, tell the user to
  run `/init-stack` and restart — do NOT enable plugins yourself (see PLUGINS & SKILLS).

## LANGUAGE (default)
- Reply in Russian.
- Keep all documentation and config files in English.

## Communication style (Russian replies)
- Reply in Russian (see LANGUAGE). Keep replies orthographically correct.
- **Before sending, scan for stray Latin letters accidentally mixed mid-word into Cyrillic
  text** (keyboard-layout slip, e.g. «objawление» instead of «объявление») — a word is
  either fully Cyrillic or fully Latin, never a mix, outside intentional inline English
  terms covered by the priority-order rule below.
- **Priority order for any technical term:** natural Russian word → real English term → (never) transliteration.
- **Prefer the Russian translation** whenever it is unambiguous, no harder to understand, and does NOT turn one word into several. In that case use the Russian word — not a transliteration and not the English term. E.g. `seam` → «стык», `merge` → «слияние», `nested` → «вложенный».
- **Keep the plain English term (Latin script)** only when translating would lose precision, be ambiguous, or need a multi-word phrase for a single term: `endpoint`, `RSC`, `claim`, `guard`, `payload`, `middleware`, `race condition`.
- **Never invent phonetic-Russian transliterations** of English words:
  - ❌ «сив» (seam), «феттчит» (fetches), «шипается» (ships), «дизейблить», «засабмитить».
  - ✅ Proper Russian: «стык»» (seam), «запрашивает» (fetches), «поставляется» (ships).
- Established, widely-used loanwords are fine: «рендерит», «коммит», «пул-реквест», «дебаг».
- Rule of thumb: if a one-word Russian equivalent reads clearly, use it; fall back to English only when Russian would be longer or fuzzier; never use a made-up hybrid.

## COLLABORATION CONTRACT (default)
- When the answer has options, present each option with what it affects, THEN ask.
- For tech/solution choices: a short description of each option precedes the question.
- Answers to direct questions include reasoning and a concrete example.
- Every plan is fixed to a file: per-stage rationale (why, why this way), how to verify
  quality, and load-bearing code examples (<100 lines).
- Log risks to `RISK_REGISTER.md` with stable IDs, not inline. Put it in `.planning/` if a
  GSD project exists, otherwise the project root. Flag when a decision touches an Open risk.
- Never report elapsed time for a background agent/task by estimating from the number or
  sum of wakeup/poll events while waiting — that estimate is unreliable (has been off by
  5x in practice). The only reliable signal a background task finished is its actual
  completion notification; wait for it. If elapsed time genuinely needs reporting, read a
  real timestamp before and after, never infer it from loop/poll count.

## CONVENTIONS (default; a project CLAUDE.md may override)
- Never invent APIs/flags — verify or ask if unsure. (advisory; not hook-gated)
- Before commit: run the project's linter and tests.
- Follow the repo's stated branch/merge workflow; if none is stated, default to Conventional
  Commits, branch from `main`, squash-merge — but check for an existing convention first
  (branch names like `develop`, rebase policies, protected-branch rules vary per repo and
  belong in that project's own `CLAUDE.md`, not assumed globally).

## SUDO ELEVATION (default; Windows)
- Windows 11 ships an inline `sudo` (Settings -> System -> For developers -> "Enable sudo"),
  OFF by default. Verify with `sudo config` before assuming it's usable — if it errors
  ("Sudo is disabled on this computer"), tell the user instead of attempting the command; do
  not fall back to another elevation method.
- Its prompt behavior (silent vs. UAC confirmation) depends on the configured mode (New
  Window / Disable input / Inline, with or without "always ask") — never assume a UAC dialog
  is a substitute for asking first.
- Ask permission first, in-session (AskUserQuestion or a direct question), with explicit
  justification: why elevation is needed and which exact command will run under `sudo`. Only
  after explicit consent, run `sudo <command>`. Never run it silently/preemptively — no
  answer, no call.
- Appropriate when the operation genuinely requires admin rights (ACL restricted to
  SYSTEM/Administrators, registering a Scheduled Task, writing to protected directories)
  while the session runs under a non-privileged/UAC-filtered token.
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

## GSD / SUPERPOWERS METHODOLOGY (conditional — see `rules/gsd.md`)
- Full routing (which `/gsd-*` command per phase, worktree ownership, TDD/debug/code-review
  single-enforcer rule) and the CLAUDE.md quarantine mechanics live in `rules/gsd.md`,
  path-scoped to `.planning/**` so they only load in GSD projects. Kept out of this file to
  avoid loading GSD-specific prose into every non-GSD project's context.

## RULES RESOLUTION & STACK MARKERS
- How language/framework rules stack (base -> direction -> cross-cutting) and the caveat
  about frameworks sharing extensions are documented once, in `~/.claude/rules/README.md` —
  see that file rather than duplicating it here. Check what actually loaded with `/memory`.
- Quick fallback if rules don't trigger: pyproject.toml -> Python | package.json -> Node/TS |
  next.config.* -> Next | nest-cli.json -> Nest | vite.config.* -> React |
  build.gradle.kts -> Kotlin | plugin.xml -> IntelliJ/Gateway plugin | *.sql -> SQL |
  *.sh / *.ps1 -> shell | AndroidManifest.xml -> Android (Kotlin) |
  *.xcodeproj/Info.plist -> iOS (Swift) | pubspec.yaml -> Flutter (Dart) |
  metro.config.js / app.config.* -> React Native | turbo.json -> Turborepo monorepo |
  nx.json -> Nx monorepo | bot.ts/bot.py + telegraf/grammy/aiogram/python-telegram-bot ->
  Telegram bot

# Model Selection Policy
DEFAULT executor: claude-sonnet-5
HIGH-ACCURACY / heavy reasoning: claude-opus-4-8

## Use sonnet-5 for
agentic coding, multi-step tool use, debug on brownfield, sustained tasks, knowledge work,
high-throughput / latency-sensitive loops.

## Use opus-4-8 for
high cost-of-error tasks, deep research, complex judgment, large context, parallel agents,
serious cyber-adjacent work (sonnet-5 weak here).
Prefer when a wrong answer is expensive to recover from.

## Effort rule
sonnet-5 @ ExtraHigh ~= opus-4-8 @ medium-high on OSWorld-Verified / BrowseComp.
If sonnet-5 at high effort stalls or under-delivers on an accuracy-critical task,
escalate sonnet-5 -> opus-4-8 rather than grinding sonnet-5 further.
Reserve max-effort sonnet-5 for throughput cases where opus latency/limits are the constraint.

## CODEBASE KNOWLEDGE GRAPH (graphify)
- A cross-project graph of the whole codebase lives at `~/.graphify/global-graph.json`
  (built via `graphify extract <repo> --global --as <name>`).
- For architecture / "where is X / what connects X to Y" / cross-repo questions, PREFER querying
  the graph over grepping many files:
  `graphify query "<question>" --graph ~/.graphify/global-graph.json`
  (also `graphify path "A" "B" --graph ...`, `graphify explain "X" --graph ...`).
- A single project's own graph (if built) is in that project's `graphify-out/` (`graph.json`,
  `GRAPH_REPORT.md`); prefer the per-project graph for questions scoped to that repo, and the
  global graph for cross-repo questions. Do not paste large graph dumps; query for the subgraph.
- Setup/refresh is out of band: `node ~/.claude/bin/graphify-setup.mjs --doctor --build-global <repos...>`.
- New projects auto-register into the global graph on first session. Every commit thereafter
  triggers a background refresh of that project's entry — both a Claude-driven `git commit`
  (`hooks/graphify-global-sync.mjs`) AND a native `.git/hooks/post-commit` installed once per
  project, so manual/IDE commits and `--amend` are covered too, not just commits Claude itself
  runs. No-ops if `graphify` isn't installed. Toggle: `CLAUDE_GRAPHIFY_AUTOSYNC=0`.
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
  When the user types `/graphify`, use the installed graphify skill or instructions before
  doing anything else.

## CONTEXT-MODE (tool routing, if active)
- context-mode (base plugin, see PLUGINS & SKILLS) intercepts `WebFetch` entirely (hard deny +
  redirect, every call) and nudges `Bash`/`Grep`/`Read`-on-large-files toward its own `ctx_*`
  MCP tools (`ctx_fetch_and_index`, `ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`,
  `ctx_search`) so raw tool output stays out of context instead of flooding it. Reach for
  these PROACTIVELY — don't wait to get denied first, and don't make the user ask each time:
  - Fetching a URL -> `ctx_fetch_and_index(url, source)` then `ctx_search(queries)`, never `WebFetch`.
  - Filtering/counting/aggregating command or grep output -> `ctx_execute`/`ctx_batch_execute`,
    not a raw `Bash` pipeline you intend to read the full output of.
  - Analyzing/summarizing a large file -> `ctx_execute_file`. `Read` is still correct when the
    file needs editing (`Edit` needs the exact bytes in context to match against).
  - If a `ctx_*` tool errors as not-found, it's a deferred schema, not unavailable — `ToolSearch`
    it once (`select:ctx_fetch_and_index,ctx_search,ctx_execute,ctx_execute_file,ctx_batch_execute`)
    and retry; do not fall back to the raw tool just because the schema wasn't loaded yet.
  - Diagnostics: `ctx doctor` (or `/ctx-doctor`) runs context-mode's own self-check. Session
    start already checks its version/staleness in the background and self-upgrades if stale
    (see `hooks/session-init.mjs`; opt out: `CLAUDE_TOOL_AUTOUPGRADE_CONTEXT_MODE=0`).
