---
description: Detect stack, run the interactive plugin selector in your terminal, then settings merge on apply
argument-hint: "[--apply-all]"
allowed-tools: Bash(python3 *), Bash(claude *), Read
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
