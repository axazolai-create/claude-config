## PLUGINS & SKILLS (loading policy)
- Base plugins (ultrapowers, context-mode) are enabled at USER scope and load every session.
  Do not duplicate them in project settings.
- Context7 is an MCP SERVER here, not a plugin. Never enable the marketplace plugin of that name.
- GSD-Core is installed with npx and detected on disk. Never enable the marketplace plugin
  named `gsd`.
- Stack-specific plugins are enabled PER PROJECT via `.claude/settings.json` -> enabledPlugins.
- Project plugin sets live under `~/.claude/setting-templates/`, nested by direction (e.g.
  `frontend/react.json`, `bots/node.json` - see that folder's README for the full layout) and
  are applied with `/init-stack` (detects stack, checks install status, merges settings).
- enabledPlugins is resolved at STARTUP and does NOT hot-reload. Never edit settings.json
  mid-session to "enable" a plugin and claim it is active — it is not until restart.
  If stack plugins are missing, surface it: tell the user to run `/init-stack`, then restart.
- Keep an `enabledPlugins` key in `.claude/settings.json` even if `{}` — otherwise entries
  in settings.local.json are silently dropped on merge.
