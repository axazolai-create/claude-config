@stack-rules.md

## NEVER edit a deployed file. Edit the source, then deploy.

This repository IS the installer. Everything under `~/.claude/` is its **output**, never its
source. This rule outranks convenience, urgency and "just to test it".

- **Never** `Write` or `Edit` any path under `~/.claude/`. Not to try something, not to fix
  it quickly, not once.
- Change the source — `payload/`, `payload/setting-templates/`, `variants.json`, `setup.mjs`
  — then run `node setup.mjs` and let the installer carry it. A change that cannot reach a
  machine through the installer is not finished.
- `~/.claude/CLAUDE.md` is assembled from `payload/claude-md/*.md`. Edit the fragment. The
  `CURATED:NOEDIT` marker and the PreToolUse hook that denies edits to it are this rule
  enforcing itself — a denial there means you are editing the wrong file.
- On rollout the installer offers to replace a conflicting `CLAUDE.md`: answer `r`, or pass
  `--replace-all` with no TTY. That is the normal path, not a workaround.
- A live edit reaches no other machine and the next deploy erases it.

Machine-side state that no bundle file produces (an MCP server someone added by hand, a
plugin enabled outside `variants.json`) is the one exception, and it is not an excuse: say
plainly that the change is machine-local and nothing in the project carries it.

## Risk register location

This tree's risk register is `.ultrapowers/RISK_REGISTER.md`, and `add-risk.mjs` is pointed
there. The user-scope `~/.claude/CLAUDE.md` names `.planning/` or the project root; project
scope outranks user scope on conflict.
