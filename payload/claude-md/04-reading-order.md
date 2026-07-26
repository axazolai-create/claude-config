---
profiles: [base, lite]
---
## READING ORDER (every session, before acting)
- Open the project-level `CLAUDE.md` (if present) before acting. Do not act from memory alone.
- Language/framework rules are compiled per project into `.claude/stack-rules.md` from
  `~/.claude/rules-src/` (checked at session start; see `rules-src/README.md`). They are
  NOT auto-loaded by file type anymore.
- If `.claude/settings.json` is missing the stack plugins for this repo, tell the user to
  run `/init-stack` and restart — do NOT enable plugins yourself (see PLUGINS & SKILLS).
