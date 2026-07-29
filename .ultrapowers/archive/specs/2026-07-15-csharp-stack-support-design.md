# C# stack support (design)

Date: 2026-07-15
Status: approved (design confirmed 2026-07-15 — full integration, no cut-down alternative)

## Problem

C# has no representation anywhere in the stack system: no `rules-src` entry (so a C# project
gets no `stack-rules.md` guidance), no `setting-templates` entry (so `/init-stack` never offers
`csharp-lsp@claude-plugins-official`, which already exists in the official catalog), and no
detection signal in `bin/init-stack.py` or the `stack-markers` skill. Every other supported
language (Python, Kotlin, Node, Swift, Dart) has all three; C# is the gap.

Confirmed directions in scope: ASP.NET Core (backend/web API), console/CLI, WPF/WinForms
(desktop). No Visual Studio-specific direction (VSIX plugin dev) — user confirmed projects will
just be *worked on* inside Visual Studio, not IDE-extension projects themselves, so no extra
rule file for that.

## Decisions

| Axis | Choice |
| --- | --- |
| Rule layering | `csharp.base.md` (all `*.cs`/`*.csproj`/`*.sln`) + 3 direction files (`csharp.aspnet.md`, `csharp.cli.md`, `csharp.wpf.md`), same `<lang>.base` / `<lang>.<direction>` pattern as every other language |
| Desktop as new top-level template branch | `setting-templates/desktop/` (new — no existing vertical fits WPF/WinForms); mirrors `mobile/`, `backend/`, `frontend/` as a sibling direction |
| CLI placement | `setting-templates/CLI/csharp.json`, alongside the existing `CLI/kotlin.json` — CLI is already a cross-language vertical in this tree |
| ASP.NET placement | `setting-templates/backend/csharp/{_base.json,aspnet.json}`, mirroring `backend/python/{_base.json,django.json}` |
| LSP plugin | `csharp-lsp@claude-plugins-official` (verified present in the official marketplace catalog) — merged directly in `backend/csharp/_base.json`, `CLI/csharp.json`, and `desktop/wpf.json` (three separate branches, no shared cross-branch parent for it, same as `kotlin-lsp` being declared standalone in `CLI/kotlin.json`) |
| Detection | New `.csproj` content sniff in `bin/init-stack.py`, mirroring `_py_requirements()`; three specific signals (Web SDK/AspNetCore refs → `aspnet`; `<UseWPF>`/`.xaml` → `wpf`; plain console csproj → `csharp-cli`) plus a bare `csharp` fallback (same pattern as bare `node`/`python`) when a `.cs`/`.csproj` exists but nothing more specific matched |
| Stack IDs | `csharp` (bare fallback), `aspnet`, `csharp-cli`, `wpf` — added to `STACK_PATHS` |

## Rule content (rules-src/, ~40 lines each, base + AVOID list per file)

- **`csharp.base.md`** — paths: `**/*.cs`, `**/*.csproj`, `**/*.sln`. Nullable reference types
  enabled project-wide; `async`/`await` all the way up (no `.Result`/`.Wait()` blocking); LINQ
  over manual loops for transforms, but avoid multiple enumeration of the same query; PascalCase
  for public members/types, camelCase for locals/parameters; `dotnet format` + Roslyn analyzers
  before commit; xUnit (or NUnit, whichever the repo already uses) for tests; records for
  immutable DTOs; target current LTS (.NET 8 or newer — verify the repo's actual TFM in
  `.csproj` rather than assuming). Avoid: `async void` outside event handlers, catching bare
  `Exception`, public mutable fields, `DateTime.Now` in business logic (inject `TimeProvider`).
