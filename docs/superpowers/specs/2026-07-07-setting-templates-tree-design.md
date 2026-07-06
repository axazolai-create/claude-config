# setting-templates: directory-tree reorganization with inheritance

## Problem

`setting-templates/` currently holds 22 flat `*.json` files. Direction/base templates
(`frontend.json`, `backend-node.json`, `backend-python.json`, `mobile.json`, `monorepo.json`,
`bots.json`) are never detected directly — they're only reached when a stack template declares
`"extends": ["<direction>"]`. Multi-word stack names encode the hierarchy in the filename itself
via dashes (`backend-node.json`, `react-native.json`, `telegram-node.json`) instead of an actual
folder structure. The `extends` graph is resolved recursively by `_resolve_chain()` in
`bin/init-stack.py`, keyed on bare stack-id strings mapped 1:1 to `TEMPLATES_DIR/<stack>.json`.

Goal: replace the dash-encoded flat layout with a real directory tree, where nesting itself
implies inheritance, and keep the whole thing resolvable by `/init-stack`.

## Key constraint: this is a DAG, not a tree

Three templates have two logical parents each:
- `react-native` — both `frontend` (TypeScript/React tooling) and `mobile` (platform notes, auth0)
- `telegram-node` / `telegram-python` — both `bots` (bot-specific docs) and `backend-node` /
  `backend-python` (language LSP)

A strict single-parent folder tree cannot represent a second parent by nesting alone. Resolved
model (confirmed with the project owner): **nesting is the primary/vertical parent, `extends` is
for the secondary/cross-branch parent(s)**. Both mechanisms combine into one resolver.

## Directory layout

```
setting-templates/
  _base.json                 # NEW — root, universal to every stack (currently empty; extension point)
  kotlin.json                 # standalone (generic JVM, not mobile) — inherits only root _base.json
  sql.json                     # standalone (generic SQL) — inherits only root _base.json
  frontend/
    _base.json                 # was frontend.json
    react.json
    next.json
    react-native.json          # extends: ["mobile/_base.json"]
  backend/
    _base.json                 # NEW — empty; no plugin shared between node/python today, structural placeholder
    node/
      _base.json               # was backend-node.json
      nest.json
    python/
      _base.json               # was backend-python.json
      django.json
      fastapi.json
      flask.json
  mobile/
    _base.json                 # was mobile.json
    android.json
    swift.json
    dart.json
  monorepo/
    _base.json                 # was monorepo.json
    turbo.json
    nx.json
  bots/
    _base.json                 # was bots.json
    node.json                  # was telegram-node.json; extends: ["backend/node/_base.json"]
    python.json                 # was telegram-python.json; extends: ["backend/python/_base.json"]
```

Judgment calls made (confirmed with the project owner):
- `react-native` nests under `frontend/` (primary identity: React/TS); `mobile` is the explicit
  `extends`. Matches the old `extends` order (`["frontend", "mobile"]`).
- `telegram-node`/`telegram-python` nest under `bots/` (primary identity: Telegram bot, the
  language is secondary); `backend/node|python` is the explicit `extends`. This flips the old
  `extends` order (`["bots", "backend-node"]` → vertical=bots, explicit=backend/node), which is
  functionally identical today since `bots/_base.json` contributes no plugins/merge keys that
  would conflict with `backend/node/_base.json`'s `typescript-lsp` entry.
- Every directory level gets its own `_base.json`, including the root and `backend/`, even where
  currently empty — explicit extension points per the project owner's request, not something the
  resolver requires (a missing `_base.json` at any level is still tolerated; see below).

Detected-stack identity stays exactly what `detect()` in `bin/init-stack.py` already emits
(`react`, `next`, `react-native`, `nest`, `django`, `fastapi`, `flask`, `android`, `swift`, `dart`,
`kotlin`, `sql`, `turbo`, `nx`, `telegram-node`, `telegram-python`) — only their file location
changes. This mapping becomes an explicit table (`STACK_PATHS`) in `bin/init-stack.py` rather than
a `f"{stack}.json"` string template, since the path no longer mirrors the stack id 1:1.

## Schema changes

- `extends`: array of paths **relative to `setting-templates/`** (e.g.
  `"extends": ["mobile/_base.json"]`), not bare direction names. Only used for the
  cross-branch/secondary parent — vertical (directory) inheritance is implicit and automatic.
- New optional `pick`: object map `{ "<extends-path>": ["merge", "plugins"] }` — restricts what's
  pulled from that specific `extends` target to the listed **top-level JSON keys** only. Omitting
  a path from `pick` (or omitting `pick` entirely) means "take that target's chain in full" — the
  current, simpler default behavior is unchanged. Granularity is top-level keys only (not deep
  dot-paths into `merge.enabledPlugins.<id>`) — no concrete case needs finer granularity today
  (YAGNI); revisit only if one shows up.

Example (`bots/node.json`, no `pick` needed — full inheritance):
```json
{
  "stack": "telegram-node",
  "description": "Telegram bots on Node.js ...",
  "extends": ["backend/node/_base.json"],
  "merge": {},
  "plugins": []
}
```

## Resolver changes (`bin/init-stack.py`)

- `TEMPLATES_DIR / f"{stack}.json"` is replaced by an explicit `STACK_PATHS: dict[str, str]`
  (16 entries, detector-id → relative path), used by both `gather()`'s no-template check and as
  the entry point into `_resolve_chain`.
- `_resolve_chain(path, visited)` reworked to operate on a relative path (not a bare stack name):
  1. **Vertical ancestors** — walk this path's parent directories up to `setting-templates/`
     root, collecting each level's own `_base.json` if present (root contributes `_base.json`
     itself). Each ancestor is resolved recursively through the same function (so an ancestor's
     own `extends`/`pick`, if any, is honored too) — order: root-most first.
  2. **Explicit `extends`** — for each path listed, recursively resolve it the same way; if a
     `pick` entry exists for that path, filter every `(label, tpl_dict)` tuple in that sub-chain
     down to the picked top-level keys before splicing it in.
  3. **Self** — appended last, unchanged from today ("added on top" semantics for `deep_merge`
     override order and the reporting `seen`-set dedup, both preserved as-is).
  4. Cycle safety: `visited` keyed by resolved relative path (was: bare stack name).
- A missing `_base.json` at any directory level is tolerated exactly like a missing template is
  today (`if not tpl_path.exists(): return []`) — the file's presence is for documentation/
  consistency, not a hard resolver requirement.

## Files to update

- `setting-templates/*.json` — physical move/reorg per the tree above (22 → 24 files: 2 new empty
  `_base.json` placeholders at root and `backend/`).
- `bin/init-stack.py` — `STACK_PATHS` table, reworked `_resolve_chain`, `gather()` no-template path.
- `setting-templates/README.md` — schema section (`extends` semantics, new `pick` field, vertical
  vs. explicit inheritance), file listing.
- `commands/init-stack.md` — the line telling the user to "fill
  `~/.claude/setting-templates/<stack>.json`" needs updating since the path is no longer always
  `<stack>.json` directly under the root.
- `CLAUDE.md` (`~/.claude/CLAUDE.md` and this repo's copy) — the PLUGINS & SKILLS section states
  "Project plugin sets live in `~/.claude/setting-templates/<stack>.json`"; this becomes
  path-inaccurate for stacks that moved into subdirectories. Editable now (see the companion
  curated-marker-lifecycle spec) — update alongside implementation.

## Out of scope

- No change to `detect()`'s stack-detection heuristics — only where each stack's template file
  physically lives.
- No change to `gather()`'s plugin de-duplication or reporting semantics beyond the path rework
  described above.
