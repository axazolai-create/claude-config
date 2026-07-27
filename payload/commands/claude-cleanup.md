---
description: Interactively clean up ~/.claude cruft — ephemeral caches, aged logs/backups, old sessions, stale temp dirs, and stale plugin cache versions. Dry-run report first, a list-checker for borderline-age items, explicit confirmation before anything moves, and a 7-day restorable trash.
allowed-tools: Bash(node *), AskUserQuestion
---

# /claude-cleanup

Clean up accumulated cruft in `~/.claude` (and its scratchpad temp tree) using the
`~/.claude/bin/claude-cleanup.mjs` engine. The engine is allowlist-based — it only ever
proposes paths under enumerated category roots, so `memory/`, active config, venvs, and the
running session are never in scope by construction. Nothing is deleted outright: everything
proposed for removal is *moved* into `~/.claude/.cleanup-trash/<batch>/` and stays restorable
for 7 days before an automatic retention sweep purges it.

**Categories the engine considers:**
- **ephemeral** — `paste-cache`, `shell-snapshots`, `logs`, `cache`, `session-env`, `daemon`.
  Every immediate child is proposed regardless of age (these are inherently disposable).
- **age** — `file-history`, `jobs`, `tasks`, `backups`, `gsd-user-files-backup`,
  `gsd-migration-journal`. Only children older than 14 days are proposed.
- **session** — `projects/<slug>/<uuid>{.jsonl,/}`. The literal `memory` entry is always
  skipped. Age-bucketed: under 7 days old is kept automatically (never proposed), 7–14 days
  goes to the list-checker, over 14 days is proposed automatically.
- **temp** — `<temp-root>/<slug>/<uuid>/`. Same 7/14-day bucketing as sessions.
- **plugin** — cached plugin versions under `plugins/cache/<marketplace>/<plugin>/<version>/`
  that are not the currently active install. Always proposed, regardless of age.

Follow these steps:

1. **Retention first.** Run:

   ```
   node ~/.claude/bin/claude-cleanup.mjs purge-retention
   ```

   This permanently deletes any trash batch from a *previous* `/claude-cleanup` run that is
   older than 7 days — pure retention housekeeping, unrelated to what you're about to scan.
   Note what it reports (`Purged N trash batch(es): ...`) before moving on.

2. **Scan.** Derive `TEMP_ROOT`, the current `<slug>`, and the current `<session-uuid>` from
   the scratchpad directory path given in your environment info. That path has the shape
   `<TEMP_ROOT>/<slug>/<session-uuid>/scratchpad` — so:
   - `<session-uuid>` = the name of the scratchpad's parent directory,
   - `<slug>` = that directory's parent,
   - `<TEMP_ROOT>` = that directory's parent.

   Then run:

   ```
   node ~/.claude/bin/claude-cleanup.mjs scan --temp-root "<TEMP_ROOT>" --exclude-session "<session-uuid>" --exclude-slug "<slug>"
   ```

   This is read-only — it only inspects the filesystem and prints a JSON plan
   (`{ items, listCheck, totals }`) to stdout. Parse it. `items` are things the engine is
   ready to propose outright (ephemeral/age/plugin, plus sessions and temp dirs already past
   the 14-day auto threshold). `listCheck` are 7–14-day-old sessions/temp dirs that need a
   human call before they're added to the removal set.

3. **Dry-run report.** Present a grouped summary of `items`: per `category`, item count and
   total size (human-readable, e.g. MB/GB), sorted so the biggest reclaimers are called out
   first. Show the grand total from `totals`. State explicitly and unambiguously that
   **nothing has moved yet** — this is a proposal, not an action.

4. **List-checker.** If `listCheck` is non-empty, show a compact numbered table — index,
   slug/session (or temp) identifier from `reason`, age in days derived from `mtimeMs`, and
   size — for each entry. Ask which of these 7–14-day items to remove:
   - For a small set (roughly 4 or fewer), use `AskUserQuestion` with explicit options:
     keep all, remove all, or pick specific ones.
   - For a larger set, ask in plain text instead (a numbered list doesn't fit
     `AskUserQuestion`'s option format well) — offer keep-all / remove-all / a comma-separated
     subset of indices.

   Whatever the user chooses, fold those exact `listCheck` entries (unmodified —
   `absPath`/`size`/`category`/`reason`/`mtimeMs` must be passed through as scanned) into the
   working `items` array. Anything not chosen is left alone; do not re-run the scan.

5. **Confirm & apply.** Summarize the finalized set (item count, total bytes) and ask for
   explicit yes/no confirmation before touching anything. On yes:
   - Write the finalized plan as JSON — `{ "items": [...] }`, using the exact item objects
     from the scan/list-checker step — to a temp file (e.g. under the scratchpad,
     `claude-cleanup-plan.json`). Only `Bash(node *)` is available (no `Write` tool in this
     command), so do the write via `node -e`, e.g. piping the JSON through stdin:

     ```
     node -e "require('fs').writeFileSync(process.argv[1], require('fs').readFileSync(0,'utf8'))" "<plan-file>" <<'JSON'
     { "items": [ ... ] }
     JSON
     ```

   - Run:

     ```
     node ~/.claude/bin/claude-cleanup.mjs apply --plan "<plan-file>"
     ```

     Apply re-checks each item's live mtime against the scanned `mtimeMs` before moving it
     (protects against something changing between scan and apply) and silently skips any item
     that no longer matches — it never overwrites, never guesses, never touches something that
     changed underneath it.
   - The command prints `Moved N items (B bytes) to <batchDir>; skipped S.`. Report the bytes
     reclaimed and the batch path. The trailing path segment of `<batchDir>` is that batch's
     `<ts>` — tell the user it's restorable for 7 days via
     `node ~/.claude/bin/claude-cleanup.mjs restore --ts <ts>`, after which the next
     `purge-retention` run (step 1 of a future `/claude-cleanup`, or the schedule that wraps
     it) will delete it for good.

   If the user says no, stop here — nothing is written or moved.

**Safety notes:**
- This command never runs unattended: every removal requires the dry-run report, the
  list-checker decision (when applicable), and a final explicit confirmation.
- `memory/`, active configuration, virtualenvs, and the currently running session/scratchpad
  are never in scope — the engine is allowlist-based by category root and always excludes the
  current session/slug and the literal `memory` entry.
- Everything moved is reversible: it lives under `~/.claude/.cleanup-trash/<ts>/` with a
  `manifest.json` recording original paths, and `restore --ts <ts>` puts it back — until the
  7-day retention window closes and a `purge-retention` run clears it out.
