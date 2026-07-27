# GSD effort re-tune: a durable patch-mechanism home (Phase 5 §6.1)

**Date:** 2026-07-27 · **Phase 5, Part §6.1** · Follows Part A (commit `1ec69b7`)
**Source:** `docs/opus5/2026-07-26-opus5-migration.md` §6.1

## 1. Problem

The Opus 5 migration re-tunes reasoning `effort` on five GSD-owned files:

| File (under `~/.claude/`) | Kind | Was | Now |
|---|---|---|---|
| `agents/gsd-plan-checker.md` | agent | `low` | `medium` |
| `agents/gsd-codebase-mapper.md` | agent | `low` | `medium` |
| `skills/gsd-plan-phase/SKILL.md` | skill | `max` | `xhigh` |
| `skills/gsd-execute-phase/SKILL.md` | skill | `max` | `xhigh` |
| `skills/gsd-autonomous/SKILL.md` | skill | `max` | `xhigh` |

All five are in `gsd-file-manifest.json` — installed by gsd-core and **overwritten by
`/gsd-update`**. They are never shipped in this bundle (§4.3 of the source doc). The migration
doc concluded there was "no durable home" for these values: they had to be re-applied by hand
after every GSD update.

There now *is* a home: the review-gated patch mechanism (`gsd-agent-patches.mjs`, applied by
`/init-session` via `apply-gsd-agent-patches.mjs`, surfaced read-only by `session-init.mjs`).
This spec gives §6.1 that home.

## 2. Why the existing mechanism does not fit as-is

`gsd-agent-patches.mjs` inserts **prose blocks** wrapped in version markers
(`<!-- gsd-patch:ID vN -->…<!-- /gsd-patch:ID -->`). Idempotency comes from the marker version;
placement from an `insertAnchor`.

An effort re-tune is not a block insertion — it is a **mutation of one existing YAML scalar**
(`effort: low` → `effort: medium`). The block mechanism cannot express it:

- HTML-comment markers cannot wrap a frontmatter value without corrupting the YAML.
- `effort: low` is not a unique anchor — many gsd files carry it.

So §6.1 needs a second, purpose-built primitive alongside the block one.

## 3. Design

### 3.1 New primitive — frontmatter-setter

A shared helper, `payload/hooks/lib/gsd-patch-frontmatter.mjs`:

```
setFrontmatterField(content, { key, from, to }) -> { content, kind }
```

- `key` — frontmatter key to set (here always `effort`, but the helper is key-generic).
- `from` — array of accepted prior values (like `priorBlocks`): the mutation only fires when the
  current value is one of these.
- `to` — target value.

Idempotency and safety come from **value comparison**, not markers:

| Current `<key>:` value | Action | `kind` |
|---|---|---|
| ∈ `from` | set to `to` | `applied` |
| === `to` (already migrated) | none | `null` |
| any other value (user-edited) | leave as-is | `skippedForeign` |
| key absent in frontmatter | none | `noKey` |
| file carries `CURATED:NOEDIT` | none | `skippedCurated` |

Rationale:
- **`from` as a list** makes future re-tunes precise: to move `medium → high` later, add the
  prior target to `from` and bump `to`; a machine still on the original `low` is caught by
  keeping `low` in `from` too.
- **`skippedForeign` never clobbers** a value the user set deliberately — it reports and moves on,
  matching the review-gated, best-effort ethos of the existing patches.
- The setter tolerates quoted and unquoted scalars (`effort: max` and `effort: "max"`), CRLF and
  LF, and only touches the frontmatter block (between the first two `---` fences), never the body.

### 3.2 Agents — extend `gsd-agent-patches.mjs`

Add two frontmatter patches to the registry (`gsd-plan-checker.md` and `gsd-codebase-mapper.md`,
each `from: ["low"], to: "medium"`). The apply/check loop dispatches on a `kind` field per patch:
`"block"` (existing path) vs `"frontmatter"` (new path via the primitive). Existing block patches
gain an explicit `kind: "block"` (or default to block when absent) so nothing changes for them.

### 3.3 Skills — new sibling `gsd-skill-patches.mjs`

`gsd-agent-patches.mjs` only scans `agents/gsd-*.md`. Skills live under `skills/gsd-*/SKILL.md`,
so they need a sibling module mirroring the agent module's `check…` / `apply…` API:

- `checkGsdSkillPatches(claudeDir)` — read-only; returns what is pending.
- `applyGsdSkillPatches(claudeDir)` — applies; returns `{ applied, skippedForeign, skippedCurated,
  noKey }` (frontmatter patches have no "upgraded" kind — a move from a prior target listed in
  `from` to the new `to` is just `applied`).

Registry: three frontmatter patches (`gsd-plan-phase`, `gsd-execute-phase`, `gsd-autonomous`,
each `from: ["max"], to: "xhigh"`). It reuses `gsd-patch-frontmatter.mjs`, so no logic is
duplicated.

### 3.4 Wiring — no new entry points

- `apply-gsd-agent-patches.mjs` already applies agent + workflow patches; add the skill patches
  there so a single `/init-session` applies all three families and reports each.
- `session-init.mjs` already calls `checkGsdAgentPatches` read-only to surface a "run
  /init-session" note; add `checkGsdSkillPatches` to the same check.

### 3.5 Profiles

`base`/`lite` exclude `hooks/gsd-*` and `apply-gsd-agent-patches.mjs`, so this patch-home ships
in **full only** — correct, since base/lite carry no GSD.

## 4. Testing (TDD)

- **Primitive unit tests** (`gsd-patch-frontmatter.test.mjs`): from-match → applied;
  already-target → null; foreign value → skippedForeign (unchanged content); missing key → noKey;
  curated file → skippedCurated; quoted value; CRLF and LF; body containing a stray `effort:` line
  is never touched (only frontmatter).
- **Integration** (`gsd-skill-patches.test.mjs`, additions to `gsd-agent-patches.test.mjs`): apply
  against fixture agent/skill files; re-apply is a no-op (idempotent); a foreign value survives.
- **Wiring**: `apply-gsd-agent-patches.mjs` invokes all three families; `session-init` surfaces a
  pending skill patch.

## 5. Out of scope

- Part B (deploy-time old-model migrator in `setup.mjs` + `/init-stack`) — separate design.
- Any change to the block-patch bodies or their versions.
- Editing the five GSD-owned files in this repo (they are not shipped here by design).

## 6. Rollback

Delete the three frontmatter patch entries (agents) / the new `gsd-skill-patches.mjs` and its
wiring; the block-patch path is untouched, so removal is isolated. Already-migrated live files
keep their tuned values (the setter never reverts).
