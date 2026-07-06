# rules

Path-scoped instructions that load **only when Claude works with matching files**.
They live in `~/.claude/rules/` and apply across all projects, gated by file type.

## How loading works

- Each file has `paths:` frontmatter — a YAML list of glob patterns matched against
  absolute file paths. A rule with no `paths:` would load unconditionally (avoid that here).
- A **base** rule per language loads for any file of that language.
- A **direction** (framework) rule loads on signature files/paths and LAYERS ON TOP of the
  base. Editing a `.tsx` in a Next app loads `node.base` + `node.react` + `node.next`.
- A **cross-cutting** rule (no language prefix — `testing.md`, `security.md`, `docker.md`,
  `ci.md`, `api-contracts.md`, `monorepo.md`) triggers on its own signature files/paths
  regardless of language, and layers on top of whatever language rules also matched. Editing
  `src/auth/jwt.service.ts` in a Nest app loads `node.base` + `node.nest` + `security.md`.
- Rules are context, not enforcement. For hard gates (block an action every time) use a
  hook, not a rule.

## Naming convention

```
<lang>.base.md           # language base (broad glob)
<lang>.<direction>.md    # framework / direction (signature globs, layers on base)
<topic>.md               # cross-cutting, no language prefix (own signature globs)
```

## Current files

| File | Scope |
| --- | --- |
| `node.base.md` | all JS/TS, package.json, tsconfig |
| `node.react.md` | `*.jsx/tsx`, vite config |
| `node.nest.md` | nest-cli.json, `*.controller/service/module.ts`, main.ts |
| `node.next.md` | next.config, `app/**`, `pages/**`, middleware/proxy |
| `python.base.md` | all `*.py`, pyproject, requirements |
| `python.fastapi.md` | routers/api/schemas/dependencies |
| `python.django.md` | manage/settings/models/migrations… |
| `python.flask.md` | app.py, blueprints, views |
| `python.data.md` | notebooks, pipelines, etl, jobs |
| `python.cli.md` | cli.py, `__main__.py`, scripts |
| `kotlin.base.md` | `*.kt/kts`, gradle.kts |
| `kotlin.intellij-plugin.md` | plugin.xml, `*.form`, META-INF |
| `kotlin.android.md` | AndroidManifest.xml, `res/**`, `androidTest/**` |
| `swift.base.md` | all `*.swift`, Package.swift |
| `swift.ios.md` | `*.xcodeproj/**`, `*.xcworkspace/**`, Info.plist, `*App.swift` |
| `dart.base.md` | all `*.dart`, pubspec.yaml |
| `dart.flutter.md` | `lib/main.dart`, `ios/Runner/**`, `android/app/**` |
| `node.react-native.md` | metro.config.js, app.config.{js,ts}, `*.native.*` |
| `mobile.md` | cross-cutting: union of the mobile signature files above |
| `sql.md` | `*.sql` (Oracle + PostgreSQL) |
| `shell.md` | `*.sh`, `*.ps1` |
| `testing.md` | cross-cutting: `*.test/.spec.*`, `test_*.py`, `*Test.kt`… |
| `security.md` | cross-cutting: `*auth*`, `.env*`, `*secret*`, `*jwt*`, `*session*`, `*crypto*` |
| `docker.md` | cross-cutting: `Dockerfile*`, `docker-compose*.yml`, `.dockerignore` |
| `ci.md` | cross-cutting: `.github/workflows/*.yml` |
| `api-contracts.md` | cross-cutting: `openapi.*`, `*.dto.ts`, `schemas.py`, `serializers.py` |
| `monorepo.md` | cross-cutting: `turbo.json`, `pnpm-workspace.yaml`, `nx.json` |
| `node.telegram.md` | `bot.ts`/`bot.js`, `telegraf.config.*` |
| `python.telegram.md` | `bot.py`, `handlers/**` |

## Adding a rule

1. Create `<lang>.<x>.md` for a language/framework direction, or `<topic>.md` for a
   cross-cutting concern that isn't tied to one language — either way, scope it with a
   `paths:` frontmatter.
2. Keep it tight (~40 lines): concrete "use X / avoid Y", with versions where known.
3. State what to AVOID as well as what to use — contradictory rules are worse than none.

## templates/

Project-root scaffold files (not rules themselves - not path-scoped, not auto-loaded).
Copy the matching one to a new project's root when it's missing, e.g.
`rules/templates/next.AGENTS.md` -> that project's `AGENTS.md`. A direction rule may
`@AGENTS.md`-import it (see `node.next.md`) so it's pulled into context once present;
the import is a silent no-op on projects that don't have the file yet.

## Caveat: frameworks share extensions

React / Next / Nest all use `.ts`, so path-scoping is best-effort and relies on signature
files (`nest-cli.json`, `next.config.*`, `app/**`, `vite.config.*`). For an ambiguous repo,
pin the direction in the project `CLAUDE.md`:

```
@~/.claude/rules/node.nest.md
```

Check what actually loaded in a session with `/memory`.
