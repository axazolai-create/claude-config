---
description: Detect stack, run the interactive plugin selector in your terminal, then settings merge on apply
argument-hint: "[--apply-all]"
allowed-tools: Bash(python3 *), Bash(claude *), Bash(pnpm *), Bash(node *), Read, Write, Edit
---

Set up stack-specific Claude Code plugins for THIS project. Never run installs, marketplace
changes, or removals without my explicit OK. In the interactive flow (step 3) my on-screen
confirmation IS that OK - the tool installs exactly the plugins I check, nothing else.

## 1. Detect + classify (you run this)
Run: `python3 ~/.claude/bin/init-stack.py`
Parse the `STATUS_JSON` block (`stacks`, `plugins[]` with `state`, `present[]` already-enabled) and
show me the human report (state per plugin, and which are already enabled).

## 2. Stack-rules snapshot (build if missing)
`.claude/stack-rules.md` is the compiled per-project rules snapshot (language/framework rules,
no longer auto-loaded from `~/.claude/rules-src/` - see that folder's README). It has no
automatic staleness check anymore (`session-init.mjs` only flags it as missing), so building it
is now this command's job.

Check:
```bash
node -e "process.exit(require('fs').existsSync('.claude/stack-rules.md') ? 0 : 1)" && echo "stack-rules.md already exists - skip this step"
```

If it already exists, skip the rest of this step - it stays as-is until an explicit rebuild (no
drift detection; re-run `/init-stack`, or ask me for a rebuild, any time the rules should be
regenerated after a `rules-src/` or stack change).

If missing: dispatch a subagent (general-purpose) to build it, following
`~/.claude/rules-src/README.md` § "Building stack-rules" exactly - reuse step 1's `stacks` list
instead of re-detecting. For the frontmatter hash values, run
`node ~/.claude/hooks/lib/stack-rules-check.mjs` (prints `sourceHash`/`stackFingerprint` for
this project) and pass them to the subagent, or let it run that command itself.

## 3. Interactive install + activate (I run this myself, in my terminal) - the main path
An arrow-key UI cannot be driven through you, so tell me to run it directly:

    python3 ~/.claude/bin/init-stack.py -i

It shows two lists - the detected stack's plugins (each marked `[installed]` or `[needs install]`)
and every OTHER known plugin (opt-in, each with a one-line description) - then a single checklist
(up/down move, space toggle, enter confirm, q cancel) where **checked = active**. Pre-checked =
what's already enabled plus the stack's auto-enable set. On confirm it:
- runs `claude plugin install` (and `marketplace add` when needed) for every checked plugin that
  isn't installed yet;
- writes `./.claude/settings.json` enabling the checked plugins and disabling any I unchecked;
- prints exactly what installed / enabled / removed, and lists anything that failed to install.

`placeholder` / `no_template` plugins can't be installed - fill the matching template under
`~/.claude/setting-templates/` first (see `STACK_PATHS` in `bin/init-stack.py`, or that folder's
README, for the exact path).

After the plugin step, `-i` also lists the stack's declared **skills** (npx Agent Skills) and
offers to `npx skills add` the missing ones. Skills are opt-in (none pre-checked), have no
enable/disable, and their slugs drift - if an install fails, verify the current slug and retry.

## 4. Non-interactive fallback (if I can't use a TTY)
`-i` needs a real terminal. If I can't run it, this path does ACTIVATION ONLY (it does not
install): confirm the id list with me first, then
`python3 ~/.claude/bin/init-stack.py --enable <installed ids...> --remove <to_remove ids...>`
(or `--apply-all` to enable every declared non-placeholder plugin). For any not-installed plugin,
install it by hand first, by state (always wait for my OK):
- **available** -> `install.cmd`.
- **marketplace_missing** -> `marketplace_add.cmd` then `install.cmd`; if `marketplace_add` still
  contains `<...>`, STOP and ask me for the real source.
- **unavailable** -> `refresh`, then retry or fix the id in the template.
Re-check after each: `python3 ~/.claude/bin/init-stack.py --status <plugin-id>` until `installed`.

## 5. Finish
After settings are written, remind me: `enabledPlugins` resolves at STARTUP - I must RESTART Claude
Code (or `/reload-plugins` if available). Do NOT claim plugins are active in the current session.

