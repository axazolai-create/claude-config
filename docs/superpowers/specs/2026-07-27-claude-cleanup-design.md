# Intelligent `~/.claude` Cleanup (`/claude-cleanup`) — Design

**Date:** 2026-07-27
**Status:** Approved (design); implementation plan pending
**Phase:** 4 (follows the three-profile / component-updater line of work)

---

## Goal

A user-invoked, reversible janitor for the live user-scope `~/.claude` (plus the session
scratchpad/task-output temp root) that reclaims accumulated cruft — stale session transcripts,
old plugin-cache versions, old backups, and ephemeral runtime dirs — while never touching active
config, regeneratable venvs, or auto-memory. End state: an uncluttered config that behaves as if
recently installed, with a 7-day safety net on everything it removes.

## Character & non-negotiable constraints

- **Conservative janitor.** Only provably-safe or age-stale data is removed. The two large
  regeneratable venvs (`security/agent-sdk-venv` ~313M, `context-mode/` ~53M) are **out of
  scope** — no `--deep`, no venv reclaim. (Revisit only if a future phase wants a "full reset".)
- **Reversible.** Nothing is hard-deleted on apply. Selected items are **moved** to a single
  timestamped trash batch; a `manifest.json` records each item's original absolute path, size,
  and reason, so restore is a move-back. Trash batches older than **7 days** are hard-purged
  (auto at the start of the next run, or via `empty-trash`).
- **Dry-run first.** The default invocation always produces a grouped report of what *would* be
  removed before anything moves; apply requires explicit confirmation.
- **Never touch:** per-project `projects/<slug>/memory/` (auto-memory), active config/payload
  (`settings*.json`, `CLAUDE.md`, `hooks/`, `bin/`, `skills/`, `agents/`, `commands/`,
  `rules-src/`, `setting-templates/`, `state/`, `references/`), the two venvs above, and the
  **currently-running session** (see Active-session guard).

## Reuse-first (existing patterns this builds on)

- **Command + bin split:** `commands/claude-cleanup.md` (interactive orchestration) → `bin/claude-cleanup.mjs`
  (deterministic engine), mirroring `commands/init-stack.md` → `bin/init-stack.mjs` and
  `commands/pnpm-phantom-fix.md` → `bin/pnpm-phantom-scan.mjs`.
- **`isMain()` symlink-robust entry guard** and **`CLAUDE_CONFIG_DIR || ~/.claude` resolution** —
  copied from `hooks/lib/stack-rules-check.mjs` / `bin/detect-stack-commands.mjs`.
- **Denylist membership:** `variants.json` default-includes new files, so all-profiles membership
  needs **no** `variants.json` edit; `**.test.mjs` is already globally excluded. (A regression
  assertion is optional, not required — the tool ships everywhere by default.)
- **`installed_plugins.json`** as the authority for which plugin versions are active (same source
  `superpowers-fallow-graft.mjs` uses).

## Target inventory & policy

Age is `mtime` (a session `.jsonl`'s mtime = last activity; a temp session dir = newest file
within). Windows: `< 7 days` KEEP · `7–14 days` LIST-CHECK (user picks) · `> 14 days` AUTO-select.

| Category | Roots | Policy |
|---|---|---|
| Ephemeral | `paste-cache/`, `shell-snapshots/`, `logs/`, `cache/`, `session-env/`, `daemon/` logs | remove all (staged to trash) |
| Edit history | `file-history/` | age (`> 14d`) |
| Job/task records | `jobs/`, `tasks/` | age (`> 14d`) |
| **Session transcripts** | `projects/<slug>/*.jsonl`, `sessions/` | session-age (KEEP/LIST/AUTO) — **preserve `projects/<slug>/memory/`** |
| **Temp (scratchpad + task output)** | `<TEMP_ROOT>/<slug>/<session-uuid>/` | session-age (KEEP/LIST/AUTO) |
| Plugin versions | `plugins/cache/<mkt>/<plugin>/<version>/` | keep every `installPath` version in `installed_plugins.json`; trash the rest |
| Backups | `backups/`, `gsd-user-files-backup/`, `gsd-migration-journal/` | age (`> 14d`) |

