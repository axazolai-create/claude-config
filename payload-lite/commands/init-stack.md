# /init-stack — compile per-project stack rules (lite)

Detect this project's stack from marker files, then assemble
`.claude/stack-rules.md` from `~/.claude/rules-src/`. No plugin management in the
lite bundle — this command only builds the rules snapshot.

## 1. Detect the stack

Match marker files against this table (rows are additive — a project can be
Node+Docker+monorepo at once):

| Marker | Stack rule files (rules-src/) |
|---|---|
| `package.json` | node.base.md |
| `next.config.*` | + node.next.md |
| `vite.config.*` / react deps | + node.react.md |
| `nest-cli.json` | + node.nest.md |
| `bot.ts`/`bot.js` + telegraf/grammY dep | + node.telegram.md |
| `metro.config.js` / `app.config.*` | + node.react-native.md |
| `pyproject.toml` / `requirements.txt` | python.base.md |
| `manage.py` | + python.django.md |
| fastapi dep | + python.fastapi.md |
| flask dep | + python.flask.md |
| `bot.py` + aiogram/python-telegram-bot dep | + python.telegram.md |
| pandas/numpy/jupyter deps | + python.data.md |
| click/typer dep (no web) | + python.cli.md |
| `*.csproj` | csharp.base.md |
| ASP.NET SDK in csproj | + csharp.aspnet.md |
| `*.xaml` / `UseWPF` | + csharp.wpf.md |
| `*.csproj` (OutputType=Exe, no ASP.NET/WPF) | + csharp.cli.md |
| `build.gradle.kts` | kotlin.base.md |
| `AndroidManifest.xml` (android gradle plugin) | + kotlin.android.md |
| `plugin.xml` (IntelliJ/Gateway plugin) | + kotlin.intellij-plugin.md |
| `pubspec.yaml` | dart.base.md (+ dart.flutter.md if flutter dep) |
| `Package.swift` | swift.base.md |
| `*.xcodeproj/**` / `Info.plist` | + swift.ios.md |
| `Dockerfile` / `docker-compose.yml` | + docker.md |
| `pnpm-workspace.yaml` / turbo/nx | + monorepo.md |
| `.github/workflows/` | + ci.md |
| `openapi.*` / `*.dto.ts` / `schemas.py` / `serializers.py` | + api-contracts.md |
| `*.sh` / `*.ps1` | + shell.md |
| `*.sql` | + sql.md |
| Android/iOS presence | + mobile.md |

Always include: `testing.md`, `security.md` (cross-cutting).

## 2. Assemble the snapshot

Follow `~/.claude/rules-src/README.md` § "Building stack-rules": concatenate the
selected files (base → direction → cross-cutting), deduplicate overlapping sections,
write to `.claude/stack-rules.md` with the source-hash header that
`hooks/lib/stack-rules-check.mjs` verifies at session start.

## 3. Wire the project

Ensure the project `.claude/CLAUDE.md` contains `@stack-rules.md` (create if
missing). Run `node ~/.claude/hooks/lib/mark-initstack-done.mjs` to record
completion. Restart is NOT needed — stack-rules.md is plain context, not a plugin.