## 6. GSD test/build command proposal (only if `.planning/config.json` exists)
gsd-core already auto-detects `workflow.test_command`/`workflow.build_command` from Makefile/
package.json/Cargo.toml/go.mod/pyproject.toml when they're unset, so only propose an explicit
value when the stack detected in step 1 gives a MORE SPECIFIC command than that generic guess
(e.g. `pnpm test` over a bare `npm test` guess, or a stack with no auto-detect signal at all
like a Gradle/Kotlin project).

Map the `stacks` list from step 1's `STATUS_JSON` using this table (a stack not listed here is
intentionally skipped - too ambiguous to guess safely):

| Stack(s) detected | `test_command` | `build_command` |
|---|---|---|
| `react`, `next`, `react-native`, `nest`, `turbo`, `nx`, `telegram-node` | `pnpm test` | `pnpm build` |
| `django`, `fastapi`, `flask`, `telegram-python` | `uv run pytest` | (no convention - skip) |
| `android`, `kotlin` | `./gradlew test` | `./gradlew build` |
| `dart` | `flutter test` | (needs a target flag - skip) |
| `swift`, `sql` | (skip both - no safe convention) | |

If stacks from more than one row are detected at once (e.g. both a `django` and a `react` stack
in the same repo - a full-stack monorepo), skip this step entirely: which command is "the" gate
is ambiguous here, so leave `test_command`/`build_command` unset for a manual `/gsd-settings`
decision later.

Otherwise, for each of `test_command`/`build_command` that has a candidate above AND is
currently unset in `.planning/config.json` (or the active workstream's config, same
`GSD_CONFIG_PATH` resolution `gsd-core/workflows/settings-advanced.md` uses): ask via
`AskUserQuestion` - one question per key, not bundled - whether to set it, showing the exact
candidate value. On accept, read the config file and set-or-create the `workflow.<key>` value
with `Edit`, preserving every other key (this is a plain JSON merge, not a full-file rewrite -
never drop sibling keys under `workflow` or elsewhere). On decline, write nothing; gsd-core's
own auto-detect remains the effective behavior.

## 7. `claude_orchestration` capability consideration (only if `.planning/config.json` exists)
Gate is `.planning/config.json` exists — nothing else. No monorepo/stack check: the capability
is about how `/gsd-execute-phase` dispatches a wave's plans, not about the repo's shape.

Re-entrant, like step 3/`init-mcp`: re-run this step on every `/init-stack` invocation and let
me change a previous choice, don't skip it just because a value is already set.

**Check the live state first, always:**
```bash
node ~/.claude/gsd-core/bin/gsd-tools.cjs claude-orchestration detect-backend --runtime claude --raw
```
Report the `reason` field to me honestly regardless of outcome — including a plain "the
`claude-orchestration` subcommand isn't available in this gsd-core install" if the command
itself doesn't exist. Read `~/.claude/references/gsd-claude-orchestration-pilot.md` for the full
reasoning behind the recommendation below before presenting it.

**Then check `.planning/config.json`:**
- `claude_orchestration.enabled` unset or `false` — offer via `AskUserQuestion` (header
  "claude_orchestration"): enable it for a pilot? Explain briefly (from the reference doc):
  it's a BETA capability that fails closed to today's inline dispatch on any gate miss, so
  enabling it is safe even if the `reason` above shows it won't currently activate. Options:
  **Enable for a pilot** (sets `enabled: true`, and — since this is a deliberate pilot, not a
  silent `auto` — also sets `execution_backend: "workflow"` so a gate miss surfaces loudly in
  the `reason` field on the next check instead of quietly falling back) / **Not now** (write
  nothing — the default is already the safe, inert state).
- `claude_orchestration.enabled` already set (`true` or `false`) — show the current value and
  the live `reason`, then offer to **switch** (toggle `enabled`, same `execution_backend`
  handling as above) or **keep as is**.

On accept: `Edit` `.planning/config.json`, preserving every other key under the
`claude_orchestration` object and elsewhere (plain JSON merge, not a full-file rewrite). On
decline or "keep as is": write nothing.

## 8. `fallow` devDependency proposal (GSD + Node only)
Only if `.planning/config.json` exists AND step 1 detected a Node stack (`stacks` contains
any of `react`/`next`/`react-native`/`nest`/`turbo`/`nx`/`telegram-node`, or a plain
`package.json` exists at repo root).

`gsd-config-patch.mjs` defaults `code_quality.fallow.enabled: true` for any project with a
root `package.json`, and gsd-core's code review FAILS OUTRIGHT (not a graceful skip) when
that flag is true but the `fallow` binary (external structural-analysis tool) can't be
resolved. This step closes that gap at setup time instead of at review time.