`<TEMP_ROOT>` = the scratchpad temp base (e.g. `C:\_Temp\claude\`), derived from the current
scratchpad path the agent already knows, with a sane platform default.

**Explicitly NOT in the inventory:** `security/` (venv), `context-mode/` (venv/index), `state/`,
`plugins/` non-cache metadata (`installed_plugins.json`, `known_marketplaces.json`,
`plugin-catalog-cache.json`, `marketplaces/`), and everything under "Never touch".

## Active-session guard

The running session must survive regardless of age math. Two layers:

1. **Explicit exclusion.** The agent knows its own session from the scratchpad path
   (`…/<slug>/<session-uuid>/…`). `claude-cleanup.md` extracts `<session-uuid>` and `<slug>` and
   passes `--exclude-session <uuid> --exclude-slug <slug>` to the bin, which hard-excludes that
   session's `projects/<slug>/<uuid>.jsonl` and `<TEMP_ROOT>/<slug>/<uuid>/` from every category.
2. **TOCTOU guard.** `apply` re-stats each planned item and skips any whose `mtime` changed since
   `scan` (a file that became active between plan and apply is left alone). The `< 7d` KEEP window
   already protects today's session; these are belt-and-suspenders.

## Plugin-version prune (precise)

Read `installed_plugins.json` → collect the set of ALL `installPath` values across every plugin
entry and every scope (user and project). Under `plugins/cache/<mkt>/<plugin>/`, a child directory
is a prune candidate only if its full path is NOT in that active set. Active and project-scoped
installs are never trashed. If `installed_plugins.json` is missing/unparseable, the plugin category
is **skipped entirely** (fail-safe: never guess which version is active).

## Trash, manifest & retention

- Batch dir: `~/.claude/.cleanup-trash/<ISO-timestamp>/`. Each moved item keeps a stable relative
  slot; `manifest.json` in the batch lists `{ originalAbsPath, size, category, reason, movedAt }`
  per item. Temp items (on a different drive) are copied+removed into the same batch, original
  absolute path recorded for restore.
- `.cleanup-trash/` is itself under "Never touch" for the inventory scan (the tool manages it,
  the janitor categories never re-scan it).
- **Retention:** at the start of every run, batches whose timestamp is `> 7 days` old are
  hard-deleted (reported as a one-line note). `empty-trash` forces this now for all batches.
- **Restore:** `restore <batch-ts>` moves each manifest entry back to its `originalAbsPath`
  (skipping any path that now exists, to avoid clobbering), then removes the emptied batch.

## Form & flow

`bin/claude-cleanup.mjs` subcommands (pure engine, testable):

- `scan` → prints a JSON plan: per-category items with sizes/counts, the `listCheck` array
  (7–14d sessions/temp awaiting a user decision), the `retentionPurge` list, and totals. Honors
  `--exclude-session/--exclude-slug`, `--temp-root`, `--older-than`/`--keep-under` (day
  overrides), `--retention` (day override).
- `apply <plan.json>` → moves the plan's selected items to a new trash batch, writes the manifest,
  applies the TOCTOU guard, prints reclaimed bytes + batch path.
- `empty-trash` → hard-purge all trash batches now.
- `restore <batch-ts>` → move a batch back.

`commands/claude-cleanup.md` orchestrates the interactive path: (0) auto-purge retention with a
note; (1) run `scan`; (2) present the grouped dry-run report (category, count, size); (3) for the
`listCheck` sessions/temp, show a compact numbered table (slug · date · size) and ask which to
remove — keep-all / remove-all / a specific subset; (4) on confirmation, write the finalized plan
and run `apply`; (5) report reclaimed space, trash location, and the 7-day retention note. No
automatic/scheduled trigger — the user runs the command.

## Testing

`bin/lib/claude-cleanup-lib.test.mjs` (TDD, tmp-dir fixtures) covers the pure logic:
`categorize` + `ageOf` bucketing (KEEP/LIST/AUTO at the 7/14-day edges); plugin-prune candidate
set from a fake `installed_plugins.json` + cache tree (active kept, old trashed, project-scope
kept, missing-manifest → skip); `moveToTrash` + manifest round-trip; `restore` move-back
(including the skip-if-exists guard); retention selection (`> 7d`); and the active-session /
memory / venv exclusions (asserting those paths never appear in any plan). The `.md` command is
prose — no unit test.

## Out of scope

- The two regeneratable venvs and any `--deep`/full-reset mode.
- Any automatic/scheduled or hook-driven trigger (manual invocation only).
- A config-file system for thresholds (constants + a few CLI day-overrides suffice).
- Cross-machine cleanup and Phase 5 (Opus 5 migration) concerns.

## File touch-list (for the plan)

**New**
- `payload/commands/claude-cleanup.md`
- `payload/bin/claude-cleanup.mjs`
- `payload/bin/lib/claude-cleanup-lib.mjs` (+ `.test.mjs`)

**Modified**
- `RISK_REGISTER.md` — one risk for irreversible-deletion exposure, mitigated by trash+retention+
  dry-run+active-session guard (record residuals, e.g. cross-drive move failure handling).

**Not modified**
- `variants.json` — all-profiles is the denylist default; no entry needed.
