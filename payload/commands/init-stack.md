---
description: Detect stack, run the interactive plugin selector in your terminal, then settings merge on apply
argument-hint: "[--apply-all]"
allowed-tools: Bash(python3 *), Bash(claude *), Bash(pnpm *), Read, Edit
---

Set up stack-specific Claude Code plugins for THIS project. Never run installs, marketplace
changes, or removals without my explicit OK. In the interactive flow (step 2) my on-screen
confirmation IS that OK - the tool installs exactly the plugins I check, nothing else.

## 1. Detect + classify (you run this)
Run: `python3 ~/.claude/bin/init-stack.py`
Parse the `STATUS_JSON` block (`stacks`, `plugins[]` with `state`, `present[]` already-enabled) and
show me the human report (state per plugin, and which are already enabled).

## 2. Interactive install + activate (I run this myself, in my terminal) - the main path
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

## 3. Non-interactive fallback (if I can't use a TTY)
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

## 4. Finish
After settings are written, remind me: `enabledPlugins` resolves at STARTUP - I must RESTART Claude
Code (or `/reload-plugins` if available). Do NOT claim plugins are active in the current session.

## 5. GSD test/build command proposal (only if `.planning/config.json` exists)
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

## 6. `fallow` devDependency proposal (only if `.planning/config.json` exists AND a Node stack
## was detected in step 1 - i.e. `stacks` contains any of `react`/`next`/`react-native`/
## `nest`/`turbo`/`nx`/`telegram-node`, or plain `package.json` exists at repo root)
My personal default config (`~/.claude/hooks/gsd-config-patch.mjs`) sets
`code_quality.fallow.enabled: true` whenever a project has a root `package.json`, on the
assumption that `fallow` (an external structural-analysis binary - detects unused exports,
unused files, circular dependencies, and duplicate code blocks) gets installed as a
devDependency here. gsd-core's own code review workflow FAILS OUTRIGHT (not a graceful skip)
if `code_quality.fallow.enabled` is `true` but the binary can't be resolved - so this step
closes that gap at project-setup time rather than leaving it to surface as a review-time error.

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

Ask via `AskUserQuestion` before running anything (mirrors this file's own rule for step 2 -
my on-screen confirmation IS the OK to install):
```text
AskUserQuestion([{
  question: "Install `fallow` as a devDependency so code_quality.fallow (already enabled in your default GSD config) actually works here?",
  header: "fallow",
  options: [
    { label: "Yes - install", description: "<pnpm add -D fallow -w | pnpm add -D fallow, based on monorepo detection above>" },
    { label: "No - leave fallow.enabled unset for this project", description: "Sets code_quality.fallow.enabled: false in .planning/config.json via Edit, overriding my personal default for this repo only, so review doesn't hard-fail here." }
  ]
}])
```
On accept: run the install command, then confirm it landed in the right `package.json`
(root, not a nested workspace package) by checking `devDependencies.fallow` there.
On decline: `Edit` `.planning/config.json` to set `code_quality.fallow.enabled: false`
explicitly (don't leave it to silently inherit `true` from the personal default and fail
later) - preserve every other key under `code_quality` and elsewhere.

## 7. Mark leanmode dial default (always, no gate)
Run `node ~/.claude/hooks/lib/mark-initstack-done.mjs` (no output expected, always safe to
re-run). This lets leanmode's project dial default to `full` for this project from now on,
instead of staying `off` until someone explicitly runs `/leanmode` — see
`docs/superpowers/specs/2026-07-10-leanmode-design.md` for why the dial is gated on
`/init-stack` having run at all.
