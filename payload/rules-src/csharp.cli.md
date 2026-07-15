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
