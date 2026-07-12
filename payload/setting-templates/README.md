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
  DB/
    _base.json                 # the "sql" stack's own settings, and DB/'s vertical base for
                                # any future sibling (e.g. a postgres- or oracle-specific template)
  CLI/
    kotlin.json                 # the "kotlin" stack; no CLI/_base.json yet - add one if a
                                 # second CLI-oriented stack shows up later
  frontend/
    _base.json                 # typescript-lsp, frontend-design, playwright, accesslint
    react.json
    next.json
    react-native.json          # extends: ["mobile/_base.json"] (cross-branch)
  backend/
    _base.json                 # empty - no plugin shared between node/python today
    node/
      _base.json                # typescript-lsp; also the "node" stack's own leaf (no framework)
      nest.json
    python/
      _base.json                 # pyright-lsp; also the "python" stack's own leaf (no framework)
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

`/init-stack` detects the project's stack(s) (`react`, `next`, `react-native`, `nest`, `node`,
`django`, `fastapi`, `flask`, `python`, `android`, `swift`, `dart`, `kotlin`, `sql`, `turbo`, `nx`,
`telegram-node`, `telegram-python`), looks up each one's file via the `STACK_PATHS` table in
`bin/init-stack.py`,
resolves its full inheritance chain, checks each declared plugin, and merges the `merge` block
into the project's `.claude/settings.json`. It also surfaces any `skills[]` a template declares
(npx-installed Agent Skills) and, in `-i`, offers to `npx skills add` the missing ones - skills are
opt-in (never auto-installed) and have no enable/disable, so their present-check is by directory
name and approximate (the install command is the source of truth; slugs drift - verify at install).

### Framework-less fallback stacks

