# setting-templates

One file per stack, named `<stack>.json`, where `<stack>` matches a key the
detector emits: react, next, nest, django, fastapi, flask, android, kotlin, swift, dart,
react-native, sql, turbo, nx, telegram-node, telegram-python.

`/init-stack` detects the project's stack(s), loads the matching template(s),
checks each plugin, and merges the `merge` block into the project's
`.claude/settings.json`.

## Direction templates + `extends`

Grouped by DIRECTION, not just by stack — e.g. react and next are both "frontend" and share
the exact same plugins (TypeScript LSP, UI-design guidance, Playwright, accessibility audit);
only a framework-specific extra would ever live in `react.json`/`next.json` itself. A stack
file declares `"extends": ["<direction>", ...]` (array, may name more than one — e.g.
`react-native.json` extends both `frontend` and `mobile`, since it genuinely straddles both).
`/init-stack` resolves the chain recursively (direction templates' plugins/merge applied
first, the stack's own on top, deduplicated by plugin id) — see `_resolve_chain()` in
`bin/init-stack.py`. Direction templates (`frontend.json`, `backend-node.json`,
`backend-python.json`, `mobile.json`, `monorepo.json`, `bots.json`) are never detected
directly; they only load when a stack template extends them.

## Schema

```jsonc
{
  "stack": "nest",                         // must equal the filename stem
  "description": "NestJS backend projects",
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
