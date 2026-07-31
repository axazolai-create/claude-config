# Deploy impact — master through phase 13

**Taken 2026-08-01, after the deploy rather than before it, and that is the first thing this
document has to say.** The ruling in `RESUME.md` is that a deploy is gated on an audit and a
written impact assessment. This assessment was written afterwards because the deploy fired by
accident: `node setup.mjs --help` was run to discover the flag set, `setup.mjs` has no `--help`
flag, and it ignores unrecognised flags rather than refusing them — so the command performed a
real installation. The content deployed was correct (merged `master`, suite green), but the
gate was skipped, and recording that is worth more than a tidy document.

Two things generalise, and both are recorded rather than fixed here:

- `setup.mjs` treats an unknown flag as no flag at all. There is no `--help`, and the closest
  safe probe is `--dry-run`. A flag typo is therefore indistinguishable from a bare invocation,
  which for this script means a full install.
- The lesson already in `RESUME.md` — that `setup.mjs` asks nothing without a TTY — is what made
  this silent. With a TTY there would have been prompts to abort at.

## What the deploy carried

From `master` at `e6734a2`, which is phases 01-13 plus `fix/no-gsd-marketplace-plugin`, merged
in that order and verified green at 682 tests, 0 failures, 1 skipped.

Variant `base`, 170 files, installing into `C:\Users\Axa\.claude`.

**Created (2):**

- `hooks/lib/graphify-sync-command.mjs` — the shell command the autosync worker spawns, as a
  pure function.
- `hooks/lib/state-lock.mjs` — the PID/mtime lock with a TTL, shared by the sync and the push.

**Updated (6):**

- `hooks/lib/graphify-global-sync-run.mjs` — consumes both new modules; extraction is now
  `--code-only`; runs the Neo4j push in the tail of its own detached process.
- `bin/graphify-neo4j-push.mjs` — resolves graphify's own interpreter, restores a missing neo4j
  driver, and takes a global lock so two repositories' pushes cannot overlap.
- `bin/lib/neo4j-config.mjs` — gains `resolveDriverPython`.
- `graphify-sync-all.mjs` — code-only by default, `--semantic` for the full run.
- `hooks/lib/protected-lib.mjs` — creating a record is not editing it (phase 13's branch).
- `bin/lib/gsd-core-detect.mjs` — from `fix/no-gsd-marketplace-plugin`.

**Not touched:** `settings.json` (no new hook registrations, so nothing waits on a restart for
its wiring), the curated `CLAUDE.md` (no conflict to resolve this time), and every other file in
the bundle.

**Plugin reconciliation:** printed only, non-interactive — `superpowers@claude-plugins-official`
stays installed on purpose and is only disabled. Unchanged from the previous deploy.

## Verification

`node setup.mjs --dry-run` immediately afterwards reports 170 files, all `unchanged`, and no
created / updated / pruned / kept / conflict lines at all. `~/.claude` is exactly merged
`master`.

## What a deploy still cannot settle

`RISK-STATUSLINE-002` is unchanged by this deploy and still unobserved:
`~/.claude/state/autocompact.json` appears only after the first genuine automatic compaction, and
the acceptance check is a `models` entry whose `tokens` is below its `windowSize` with no
`pending` left.
