# setting-templates

Templates live in a directory tree under `setting-templates/`, grouped by DIRECTION rather than
flat dash-named files. Each directory has its own `_base.json` (including the root) that every
file nested under it inherits from automatically — vertical (directory) inheritance needs no
`extends` declaration at all. A stack file only declares `extends` for a SECOND, cross-branch
parent it needs beyond its own directory nesting (e.g. `frontend/react-native.json` also needs
`mobile/_base.json`).

```
setting-templates/
  _base.json                 # root - universal extension point (currently empty)
  kotlin.json                 # standalone (generic JVM, not mobile)
  sql.json                     # standalone (generic SQL)
  frontend/
    _base.json                 # typescript-lsp, frontend-design, playwright, accesslint
    react.json
    next.json
    react-native.json          # extends: ["mobile/_base.json"] (cross-branch)
  backend/
    _base.json                 # empty - no plugin shared between node/python today
    node/
      _base.json                # typescript-lsp
      nest.json
    python/
      _base.json                 # pyright-lsp
      django.json
      fastapi.json
      flask.json
  mobile/
    _base.json                 # auth0 (opt-in, not auto-enabled)
    android.json                 # kotlin-lsp
    swift.json                   # swift-lsp
    dart.json
  monorepo/
    _base.json
    turbo.json
    nx.json
  bots/
    _base.json                 # no dedicated plugin exists for bot dev - docs only
    node.json                    # extends: ["backend/node/_base.json"] (cross-branch)
    python.json                   # extends: ["backend/python/_base.json"] (cross-branch)
```

`/init-stack` detects the project's stack(s) (`react`, `next`, `react-native`, `nest`, `django`,
`fastapi`, `flask`, `android`, `swift`, `dart`, `kotlin`, `sql`, `turbo`, `nx`, `telegram-node`,
`telegram-python`), looks up each one's file via the `STACK_PATHS` table in `bin/init-stack.py`,
resolves its full inheritance chain, checks each declared plugin, and merges the `merge` block
into the project's `.claude/settings.json`.

## Inheritance: vertical + explicit `extends` + `pick`

- **Vertical (implicit):** every `_base.json` from the root down to (but not including) a
  template's own directory is applied automatically, root-most first — no declaration needed.
  E.g. `backend/node/nest.json` automatically inherits `_base.json` -> `backend/_base.json` ->
  `backend/node/_base.json`, in that order, before its own content.
- **Explicit `extends` (cross-branch only):** an array of paths **relative to
  `setting-templates/`**, for a second parent outside the template's own directory chain. Only
  three templates need this today: `frontend/react-native.json` (`["mobile/_base.json"]`),
  `bots/node.json` (`["backend/node/_base.json"]`), `bots/python.json`
  (`["backend/python/_base.json"]`).
- **`pick` (optional, partial inheritance):** `{ "<extends-path>": ["merge", "plugins"] }` -
  restricts what's pulled from that specific `extends` target to the listed top-level JSON keys
  only. Omitting a path from `pick` (or omitting `pick` entirely) means "inherit that target's
  chain in full" - the default, and what every template uses today (no current template needs
  partial inheritance; the field exists as a deliberate extension point).
- Resolution order for a given template: vertical ancestors (root-most first) -> each `extends`
  target (in declared order, `pick`-filtered if applicable) -> the template's own content, LAST -
  so its own plugins/merge are what a diff would show as "added on top". See `_resolve_chain()`
  in `bin/init-stack.py`.

## Schema

```jsonc
{
  "stack": "nest",                         // documentation only - never read programmatically;
                                            // for a `_base.json` this is the direction's name
                                            // (e.g. "frontend", "backend", "mobile")
  "description": "NestJS backend projects",
  "extends": ["backend/node/_base.json"],  // OPTIONAL - only for a second, cross-branch parent;
                                            // path relative to setting-templates/
  "pick": {                                 // OPTIONAL - restrict an `extends` target to these
    "backend/node/_base.json": ["merge"]   // top-level keys only (omit a path for full inherit)
  },
  "merge": {                               // deep-merged into .claude/settings.json
    "enabledPlugins": {                    // keys with <...> placeholders are skipped
      "nest-toolkit@my-mp": true
    }
    // any other settings.json keys may go here too
  },
  "plugins": [
    {
      "id": "nest-toolkit@my-mp",          // plugin@marketplace
      "description": "",
      "check": {                           // how to verify it's installed/available
        "installed_file": "~/.claude/plugins/installed_plugins.json",
        "cmd":   "claude plugin list",
        "bash":  "jq -e '.plugins[\"nest-toolkit@my-mp\"]' ~/.claude/plugins/installed_plugins.json >/dev/null 2>&1 && echo INSTALLED || echo MISSING",
        "slash": "/plugin list"
      },
      "install": {                         // commands shown when the plugin is missing
        "marketplace_add": {
          "cmd":   "claude plugin marketplace add owner/repo",
          "slash": "/plugin marketplace add owner/repo"
        },
        "cmd":   "claude plugin install nest-toolkit@my-mp --scope project",
        "bash":  "claude plugin install nest-toolkit@my-mp --scope project",
        "slash": "/plugin install nest-toolkit@my-mp"
      }
    }
  ]
}
```

## Notes

- The detector reads `installed_plugins.json` natively to decide installed vs missing.
  The `check.*` strings are for display / manual use (and optional jq-based checks).
- Keys starting with `_` (e.g. `_comment`) are ignored on merge.
- `enabledPlugins` is resolved at startup — restart Claude Code after `/init-stack`.
- A missing `_base.json` at any directory level is tolerated (treated as contributing nothing) —
  its presence at every level in this repo is a deliberate consistency choice, not a resolver
  requirement.

## Plugin states (used by /init-stack)

For every declared plugin the detector reports one state:

- `installed` — present in `installed_plugins.json`; added to `ready` automatically.
- `available` — not installed, but its `@marketplace` is added and the plugin is in that
  catalog → only install commands are shown.
- `marketplace_missing` — its `@marketplace` is not added → marketplace_add + install shown.
- `unavailable` — marketplace added but the id isn't in the catalog (stale catalog or wrong
  id) → refresh + install shown.
- `placeholder` / `no_template` — fill the template / create one.

`/init-stack` walks non-installed plugins one at a time, asks before installing or adding a
marketplace, re-checks with `--status <id>`, and finally enables the resolved ones with
`--apply <id...>`. Restart Claude Code afterwards.
