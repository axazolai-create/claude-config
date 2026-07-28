# gsd-core detector + own statusLine for base/lite — design

Date: 2026-07-28
Status: approved, not yet planned

## Context

Installing the `base` profile removed this bundle's whole GSD layer correctly — the manifest
records 148 files and zero `gsd-*` entries, and every path listed in `base.exclude` is gone from
`~/.claude`. What remains on disk is **gsd-core 1.8.0**, a separate product installed by its own
installer and carrying no uninstaller of its own:

| Surface | Count |
|---|---|
| `~/.claude/gsd-core/` | VERSION 1.8.0 |
| `~/.claude/skills/gsd-*` | 71 |
| `~/.claude/agents/gsd-*.md` | 34 |
| `~/.claude/hooks/gsd-*` | 23 files, **12 registered** in `settings.json` |
| `~/.gsd/` | `defaults.json`, `research-cache` |

`pruneStale()` (`setup.mjs:517`) cannot reach these: its candidate set comes from this bundle's
own previous manifest plus `SEED_REMOVED`. Files the bundle never installed never become
candidates — a deliberate guarantee, stated at `setup.mjs:688` ("gsd-* agents belong to the
separate gsd-core tool, not this bundle"), not an oversight.

Separately, `base` currently has **no statusLine at all**. That is also by design:
`setup.mjs:894-899` deletes a `statusLine` pointing at `gsd-context-meter` whenever the variant
is not `full`, because `hooks/gsd-context-meter.mjs` is excluded outside `full`. That file is a
wrapper that shells out to gsd-core's own `gsd-statusline.js` and rewrites one segment, so
without gsd-core it has nothing to wrap — the `gsd-` prefix on it and on
`hooks/lib/gsd-context-meter-lib.mjs` is honest, and their exclusion is correct.

## Part 1 — gsd-core detector in setup.mjs

### Trigger

`profile ∈ {base, lite}` **and** `~/.claude/gsd-core/VERSION` exists.

### Inventory

Collected strictly under `~/.claude`:

- `gsd-core/`
- `skills/gsd-*`
- `agents/gsd-*.md`
- `hooks/gsd-*`
- `hooks/lib/gsd-*`

Never touched: `~/.gsd/` (settings and research cache survive a return to `full`), `.planning/`
in any project, anything outside `~/.claude`. Paths present in the current bundle manifest are
subtracted from the inventory, so the detector cannot consume a file this bundle owns.

### Consent

- **TTY:** print the inventory with per-category counts and total size, then ask. Default **no**.
- **Non-TTY:** report only.
- `--replace-all` / `--merge-all` do **not** imply consent here. Those flags are about this
  bundle's own files; extending them to a foreign product is the wrong semantics. A dedicated
  `--uninstall-gsd` flag exists for scripted use.

This deliberately diverges from `pruneStale()`, which does treat the bulk flags as consent.

### Execution

Reuse `payload/bin/lib/claude-cleanup-lib.mjs`:

- `applyPlan({ dir, items, nowMs, ts })` moves every path into `.cleanup-trash/<ts>/`
- `restoreBatch({ dir, ts })` is the documented rollback, inside the 7-day retention window
- `purgeRetention()` sweeps it afterwards, as it already does for `/claude-cleanup`

`settings.json` is not a file move, so it needs its own reversibility: a copy of the current
`settings.json` goes into the same trash batch **before** the edit, then hook entries whose args
reference `hooks/gsd-*` are removed.

That edit is the one place this work weakens an existing guarantee. Today `setup.mjs:824-847`
filters hook entries only through `mentionsOurs(e)`, which matches basenames drawn from
`settings.partial.json` — foreign entries are left alone by construction. The detector must
match `gsd-*` explicitly, and does so only under the profile trigger and explicit consent.

### Structure

New `payload/bin/lib/gsd-core-detect.mjs` holding pure functions — inventory building and the
`settings.hooks` filter — with tests beside it. `setup.mjs` orchestrates and prompts only.
Rationale: `setup.mjs` is already ~1250 lines, and pure logic is testable without filesystem
mocks.

## Part 2 — own statusLine for base/lite

New `payload/hooks/statusline.mjs` rendering the whole line, registered for `base`/`lite` where
`setup.mjs:894-899` currently just deletes the key. `full` keeps `gsd-context-meter.mjs`.

### Segment order

The updates segment goes **first**, and names what is stale rather than counting it:

```
⬆ context-mode +2 │ <context segment> │ <state segment>
```

Omitted entirely when nothing is pending. Names come from `state/component-updates.json`; beyond
two, the remainder collapses to `+N`. The current native `⬆1` in the Claude Code footer is a
separate indicator that this does not and cannot replace.

### State segment — resolved by what the repo actually has

1. **GSD project** — `.planning/config.json` exists → milestone, phase and status, mirroring
   gsd-core's own vocabulary (`v2.0 [██░] X% · Phase 4.5 executing`).
2. **Ultrapowers SDD in flight** — `.ultrapowers/sdd/<plan>/progress.md` exists → plan name from
   the ledger's first line (`# SDD ledger — plan: <path>`) and progress counted from
   `Task <N>: complete` lines, resuming at the first task without one.
3. **Neither** — project directory name and current git branch, in gsd-core's own git format
   (`main+2~1?3↑1`, `main✓`, `(detached)`).

Case 2 was initially assumed impossible on the grounds that ultrapowers keeps no state. That was
wrong: it keeps `docs/ultrapowers/plans/`, `docs/ultrapowers/specs/`, `.ultrapowers/brainstorm/`
and the SDD ledger above. Only the GSD *names* (`STATE.md`, `ROADMAP.md`) are absent.

### Shared logic

`formatCurrentTokens`, `formatContextWindow`, `computeUsedTokenMetrics` and
`appendUpdatesSegment` move out of `gsd-context-meter-lib.mjs` into a neutral
`payload/hooks/lib/statusline-lib.mjs`; the gsd file imports them and retains only
`rewriteContextBar`, which exists solely to parse `gsd-statusline.js` output. No duplicated
logic between profiles.

### Failure policy

Any error yields empty output. The statusLine never breaks the prompt — the same discipline
`gsd-context-meter.mjs` already follows.

## Risks

To be filed in `RISK_REGISTER.md` (next free id: `RISK-ULTRAPOWERS-009`):

- Removing foreign hook registrations from `settings.json` weakens the "only ever touch our own
  entries" property. Mitigated by the pre-edit backup inside the trash batch.
- `/gsd-update` reinstalls gsd-core at any time. The detector only observes the divergence at
  the next `setup.mjs` run; between runs the machine drifts.

## Out of scope

- Uninstalling `~/.gsd/` or any `.planning/` directory.
- Replacing the native Claude Code update indicator.
- Any session-start-time enforcement of the gsd-core absence.
