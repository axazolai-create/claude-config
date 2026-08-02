# Deploy impact — master at `330a879`

Written **before** the deploy, from `node setup.mjs --dry-run`. Variant `base`, 174 files.
Working tree clean, 712 tests / 0 failures, 10 commits ahead of `origin/master`.

## Created (9)

The graphify rework's new surface:

- `bin/graph-find.mjs` + `bin/lib/global-index.mjs` — cross-project symbol lookup, ~200 ms.
- `bin/graph-docs.mjs` + `bin/lib/doc-corpus.mjs` — the comment corpus for full-text search.
- `bin/graph-semantic.mjs` + `bin/graph-semantic.py` — search by meaning, ~1 s.
- `bin/lib/project-scan.mjs` — what counts as a project root, and what is a worktree or archive copy.
- `bin/lib/graphify-python.mjs` — locates graphify's interpreter; extracted from the deleted
  `neo4j-config.mjs`, which was the only thing that made it look Neo4j-specific.
- `commands/graphify-build-docs.md` — the rebuild command and the rule for when to offer it.
- `rules-src/context7.md` — the context7 call sequence, previously a hand-added file on one machine.

## Updated (10)

`commands/init-mcp.md` (Neo4j is a plain database again, not a graphify mirror),
`commands/init-stack.md`, `commands/up-update.md`, `graphify-sync-all.mjs` (clean scan, log out of
the scanned root, `--skip-nested-archives`), `hooks/lib/graphify-global-sync-run.mjs` and
`hooks/lib/graphify-sync-command.mjs` (no push step, index rebuild instead),
`rules-src/README.md`, `setting-templates/_base.json` (context7 plugin gone),
`skills/update-changelog/SKILL.md`.

## Pruned (4)

`bin/graphify-neo4j-push.mjs`, `bin/graphify-neo4j-prune.py`, `bin/lib/neo4j-config.mjs`,
`graphify-neo4j.cypher`. The Neo4j export is gone from the bundle; `~/.graphify/neo4j.env` and the
`neo4j` MCP server are the user's own and are not touched.

## Plugins

`context7@claude-plugins-official`: `disable` (a `settings.json` edit, applied) and `uninstall`
(a CLI call). Under `--replace-all` the uninstall is printed as a manual command and not executed —
that split is deliberate and predates this deploy.

## The one conflict

`~/.claude/CLAUDE.md` comes back `kept` without `--replace-all`: it carries `CURATED:NOEDIT` and
differs from what the fragments now assemble to. The dry run shows it is the **only** conflict, so
`--replace-all` touches that file's resolution and nothing else. It drops from 121 lines to 92.

## What a deploy cannot settle

The component-update nudge clears only once the installer records the new hash. It has been
truthful all along: `~/.claude` was installed from `e6734a2` on 2026-08-01 and the repository has
moved fourteen commits since.
