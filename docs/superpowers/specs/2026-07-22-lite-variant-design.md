# Lite variant of the claude-config bundle — design

**Date:** 2026-07-22 · **Status:** DESIGN APPROVED (all sections presented and approved in-session;
questionnaire over every include bundle completed; awaiting final spec review → writing-plans).

---

## 1. Goal

One unified `setup.mjs` that, on start, asks which bundle **variant** to install: **full**
(current bundle, unchanged) or **lite**. If the selected variant differs from the detected
installed one, the installer removes the surplus bundle-owned files (instructions / skills /
hooks) so the result looks like a fresh install of the selected variant on a clean Claude Code —
**never touching foreign files** (user's `settings.local.json`, `projects/`, `memory/`, files
installed by other tools such as graphify's own `skills/graphify/`).

Motivation: `docs/review.md` (2026-07-22 stack assessment) — lite implements its
recommendation #1 ("match the tool to the task size"): a light profile for single-session tasks.
Also adopts recommendation #4: lite `CLAUDE.md` is cut per the Tier A/B plan from
`.claude/_analize/` (graphify-CLI / model-selection → lazy skills; INVARIANTS/SUDO/PRECEDENCE kept).

## 2. Locked decisions (user-confirmed; includes 2026-07-22 questionnaire results)

### 2.1 Lite plugin set (managed by setup.mjs)
- **superpowers** — in
- **context7** — in (`context7@claude-plugins-official`)
- **context-mode** — in
- **graphify** — in, **without the neo4j overlay** (not a Claude plugin; managed by
  `bin/graphify-setup.mjs`; its `skills/graphify/` is foreign, never pruned)
- **gsd** — OUT (with its whole support layer)
- **leanmode** — in (works without GSD, nudges any subagents)

Plugin management: **setup.mjs manages plugins itself**: edits `enabledPlugins` in user
`settings.json` AND runs `claude plugin install`/`uninstall` with confirmation; fallback printed
instructions when the `claude` CLI is unavailable. Only the plugins named in
`variants.json → managedPlugins` are ever touched — never user-added ones.

### 2.2 Component questionnaire — final verdicts

Per-bundle questionnaire completed 2026-07-22 (every include entry reviewed with the user).
**Three verdicts changed vs the original draft** — marked ⚠.

| Bundle | Components | Lite? |
|---|---|---|
| CLAUDE.md (lite text from overlay) | payload-lite/CLAUDE.md | **IN** |
| secrets-gate | hooks/secrets-gate.mjs (PreToolUse:Bash) | **IN** |
| deny-curated-claude-md | hook + permissions.deny Edit(~/.claude/CLAUDE.md) | **IN** |
| db-live-access-gate | hooks/db-live-access-gate.mjs | OUT |
| bg-supervision | bg-supervision-nudge.mjs(+test) + bin/supervise-bg.mjs + bin/lib/supervise-lib.mjs(+test) | **OUT** ⚠ |
| task-lifecycle-probe | hooks/task-lifecycle-probe.mjs(+test) | **OUT** ⚠ |
| init-mcp | commands/init-mcp.md + session-init reminder | **OUT** ⚠ |
| ci-watch-nudge | hooks/ci-watch-nudge.mjs(+test) | OUT |
| schedulewakeup-loop-only-nudge | hooks/schedulewakeup-loop-only-nudge.mjs(+test) | OUT |
| pnpm-phantom-fix | hook + bin scan/install + libs + command + turbopack-gvs-* | OUT |
| token-usage | token-usage-log.mjs hook (Stop/SubagentStop) + skills/token-usage + lib prune/pricing/shared | **IN** |
| update-changelog | skills/update-changelog + 10 scripts | **IN** (stays a lazy skill) |
| stack system | **PARTIAL**: only stack detection + rules-src → `.claude/stack-rules.md` compilation, via a lightweight lazy `/init-stack` (same command name, overlay). No plugin machinery, no python UI, no setting-templates/, no stack-markers skill (markers table inlined into lite /init-stack). Keeps hooks/lib/stack-rules-check.mjs + hooks/lib/mark-initstack-done.mjs. | **PARTIAL** |
| model-selection-policy | skill, content adapted (no GSD agents); one pointer line in lite CLAUDE.md | **IN** |
| risk register | add-risk.mjs + RISK_REGISTER rule in COLLABORATION CONTRACT; session-init's GSD-clobber write is full-only | **IN** |
| graphify core | bin/graphify-setup.mjs, graphify-sync-all.mjs, bin/graphify-freshness*(+test), hooks/graphify-global-sync.mjs + lib | **IN** |
| leanmode | hooks/leanmode-subagent.mjs, hooks/lib/leanmode-*, commands/leanmode.md, agents/leanmode-executor.md | **IN** |
| config-dir infra | bin/lib/config-dir-validate.mjs(+tests), bin/lib/entrypoint-guard.test.mjs | **IN** |
| session-init | hooks/session-init.mjs (variant-aware, § 5) + hooks/lib/config-update-check-run.mjs | **IN** |
| rules-src | rules-src/** except gsd.md; cleaned README via overlay | **IN** |
| using-git-worktrees no-op shadow skill | skills/using-git-worktrees | OUT |

**Cascade of the ⚠ exclusions:** lite CLAUDE.md drops the bg-elapsed-time rule (both its
carriers — supervise-bg and the probe — are out); lite session-init disables the /init-mcp
suggestion; the only hooks registered in lite are: secrets-gate, deny-curated,
graphify-global-sync, leanmode-subagent, token-usage-log, session-init.

Auto-OUT (GSD-specific): `agents/gsd-*`, `apply-gsd-agent-patches.mjs`, `gsd-defaults-sync.mjs`
(+ hook lib twin), `hooks/gsd-config-patch.mjs`, `hooks/gsd-context-meter.mjs` (+ statusLine
registration), `hooks/lib/gsd-*`, `hooks/lib/context-mode-gsd-agents.mjs`,
`hooks/worktree-executor-discipline-advisor.mjs`, `commands/init-session.md`,
`references/**`, `rules-src/gsd.md`, neo4j files, `bin/init-stack.py` + `bin/test_init_stack.py`
+ `bin/__pycache__/**`, `setting-templates/**`.

### 2.3 Resolved open questions (2026-07-22)
- **Bootstrap:** no code changes. `bootstrap.sh`/`bootstrap.ps1` already forward flags
  (positional / `CLAUDE_SETUP_ARGS='--variant=lite'`); document in README only.
- **Forbidden-token list** for the rules-src guard: confirmed, see § 8 test 3.
- **RISK_REGISTER step in lite session-init:** gated off entirely (its only action is the
  GSD-clobber entry, which has no trigger in lite). `add-risk.mjs` stays as a manual CLI tool
  and the RISK_REGISTER rule stays in lite CLAUDE.md.

## 3. `variants.json` — schema and resolution rules (APPROVED)

**File:** repo root (installer meta, like `settings.partial.json`; never mirrored into `~/.claude`).

```json
{
  "$comment": "Variant definitions for setup.mjs. Globs are relative to payload/.",
  "managedPlugins": {
    "superpowers":  "superpowers@claude-plugins-official",
    "gsd":          "gsd@<marketplace-id, verified at implementation from `claude plugin list`>",
    "context-mode": "context-mode@<marketplace-id, verified at implementation>",
    "context7":     "context7@claude-plugins-official"
  },
  "variants": {
    "full": {
      "plugins": ["superpowers", "gsd", "context-mode", "context7"]
    },
    "lite": {
      "plugins": ["superpowers", "context-mode", "context7"],
      "overlay": "payload-lite",
      "include": [
        "CLAUDE.md",
        "add-risk.mjs",
        "graphify-sync-all.mjs",
        "agents/leanmode-executor.md",
        "bin/graphify-freshness*",
        "bin/graphify-setup.mjs",
        "bin/lib/config-dir-validate*",
        "bin/lib/entrypoint-guard.test.mjs",
        "commands/init-stack.md",
        "commands/leanmode.md",
        "hooks/secrets-gate.mjs",
        "hooks/deny-curated-claude-md.mjs",
        "hooks/token-usage-log.mjs",
        "hooks/session-init.mjs",
        "hooks/graphify-global-sync.mjs",
        "hooks/leanmode-subagent.mjs",
        "hooks/lib/config-update-check-run.mjs",
        "hooks/lib/graphify-global-sync-run.mjs",
        "hooks/lib/leanmode-*",
        "hooks/lib/mark-initstack-done.mjs",
        "hooks/lib/stack-rules-check.mjs",
        "hooks/lib/token-usage-*",
        "rules-src/**",
        "skills/model-selection-policy/**",
        "skills/token-usage/**",
        "skills/update-changelog/**"
      ],
      "exclude": [
        "agents/gsd-*.md",
        "apply-gsd-agent-patches.mjs",
        "gsd-defaults-sync.mjs",
        "graphify-neo4j.cypher",
        "bin/init-stack.py", "bin/test_init_stack.py", "bin/__pycache__/**",
        "bin/graphify-neo4j-*", "bin/lib/neo4j-config*",
        "bin/lib/pnpm-*", "bin/lib/turbopack-gvs-*",
        "bin/pnpm-phantom-*", "bin/turbopack-gvs-check.mjs",
        "bin/supervise-bg.mjs", "bin/lib/supervise-lib*",
        "commands/init-mcp.md", "commands/init-session.md", "commands/pnpm-phantom-fix.md",
        "hooks/db-live-access-gate.mjs", "hooks/ci-watch-nudge*",
        "hooks/schedulewakeup-loop-only-nudge*",
        "hooks/bg-supervision-nudge*", "hooks/task-lifecycle-probe*",
        "hooks/gsd-*", "hooks/lib/gsd-*",
        "hooks/lib/context-mode-gsd-agents.mjs",
        "hooks/pnpm-phantom-fix-hook*",
        "hooks/worktree-executor-discipline-advisor.mjs",
        "references/**",
        "rules-src/gsd.md",
        "skills/stack-markers/**", "skills/using-git-worktrees/**",
        "setting-templates/**"
      ]
    }
  }
}
```

**Resolution rules (enforced by the classification test, § 8):**

1. `full` = the whole `payload/` as-is (identity; no globs) + the full plugin list. No overlay.
2. For `lite`, every file in `payload/` must match `include ∪ exclude`. A file matching
   neither → test fails ("new payload file not classified"). Overlap is allowed:
   **exclude wins over include** (this is how `rules-src/**` in include coexists with
   `rules-src/gsd.md` in exclude); the test fails only on uncovered files.
3. **Source resolution order** when installing lite: `payload-lite/<rel>` if it exists,
   else `payload/<rel>`. The overlay only overrides content, never extends the set: every
   overlay file must correspond to a `rel` inside the lite set (orphan overlay file → test fails).
4. Expected `payload-lite/` contents: `CLAUDE.md` (lite text, § 6), `commands/init-stack.md`
   (lite command, § 7), `rules-src/README.md` (cleaned). Everything else is shared from `payload/`.
5. `managedPlugins` is the only set of plugins setup.mjs may touch; user plugins outside this
   dict are invisible to reconciliation.
6. Hook registrations are NOT hand-maintained per variant: at install, entries from
   `settings.partial.json` whose hook script files are not in the selected variant's file set
   are dropped automatically (extend the existing `mentionsOurs` strip-and-readd filter,
   setup.mjs ~line 692). Same for `statusLine` (gsd-context-meter): registered only in full;
   removed on full→lite switch if it points at our file.
7. Variant state: `bundle-manifest.json` gets a `variant` field. Missing field ⇒ `full`
   (pre-variant bundles were full). Switch = install new set + prune (old manifest ∖ new set).

## 4. Plugin reconciliation flow (APPROVED)

Runs after file copy and settings merge, before the final summary. Operates only on
`managedPlugins` (4 names); everything else is invisible.

1. **Target state**: `variants[selected].plugins` → required; `managedPlugins ∖ required` →
   surplus (for lite: `{gsd}`).
2. **Actual state**: `enabledPlugins` from user `settings.json` + `claude plugin list --json`
   (when the CLI is available; otherwise settings only).
3. **Action plan** (shown before execution as one list):
   - required but not installed → `claude plugin install <id>`;
   - required but missing from `enabledPlugins` → add the key to `settings.json`;
   - surplus and installed → `claude plugin uninstall <id>` + remove from `enabledPlugins`.
4. **Confirmation**: one aggregate "run N actions? [y/n/show]" prompt interactively; each
   uninstall action is additionally named (removal is the irreversible part). `--dry-run` →
   plan printed only. Non-interactive without a variant switch → plan printed as instructions,
   nothing executed.
5. **CLI unavailable** (`claude` not in PATH): `enabledPlugins` is still edited (plain JSON);
   install/uninstall are printed as ready-to-run commands.
6. **Guarantees**: user plugins / `enabledPlugins` keys outside `managedPlugins` are never read
   or written; an empty `enabledPlugins {}` is preserved; final summary reminds "restart Claude
   Code — enabledPlugins does not hot-reload".

Marketplace ids for gsd/context-mode are verified at implementation from the actual
installation (`claude plugin list`) — never guessed.

## 5. Variant-aware `session-init.mjs` (APPROVED)

One file in `payload/` (no overlay copy — a fork would drift). Full-variant behavior stays
byte-identical to today.

```js
// top of session-init.mjs
const VARIANT = safe(() =>
  JSON.parse(readFileSync(join(CDIR, "state", "bundle-manifest.json"), "utf8")).variant
) ?? "full";   // manifest without the field = pre-variant bundle = full
const FULL = VARIANT === "full";
```

GSD lib imports become dynamic, gated on `FULL` (in lite those files are deleted; a static
import would crash the hook every session):

```js
if (FULL) {
  try {
    const { syncGsdAgentsContextMode } = await import("./lib/context-mode-gsd-agents.mjs");
    syncGsdAgentsContextMode(...);
  } catch { /* half-install: skip the step, never block the session */ }
}
```

Imports that live in both variants (`leanmode-rules.mjs`, `config-update-check-run.mjs`,
`stack-rules-check.mjs`) stay static.

| Step | full | lite |
|---|---|---|
| Auto-mark root CLAUDE.md as curated | ✔ | ✔ |
| graphify claude install + global-graph autosync | ✔ | ✔ |
| stack-rules freshness check (stale → suggest `/init-stack`) | ✔ | ✔ |
| config-update-check (bundle stale → suggest setup.mjs) | ✔ | ✔ |
| leanmode context for SubagentStart | ✔ | ✔ |
| GSD agents ↔ context-mode sync, gsd-agent/workflow patches, gsd-defaults | ✔ | — |
| `.planning/CLAUDE.md` exclude (GSD-owned) | ✔ | — |
| RISK_REGISTER: GSD-clobber entry | ✔ | — (gated whole: its only action is the GSD entry) |
| `/init-mcp` suggestion | ✔ | — (command absent in lite) |

Drift protection: the import-graph test (§ 8 test 4) asserts no static import in the lite file
set resolves to an excluded file — catches session-init and any future lib.

## 6. Lite `CLAUDE.md` — full text (APPROVED; `payload-lite/CLAUDE.md`)

~55 lines (full is 111). Dropped relative to full: READING ORDER as a section (folded into
PRECEDENCE — its GSD routing and plugin checks are out of lite), the GSD section, RULES
RESOLUTION & STACK MARKERS (replaced by the short STACK RULES note), db-gate /
init-stack.py / setting-templates mentions, the bg-elapsed-time rule, `/init-mcp`.

```markdown
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
```

## 7. Lite `/init-stack` — command text (APPROVED; `payload-lite/commands/init-stack.md`)

Replaces the full version under the same command name. No python, no plugins, no
setting-templates. The markers table is an inline snapshot from the `stack-markers` skill
(excluded from lite); the exact row set is verified against that skill at implementation.

````markdown
# /init-stack — compile per-project stack rules (lite)

Detect this project's stack from marker files, then assemble
`.claude/stack-rules.md` from `~/.claude/rules-src/`. No plugin management in the
lite bundle — this command only builds the rules snapshot.

## 1. Detect the stack

Match marker files against this table (rows are additive — a project can be
Node+Docker+monorepo at once):

| Marker | Stack rule files (rules-src/) |
|---|---|
| `package.json` | node.base.md |
| `next.config.*` | + node.next.md |
| `vite.config.*` / react deps | + node.react.md |
| `nest-cli.json` | + node.nest.md |
| grammY/telegraf deps | + node.telegram.md |
| `react-native.config.*` / expo | + node.react-native.md |
| `pyproject.toml` / `requirements.txt` | python.base.md |
| `manage.py` | + python.django.md |
| fastapi dep | + python.fastapi.md |
| flask dep | + python.flask.md |
| aiogram/python-telegram-bot dep | + python.telegram.md |
| pandas/numpy/jupyter deps | + python.data.md |
| click/typer dep (no web) | + python.cli.md |
| `*.csproj` | csharp.base.md |
| ASP.NET SDK in csproj | + csharp.aspnet.md |
| WPF `UseWPF` | + csharp.wpf.md |
| console template | + csharp.cli.md |
| `build.gradle.kts` + android plugin | kotlin.base.md + kotlin.android.md |
| intellij-plugin gradle plugin | kotlin.base.md + kotlin.intellij-plugin.md |
| `pubspec.yaml` | dart.base.md (+ dart.flutter.md if flutter dep) |
| `Package.swift` / `*.xcodeproj` | swift.base.md (+ swift.ios.md if iOS target) |
| `Dockerfile` / `docker-compose.yml` | + docker.md |
| `pnpm-workspace.yaml` / turbo/nx | + monorepo.md |
| `.github/workflows/` | + ci.md |
| OpenAPI/proto specs | + api-contracts.md |
| shell scripts as primary artifact | + shell.md |
| SQL migrations dir | + sql.md |
| Android/iOS presence | + mobile.md |

Always include: `testing.md`, `security.md` (cross-cutting).

## 2. Assemble the snapshot

Follow `~/.claude/rules-src/README.md` § "Building stack-rules": concatenate the
selected files (base → direction → cross-cutting), deduplicate overlapping sections,
write to `.claude/stack-rules.md` with the source-hash header that
`hooks/lib/stack-rules-check.mjs` verifies at session start.

## 3. Wire the project

Ensure the project `.claude/CLAUDE.md` contains `@stack-rules.md` (create if
missing). Run `node ~/.claude/hooks/lib/mark-initstack-done.mjs` to record
completion. Restart is NOT needed — stack-rules.md is plain context, not a plugin.
````

`mark-initstack-done.mjs` stays so the session-init reminder goes quiet. The rules-src guard
(§ 8 test 3) guarantees the README referenced in step 2 mentions no excluded components in lite.

## 8. Test plan (APPROVED)

All tests: `node --test`, matching existing `*.test.mjs` style. New files at repo root next to
`setup.mjs`: `variants.test.mjs` (static repo checks), `setup-variants.e2e.test.mjs`
(e2e via a temporary `CLAUDE_CONFIG_DIR`).

**Static (fast, every run):**

1. **Classification**: every `payload/` file matches lite's `include ∪ exclude`; an uncovered
   file fails with its name ("new payload file not classified"). Overlap allowed, exclude wins.
2. **Overlay orphans**: every `payload-lite/` file must correspond to a `rel` inside the lite
   set; an orphan overlay file fails.
3. **rules-src purity guard**: the resolved lite rules-src set (overlay over payload) is grepped
   for forbidden tokens: `gsd`, `init-stack.py`, `setting-templates`, `neo4j`, `pnpm-phantom`,
   `db-live-access`, `ci-watch`, `schedulewakeup`, `stack-markers`,
   `worktree-executor-discipline`, `bg-supervision`, `supervise-bg`, `task-lifecycle-probe`,
   `init-mcp`.
4. **Import graph**: no static `import` of any `.mjs` in the lite set resolves to an excluded
   file (catches session-init regressions and any future lib).
5. **Hook registrations**: for each hook entry in `settings.partial.json`, compute which variant
   its script belongs to; assert lite filtering leaves exactly 6 hooks (secrets-gate,
   deny-curated, graphify-global-sync, leanmode-subagent, token-usage-log, session-init) and
   no `statusLine`.

**E2E (isolated `CLAUDE_CONFIG_DIR=<tmp>`):**

6. `node setup.mjs --variant=lite --replace-all` → exact file tree equals the expected lite set
   (snapshot list, updated consciously); `settings.json` has only lite hooks, no `statusLine`;
   `bundle-manifest.json.variant === "lite"`.
7. **Switching both ways**: lite→full delivers all full files; full→lite removes exactly the
   surplus (manifest ∖ lite set) and nothing else.
8. **Foreign files untouched**: plant `settings.local.json`, `projects/x`, `memory/x`,
   `skills/graphify/x` into the tmp config → byte-identical after both switches.
9. **Manifest without `variant`** (pre-variant bundle simulation) → treated as full: installing
   full on top prunes nothing extra.
10. `--dry-run` for both variants: tmp tree snapshot before/after identical (zero writes),
    plan printed.

**Unit:**

11. **Plugin reconciliation**: the action-plan builder (target × actual → install/uninstall/
    enable list) is a pure function tested without the CLI; cases: CLI absent (fallback
    instructions), surplus gsd, unknown user `enabledPlugins` keys untouched, empty `{}` kept.
12. **Existing tests** `payload/**/*.test.mjs` pass unchanged (full runs the whole set; the
    lite set contains only tests of included files, guaranteed by test 1).

## 9. setup.mjs UX

- Start: detect installed variant from manifest → interactive question (existing
  `ask`/`choose` readline infra) "variant: full/lite", default = detected (or full on fresh).
- Non-interactive: `--variant=full|lite` flag; non-TTY without flag → detected variant, or
  full on fresh install (backward compatible with existing bootstrap pipelines).
- On switch: show what will be removed (counts + notable paths), confirm, prune, then plugin
  reconciliation (§ 4) with confirmation; `--dry-run` shows everything without writing.
- All other existing behavior (curated/managed tiers, conflict prompts, doctor) unchanged.
- Bootstrap scripts: unchanged; variant passed as a forwarded flag
  (`CLAUDE_SETUP_ARGS='--variant=lite'` or positional) — README documents this.

## 10. Key codebase findings (verified 2026-07-22)

1. `setup.mjs` (962 lines) already has the needed machinery: bundle manifest at
   `~/.claude/state/bundle-manifest.json` + `pruneStale()`; additive settings merge that first
   strips hook entries referencing our files (`mentionsOurs`, ~line 692) then re-adds from
   `settings.partial.json` — the natural attach point for variant filtering. Flags parse via
   `argv = new Set(process.argv.slice(2))` (~line 67); `ask`/`choose` readline infra ~line 201.
2. `session-init.mjs` statically imports gsd libs — § 5 fixes this with gated dynamic imports.
3. `stack-rules.md` is assembled by Claude during `/init-stack` per `rules-src/README.md`
   (init-stack.py never wrote it; python is plugin machinery only) — so lite needs no python.
4. Only `rules-src/gsd.md` and `rules-src/README.md` contain forbidden tokens today ⇒ the
   overlay needs just the cleaned README; `gsd.md` is excluded outright.
5. `bootstrap.ps1`/`bootstrap.sh` already forward arbitrary flags to setup.mjs.
6. graphify is NOT a Claude plugin — installed via `bin/graphify-setup.mjs`; its
   `skills/graphify/` is foreign (never pruned).
7. Root meta files (`setup.mjs`, `README*.md`, `settings.partial.json`, `bootstrap.*`,
   `RISK_REGISTER*.md`, `gsd-defaults.partial.json`, `variants.json`) are never mirrored into
   `~/.claude`.

## 11. Risks (log to RISK_REGISTER.md with stable IDs during implementation)

- Variant switch deleting a file the user edited in place under `~/.claude` (mitigated by the
  existing hash-gate in pruneStale — verify it covers the switch path; add a test if not).
- Marketplace ids in `managedPlugins` drifting from the real marketplace — verified at
  implementation, reconciliation shows the plan before acting.

## 12. Next steps

1. ~~Design presentation + approval per section~~ — DONE (all sections approved; PLUGINS &
   SKILLS wording fix applied).
2. Spec self-review → user reviews this spec → invoke superpowers:writing-plans for the
   implementation plan.
3. README.md / README.en.md: document variants (selection, switching, what lite contains,
   bootstrap flag forwarding).
4. Lint/tests before commits; Conventional Commits; this repo's own conventions.
