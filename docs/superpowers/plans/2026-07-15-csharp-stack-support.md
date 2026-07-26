# C# Stack Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give C# the same first-class stack support every other language already has in this
repo — `rules-src` guidance, `setting-templates` plugin wiring, and `/init-stack` auto-detection
— covering ASP.NET Core, console/CLI, and WPF/WinForms desktop.

**Architecture:** Additive only, no existing behavior changes. Follows the exact
`<lang>.base.md` + `<lang>.<direction>.md` rule-layering pattern (Python/Kotlin/Swift/Dart), the
exact `setting-templates` vertical-inheritance pattern (`backend/python/`, `CLI/kotlin.json`),
and extends `bin/init-stack.py`'s `detect()`/`STACK_PATHS` the same way `node`/`python` bare
fallbacks and `django`/`fastapi` framework detection already work.

**Tech Stack:** Markdown (rules), JSON (setting-templates), Python 3 stdlib (`bin/init-stack.py`
+ `unittest` in `bin/test_init_stack.py`).

## Global Constraints

- Every file lives under `payload/` (the deployed source), never edited directly under
  `~/.claude/` — `payload/*` is what `setup.mjs` copies to `~/.claude/*`.
- Plugin id used everywhere: `csharp-lsp@claude-plugins-official` (verified present in
  `~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`).
- New stack ids: `csharp` (bare fallback), `aspnet`, `csharp-cli`, `wpf`.
- No VSIX/Visual-Studio-extension-authoring direction — out of scope (user confirmed).
- Each rules-src file: `paths:` frontmatter + concise body (~25-40 lines), ending with an
  `Avoid:` line, matching every existing rules-src file's shape.
- Run `python payload/bin/test_init_stack.py -v` after every task that touches
  `init-stack.py`/`test_init_stack.py`/`setting-templates/` — all tests must pass, none skipped.

---

### Task 1: rules-src — C# rule files + README table

**Files:**
- Create: `payload/rules-src/csharp.base.md`
- Create: `payload/rules-src/csharp.aspnet.md`
- Create: `payload/rules-src/csharp.cli.md`
- Create: `payload/rules-src/csharp.wpf.md`
- Modify: `payload/rules-src/README.md` (Current files table)

**Interfaces:**
- Consumes: nothing (pure content files, no code dependency on other tasks).
- Produces: four `.md` files whose exact filenames (`csharp.base.md`, `csharp.aspnet.md`,
  `csharp.cli.md`, `csharp.wpf.md`) Task 3's `stack-markers` update and any future
  stack-rules-compiler run will reference by name.

This task has no automated test — every other file in `rules-src/` is untested prose (verified
by content/convention, not `unittest`); this follows that existing convention exactly.

- [ ] **Step 1: Write `csharp.base.md`**

```markdown
---
paths:
  - "**/*.cs"
  - "**/*.csproj"
  - "**/*.sln"
---

# C# (base)
- Enable nullable reference types (`<Nullable>enable</Nullable>`) project-wide; treat
  nullable warnings as real signal, not noise.
- `async`/`await` all the way up the call stack; never `.Result`/`.Wait()` on a Task outside
  a synchronous entry point (deadlock risk on captured contexts).
- LINQ for transforms over manual loops, but materialize (`.ToList()`/`.ToArray()`) before
  reusing a query more than once - avoid re-enumerating `IEnumerable<T>` with side effects.
- Naming: PascalCase for types/public members, camelCase for locals/parameters, `_camelCase`
  for private fields (project convention permitting).
- Tooling: `dotnet format` + Roslyn analyzers (`TreatWarningsAsErrors` in CI) before commit.
  xUnit for new test suites unless the repo already uses NUnit/MSTest.
- Records (`record`/`record struct`) for immutable DTOs and value objects over classes with
  manual `Equals`/`GetHashCode`.
- Verify the repo's actual target framework in `.csproj` (`<TargetFramework>`) rather than
  assuming a version - don't invent APIs from a newer TFM than the project targets.
- Inject `TimeProvider` (or an `IClock`-style abstraction) instead of reading `DateTime.Now`/
  `DateTime.UtcNow` directly in business logic - keeps it testable.
- Avoid: `async void` outside event handlers, catching bare `Exception` instead of a specific
  type, public mutable fields, `Thread.Sleep` in anything but test/demo code.
```

