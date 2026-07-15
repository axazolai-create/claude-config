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