**Check first** whether it's already installed - skip this step entirely if either is true:
```bash
node -e "process.exit(require('fs').existsSync('node_modules/.bin/fallow') || require('fs').existsSync('node_modules/.bin/fallow.cmd') ? 0 : 1)" && echo "fallow already installed"
```
(or grep `"fallow"` in root `package.json` `devDependencies`).

**Monorepo placement matters.** gsd-core resolves the `fallow` binary relative to the CURRENT
WORKING DIRECTORY when `/gsd-code-review`/`/gsd-ship` runs - which is the repo root where
`.planning/` lives, not any individual workspace package. So:
- If `stacks` includes `turbo` or `nx`, or `pnpm-workspace.yaml` exists at root: this is a
  monorepo - install at the WORKSPACE ROOT, not inside a package:
  `pnpm add -D fallow -w`
- Otherwise (plain single-package Node repo): `pnpm add -D fallow`

Ask via `AskUserQuestion` before running anything (my on-screen confirmation IS the OK to
install; header "fallow"): install `fallow` as a devDependency so `code_quality.fallow`
(already enabled by the personal GSD default) works here? Options: **Yes - install** (the
pnpm command chosen above) / **No** (explicitly set `code_quality.fallow.enabled: false`
for this repo so review doesn't hard-fail).
On accept: run the install command, then confirm it landed in the right `package.json`
(root, not a nested workspace package) by checking `devDependencies.fallow` there.
On decline: `Edit` `.planning/config.json` to set `code_quality.fallow.enabled: false`
explicitly (don't leave it to silently inherit `true` from the personal default and fail
later) - preserve every other key under `code_quality` and elsewhere.

## 9. Mark leanmode dial default (always, no gate)
Run `node ~/.claude/hooks/lib/mark-initstack-done.mjs` (silent, idempotent). Lets leanmode's
project dial default to `full` for this project instead of staying `off` (rationale:
`docs/superpowers/specs/2026-07-10-leanmode-design.md`).

## 10. Apply pending gsd-* agent patches (machine-wide, not project-specific)
`~/.claude/agents/gsd-*.md` are owned by the separate `gsd-core` tool, not this bundle -
patching them is best-effort cross-tool maintenance. `session-init.mjs` checks read-only every
session and flags when something here is pending (context-mode routing guidance,
gsd-executor.md/gsd-debugger.md hardening fixes); this step is what actually writes, folded
into `/init-stack` so it happens on an explicit invocation you already control instead of
requiring a separate command. (`/init-session` still exists standalone for applying patches
without running the rest of this flow, e.g. right after a gsd-core update mid-milestone.)
This step is unrelated to step 7 above — it patches `~/.claude/agents/gsd-*.md` prose
(machine-wide), not this project's `.planning/config.json`.

Run:
```bash
node ~/.claude/apply-gsd-agent-patches.mjs
```

Show me exactly what it printed: which `file:patchId` pairs were applied, which were skipped
as curated (`CURATED:NOEDIT`, left untouched on purpose), and which were skipped for a missing
anchor (target file changed upstream since the patch was written - flag those to me
explicitly, don't silently treat them as done).

If anything was skipped for a missing anchor, read the affected file and tell me what changed
near the patch's expected anchor text (`~/.claude/hooks/lib/gsd-agent-patches.mjs` documents
each patch's target string). Don't guess a new anchor and re-apply automatically - that's a
judgment call on whether the patch still makes sense against the new content, which needs my
review.

## 11. Sync personal GSD defaults + statusline override (machine-wide + this project)
`gsd-defaults.partial.json` is this bundle's curated personal GSD config (model routing,
workflow toggles) plus the statusline context-meter override. `setup.mjs` already applies
both once per install; this step catches drift for the entry point you actually run per
project without necessarily re-running the full installer - same rationale as step 10.

Run:
```bash
node ~/.claude/gsd-defaults-sync.mjs
```

Show me exactly what it printed: whether `~/.gsd/defaults.json` changed (deep-additive -
your own values always win), whether this project's `.planning/config.json` changed
(reference wins on overlapping keys, skipped entirely if there's no `.planning/` here), and
whether the statusLine registration changed (it only takes over from an unset value or from
gsd-core's own default `gsd-statusline.js` - if it reports a custom value was left
untouched, that's expected and not an error).
