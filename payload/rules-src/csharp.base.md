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
