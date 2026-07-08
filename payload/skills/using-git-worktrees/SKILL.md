---
name: using-git-worktrees
description: No-op shadow. Worktrees are owned by GSD or the user. Do not auto-create worktrees.
---

# using-git-worktrees (shadow / no-op)

This USER-scope skill intentionally overrides the plugin skill of the same name
(user scope wins over plugin cache).

Do not create git worktrees automatically. Worktree lifecycle is owned by:
- GSD: `/gsd-workspace --strategy worktree`, and `/gsd-execute-phase` waves, or
- the user, manually via `git worktree add`.

If a task seems to need a worktree, ask the user or defer to GSD instead of creating one.
