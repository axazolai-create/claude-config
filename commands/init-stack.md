---
description: Detect stack, run the interactive plugin selector in your terminal, then settings merge on apply
argument-hint: "[--apply-all]"
allowed-tools: Bash(python3 *), Bash(claude *), Read
---

Set up stack-specific Claude Code plugins for THIS project. Never run installs, marketplace
changes, or removals without my explicit OK.

## 1. Detect + classify (you run this)
Run: `python3 ~/.claude/bin/init-stack.py`
Parse the `STATUS_JSON` block (`stacks`, `plugins[]` with `state`, `present[]` already-enabled) and
show me the human report (state per plugin, and which are already enabled).

## 2. Install pending plugins first (only the ones I ask for, one at a time)
The interactive selector enables/disables plugins that are already `installed`. If I want a plugin
that is not installed yet, help me install it FIRST, by state (always wait for my OK):
- **available** -> run `install.cmd`.
- **marketplace_missing** -> run `marketplace_add.cmd` then `install.cmd`; if `marketplace_add`
  still contains `<...>`, STOP and ask me for the real source.
- **unavailable** -> show `refresh`, then retry or fix the id in the template.
- **placeholder / no_template** -> tell me to fill `~/.claude/setting-templates/<stack>.json`; skip.
Re-check after each: `python3 ~/.claude/bin/init-stack.py --status <plugin-id>` until `installed`.

## 3. Interactive selection (I run this myself, in my terminal)
An arrow-key UI cannot be driven through you, so tell me to run it directly:

    python3 ~/.claude/bin/init-stack.py -i

It prints the plugins with an `[enabled]` mark, then offers:
- a menu (up/down + enter): **Choose what to ENABLE** or **REMOVE enabled plugins, then choose what to enable**;
- a checklist (up/down move, space toggle, enter confirm, q cancel) where **checked = active**;
- on confirm it writes `./.claude/settings.json` and prints exactly what changed.

If I say I can't use an interactive terminal, offer to apply it for me instead (confirm the id
list with me first):
`python3 ~/.claude/bin/init-stack.py --enable <ready ids...> --remove <to_remove ids...>`
(or `python3 ~/.claude/bin/init-stack.py --apply-all` to enable every installed/declared plugin).

## 4. Finish
After settings are written, remind me: `enabledPlugins` resolves at STARTUP - I must RESTART Claude
Code (or `/reload-plugins` if available). Do NOT claim plugins are active in the current session.
