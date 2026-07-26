## INVARIANTS (hook / managed-policy enforced; never relaxed by any project file)
- No secrets, tokens, or connection strings in commits. (PreToolUse: secrets-gate.mjs)
- No Write/Edit to a human-curated `CLAUDE.md` — `~/.claude/CLAUDE.md` and any file carrying
  the `CURATED:NOEDIT` marker, in any location (root or `.planning/`). Unmarked generated
  files stay editable. (PreToolUse: deny-curated-claude-md.mjs)
- These live in `settings.json` hooks, not here. If a hook is missing, say so — do not
  pretend this prose enforces it.
