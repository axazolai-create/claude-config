# Risk Register

Stable-ID risk log for this repo. Referenced from design docs; do not inline risks in specs.

| ID | Status | Area | Risk | Mitigation | Refs |
|----|--------|------|------|------------|------|
| R-CL-01 | Closed | changelog-trigger | Drain's own version-bump commit re-fires the `post-commit` hook → infinite enqueue/drain loop. | Drain writes a lock file the hook checks; hook also ignores commits whose message starts with `релиз:`/`патч:`. Two independent guards. | DESIGN §6, §6.2 |
| R-CL-02 | Closed | changelog-trigger | Headless `claude -p` drain spawns a model per invocation → cost / rate pressure if wired to fire too often. | Headless entrypoint is opt-in and drains the *whole queue* in one run (batch), not one model per commit. Default path is in-session drain (no extra model). | DESIGN §6 |
| R-CL-03 | Accepted | changelog-trigger | New `релиз:`/`патч:` commit-message format deviates from the target repo's existing `vX.Y.Z` bump-commit convention; tooling/filters keying on the old format may miss them. | Documented as an intentional convention change; version string still embedded in the message. Confirm no CI/release tooling parses the old exact format before rollout. | DESIGN §6.2 |
| R-CL-04 | Closed | changelog-trigger | Queue file (`.claude/changelog-queue`) or lock left stale (crash mid-drain) blocks future drains or loses commits. | Lock carries PID+mtime with a TTL (mirror `graphify-global-sync-run.mjs` staleness guard); queue is append-only and only cleared for entries actually processed. | DESIGN §6, §7 |
| R-CL-05 | Closed | changelog-trigger | Missing/incorrect `.changelog.config.json` → aggregate silently skipped or parts mis-named. | No config → per-part still works, explicit warning emitted; unknown workspace → folder-name fallback. Config is committed (not gitignored). | DESIGN §3 |

## Resolution log

Resolved 2026-07-07 after executing `skills/update-changelog/IMPLEMENTATION-PLAN.md`
(commits `343c9a5`..`09d0550`). Verdicts are evidence-based against the committed code/docs.

- **R-CL-01 — Closed.** Both guards are emitted by the installed `post-commit` hook in
  `scripts/install-trigger.mjs`: the `case "$msg" in релиз:*|патч:*) : ;;` message skip and the
  `! node "$q" is-locked` lock check. Drain holds the lock (SKILL.md drain step 1) while it
  composes its `релиз:`/`патч:` bump commit, so either guard alone breaks the loop; both fire
  together.
- **R-CL-02 — Closed.** `scripts/queue.mjs read` returns the entire queue; SKILL.md "Automated
  mode → Drain" processes all queued hashes in a single pass and the "Headless runbook" spawns
  one model per drain, not per commit. Entrypoint is documented opt-in.
- **R-CL-03 — Accepted (residual).** The `релиз:`/`патч:` label is an intentional, documented
  convention change (SKILL.md §6.2 / drain step 5); the version string is still embedded. The
  only residual — a *target* repo whose CI parses the old exact `vX.Y.Z` format — can't be
  closed from this repo; it remains a pre-rollout confirmation item per deployment.
- **R-CL-04 — Closed.** `scripts/queue.mjs` sets `LOCK_TTL_MS = 15 min` and auto-clears a stale
  lock in `isLocked()` (`Date.now() - mtimeMs > TTL`); `clearHashes()` removes only the hashes
  passed in (processed), and `appendHash()` is append-only with dedup. Covered by
  `tests/queue.test.mjs` (roundtrip + lock lifecycle).
- **R-CL-05 — Closed.** `scripts/config.mjs` returns `null` when the config is absent,
  `partName()` falls back to `basename(relDir)`, and `aggregatePath()` returns `null` when no
  aggregate is configured; SKILL.md M7a then skips the aggregate write with a warning while
  per-part changelogs still run. Covered by `tests/config.test.mjs`.