- **`csharp.aspnet.md`** — paths: `**/Controllers/**/*.cs`, `**/Program.cs`, `**/appsettings*.json`.
  Minimal APIs or controllers (pick one per project, don't mix); constructor DI, no service
  locator; EF Core migrations checked into source control, never `EnsureCreated()` in
  production paths; `ProblemDetails` for error responses; `IOptions<T>`/`IOptionsSnapshot<T>`
  for config, no raw `IConfiguration` reads in handlers; thin endpoints delegating to a service
  layer. Avoid: business logic in controllers/minimal-API lambdas, returning EF entities
  directly from endpoints, sync-over-async DB calls.
- **`csharp.cli.md`** — paths: `**/Program.cs` (console-only projects — see detection note
  below on how this differs from ASP.NET's `Program.cs`). Top-level statements for small tools;
  `System.CommandLine` (or `Spectre.Console.Cli`) for real argument parsing over manual
  `args[]` indexing; exit codes via `Environment.ExitCode`, not `Environment.Exit()` mid-logic;
  structured logging via `Microsoft.Extensions.Logging`, not bare `Console.WriteLine` in
  anything beyond a trivial script. Avoid: business logic entangled with argument-parsing code,
  swallowing exceptions to keep the console "clean".
- **`csharp.wpf.md`** — paths: `**/*.xaml`, `**/*.xaml.cs`. MVVM: views bind to view models via
  `INotifyPropertyChanged`/`ObservableObject` (CommunityToolkit.Mvvm), no business logic in
  code-behind; `ICommand`/`RelayCommand` for UI actions, not click-handler event methods calling
  into services directly; `x:Bind`/`{Binding}` over manual control manipulation from code-behind.
  Avoid: code-behind reaching into other views/windows directly, static mutable UI state.

## setting-templates additions

```
setting-templates/
  backend/
    csharp/
      _base.json     # merge: csharp-lsp@claude-plugins-official
      aspnet.json     # inherits backend/csharp/_base.json vertically; no extra plugin (like django.json)
  CLI/
    csharp.json      # own merge: csharp-lsp@claude-plugins-official (CLI is a separate branch, same as kotlin.json)
  desktop/            # NEW top-level direction
    _base.json        # empty leaf, like backend/_base.json — future desktop siblings inherit from here
    wpf.json           # own merge: csharp-lsp@claude-plugins-official
```

`backend/csharp/_base.json` doubles as the bare-`csharp`-fallback template (`STACK_PATHS["csharp"]`),
same convention as `"python": "backend/python/_base.json"`.

## Detection (`bin/init-stack.py`)

New helper `_csproj_text()` (mirrors `_py_requirements()`): concatenate all `*.csproj` file
contents (lowercased) found under the project root (respecting the existing `PRUNE` set).

```python
cs = _csproj_text()
if cs:
    if "sdk=\"microsoft.net.sdk.web\"" in cs or "microsoft.aspnetcore" in cs:
        found.append("aspnet")
    if "<usewpf>true" in cs or _glob_any("*.xaml"):
        found.append("wpf")
    if not any(s in found for s in ("aspnet", "wpf")) and (
            "outputtype>exe" in cs or "sdk=\"microsoft.net.sdk\"" in cs):
        found.append("csharp-cli")
    if not any(s in found for s in ("aspnet", "wpf", "csharp-cli")):
        found.append("csharp")   # bare fallback, mirrors node/python
elif _glob_any("*.cs"):
    found.append("csharp")       # .cs files with no .csproj in reach (rare, but don't miss it)
```

`STACK_PATHS` additions:
```python
"csharp": "backend/csharp/_base.json",
"aspnet": "backend/csharp/aspnet.json",
"csharp-cli": "CLI/csharp.json",
"wpf": "desktop/wpf.json",
```

Ordering note (same class of ambiguity as the existing react/react-native and
Flutter/Swift orderings, and equally acceptable): a WPF app referencing ASP.NET Core (e.g. for a
local Kestrel host) would tag both `aspnet` and `wpf` — both templates merge fine since they're
on different branches; no mutual exclusion needed, unlike react vs react-native which really are
mutually exclusive framework choices.

## Cross-reference updates required

- `rules-src/README.md` — "Current files" table: 4 new rows.
- `setting-templates/README.md` — tree diagram gets `backend/csharp/` and `desktop/`; the
  `/init-stack` detected-stack-id list line gets `csharp`, `aspnet`, `csharp-cli`, `wpf` added.
- `skills/stack-markers/SKILL.md` — one more marker pair: `*.csproj/*.sln -> C#/.NET | *.xaml -> WPF/desktop`.
- `payload/bin/test_init_stack.py` — extend `test_every_stack_path_resolves_to_a_real_file`
  coverage implicitly (it iterates `STACK_PATHS` already, no new test needed there); add
  targeted tests: `backend/csharp/aspnet.json` inherits `csharp-lsp` from its vertical parent;
  `CLI/csharp.json` and `desktop/wpf.json` are standalone (no cross-branch leak), same shape as
  `test_kotlin_is_standalone`.
- Repo `README.md` / `README.en.md` — if they list supported languages/stacks anywhere, add C#.

## Risks

None new — this follows an already-accepted pattern (RISK-STACKRULES-001/002 already cover
rules-compilation and snapshot-staleness risk generically for every language including this
one). The aspnet/wpf/csharp-cli detection heuristic carries the same low, already-accepted
false-classification risk as the existing react/react-native and Flutter/Swift orderings — not
logged as a new register entry.

## Verification plan

1. `python3 payload/bin/test_init_stack.py -v` — all existing tests plus new ones pass.
2. Manual: point `bin/init-stack.py` at a throwaway `.csproj` fixture for each of the three
   directions + a bare console app with no framework refs; confirm `detect()` returns the
   expected single stack id per fixture.
3. `rules-src/README.md` table and `setting-templates/README.md` tree stay accurate (read back
   after edits).
