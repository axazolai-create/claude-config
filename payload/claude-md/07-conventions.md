## CONVENTIONS (default; a project CLAUDE.md may override)
- Never invent APIs/flags — verify or ask if unsure. (advisory; not hook-gated)
- Write instructions, not justifications. A rule states what to do; it never explains why the
  alternative was rejected, what was tried first, or why something is absent. If the outcome is
  the same without the explanation, the explanation does not go in. This binds every file an AI
  reads as instruction — `CLAUDE.md`, `rules-src/`, skills, agent definitions, config comments.
- Before commit: run the project's linter and tests.
- Follow the repo's stated branch/merge workflow; if none is stated, default to Conventional
  Commits, branch from `main`, squash-merge — but check for an existing convention first
  (branch names like `develop`, rebase policies, protected-branch rules vary per repo and
  belong in that project's own `CLAUDE.md`, not assumed globally).