- [ ] **Step 2: Write `csharp.aspnet.md`**

```markdown
---
paths:
  - "**/Controllers/**/*.cs"
  - "**/Program.cs"
  - "**/appsettings*.json"
---

# ASP.NET Core (direction)
- Pick one API style per project - Minimal APIs or MVC controllers - don't mix them for the
  same resource.
- Constructor dependency injection only; no service-locator (`IServiceProvider.GetService`)
  calls inside request-handling code.
- EF Core: migrations checked into source control (`dotnet ef migrations add`), never
  `Database.EnsureCreated()` on a production code path.
- `ProblemDetails` (`AddProblemDetails()`) for error responses; no raw exception messages
  leaking to clients.
- Config via `IOptions<T>`/`IOptionsSnapshot<T>` bound at startup, not raw `IConfiguration`
  reads scattered through handlers.
- Thin endpoints/controllers delegating to a service layer; validation via
  `FluentValidation` or data annotations, not inline `if` chains in the handler.
- Explicit status codes (`Results.Ok()`, `[ProducesResponseType]`) and typed responses.
- Avoid: business logic in controller actions or minimal-API lambdas, returning EF entities
  directly from an endpoint (map to a DTO/record), synchronous DB calls (`.ToList()` on an
  `IQueryable` instead of `.ToListAsync()`) inside async handlers.
```

- [ ] **Step 3: Write `csharp.cli.md`**

```markdown
---
paths:
  - "**/Program.cs"
---

# Console / CLI (direction)
- This applies to console-only `Program.cs` (no `Controllers/`, no `WebApplication`, no
  ASP.NET Core package references) - an ASP.NET `Program.cs` is covered by
  `csharp.aspnet.md` instead.
- Top-level statements are fine for small tools; extract into classes once the file grows
  past a simple entry point.
- Real argument parsing via `System.CommandLine` or `Spectre.Console.Cli` - not manual
  `args[0]`/`args[1]` indexing beyond a single flag or two.
- Exit codes via `Environment.ExitCode` set once at the end, not scattered
  `Environment.Exit()` calls mid-logic (those skip `finally` blocks and DI container
  disposal).
- Structured logging via `Microsoft.Extensions.Logging` for anything beyond a trivial
  script; reserve bare `Console.WriteLine` for the tool's actual user-facing output.
- Avoid: business logic entangled with argument-parsing code, swallowing exceptions to keep
  console output "clean" (log or rethrow, don't silently `catch {}`).
```

- [ ] **Step 4: Write `csharp.wpf.md`**

```markdown
---
paths:
  - "**/*.xaml"
  - "**/*.xaml.cs"
---

# WPF / WinForms (desktop direction)
- MVVM: views bind to view models implementing `INotifyPropertyChanged` (or
  `CommunityToolkit.Mvvm`'s `ObservableObject`/`[ObservableProperty]`) - no business logic
  in code-behind beyond wiring the view up.
- `ICommand`/`RelayCommand` for UI actions bound via `Command="{Binding ...}"`, not
  click-handler methods that call into services directly from code-behind.
- `{Binding}`/`x:Bind` for data flow over manual control manipulation
  (`myTextBox.Text = ...`) from code-behind.
- WinForms projects: same MVVM-adjacent discipline via a presenter/controller class per
  form - don't put data-access or business logic directly in a `Form` subclass.
- Dependency injection for services/view models (`Microsoft.Extensions.DependencyInjection`
  host, or a DI-aware MVVM toolkit) instead of `new`-ing services inside a view model's
  constructor.
- Avoid: code-behind reaching into other windows/views directly, static mutable UI state,
  long-running work on the UI thread (use `async`/`await` with `Task.Run` for CPU-bound
  work, keep I/O naturally async).
```

- [ ] **Step 5: Update `payload/rules-src/README.md`'s "Current files" table**

Find this exact block (the end of the Python group, right before the Kotlin group):

```markdown
| `python.cli.md` | cli.py, `__main__.py`, scripts |
| `kotlin.base.md` | `*.kt/kts`, gradle.kts |
```

Replace with:

