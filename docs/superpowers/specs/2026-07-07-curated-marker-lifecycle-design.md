# CURATED:NOEDIT marker: stop shipping it in the repo, add it at install/session time

## Problem

`CLAUDE.md` in this repo ships with `<!-- CURATED:NOEDIT -->` as its literal first line. That
marker is what `deny-curated-claude-md.mjs` (PreToolUse: `Edit|Write|MultiEdit`) checks to decide
whether to block edits to a given `CLAUDE.md`, *except* for the one hardcoded special case: the
literal path `~/.claude/CLAUDE.md` is always blocked regardless of marker content (source:
`deny-curated-claude-md.mjs` lines 29-33).

Because this repo's own `CLAUDE.md` is a plain project file (not `~/.claude/CLAUDE.md` itself), it
is protected only by the marker — which makes it impossible for Claude to edit this repo's own
template while working on the config package itself (e.g. updating the `setting-templates` path
description after the tree-reorg change in the companion spec). The marker had to be stripped by
hand (with the project owner's explicit one-time Bash authorization) to unblock this session.

Requirement: the repository must never carry the marker in its own committed `CLAUDE.md`. The
marker must instead be applied at **install time** (`setup.mjs`) or **session-init time**
(`session-init.mjs`), so the *installed* `~/.claude/CLAUDE.md` still ends up protected, without
the source template needing to carry the marker itself.

## Bug this uncovers in `setup.mjs`

`setup.mjs` currently decides "is this a curated file" purely from **the destination's current
on-disk content** (`isCurated(cur)` — checks whether the marker substring is present in what's
already at `~/.claude/CLAUDE.md`), not from the file's identity/path. Two concrete gaps once the
source template stops carrying the marker:

1. **Fresh install** (`placeFile()`, the `!existsSync(dst)` branch) copies the bundle content
   verbatim with no curated handling of any kind. `~/.claude/CLAUDE.md` would be created with no
   marker at all.
2. **Existing-but-unmarked destination** (the `!isCurated(cur)` branch under "other non-script
   files") treats the file as ordinary managed content — "always refresh, no prompt." Every
   subsequent `setup.mjs` run would **silently overwrite** an unmarked `~/.claude/CLAUDE.md` with
   the bundle version, with no diff and no confirmation. This is the exact risk the project owner
   flagged.

Both gaps exist because curated-ness for this one file needs to be a **path-based** property
(mirroring the hook's own special case), not merely "does the current file happen to contain the
substring."

## Design

### 1. Shared helper: `hooks/lib/curated-marker.mjs`

Single source of truth for the marker string and the two small operations, imported by
`deny-curated-claude-md.mjs`, `session-init.mjs`, and `setup.mjs` (removes three copies of the
literal `"CURATED:NOEDIT"` string):

```js
export const MARKER = "CURATED:NOEDIT";
export const hasMarker = (text) => typeof text === "string" && text.includes(MARKER);
export const withMarker = (text) => hasMarker(text) ? text : `<!-- ${MARKER} -->\n${text}`;
```

### 2. `setup.mjs`: `~/.claude/CLAUDE.md` is unconditionally curated by path

In `placeFile()`, special-case `rel === "CLAUDE.md"` (this bundle only ever ships one `CLAUDE.md`,
at the archive root, destined for exactly this path):

- Compute `finalSrcContent = withMarker(srcContent)` — whatever gets written to this destination
  (fresh create, or a "replace" resolution) always carries the marker, regardless of whether the
  bundle source does.
- Treat this destination as curated for the conflict-decision branch **unconditionally** — do not
  gate on `isCurated(cur)` for this one path; always go through the existing diff + `choose()`
  merge/replace/skip prompt when `cur !== finalSrcContent`.
- Independently of the merge/replace/skip outcome for body content: if the current on-disk `cur`
  lacks the marker, prepend it in place as its own small write, reported as its own summary line
  (`marked ~/.claude/CLAUDE.md as curated (marker was missing)`). This keeps "sync the body text"
  and "ensure the marker is present" as two independent, always-both-satisfied guarantees, instead
  of coupling marker presence to whichever body-merge choice the user happens to pick.
- Notification/confirmation requirement: already satisfied by the existing diff + `choose()`
  prompt (interactive keypress, or an explicit `--merge-all`/`--replace-all`/`--skip-all` flag in
  non-interactive runs) — add one explicit printed line calling out the marker action so it isn't
  a surprise inside an otherwise-familiar diff.

### 3. `session-init.mjs`: self-healing net, every session

Add a small, cheap, **every-session** check (not gated by the existing per-project `firstTime`
state, since this is a machine-global file, not a per-project one): if `~/.claude/CLAUDE.md`
exists and `!hasMarker(...)`, rewrite it via `withMarker(...)` and record the action in
`additionalContext`, mirroring the existing per-project root-`CLAUDE.md` auto-mark block already
in this file. New toggle: `CLAUDE_CURATED_AUTOMARK_GLOBAL` (default on) — kept separate from the
existing `CLAUDE_CURATED_AUTOMARK_ROOT` (which governs the *per-project* root `CLAUDE.md`, a
different file with different scope) so either can be disabled independently.

### 4. No hook-level "exception" for `setup.mjs` is needed

`deny-curated-claude-md.mjs` is a `PreToolUse` hook gated on the `Edit|Write|MultiEdit` tool
matcher. `setup.mjs` is a standalone Node process the user runs directly (`node setup.mjs`) that
writes via plain `fs.writeFileSync` — it never goes through Claude's Edit/Write tool call path, so
the hook structurally never sees it and there is nothing to except. (This mirrors the existing,
already-documented caveat about `graphify claude install` writing to a project's `CLAUDE.md`
outside the hook's reach — see `session-init.mjs`'s comment on that block.) No hook code changes
for this part; the "notification and confirmation" requirement is met by `setup.mjs`'s own
existing interactive diff/prompt flow (point 2 above), not by a hook bypass.

## Files to change

- `hooks/lib/curated-marker.mjs` — new shared helper (`MARKER`, `hasMarker`, `withMarker`).
- `hooks/deny-curated-claude-md.mjs` — import the constant/helper instead of its own literal.
- `hooks/session-init.mjs` — new every-session global-file check + `CLAUDE_CURATED_AUTOMARK_GLOBAL`
  toggle; header comment updated to document the new step.
- `setup.mjs` — `placeFile()` special-case for `rel === "CLAUDE.md"` as described above.
- `CLAUDE.md` (this repo's copy) — marker already removed from the committed file as part of this
  change (done by hand, with the project owner's explicit one-time authorization, since the hook
  itself blocked Claude's own Edit tool from doing it beforehand).
- `README.md` (this repo's install/architecture doc) — the "Модель защиты: маркер, а не путь"
  section should note that the marker is now applied at install/session-init time rather than
  shipped in the archive, so a fresh install still ends up with a protected
  `~/.claude/CLAUDE.md`.

## Out of scope

- No change to the *enforcement* behavior of `deny-curated-claude-md.mjs` itself — `~/.claude/
  CLAUDE.md` was already unconditionally blocked by path; this spec only fixes how and when the
  marker text gets applied, not who gets blocked from editing.
- Only `CLAUDE.md` is affected — no other file in this bundle carries or is intended to carry the
  `CURATED:NOEDIT` marker.
