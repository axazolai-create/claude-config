# Curated ~/.claude config — installation and how it works

[🇷🇺 Русский](README.md) | 🇬🇧 English

Cross-platform (Linux / macOS / Windows). Principle: **unpack the archive anywhere and run
one script** — the installer does all the copying into `~/.claude` itself, nothing to lay out
by hand.

```
node setup.mjs
```

After installing — **restart Claude Code** (hooks and settings are only read at startup).

---

## Table of Contents

- [Install on a new machine (bootstrap, no manual download)](#install-on-a-new-machine-bootstrap-no-manual-download)
- [Order of operations](#order-of-operations)
  - [Initial setup (new machine)](#initial-setup-new-machine)
  - [Reconfiguring](#reconfiguring)
- [Why any of this (problem → solution)](#why-any-of-this-problem-solution)
- [What goes where](#what-goes-where)
- [How the installer works (`setup.mjs`)](#how-the-installer-works-setupmjs)
  - [Conflicts (curated text and JSON): merge / replace / skip](#conflicts-curated-text-and-json-merge-replace-skip)
  - [Diff readability](#diff-readability)
  - [Repo layout: `payload/` vs root](#repo-layout-payload-vs-root)
  - [Flags (non-interactive / for CI)](#flags-non-interactive-for-ci)
- [Protection model: the marker, not the path](#protection-model-the-marker-not-the-path)
- [Project auto-init (SessionStart)](#project-auto-init-sessionstart)
- [What each hook does and why](#what-each-hook-does-and-why)
- [Required tools and fallback](#required-tools-and-fallback)
- [PowerShell tool on Windows (optional, manual — not via setup.mjs)](#powershell-tool-on-windows-optional-manual-not-via-setupmjs)
- [Post-install check](#post-install-check)
- [Codebase knowledge graph (graphify) + a shared graph across all projects](#codebase-knowledge-graph-graphify-a-shared-graph-across-all-projects)
  - [Install / check (+ extra components, + uv auto-setup)](#install-check-extra-components-uv-auto-setup)
  - [The whole codebase at once, not project by project](#the-whole-codebase-at-once-not-project-by-project)
  - [Where the result is stored and how it's available in any project](#where-the-result-is-stored-and-how-its-available-in-any-project)
  - [Auto-registering a new project + auto-refresh on commit](#auto-registering-a-new-project-auto-refresh-on-commit)
  - [`graphify claude install` — the official "always consult the graph" hook mechanism](#graphify-claude-install-the-official-always-consult-the-graph-hook-mechanism)
  - [Auto-updating CLI tools (context-mode, graphify)](#auto-updating-cli-tools-context-mode-graphify)
- [Other / limitations](#other-limitations)
- [Diagnostics: `PreToolUse hook error` / `cannot find module` on every Edit](#diagnostics-pretooluse-hook-error-cannot-find-module-on-every-edit)
- [Cyrillic console: character errors (checkmark/dash) and where RISK_REGISTER lives](#cyrillic-console-character-errors-checkmarkdash-and-where-risk_register-lives)

---

## Install on a new machine (bootstrap, no manual download)

One command — it downloads the package as a tarball itself (no git needed) and runs
`setup.mjs`. Only **Node** is required (plus `tar`/`curl`, which ship out of the box on
Win10 1803+/macOS/Linux).

```
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.ps1 | iex
```

Forwarding flags to `setup.mjs` (e.g. a non-interactive replace): POSIX — `… | bash -s -- --replace-all`;
Windows — `$env:CLAUDE_SETUP_ARGS='--replace-all'; irm … | iex`.

> Note: with `curl|bash` on Linux/macOS, `setup.mjs` runs non-interactively (stdin is occupied
> by the pipe) — on an already-configured `~/.claude`, conflicts are resolved with an additive
> merge (no loss, with backups/sidecars); to force a replace, add `-- --replace-all`. On a clean
> machine there's no difference.

**Safer alternative** to `curl|bash` / `irm|iex` (read first, then run):

```
# Linux / macOS
curl -fsSLO https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh
less bootstrap.sh && bash bootstrap.sh

# Windows PowerShell
irm https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.ps1 -OutFile bootstrap.ps1
notepad bootstrap.ps1; .\bootstrap.ps1
```

After installing — **restart Claude Code**.

---

## Order of operations

Two independent mechanisms with different scope — **they don't call each other and know
nothing about each other** (see "Repo layout" below): `setup.mjs` installs **`~/.claude` as a
whole** (hooks, rules, skills, `CLAUDE.md`, the base `settings.json` — once per machine),
`/init-stack` wires up **a specific project's plugins** (once per project, or when the stack
changes).

### Initial setup (new machine)

1. `node setup.mjs` (or bootstrap — see above) — installs `~/.claude`, including
   `~/.claude/bin/init-stack.py`, which step 3 uses.
2. **Restart Claude Code** (hooks and `settings.json` are only read at startup).
3. In every PROJECT that needs stack-specific plugins — open a Claude Code session there and
   run `/init-stack`. It:
   - runs `python3 ~/.claude/bin/init-stack.py` itself (stack detection + report, writes
     nothing);
   - asks you to run `python3 ~/.claude/bin/init-stack.py -i` yourself, in YOUR OWN terminal —
     the interactive checklist (arrow-key UI) can't be driven through Claude; on confirmation
     it installs the missing plugins itself (`claude plugin install`) and writes
     `./.claude/settings.json`;
   - if there's no real terminal — non-interactive fallback (`--enable`/`--apply-all`);
   - for GSD projects (`.planning/config.json` exists), it additionally proposes
     `workflow.test_command`/`build_command` and installing `fallow`, if the stack supports it.
4. **Restart Claude Code again** — `enabledPlugins` also only resolves at startup.

Bottom line for a new machine: `setup.mjs` — once, `/init-stack` — per project (right after
cloning the repo, or whenever it first needs plugins).

### Reconfiguring

| What changed | What to run | How often |
|---|---|---|
| A new version of this repo shipped (hooks/rules/skills updated) | `node setup.mjs` (conflict flags — see above; `--dry-run` to preview without touching anything) | whenever the package updates |
| `PreToolUse hook error` / broken paths in `~/.claude/settings.json` | `node setup.mjs --doctor`, then `node setup.mjs` | by symptom (see diagnostics below) |
| The project's stack changed/gained a new one (new framework, monorepo, etc.) | `/init-stack` again — already-enabled plugins are pre-checked + the new stack's auto-set is added | on a stack change |
| Toggle one specific plugin without a full `/init-stack` run | `python3 ~/.claude/bin/init-stack.py -i` directly (same checklist, but without the report and without `/init-stack`'s GSD steps 5-6) | as needed |
| Just check current plugin status, changing nothing | `python3 ~/.claude/bin/init-stack.py` (no args, writes nothing) | as needed |

After ANY of these steps that touched `settings.json` (user-level or project-level) —
**restart Claude Code**: hooks, the user `CLAUDE.md`, and `enabledPlugins` only resolve at
startup, there's no hot-reload.

---

## Why any of this (problem → solution)

The underlying problem: in Claude Code, **a project `CLAUDE.md` overrides the user one**, and
`CLAUDE.md` itself loads as context, not as "hard" config — meaning any project file
(including a GSD-generated one) can silently override your carefully-tuned rules. Prose in the
global `~/.claude/CLAUDE.md` can't protect against that. Only hooks work reliably.

So this package does three things:

1. **Protects curated files** — a PreToolUse hook blocks edits to any `CLAUDE.md` carrying the
   `<!-- CURATED:NOEDIT -->` marker, wherever it lives (project root or `.planning/`). The
   marker decides everything, the path doesn't matter. Unmarked (generated) files are edited
   freely.
2. **Catches secrets** — a PreToolUse hook on `git commit` scans staged changes; on a hit, the
   commit is blocked (only fires on commits Claude makes, not your manual ones).
3. **Removes the busywork on new projects** — a SessionStart hook automatically marks a
   curated root `CLAUDE.md`, adds a per-project exclude for a GSD-owned `.planning/CLAUDE.md`,
   and appends a risk to `RISK_REGISTER.md`. Nothing to do by hand, per project.

---

## What goes where

```
~/.claude/
  CLAUDE.md                              # your curated rules (contains the marker line)
  settings.json                          # your file + pre-merged keys (hooks, permissions.deny)
  add-risk.mjs                           # risk-register helper (called by auto-init)
  hooks/
    deny-curated-claude-md.mjs           # blocks edits to a curated CLAUDE.md (any location)
    secrets-gate.mjs                     # blocks `git commit` when secrets are found in staged
    db-live-access-gate.mjs              # read-only gate on live DBs (PreToolUse: Bash|mcp__*)
    graphify-global-sync.mjs             # after a Claude `git commit` — bg. refresh of global-graph.json
    lib/
      graphify-global-sync-run.mjs       # shared worker (called by the hook above and the native post-commit)
    session-init.mjs                     # SessionStart: project bootstrap (+ registration in graphify,
                                          #   + installing the native post-commit hook in the project)
    token-usage-log.mjs                  # SubagentStop + Stop — token/$ spend log in JSONL
    lib/
      token-usage-shared.mjs             # shared helpers (findRoot, JSONL read/append, cursor)
      token-usage-prune.mjs              # global log retention (3mo / last-but-one day / min 10)
      token-usage-pricing-refresh.mjs    # bg. scrape of the pricing table once a day
    leanmode-subagent.mjs                # SubagentStart: per-agent_type YAGNI ruleset (see below)
    lib/
      leanmode-rules.mjs                 # agent_type->level map, BASE+dial resolver, shift table
      leanmode-lite-rule.md              # rule text: lite
      leanmode-full-rule.md              # rule text: full
      leanmode-ultra-rule.md             # rule text: ultra (extends full)
      mark-initstack-done.mjs            # called from /init-stack; sets initStackRun in project-init.json
  agents/
    leanmode-executor.md                 # subagent for explicit per-task lean opt-in (see below)
  commands/
    leanmode.md                          # /leanmode — interactive/--flag, sets the project-level dial
  skills/
    using-git-worktrees/SKILL.md         # no-op stub for Superpowers' worktree skill
    token-usage/SKILL.md                 # /token-usage — token spend log summary
  state/project-init.json                # created at runtime; list of already-initialized projects
                                          #   (+ initStackRun per project root — set by /init-stack)
  state/token-usage.jsonl                # created at runtime; global token spend log
  state/model-pricing.json               # created at runtime; pricing table (refreshed once a day)
```

---

## How the installer works (`setup.mjs`)

- Copies all files into `~/.claude` (creates folders), sets +x on `.mjs` under POSIX.
- **Scope — `~/.claude` only** (hooks, `rules/`, `skills/`, `CLAUDE.md`, `settings.json`).
  Project plugins are NOT part of this — that's a separate, independent mechanism,
  `/init-stack` (see below), with its own script (`bin/init-stack.py`) and its own output. If
  after running `setup.mjs` the output only shows plugin-related messages — `/init-stack` was
  probably run instead of `setup.mjs`: they don't call each other and know nothing about each
  other.

Two tiers of files, handled differently, **deliberately**:

- **Managed content** — `.mjs` scripts, and really any `.md`/text file that is NOT marked
  `CURATED:NOEDIT`. The package is the source of truth, so such a file **is always overwritten
  with the archive's version, no questions asked** — exactly like scripts. This is what makes
  "drop in a fresh package, old files get updated" real not just for `.mjs`, but for `rules/`,
  `skills/`, `README.md`, etc.
- **Curated content** — a file whose **current on-disk content** carries the `CURATED:NOEDIT`
  marker (in practice — your `~/.claude/CLAUDE.md`). Never touched silently: a diff is shown,
  three options to choose from (see below). The marker decides, not the filename — same as in
  the `deny-curated-claude-md.mjs` hook's protection model.
- **JSON** (`settings.json`, `setting-templates/*.json`) — a third case: a real **additive deep
  merge** (your values are kept, missing keys/array items are added). Also conflict-checked
  like curated files, because JSON usually holds real per-machine values (marketplace ids, your
  model choice, etc.) that must never be silently overwritten.

### Conflicts (curated text and JSON): merge / replace / skip

A unified diff is shown (`@@ … @@` format, with line numbers and terminal highlighting) and
three options:

- **(m) merge** — the default.
  - **any `.json`** (your addition, `settings.json`, `setting-templates/*.json`) — deep
    additive merge, as described above. For `settings.json`, the source of "what we need" is
    `settings.partial.json` from the archive itself (not a second, separately-written list
    inside `setup.mjs` — that used to be the case, and it's exactly what caused drift: a hook
    added to `settings.partial.json` never made it into the actual `settings.json`, even though
    the `.mjs` file itself was copied correctly). Stale/duplicate entries for OUR hooks (by
    filename, not by event — a hook moving from `SessionStart` to `PreToolUse` is picked up
    too) are removed, current ones are added — re-running is idempotent.
  - curated `.md`/text — can't be merged automatically, and the diff shown above IS the merge
    output. Nothing is written — not to the file, not alongside it (no `<name>.new`): your file
    stays byte-for-byte as it was; apply the diff by hand, or re-run with `--replace-all`.
- **(r) replace** — the archive's version is written over your file. **No backup is made** —
  the diff shown above is the only record of what was there; recover via git/your own copy if
  you need it (for `.json` under merge — the merge result; under replace — the archive file
  as-is).
- **(s) skip** — the file is left untouched (for curated text, this is the same outcome as the
  default merge above: the file stays as-is).

If the file is new — it's simply **copied**. If an existing `.json` already contains
everything from the archive (a superset) — `unchanged`, nothing is written. Non-curated text
that differs from the archive — `updated`, no prompt.

**Important if you already have manual edits in non-curated `.md` files** (e.g. your own
`rules/node.react.md`): starting with this version they will be silently overwritten with the
archive's version on the next `setup.mjs` run (the same behavior `.mjs` has always had). If you
have such edits and need to keep them — either move them into the archive (this repo) before
running, or put the `<!-- CURATED:NOEDIT -->` marker as the first line of the file itself to
get the merge/replace/skip dialog instead of a silent overwrite. Run `--dry-run` first if
you're not sure exactly what will update.

At the end of the run — **`--- summary ---`** (a full file list tagged created/updated/
unchanged/merged/replaced/skipped) and **`--- by category ---`** (a per-folder digest: `hooks:
N updated, M unchanged`, `rules: ...`, etc.) — so you don't have to guess whether rules and
hooks updated by scanning a long path list.

### Diff readability

- In a terminal, the diff is colored (green "+", red "−", cyan `@@` headers) and has line
  numbers.
- `--no-color` or the `NO_COLOR` variable — turn off color.
- `--md` — print the diff as a markdown ```diff block (handy to redirect into a file/PR — it
  gets colorized there automatically).

### Repo layout: `payload/` vs root

The repo is split into two zones:

- **`payload/`** — everything that actually gets installed into `~/.claude` (`hooks/`,
  `skills/`, `rules/`, `commands/`, `setting-templates/`, `bin/`, `add-risk.mjs`,
  `graphify-sync-all.mjs`, `CLAUDE.md`). The installer **mirrors the whole `payload/` tree**
  into `~/.claude`, preserving structure relative to `payload/` (i.e. `payload/hooks/foo.mjs`
  → `~/.claude/hooks/foo.mjs`).
- **Repo root** — the installer's own meta, never copied: `setup.mjs`,
  `bootstrap.sh`/`bootstrap.ps1`, `README.md`, `settings.partial.json`,
  `RISK_REGISTER.snippet.md`, this repo's own `RISK_REGISTER.md` (not to be confused with the
  installed `~/.claude/state/...`), `docs/` (design specs/plans, outside distribution).

You can just drop your own files/folders into `payload/` — they'll be copied with structure
preserved (`payload/commands/`, `payload/agents/`, extra `payload/skills/`, any of your own
files). Same rules apply: none exists → created; an existing `.mjs` → silently overwritten with
the bundle's version; any other existing file → diff + choice. Under POSIX, +x is set on every
copied `.mjs`.

The `settings.json` file at the archive root (`~/.claude/settings.json`) isn't copied as a
plain file — it's managed by a separate additive merge based on `settings.partial.json` (see
below). Hidden files (`.git`, `.DS_Store`, etc.) inside `payload/` are also never copied.

### Flags (non-interactive / for CI)

```
node setup.mjs --merge-all     # all conflicts -> merge
node setup.mjs --replace-all   # all conflicts -> replace (no backup)
node setup.mjs --skip-all      # all conflicts -> skip
node setup.mjs --dry-run       # show what would be done, without writing
node setup.mjs --md            # diffs as markdown ```diff
node setup.mjs --doctor        # check registered hook paths
```

If run **not in a terminal** and with no flag, the default action for existing non-scripts is
**merge**: `.json` is genuinely merged, curated `.md`/text is left as-is (nothing is written,
the diff is already shown). `.mjs` are always updated. To skip/replace instead — the
`--skip-all` / `--replace-all` flags.

---

## Protection model: the marker, not the path

Authority "travels" with the marker. Any `CLAUDE.md` that CONTAINS a
`<!-- CURATED:NOEDIT -->` line (not necessarily the first one — a heading, frontmatter, etc.
may come before it; whitespace around the line and around `<!--`/`-->` doesn't matter) is
considered curated: protected from edits by the agent and is the source of truth — whether at
the root or in `.planning/`. Unmarked files (e.g. GSD-generated ones) are edited freely. There
is no binding to a specific path — and no binding to the line's position in the file either.
Just naming the marker in prose (like this sentence) doesn't count — only the whole line
itself matches.

---

## Project auto-init (SessionStart)

The `session-init.mjs` hook fires at the start of EVERY session (state lives in
`~/.claude/state/project-init.json`, but most steps below are NOT one-time — see why). It
**deterministically fixes files** (doesn't rely on context injection — that can be dropped on
fresh sessions sometimes):

- **auto-marks** an unmarked root `CLAUDE.md` as curated — unless it looks GSD-generated.
  **Re-checked every session, idempotently** (used to be one-time on a project's first session
  — that turned out to be a bug: if the root `CLAUDE.md` didn't exist yet on the first session
  and appeared later, e.g. from `graphify claude install`, it stayed unmarked forever, because
  the one-time flag was already spent). Toggle: `CLAUDE_CURATED_AUTOMARK_ROOT=0`.
- **adds a per-project `claudeMdExcludes`** for an unmarked (GSD-owned) `.planning/CLAUDE.md`
  in that project's `.claude/settings.json` (this exclude is not set globally: a union-exclude
  can't be undone at the project level, and it would hide your curated
  `.planning/CLAUDE.md`). **Re-checked every session**, for the same reason as the item above.
- **appends the GSD risk** to an existing `RISK_REGISTER.md` (via `add-risk.mjs`: understands
  either table or section format, picks the next free ID, idempotently).
- **suggests `/init-mcp`** (a hint only — runs nothing): if the repo has a GitHub/GitLab remote
  or shows signs of DB usage (`postgres`/`DATABASE_URL`/`prisma`/`typeorm`/`psycopg`/
  `sqlalchemy` in configs) and the matching MCP isn't wired yet — appends a suggestion to
  `additionalContext` to wire it via `/init-mcp` (which also offers a self-hosted SearXNG
  option for web search). **Re-checked every session** (git/DB can appear later, so this isn't
  one-time) and stops on its own once the matching MCP is wired. Web search isn't detected
  passively (on-demand) — mentioned as an option. Toggle: `CLAUDE_MCP_SUGGEST=0`.
- **fixes `claude_md_assembly.mode: "link"` when the root doesn't import it** — under this
  mode, gsd-core writes generated project context + the profile (`/gsd-profile-user`) into a
  separate `.claude/CLAUDE.md`, but doesn't itself guarantee that the root `CLAUDE.md` actually
  `@`-imports it. In practice this produced an 18KB generated file that was never loaded into
  any session at all. **Re-checked every session** (not one-time — `.claude/CLAUDE.md` can
  appear after the first session, e.g. from `/gsd-profile-user`), stops on its own once the
  import is present. Skips when: the root file is missing, already imports
  `.claude/CLAUDE.md`, or itself looks GSD-generated. Toggle: `CLAUDE_GSD_LINK_IMPORT=0`.

Toggles (environment variables the hook reads):

```
CLAUDE_CURATED_AUTOMARK_ROOT=0   # don't auto-mark the root (show a hint instead)
CLAUDE_CURATED_AUTOINIT=0        # disable auto-init entirely
CLAUDE_MCP_SUGGEST=0             # don't suggest /init-mcp on a git/DB signal
CLAUDE_GSD_LINK_IMPORT=0         # don't fix a missing @.claude/CLAUDE.md import
```

Reset a specific project's state (to re-run it) — delete its entry from
`~/.claude/state/project-init.json`.

---

## What each hook does and why

- **deny-curated-claude-md.mjs** (PreToolUse: `Edit|Write|MultiEdit`). Blocks edits to any
  `CLAUDE.md` that contains the marker line — **no hardcoded path** for `~/.claude/CLAUDE.md`
  inside the hook (there used to be one; removed so there's only one source of truth). Your
  global file's protection rests on `setup.mjs` guaranteeing it the marker on every run (see
  "Project auto-init" — the same principle now applies to a project's root `CLAUDE.md` too).
  Why a hook, not a rule: `CLAUDE.md` loads as context, and a project one overrides the user's
  — prose can't hold an invariant, but a hook fires before the write and can't be talked
  around by a prompt.
- **secrets-gate.mjs** (PreToolUse: `Bash`). On `git commit`, scans `git diff --cached`: AWS
  keys, private keys, Slack/GitHub tokens, creds in connection strings, explicit secret
  assignments (env references are filtered out, for fewer false positives). If `gitleaks` is
  installed, it's used additionally. The baseline regex always works, no dependencies.
- **db-live-access-gate.mjs** (PreToolUse: `Bash|^mcp__.*`). Live connected DBs are read-only
  by default: any query outside SELECT/WITH/SHOW/DESCRIBE/EXPLAIN is blocked (exit 2); a
  recognized read-only query still requires manual confirmation via "ask", even in a
  bypass-permissions session. Used to be mistakenly registered under `SessionStart` (never
  fired there, since that event isn't tied to a tool call) — fixed, now lives under
  `PreToolUse` with the other gates.
- **graphify-global-sync.mjs** (PostToolUse: `Bash`) + **hooks/lib/graphify-global-sync-run.mjs**
  (shared worker). After a `git commit` made by Claude via the Bash tool, in the background
  (detached, doesn't block the session), refreshes this project's entry in the cross-project
  `~/.graphify/global-graph.json` (`graphify extract . --global --as <name>`). No-op if
  `graphify` isn't installed, if it's not a `git commit`, or if the commit didn't succeed. A
  PID/mtime lock at `~/.claude/state/graphify-sync-<name>.lock` keeps concurrent triggers from
  spawning parallel extractions; the lock is considered stale after 10 minutes.
  **Limitation:** Claude Code hooks only see tool calls Claude itself makes — a manual
  `git commit`/`--amend` from a terminal or IDE is invisible to this hook in principle. That's
  what the native git hook below closes. Disable both: `CLAUDE_GRAPHIFY_AUTOSYNC=0`.
- **session-init.mjs** (SessionStart). Project bootstrap (see above — most steps are now
  every-session, idempotent) +
  an **independent** (not tied to the shared `firstTime`, so it also fires on projects
  initialized in the past) one-time step: registers the project in graphify's global graph AND
  installs a native `<repo>/.git/hooks/post-commit` that calls the same
  `graphify-global-sync-run.mjs` — git itself invokes this hook, on ANY commit (manual, from an
  IDE, `--amend`), independent of Claude Code. If a `post-commit` already exists (husky,
  pre-commit, graphify's own local hook) — it's appended to, not overwritten. Same toggle:
  `CLAUDE_GRAPHIFY_AUTOSYNC=0`.
- **token-usage-log.mjs** (`SubagentStop` + `Stop`) + **hooks/lib/token-usage-shared.mjs**,
  **hooks/lib/token-usage-prune.mjs**, **hooks/lib/token-usage-pricing-refresh.mjs**. After
  every sub-agent completion and after every main-agent turn, appends a line (JSONL) with
  task/agent/model/tokens/date/cost estimate to **both** logs —
  `<project>/.claude/token-usage.jsonl` (kept forever, never pruned) and
  `~/.claude/state/token-usage.jsonl` (cross-project, with retention — a union of: no older
  than 3 calendar months from the last entry / the last-but-one day of activity / a minimum of
  10 entries). Sub-agent logging originally relied on a second `PostToolUse:Agent` call with
  `status:"completed"` — a 2026-07-10 investigation found that event never arrives (every Agent
  call, backgrounded or not, reports `"async_launched"` and `PostToolUse:Agent` never fires
  again for it), so no `kind:"subagent"` record was ever written. Replaced with `SubagentStop`:
  data comes from `agent_transcript_path` (a transcript file dedicated to that one sub-agent)
  via a saved byte cursor keyed **per agent_id** (not per session — the same agent can
  `SubagentStop` more than once if resumed via `SendMessage`); for the main turn — from
  `transcript_path` via a saved byte cursor keyed per session (a known caveat: the transcript
  can lag slightly on write, so in rare cases the turn's last API call is only counted on the
  next `Stop`). The `cost_usd` estimate is best-effort, from the
  `~/.claude/state/model-pricing.json` pricing table, which refreshes itself once a day by
  scraping the public pricing page (there's no official pricing API — see
  `RISK-TOKENLOG-001`). To view aggregates — the `/token-usage` skill (`--global` for the
  cross-project log, `--week`/`--month`/`--all` for the period; defaults to the current project
  over the last 24h). Toggles: `CLAUDE_TOKEN_USAGE_LOG=0` (disable entirely),
  `CLAUDE_TOKEN_USAGE_COST=0` (no cost estimate and no background price refresh),
  `CLAUDE_TOKEN_USAGE_PRUNE=0` (don't prune the global log).
- **leanmode-subagent.mjs** (`SubagentStart`, the first hook in this repo on this event — until
  now only SessionStart/PreToolUse/PostToolUse/Stop were used) + **hooks/lib/leanmode-rules.mjs**.
  A first-party replacement for the third-party `ponytail` plugin: before a subagent starts,
  keyed on its `agent_type`, injects a YAGNI ("write minimal code") text into its context — but
  not evenly: `DEFAULT_LEANMODE_MAP` assigns `off/lite/full` per `agent_type` individually (11 of
  ~40 non-`off`; everything else is deliberately `off` — agents that don't write code at all,
  like `gsd-planner`/`gsd-security-auditor`, never get this injection). On top of that: per-project
  overrides (`.claude/leanmode.json`) and a project-wide dial (`off/lite/full/ultra`, set via the
  `/leanmode` command) that **shifts** the map rather than replacing it — `off` is pinned and
  never moves either direction under the shift (full design rationale and map:
  `docs/superpowers/specs/2026-07-10-leanmode-design.md`, outside the distribution). The dial
  defaults to `full` once `/init-stack` has run at least once for a project (the `initStackRun`
  flag in `~/.claude/state/project-init.json`, set by **hooks/lib/mark-initstack-done.mjs**,
  called as `/init-stack`'s last step — not a registered hook on its own); otherwise `off`.
  Toggle: `CLAUDE_LEANMODE=0`.

All hooks are Node-based and registered in **exec form** (`command: "node"`, `args: [abs.
path]`): no shell, so they work on Windows without Git Bash too, with no `$HOME` or
line-ending issues.

---

## Required tools and fallback

The installer checks and suggests the install command for your OS:

- **node** — required; guaranteed by Claude Code itself. Hooks need nothing else to run.
- **git** — needed by `secrets-gate.mjs`. If missing: `secrets-gate` becomes a no-op (a commit
  won't run without git anyway), everything else works. Install: `apt/dnf` ·
  `winget`/`choco`/`scoop` · `brew`.
- **gitleaks** — optional. Without it, the built-in regex still works. Install:
  `winget`/`choco` · release binary · `brew`.

---

## PowerShell tool on Windows (optional, manual — not via setup.mjs)

Claude Code can work through a PowerShell tool instead of/alongside Bash on Windows
(`CLAUDE_CODE_USE_POWERSHELL_TOOL=1` in `env`, optionally `"defaultShell": "powershell"` — also
switches interactive `!` commands). Officially documented on docs.claude.com, but this is a
**preview feature, still "rolling out progressively"**, and it has significant limitations:

- **auto-mode isn't supported** — every PowerShell command requires manual confirmation, even
  in an auto-approve/bypass-permissions session. This is the main reason the key is **not**
  baked into `setup.mjs`/`settings.partial.json`: if it were, any already-configured
  auto-approved Windows session would silently start asking for confirmation on every command
  after a plain `node setup.mjs`.
- `$PROFILE` (aliases/functions) isn't picked up.
- no sandboxing, which the Bash tool has access to via WSL2.
- execution policy can block scripts.
- the pipeline returns objects, not text — awk/sed-style result parsing doesn't work.

This doesn't affect the package's hooks at all — they're all Node in exec form
(`command: "node"`), they need no shell. It only affects commands Claude itself runs in a
session (git, npm, etc.).

If you want to try it (yourself, manually, aware of the auto-mode limitation) — add to your
`~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_USE_POWERSHELL_TOOL": "1" } }
```

and, if you also want to switch interactive `!` commands: `"defaultShell": "powershell"` at
the top level. Details: [PowerShell tool](https://code.claude.com/docs/en/tools-reference#powershell-tool).

---

## Post-install check

- `/hooks` — the list should show two PreToolUse entries and one SessionStart.
- Ask Claude to edit your marked `CLAUDE.md` → should be denied.
- In a repo with an unmarked `.planning/CLAUDE.md` and a `RISK_REGISTER.md`, the first session
  should add the per-project exclude and a risk line.
- Stage a file with an obviously hardcoded key (a line like `api_key = "<16 hex chars>"`) and
  ask Claude to `git commit` → denied; a clean change goes through.

---

## Codebase knowledge graph (graphify) + a shared graph across all projects

[graphify](https://github.com/safishamsi/graphify) builds a queryable knowledge graph over
code/docs. The PyPI package is **`graphifyy`** (double `y`), the CLI is `graphify`.

### Install / check (+ extra components, + uv auto-setup)

A cross-platform installer (ASCII output - doesn't crash under cp1251). **If `uv` is missing -
it first tries any already-installed `pipx`/`pip` (without installing anything), and only asks
for your consent** (`[y/N]`) before installing `uv` itself: Windows - `winget` (id
`astral-sh.uv`) -> `scoop`/`choco` -> the official PowerShell installer; macOS - `brew`/`curl`;
Linux - `curl`/`wget` -> `pipx`/`pip`. On a decline with no alternatives it asks once more, on a
second decline it skips the install. `--yes` - auto-consent (for CI). After installing, it
**verifies the tool is actually callable** (a common issue - PATH): if `uv` got installed but
isn't yet on the current session's PATH - open a new terminal.

```
node ~/.claude/bin/graphify-setup.mjs             # uv (if needed) + graphifyy[pdf,office,sql,mcp] + the /graphify skill
node ~/.claude/bin/graphify-setup.mjs --all       # ALL tools: uv tool install "graphifyy[all]"
node ~/.claude/bin/graphify-setup.mjs --extras=pdf,office,sql,postgres,mcp
node ~/.claude/bin/graphify-setup.mjs --doctor    # python, uv, winget/scoop/choco/brew/curl, graphify, global graph
node ~/.claude/bin/graphify-setup.mjs --bootstrap-uv   # just install uv
node ~/.claude/bin/graphify-setup.mjs --no-bootstrap   # don't install uv, use pipx/pip if present
node ~/.claude/bin/graphify-setup.mjs --dry-run   # show the commands, run nothing
```

`--doctor` shows upfront what's available (e.g.: `uv: on PATH`, `winget: available`,
`curl/wget: curl`), to see whether bootstrapping is needed. Useful extras: `pdf, office, sql,
postgres, terraform, mcp, video, all` (Delphi `.pas/.dpr` and SQL are supported out of the box).

### The whole codebase at once, not project by project

Uses graphify's **global graph** - a single cross-project file where every repo's graph gets
registered:

```
node ~/.claude/bin/graphify-setup.mjs --build-global /path/repoA /path/repoB /path/repoC
```

Under the hood, per repository: `graphify extract <repo> --global --as <name>`. Management -
`graphify global list | remove <name> | path`.

### Where the result is stored and how it's available in any project

- **File:** `~/.graphify/global-graph.json` (cross-project, outside any specific repo).
- **Query from ANY project** (even a new one), without wiring up individually:
```
  graphify query "where is auth validated?" --graph ~/.graphify/global-graph.json
  graphify path "UserService" "DatabasePool" --graph ~/.graphify/global-graph.json
```
- **Claude knows about this in every project:** the curated `~/.claude/CLAUDE.md` has a
  "CODEBASE KNOWLEDGE GRAPH" section added, which tells it to query the global graph first for
  architecture/cross-repo questions instead of grepping files. User memory loads in any
  project.
- **(Optional) a user-level MCP** - structured access (`query_graph`, `get_node`,
  `shortest_path`, ...) across all Claude Code projects:
```
  node ~/.claude/bin/graphify-setup.mjs --mcp
```
  Registers a user-scope `graphify-global` MCP server on top of `~/.graphify/global-graph.json`
  (needs the `claude` CLI; if `uv` is present, it runs through an isolated environment).

You can still graph a project locally as before (`/graphify .` - result in `graphify-out/`):
for "just this repo" questions its own graph is more convenient, for cross-repo questions - the
global one.

### Auto-registering a new project + auto-refresh on commit

`global-graph.json` used to be filled in entirely by hand (`--build-global` /
`graphify-sync-all.mjs`). Now it happens on its own, if `graphify` is installed (toggle for
both steps — `CLAUDE_GRAPHIFY_AUTOSYNC=0`):

- **New project** — on Claude's first session in the project, `session-init.mjs` queues a
  one-time background `graphify extract . --global --as <name>`, adding the project to the
  shared graph. Part of the one-time bootstrap, like `CLAUDE.md` auto-marking.
- **Accumulated knowledge is visible right away, not just on query** — at that same one-time
  moment, BEFORE queuing its own registration, `session-init.mjs` synchronously (cheap: a local
  JSON read, no LLM call) calls `graphify global list` and drops a preview of the already
  accumulated repos into the session's `additionalContext`. The point: a new project should
  learn, on its very first session, that work/patterns already exist elsewhere that can be
  reused via `graphify query ... --graph ~/.graphify/global-graph.json`, rather than relying
  solely on Claude remembering to read the CODEBASE KNOWLEDGE GRAPH section in CLAUDE.md.
  Best-effort (see the warning in the file header about `additionalContext`), so this
  supplements, not replaces, the static instruction in CLAUDE.md.
- **Every commit** — via two paths, both calling the same
  `hooks/lib/graphify-global-sync-run.mjs`:
  1. `hooks/graphify-global-sync.mjs` (PostToolUse on `Bash`) — catches commits Claude makes
     via the Bash tool. Needs no per-project install, works from the first session.
  2. A native `<repo>/.git/hooks/post-commit`, which `session-init.mjs` installs once per
     project — git itself invokes it on ANY commit: manual, from an IDE, `--amend`. This is the
     only path that sees commits not made by Claude.
  Both are detached, don't block the session/commit; a per-project lock file keeps concurrent
  triggers from spawning parallel extractions.

The manual path (`--build-global`, `node graphify-sync-all.mjs --install-hooks`) still exists —
useful for a one-off bulk import of existing repos or a forced full re-sync.
`graphify-sync-all.mjs` — Node-based (cross-platform, Windows/Linux/macOS): walks projects
under `--root` (defaults to the current folder) up to `--max-depth`, registers each one in the
shared graph, with `--install-hooks` it installs the per-repo hook. Doesn't install anything
itself — if `graphify` isn't on PATH, it prints how to get it and exits.

### `graphify claude install` — the official "always consult the graph" hook mechanism

Separately from the global registration, `session-init.mjs` once (its own independent flag
`graphifyClaudeInstalled`, same pattern as `graphifySynced`) calls `graphify claude install`
for the CURRENT project — this is graphify's official mechanism: a section in the project's
`CLAUDE.md` + a PreToolUse hook that itself nudges Claude toward `graphify query` before a
grep/Read scan of files, instead of relying on Claude remembering to read the prose in
CLAUDE.md.

**An important security nuance:** `graphify claude install` writes into the project's
`CLAUDE.md` via a plain CLI process — bypassing Claude's Edit/Write tools, and therefore
bypassing `deny-curated-claude-md.mjs` (which only matches on the tools themselves). So this
step:

- runs STRICTLY before the root `CLAUDE.md` auto-mark step (see above) — on a new project's
  first session the file isn't curated yet, graphify gets one chance to append its section,
  AFTER which auto-marking immediately locks the file in as curated;
- on a retrofit of an older project (auto-marking already ran in the past) — before calling it,
  `CURATED:NOEDIT` is always checked; if the file is already curated, the step is skipped and
  leaves a note in `additionalContext` recommending you run the command by hand and review the
  diff yourself.

Optionally disable just this step (global-graph registration keeps working):
`CLAUDE_GRAPHIFY_CLAUDE_INSTALL=0`.

### Auto-updating CLI tools (context-mode, graphify)

`session-init.mjs`, every session (24h throttle per tool, its own state file
`~/.claude/state/tool-upgrade.json`, machine-wide — not tied to a project), checks and, in the
background (detached, doesn't block the session), updates known CLIs if they're installed:

- **context-mode** — `context-mode upgrade` (its own subcommand: pulls the latest from GitHub,
  rebuilds, reinstalls hooks). Used to require remembering `/ctx-upgrade` by hand whenever
  `ctx doctor` showed "outdated".
- **graphify** — `uv tool upgrade graphifyy` (graphify has no built-in update command; this is
  the path from its own README). Only runs if `uv` is on PATH.

Toggles: `CLAUDE_TOOL_AUTOUPGRADE=0` (all of it), `CLAUDE_TOOL_AUTOUPGRADE_<NAME>=0`
(per-tool, dashes → underscores, e.g. `CLAUDE_TOOL_AUTOUPGRADE_CONTEXT_MODE=0`). Accepted risk:
an update might still be writing in the background while the same session's first tool calls
already use the tool — the same trade-off already accepted for the background `graphify
extract` above.

The tool list (`KNOWN_TOOLS` in `session-init.mjs`) is extensible: add a new
`{ name, cmd, upgradeArgs }` entry (or `upgradeCmd`, if the update runs through a different
binary, like graphify does via `uv`) for any future CLI plugin with a similar model.

---

## Other / limitations

- Hooks only fire inside Claude Code sessions. Your manual commits and edits in a terminal
  aren't affected — that's by design.
- `permissions.deny` for `~/.claude/CLAUDE.md` — a secondary, dependency-free layer; the main
  protection is the Node hook (which also catches the marker at any location).
- Rules in `secrets-gate.mjs` can be tuned to your stack — they constrain Claude's commits.
- `settings.partial.json` isn't just a reference file: `setup.mjs` reads it directly as the
  single source of truth for hooks/permissions in `settings.json` (substituting `<HOME>` with
  the real home directory). Edit hooks only here — you don't need to, and shouldn't, touch the
  generated merge inside `setup.mjs` by hand. Also fine for manual insertion if you'd rather
  not rely on the installer. `RISK_REGISTER.snippet.md` is purely a reference, for manual
  insertion.

---

## Diagnostics: `PreToolUse hook error` / `cannot find module` on every Edit

Symptom: on any file edit, a spam of
`PreToolUse:Edit hook error` + `node:internal/modules/cjs/loader:...`.

Cause: Node can't find the hook file **at the path recorded in `~/.claude/settings.json`** —
the path is stale (left over from an earlier version, including a `.sh` variant) or points at
a different `~`. The hook itself is fine; the problem is the `settings.json` entry.

Check which path is broken:

```
node setup.mjs --doctor
```

Shows `OK` / `MISSING` / `BROKEN` for each registered hook.

Fix it:

```
node setup.mjs
```

The installer now **removes any entries referencing its own hooks itself** (broken paths, old
`.sh`, the wrong home) and writes fresh, correct ones. Your own unrelated hooks aren't touched.
Then — **restart Claude Code**. Run `setup.mjs` as the same user Claude Code runs as
(otherwise `~` diverges again).

To stop the spam instantly before restarting: temporarily set `"disableAllHooks": true` in
`~/.claude/settings.json` (or remove the broken entry from `hooks.PreToolUse` by hand).

---

## Cyrillic console: character errors (checkmark/dash) and where RISK_REGISTER lives

**Symptom:** on running something (e.g. `/init-stack`), a crash over a non-ASCII character
(the checkmark `✓`, an em dash, etc.) in a terminal with a Cyrillic OEM code page (cp866) or
cp1251.

**Cause:** the console in that encoding can't encode such a character on output — the write to
stdout throws, and the step aborts (which, among other things, could leave `RISK_REGISTER.md`
un-updated).

**What's already been done here:** every script in the package (`setup.mjs`, hooks,
`add-risk.mjs`) outputs **ASCII only** — they don't hit this class of error.

**If your own script/command crashes** (e.g. `/init-stack` prints `✓`):
- simplest — strip the non-ASCII from the output (write `[ok]`/`OK` instead of `✓`, a plain
  hyphen `-` instead of `—`);
- or switch the console to UTF-8 before running:
  - PowerShell: `chcp 65001` or `[Console]::OutputEncoding=[Text.Encoding]::UTF8`;
  - Python tools: the `PYTHONIOENCODING=utf-8` variable;
  - Node outputs UTF-8 on its own — ASCII output or a UTF-8 console is enough.

**Where RISK_REGISTER.md is looked for:** at the project root, at the `.planning/` root, and in
its subfolders (e.g. `.planning/codebase/`). Selection rules:
- if several are found — the **shallowest** one (closest to the root) is used;
- if there are several at that minimal depth — **each one** is updated, each with its own next
  ID.

`add-risk.mjs`:
- a path to a **file** — update exactly that one; a path to a **folder** —
  `<folder>/RISK_REGISTER.md`;
- **no argument** — find and update the register(s) per the rules above (search base is the
  current folder, `--root <dir>` can be given); `--no-create` — create nothing if none exist.

Auto-init (`session-init.mjs`) uses the same logic (with `--no-create`, i.e. only existing
files). The risk-register step runs **every session** and is idempotent — if the register
appeared or moved after the project's first init, the entry gets added on the next startup
automatically. (Root `CLAUDE.md` auto-marking and the per-project exclude are also every
session and idempotent now, see "Project auto-init" above; they used to be one-time — that
turned out to be a timing bug, when the file appeared after the first session.)

Update a specific register directly:

```
node ~/.claude/add-risk.mjs .planning/codebase/RISK_REGISTER.md
```

Find and update per the rules (from the project root):

```
node ~/.claude/add-risk.mjs
```

The risk register updates itself on every startup — you don't need to delete state for that.
Root `CLAUDE.md` auto-marking and the per-project exclude also don't remember anything in
state either — it's a plain check of the file's current content on every session, so you don't
need to delete state for those either. The entry in `~/.claude/state/project-init.json` is
only needed for truly one-time steps (`graphify claude install`, global-graph registration,
the model_profile patch) — delete it if you need to re-run exactly those.
