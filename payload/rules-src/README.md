# rules-src

Source rules, compiled into a per-project snapshot — `<project>/.claude/stack-rules.md`.
These files are NOT auto-loaded by Claude Code; that is why the directory is `rules-src`,
not `rules` — everything under `~/.claude/rules/` is loaded by Claude Code itself
(path-scoped via `paths:` frontmatter, unconditionally without it), and that mechanism has
no off switch. Delivery works by compilation instead:

- On session start, `hooks/session-init.mjs` only checks whether `.claude/stack-rules.md`
  exists; if not, it suggests running `/init-stack` (see "Building stack-rules" below - the
  command now owns generation). No automatic staleness/drift detection once a snapshot
  exists - re-run `/init-stack` or ask for a rebuild explicitly to refresh it. Simplified
  2026-07-13 from a `sourceHash`/`stackFingerprint` comparison (`hooks/lib/stack-rules-check.mjs`,
  still used by the compiler subagent to stamp the frontmatter, just no longer auto-compared)
  that fired a rebuild instruction every session on any drift. Opt out: `CLAUDE_STACK_RULES=0`.
- The snapshot enters context via an `@stack-rules.md` import line in the project's
  auto-loaded `.claude/CLAUDE.md`.
- Design/rationale: `docs/superpowers/specs/2026-07-12-stack-rules-design.md`.

## Rule layers (selection semantics)

- A **base** rule per language applies whenever that language is in the project's stack.
- A **direction** (framework) rule applies when its framework is detected; layers on the base.
- A **cross-cutting** rule (no language prefix) applies by concern, on top of language
  rules: `testing.md` and `security.md` always; `docker.md` / `ci.md` / `monorepo.md` /
  `api-contracts.md` / `mobile.md` when their signature files exist; `gsd.md` when
  `.planning/` exists.
- `paths:` frontmatter in each rule is selection METADATA (which files the rule targets),
  kept for the compiler and for readers — Claude Code does not read it here.
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
| `csharp.base.md` | all `*.cs`, `*.csproj`, `*.sln` |
| `csharp.aspnet.md` | `Controllers/**`, `Program.cs` (web), `appsettings*.json` |
| `csharp.cli.md` | console `Program.cs` (no ASP.NET/WPF signature) |
| `csharp.wpf.md` | `*.xaml`, `*.xaml.cs` |
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
| `testing.md` | cross-cutting: always included |
| `security.md` | cross-cutting: always included |
| `docker.md` | cross-cutting: `Dockerfile*`, `docker-compose*.yml`, `.dockerignore` |
| `ci.md` | cross-cutting: `.github/workflows/*.yml` |
| `api-contracts.md` | cross-cutting: `openapi.*`, `*.dto.ts`, `schemas.py`, `serializers.py` |
| `monorepo.md` | cross-cutting: `turbo.json`, `pnpm-workspace.yaml`, `nx.json` |
| `node.telegram.md` | `bot.ts`/`bot.js`, `telegraf.config.*` |
| `python.telegram.md` | `bot.py`, `handlers/**` |
| `gsd.md` | GSD projects: `.planning/` exists |

## Building stack-rules (compiler instructions)

Run this as a subagent when `/init-stack` finds `.claude/stack-rules.md` missing, when a
session-start note flags it missing, or when the user asks for a rebuild:

1. **Detect stacks** from signature files (same marker set as `stack-rules-check.mjs` and
   the quick-fallback table in `~/.claude/CLAUDE.md`). Multiple stacks are normal — a
   full-stack monorepo includes each part's rules.
2. **Select rules** by the layer semantics above.
3. **Compile into one document, deduplicated.** State shared guidance once (e.g.
   `mobile.md` and `kotlin.android.md` overlap on permissions/secrets); keep all version
   pins; copy every rule's "Avoid:" list VERBATIM — dedup may merge prose but must never
   drop an Avoid item. Write for an AI reader: terse, no narration, no history.
4. **Rewrite location-sensitive lines**: imports resolve relative to `.claude/`, so
   `@AGENTS.md` (from `node.next.md`) becomes `@../AGENTS.md` in the snapshot.
5. **Write `<project>/.claude/stack-rules.md`** with this frontmatter (hash values come
   from the session note, or from `node ~/.claude/hooks/lib/stack-rules-check.mjs <root>`):

```yaml
---
generated: stack-rules compiler   # machine-owned; edit rules-src and rebuild, not this file
sourceHash: <16-hex>
stackFingerprint: <16-hex>
stacks: [next, telegram-node]
generatedAt: <ISO timestamp>
---
```

6. **Ensure `<project>/.claude/CLAUDE.md` exists** and contains a line `@stack-rules.md`.
   Write the snapshot BEFORE adding the import — a dangling import target triggers an
   approval dialog.
7. **Root `CLAUDE.md`**: only when it exists AND is not `CURATED:NOEDIT`-marked, ensure a
   one-line pointer to `.claude/CLAUDE.md`. Never create a root `CLAUDE.md`; never edit a
   curated one (the deny hook blocks it anyway).
8. **Gitignore**: in a git repo, ensure `.claude/stack-rules.md` is listed in `.gitignore`
   (machine-generated personal config, not for the project's repo).
9. **Apply `templates/`** (see below).

## Adding a rule

1. Create `<lang>.<x>.md` for a language/framework direction, or `<topic>.md` for a
   cross-cutting concern — give it `paths:` frontmatter (selection metadata).
2. Keep it tight (~40 lines): concrete "use X / avoid Y", with versions where known.
3. State what to AVOID as well as what to use — contradictory rules are worse than none.
4. No extra deploy step beyond `setup.mjs`: the source hash changes, so every project
   rebuilds its snapshot on its next session start.

## templates/

Project-root scaffold files, applied during the build (step 9) — not rules, never compiled
into the snapshot:

- `next.AGENTS.md` -> copy to the project root as `AGENTS.md` when the Next stack is
  detected and no `AGENTS.md` exists (Next.js breaking-changes-vs-training-data note; the
  snapshot's `node.next.md` section imports it via `@../AGENTS.md`).

## Ambiguous stacks

React / Next / Nest all use `.ts`; detection relies on signature files (`nest-cli.json`,
`next.config.*`, `vite.config.*`, ...). If detection picks wrong for a repo, state the
stack explicitly in that project's `.claude/CLAUDE.md` (e.g. "stack: NestJS backend") and
rebuild — the compiler must honor an explicit statement over inference.
