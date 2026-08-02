## READING ORDER (every session, before acting)
- If `.planning/` exists, this is a GSD project — the project's stack-rules snapshot
  includes `rules-src/gsd.md` (methodology routing + CLAUDE.md quarantine rules).
- Language/framework rules are compiled per project into `.claude/stack-rules.md` from
  `~/.claude/rules-src/` (checked at session start; see `rules-src/README.md`). They are
  NOT auto-loaded by file type anymore.
- If `.claude/settings.json` is missing the stack plugins for this repo, tell the user to
  run `/init-stack` and restart — do NOT enable plugins yourself (see PLUGINS & SKILLS).