```markdown
| `python.cli.md` | cli.py, `__main__.py`, scripts |
| `csharp.base.md` | all `*.cs`, `*.csproj`, `*.sln` |
| `csharp.aspnet.md` | `Controllers/**`, `Program.cs` (web), `appsettings*.json` |
| `csharp.cli.md` | console `Program.cs` (no ASP.NET/WPF signature) |
| `csharp.wpf.md` | `*.xaml`, `*.xaml.cs` |
| `kotlin.base.md` | `*.kt/kts`, gradle.kts |
```

- [ ] **Step 6: Verify frontmatter and line counts**

Run: `python3 -c "
import re
for f in ['csharp.base.md','csharp.aspnet.md','csharp.cli.md','csharp.wpf.md']:
    p = 'payload/rules-src/' + f
    text = open(p, encoding='utf-8').read()
    assert text.startswith('---\npaths:'), f + ' missing paths frontmatter'
    assert 'Avoid:' in text, f + ' missing Avoid line'
    print(f, len(text.splitlines()), 'lines - OK')
"`

Expected: all four files print `OK` with no `AssertionError`, each under ~40 lines.

- [ ] **Step 7: Commit**

```bash
git add payload/rules-src/csharp.base.md payload/rules-src/csharp.aspnet.md \
        payload/rules-src/csharp.cli.md payload/rules-src/csharp.wpf.md \
        payload/rules-src/README.md
git commit -m "feat: add C# rules-src (base + aspnet/cli/wpf directions)"
```

---

### Task 2: setting-templates — C# plugin wiring + gather() tests

**Files:**
- Create: `payload/setting-templates/backend/csharp/_base.json`
- Create: `payload/setting-templates/backend/csharp/aspnet.json`
- Create: `payload/setting-templates/CLI/_base.json`
- Create: `payload/setting-templates/CLI/csharp.json`
- Create: `payload/setting-templates/desktop/_base.json`
- Create: `payload/setting-templates/desktop/wpf.json`
- Modify: `payload/bin/init-stack.py` (`STACK_PATHS` dict only, no detection logic yet)
- Modify: `payload/bin/test_init_stack.py` (new tests in `RealTemplatesTests`)
- Modify: `payload/setting-templates/README.md` (tree diagram + stack-id list)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `STACK_PATHS` entries `"csharp"`, `"aspnet"`, `"csharp-cli"`, `"wpf"` mapping to the
  JSON paths above - Task 3's `detect()` additions append exactly these four stack-id strings
  to `found`, and rely on these `STACK_PATHS` entries existing to resolve.

This task is TDD: the new `gather()`-based tests are written first (they reference stack ids
that don't resolve yet), confirmed failing, then the JSON files + `STACK_PATHS` entries are
added to make them pass.

- [ ] **Step 1: Write the failing tests**

In `payload/bin/test_init_stack.py`, inside `class RealTemplatesTests`, add these methods
(anywhere after `test_kotlin_is_standalone`, before `test_python_bare_stack_reuses_backend_python_base`
is fine):

```python
    def test_aspnet_inherits_backend_csharp_base(self):
        entries, _ = init_stack.gather(["aspnet"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("csharp-lsp@claude-plugins-official", ids)  # backend/csharp/_base.json, vertical parent
        self.assertIn("context7@claude-plugins-official", ids)    # root _base universal

    def test_csharp_bare_stack_reuses_backend_csharp_base(self):
        entries, _ = init_stack.gather(["csharp"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("csharp-lsp@claude-plugins-official", ids)
        self.assertIn("context7@claude-plugins-official", ids)

    def test_csharp_cli_is_standalone(self):
        entries, _ = init_stack.gather(["csharp-cli"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("csharp-lsp@claude-plugins-official", ids)  # its own plugin
        self.assertIn("context7@claude-plugins-official", ids)    # root _base universal
        self.assertNotIn("typescript-lsp@claude-plugins-official", ids)
        self.assertNotIn("kotlin-lsp@claude-plugins-official", ids)

    def test_wpf_is_standalone(self):
        entries, _ = init_stack.gather(["wpf"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("csharp-lsp@claude-plugins-official", ids)
        self.assertIn("context7@claude-plugins-official", ids)
        self.assertNotIn("typescript-lsp@claude-plugins-official", ids)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python payload/bin/test_init_stack.py -v`
Expected: the 4 new tests FAIL (`KeyError`/`AssertionError` from `gather()` hitting
`state: "no_template"` for unknown stack ids `aspnet`/`csharp`/`csharp-cli`/`wpf`); all
pre-existing tests still PASS.

- [ ] **Step 3: Create `payload/setting-templates/backend/csharp/_base.json`**

```json
{
  "stack": "backend-csharp",
  "description": "C#/.NET backend language intelligence, shared regardless of framework.",
  "merge": {
    "enabledPlugins": {
      "csharp-lsp@claude-plugins-official": true
    }
  },
  "plugins": [
    {
      "id": "csharp-lsp@claude-plugins-official",
      "description": "C# language server for code intelligence.",
      "check": {
        "installed_file": "~/.claude/plugins/installed_plugins.json",
        "cmd": "claude plugin list",
        "bash": "jq -e '.plugins[\"csharp-lsp@claude-plugins-official\"]' ~/.claude/plugins/installed_plugins.json >/dev/null 2>&1 && echo INSTALLED || echo MISSING",
        "slash": "/plugin list"
      },
      "install": {
        "marketplace_add": {
          "cmd": "claude plugin marketplace add anthropics/claude-plugins-official",
          "slash": "/plugin marketplace add anthropics/claude-plugins-official"
        },
        "cmd": "claude plugin install csharp-lsp@claude-plugins-official --scope project",
        "bash": "claude plugin install csharp-lsp@claude-plugins-official --scope project",
        "slash": "/plugin install csharp-lsp@claude-plugins-official"
      }
    }
  ]
}
```

- [ ] **Step 4: Create `payload/setting-templates/backend/csharp/aspnet.json`**

```json
{
  "stack": "aspnet",
  "description": "ASP.NET Core web/API projects.",
  "merge": {},
  "plugins": []
}
```

- [ ] **Step 5: Create `payload/setting-templates/CLI/_base.json`**

```json
{
  "stack": "CLI",
  "description": "Cross-language CLI-application vertical base - no plugin shared between languages today (Kotlin and C# CLI tools use different LSPs).",
  "merge": {},
  "plugins": []
}
```

- [ ] **Step 6: Create `payload/setting-templates/CLI/csharp.json`**

```json
{
  "stack": "csharp-cli",
  "description": "Standalone C# console/CLI applications (no ASP.NET Core or WPF/WinForms signature) - not nested under backend/csharp since a CLI tool isn't a backend service.",
  "merge": {
    "enabledPlugins": {
      "csharp-lsp@claude-plugins-official": true
    }
  },
  "plugins": [
    {
      "id": "csharp-lsp@claude-plugins-official",
      "description": "C# language server for code intelligence.",
      "check": {
        "installed_file": "~/.claude/plugins/installed_plugins.json",
        "cmd": "claude plugin list",
        "bash": "jq -e '.plugins[\"csharp-lsp@claude-plugins-official\"]' ~/.claude/plugins/installed_plugins.json >/dev/null 2>&1 && echo INSTALLED || echo MISSING",
        "slash": "/plugin list"
      },
      "install": {
        "marketplace_add": {
          "cmd": "claude plugin marketplace add anthropics/claude-plugins-official",
          "slash": "/plugin marketplace add anthropics/claude-plugins-official"
        },
        "cmd": "claude plugin install csharp-lsp@claude-plugins-official --scope project",
        "bash": "claude plugin install csharp-lsp@claude-plugins-official --scope project",
        "slash": "/plugin install csharp-lsp@claude-plugins-official"
      }
    }
  ]
}
```

- [ ] **Step 7: Create `payload/setting-templates/desktop/_base.json`**

```json
{
  "stack": "desktop",
  "description": "Cross-framework desktop-application vertical base - no plugin shared across desktop frameworks today.",
  "merge": {},
  "plugins": []
}
```

- [ ] **Step 8: Create `payload/setting-templates/desktop/wpf.json`**

```json
{
  "stack": "wpf",
  "description": "WPF/WinForms desktop applications.",
  "merge": {
    "enabledPlugins": {
      "csharp-lsp@claude-plugins-official": true
    }
  },
  "plugins": [
    {
      "id": "csharp-lsp@claude-plugins-official",
      "description": "C# language server for code intelligence.",
      "check": {
        "installed_file": "~/.claude/plugins/installed_plugins.json",
        "cmd": "claude plugin list",
        "bash": "jq -e '.plugins[\"csharp-lsp@claude-plugins-official\"]' ~/.claude/plugins/installed_plugins.json >/dev/null 2>&1 && echo INSTALLED || echo MISSING",
        "slash": "/plugin list"
      },
      "install": {
        "marketplace_add": {
          "cmd": "claude plugin marketplace add anthropics/claude-plugins-official",
          "slash": "/plugin marketplace add anthropics/claude-plugins-official"
        },
        "cmd": "claude plugin install csharp-lsp@claude-plugins-official --scope project",
        "bash": "claude plugin install csharp-lsp@claude-plugins-official --scope project",
        "slash": "/plugin install csharp-lsp@claude-plugins-official"
      }
    }
  ]
}
```

- [ ] **Step 9: Add the four new entries to `STACK_PATHS` in `payload/bin/init-stack.py`**

Find:

```python
    "telegram-node": "bots/node.json",
    "telegram-python": "bots/python.json",
}
```

Replace with:

```python
    "telegram-node": "bots/node.json",
    "telegram-python": "bots/python.json",
    "csharp": "backend/csharp/_base.json",
    "aspnet": "backend/csharp/aspnet.json",
    "csharp-cli": "CLI/csharp.json",
    "wpf": "desktop/wpf.json",
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `python payload/bin/test_init_stack.py -v`
Expected: all tests PASS, including the 4 new ones and
`test_every_stack_path_resolves_to_a_real_file` (which iterates `STACK_PATHS` generically and
now also checks the 4 new paths resolve to real files).

- [ ] **Step 11: Update `payload/setting-templates/README.md`**

Find this exact block:

```markdown
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
```

Replace with:

```markdown
  backend/
    _base.json                 # empty - no plugin shared between node/python/csharp today
    node/
      _base.json                # typescript-lsp; also the "node" stack's own leaf (no framework)
      nest.json
    python/
      _base.json                 # pyright-lsp; also the "python" stack's own leaf (no framework)
      django.json
      fastapi.json
      flask.json
    csharp/
      _base.json                 # csharp-lsp; also the "csharp" stack's own leaf (no framework)
      aspnet.json
```

Find:

```markdown
  CLI/
    kotlin.json                 # the "kotlin" stack; no CLI/_base.json yet - add one if a
                                 # second CLI-oriented stack shows up later
```

Replace with:

```markdown
  CLI/
    _base.json                  # empty - no plugin shared between kotlin/csharp CLI tools today
    kotlin.json                  # the "kotlin" stack
    csharp.json                  # the "csharp-cli" stack
```

Find:

```markdown
  monorepo/
    _base.json
    turbo.json
    nx.json
```

Replace with:

```markdown
  monorepo/
    _base.json
    turbo.json
    nx.json
  desktop/
    _base.json                  # empty - no plugin shared across desktop frameworks today
    wpf.json                     # the "wpf" stack (WPF/WinForms)
```

Find:

```markdown
`/init-stack` detects the project's stack(s) (`react`, `next`, `react-native`, `nest`, `node`,
`django`, `fastapi`, `flask`, `python`, `android`, `swift`, `dart`, `kotlin`, `sql`, `turbo`, `nx`,
`telegram-node`, `telegram-python`), looks up each one's file via the `STACK_PATHS` table in
`bin/init-stack.py`,
```

Replace with:

```markdown
`/init-stack` detects the project's stack(s) (`react`, `next`, `react-native`, `nest`, `node`,
`django`, `fastapi`, `flask`, `python`, `android`, `swift`, `dart`, `kotlin`, `sql`, `turbo`, `nx`,
`telegram-node`, `telegram-python`, `csharp`, `aspnet`, `csharp-cli`, `wpf`), looks up each one's
file via the `STACK_PATHS` table in `bin/init-stack.py`,
```

- [ ] **Step 12: Commit**

```bash
git add payload/setting-templates/backend/csharp payload/setting-templates/CLI \
        payload/setting-templates/desktop payload/bin/init-stack.py \
        payload/bin/test_init_stack.py payload/setting-templates/README.md
git commit -m "feat: wire C# (aspnet/csharp-cli/wpf/bare) into setting-templates + STACK_PATHS"
```

---

### Task 3: `bin/init-stack.py` detection logic + stack-markers doc

**Files:**
- Modify: `payload/bin/init-stack.py` (`_csproj_text()` helper + `detect()` body)
- Modify: `payload/bin/test_init_stack.py` (new `DetectCSharpTests` class)
- Modify: `payload/skills/stack-markers/SKILL.md`

**Interfaces:**
- Consumes: the four `STACK_PATHS` entries from Task 2 (`csharp`, `aspnet`, `csharp-cli`,
  `wpf`) - `detect()`'s new branch appends exactly these four strings to `found`.
- Produces: `detect()` now returns `"aspnet"`/`"wpf"`/`"csharp-cli"`/`"csharp"` for real C#
  projects - nothing downstream of this task depends on it (it's the last task).

TDD: write the failing `detect()` tests first (they exercise heuristics that don't exist yet),
confirm they fail with `AssertionError` (not a crash - `detect()` already exists and returns a
list, just without C# entries), then add the heuristic.

- [ ] **Step 1: Write the failing tests**

In `payload/bin/test_init_stack.py`, add a new test class after `SyntheticFixtureTests` (before
the `if __name__ == "__main__":` line):

```python
class DetectCSharpTests(unittest.TestCase):
    """Exercise the .csproj-based C# detection heuristics in detect()."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        orig_root = init_stack.ROOT
        init_stack.ROOT = self.root
        self.addCleanup(lambda: setattr(init_stack, "ROOT", orig_root))

    def _write(self, rel_path, content):
        p = self.root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")

    def test_aspnet_detected_from_web_sdk(self):
        self._write("Api/Api.csproj",
                     '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup>'
                     '<TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>')
        found = init_stack.detect()
        self.assertIn("aspnet", found)
        self.assertNotIn("wpf", found)
        self.assertNotIn("csharp-cli", found)
        self.assertNotIn("csharp", found)

    def test_aspnet_detected_from_aspnetcore_package_reference(self):
        self._write("Api/Api.csproj",
                     '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup>'
                     '<PackageReference Include="Microsoft.AspNetCore.App" />'
                     '</ItemGroup></Project>')
        self.assertIn("aspnet", init_stack.detect())

    def test_wpf_detected_from_usewpf_flag(self):
        self._write("App/App.csproj",
                     '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                     '<UseWPF>true</UseWPF></PropertyGroup></Project>')
        found = init_stack.detect()
        self.assertIn("wpf", found)
        self.assertNotIn("aspnet", found)
        self.assertNotIn("csharp-cli", found)

    def test_wpf_detected_from_xaml_file_alone(self):
        self._write("App/MainWindow.xaml", "<Window/>")
        found = init_stack.detect()
        self.assertIn("wpf", found)
        self.assertNotIn("csharp", found)

    def test_csharp_cli_detected_from_exe_output_type(self):
        self._write("Tool/Tool.csproj",
                     '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                     '<OutputType>Exe</OutputType></PropertyGroup></Project>')
        found = init_stack.detect()
        self.assertIn("csharp-cli", found)
        self.assertNotIn("aspnet", found)
        self.assertNotIn("wpf", found)
        self.assertNotIn("csharp", found)

    def test_bare_csharp_fallback_for_plain_library(self):
        self._write("Lib/Lib.csproj",
                     '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                     '<TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>')
        found = init_stack.detect()
        self.assertIn("csharp", found)
        self.assertNotIn("aspnet", found)
        self.assertNotIn("wpf", found)
        self.assertNotIn("csharp-cli", found)

    def test_bare_csharp_fallback_when_cs_files_exist_without_csproj(self):
        self._write("Script.cs", "class Program {}")
        self.assertIn("csharp", init_stack.detect())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python payload/bin/test_init_stack.py -v`
Expected: all 7 new `DetectCSharpTests` FAIL (`AssertionError: 'aspnet' not found in []` etc.);
every pre-existing test (including Task 2's) still PASSES.

- [ ] **Step 3: Add `_csproj_text()` helper to `payload/bin/init-stack.py`**

Find:

```python
def _py_requirements() -> str:
    text = _read_text(ROOT / "pyproject.toml")
    for req in ROOT.glob("requirements*.txt"):
        text += "\n" + _read_text(req)
    return text.lower()
```

Replace with:

```python
def _py_requirements() -> str:
    text = _read_text(ROOT / "pyproject.toml")
    for req in ROOT.glob("requirements*.txt"):
        text += "\n" + _read_text(req)
    return text.lower()


def _csproj_text() -> str:
    text = ""
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in PRUNE]
        for fn in filenames:
            if fn.endswith(".csproj"):
                text += "\n" + _read_text(Path(dirpath) / fn)
    return text.lower()
```

- [ ] **Step 4: Add the C# detection branch to `detect()`**

Find:

```python
    if _glob_any("*.sql"):
        found.append("sql")
    seen: set[str] = set()
    return [s for s in found if not (s in seen or seen.add(s))]
```

Replace with:

```python
    cs = _csproj_text()
    has_xaml = _glob_any("*.xaml")
    if cs:
        if 'sdk="microsoft.net.sdk.web"' in cs or "microsoft.aspnetcore" in cs:
            found.append("aspnet")
        if "<usewpf>true" in cs or "<usewindowsforms>true" in cs or has_xaml:
            found.append("wpf")
        if "outputtype>exe" in cs and not any(s in found for s in ("aspnet", "wpf")):
            found.append("csharp-cli")
        if not any(s in found for s in ("aspnet", "wpf", "csharp-cli")):
            found.append("csharp")
    elif has_xaml or _glob_any("*.cs"):
        found.append("wpf" if has_xaml else "csharp")
    if _glob_any("*.sql"):
        found.append("sql")
    seen: set[str] = set()
    return [s for s in found if not (s in seen or seen.add(s))]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python payload/bin/test_init_stack.py -v`
Expected: all tests PASS (pre-existing + Task 2's 4 + this task's 7), zero failures, zero
errors.

- [ ] **Step 6: Update `payload/skills/stack-markers/SKILL.md`**

Find:

```markdown
metro.config.js / app.config.* -> React Native | turbo.json -> Turborepo monorepo |
nx.json -> Nx monorepo | bot.ts/bot.py + telegraf/grammy/aiogram/python-telegram-bot ->
Telegram bot
```

Replace with:

```markdown
metro.config.js / app.config.* -> React Native | turbo.json -> Turborepo monorepo |
nx.json -> Nx monorepo | bot.ts/bot.py + telegraf/grammy/aiogram/python-telegram-bot ->
Telegram bot | *.csproj (Sdk="...Web"/AspNetCore ref) -> ASP.NET Core | *.csproj
(OutputType=Exe) -> C# CLI | *.xaml / UseWPF/UseWindowsForms -> WPF/WinForms desktop |
*.csproj (no more specific signal) -> C# (bare)
```

- [ ] **Step 7: Full regression run**

Run: `python payload/bin/test_init_stack.py -v`
Expected: all tests still PASS (this step just re-confirms after the doc-only edit in Step 6,
which touches no code).

- [ ] **Step 8: Commit**

```bash
git add payload/bin/init-stack.py payload/bin/test_init_stack.py \
        payload/skills/stack-markers/SKILL.md
git commit -m "feat: detect ASP.NET Core/WPF/csharp-cli/bare C# from .csproj signals"
```

---

## Self-Review Notes (per writing-plans skill)

- **Spec coverage:** all 4 rule files (Task 1), all 6 setting-templates files + `STACK_PATHS` +
  README tree/list (Task 2), `.csproj` detection heuristic + `stack-markers` doc (Task 3) —
  every section of the 2026-07-15 design spec has a corresponding step above. No VSIX task
  (correctly out of scope per user confirmation).
- **No placeholders:** every step shows complete file content or an exact find/replace block;
  no "add appropriate X" phrasing.
- **Type/name consistency:** stack ids (`csharp`, `aspnet`, `csharp-cli`, `wpf`) and the plugin
  id (`csharp-lsp@claude-plugins-official`) are identical across the design spec, Task 2's
  JSON files, Task 2's `STACK_PATHS` entries, and Task 3's `detect()` branch and tests.