`node` and `python` fire when the language is present (`package.json`, or `pyproject.toml`/
`requirements*.txt`) but no more specific framework matched (no `nest`/`next`/`react`/
`react-native`, no `django`/`fastapi`/`flask`/`telegram-python`) - a plain script, library, or
unopinionated backend. Both map straight to their direction's own `_base.json`
(`backend/node/_base.json`, `backend/python/_base.json`) instead of a dedicated leaf file,
same as `sql` -> `DB/_base.json` — there is no framework-specific plugin to add on top, only the
language server the `_base.json` already declares. A framework stack and its bare fallback never
fire together (e.g. a Django project detects `django` only, not `django` + `python`).

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
  ],
  "skills": [                                // OPTIONAL - npx-installed Agent Skills (NOT plugins)
    {
      "id": "owner/repo",                    // passed to `npx skills add <id>`
      "name": "installed-skill-dir",         // best-effort present-detection (dir name in skills/)
      "description": "...",                  // prefer skills that add JUDGMENT, not API docs (Context7 covers docs)
      "install": { "cmd": "npx skills add owner/repo", "slash": "" }
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
- Before writing/trusting a plugin's `description` here, verify it against the plugin's own
  manifest: `hooks/hooks.json` (does it register hooks that run on their own?), `.mcp.json`
  (a known local OSS binary, or a vendor's closed one?), and its README's install steps. The
  catalog `source` field is a tell: a bundled `./plugins/<name>` path is usually safe; an
  external `git-subdir`/`url` source needs its manifest checked.
- A marketplace's own `.gitmodules` can force SSH even when `marketplace_add` clones over
  HTTPS: `git submodule` always honors the literal submodule URL, so `git@github.com:...`
  URLs in the marketplace repo's `.gitmodules` fail the whole add on a machine without a
  GitHub SSH key ("SSH host key is not in your known_hosts file" / "Permission denied
  (publickey)") — even when the plugin you want has no SSH dependency. Fix on the affected
  machine: `git config --global url."https://github.com/".insteadOf "git@github.com:"`,
  then retry `marketplace_add`. (Trusting the host key alone doesn't help if the account
  has no SSH key registered; seen on `turborepo@pleaseai`.)

## Related tools (non-plugin)

Things worth knowing about that don't fit the `plugins` schema above (no `claude plugin
install` path — installed via `claude mcp add`, `npx skills add`/`pnpm dlx skills add`, or an
IDE marketplace instead) or aren't currently auto-enabled anywhere. Kept here instead of as
prose in individual template files.

- **Frontend/mobile UI handoff:** Claude Design (claude.ai/design) — build a prototype on its
  canvas, one-click Export produces a handoff bundle Claude Code implements directly; requires
  Claude Pro, design-system sync is in beta. Figma + `madebysan/claude-figma-skills`
  (figma-code-connect, figma-swiftui) remains a fallback for teams already on a Figma design
  system.
- **shadcn/ui Skills:** `pnpm dlx skills add shadcn/ui` (skills.sh, not a marketplace plugin) —
  project-aware shadcn/ui component/theming/CLI knowledge, free, 118k-star project.
- **Android:** Chris Banes' Jetpack Compose skill pack, `npx skills add chrisbanes/skills`
  (free, written by a Google Android engineer). JetBrains' official "Claude Code" IDE plugin
  (plugins.jetbrains.com/plugin/27310) wires Claude Code + Kotlin LSP into Android Studio.
- **iOS:** xclaude-plugin (github.com/conorluddy/xclaude-plugin) — 8 modular MCP servers for
  Xcode/Simulator/IDB, community project, free.
- **Flutter/Dart:** Dart & Flutter MCP Server (docs.flutter.dev/ai/mcp-server, official
  Google/Dart team — analyze/fix, hot-reload, pub.dev search, run tests; needs Dart SDK 3.9+ /
  Flutter 3.35+). Very Good Ventures' AI Flutter plugin
  (github.com/VeryGoodOpenSource/vgv-ai-flutter-plugin) for architecture/testing best-practice
  skills.
- **Databases/queues:** no generic Postgres/MySQL/MongoDB/RabbitMQ/Kafka plugin exists in the
  official catalog — use MCP servers instead: Postgres via
  github.com/modelcontextprotocol/servers (official reference impl), Redis via
  github.com/redis/mcp-redis (official), RabbitMQ via
  github.com/kenliao94/mcp-server-rabbitmq (community), Kafka via
  github.com/tuannvm/kafka-mcp-server or github.com/Joel-hanson/kafka-mcp-server (no dominant
  option — pick by activity). Prefer self-hosted Postgres/Redis over cloud-managed-only
  variants (Neon/AlloyDB/Cloud SQL) for a genuinely free setup.
- **Telegram bots:** `telegram@claude-plugins-official` is a Claude-Code remote-control channel
  (DM your running session via a BotFather bot), **not** bot-development tooling — don't
  confuse the two. For testing a bot you're building: telegram-bot-api-mcp
  (github.com/shekelstrong/telegram-bot-api-mcp), telegram-mcp
  (github.com/guangxiangdebizi/telegram-mcp), or chigwell/telegram-mcp (Telethon/MTProto —
  reads chat history a bot token can't, for inspection only).

## Plugin states (used by /init-stack)

For every declared plugin the detector reports one state:

- `installed` — present in `installed_plugins.json`; added to `ready` automatically.
- `available` — not installed, but its `@marketplace` is added and the plugin is in that
  catalog → only install commands are shown.
- `marketplace_missing` — its `@marketplace` is not added → marketplace_add + install shown.
- `unavailable` — marketplace added but the id isn't in the catalog (stale catalog or wrong
  id) → refresh + install shown.
- `placeholder` / `no_template` — fill the template / create one.

`/init-stack -i` shows the detected stack's plugins (installed vs needs-install) plus every other
known plugin (opt-in, with description) as one checklist; on confirm it installs the checked
plugins that are missing (`claude plugin install`, adding the marketplace when needed) and enables
them in the project's `.claude/settings.json`. The non-interactive `--enable`/`--apply-all` path
activates only (no install). Restart Claude Code afterwards (`enabledPlugins` resolves at startup).
