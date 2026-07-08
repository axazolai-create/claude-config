---
paths:
  - "**/routers/**/*.py"
  - "**/api/**/*.py"
  - "**/schemas.py"
  - "**/dependencies.py"
---

# FastAPI (direction)
> Path-scoping for FastAPI is weak — if it doesn't trigger, import it in the project
> CLAUDE.md: `@~/.claude/rules/python.fastapi.md`
- Pydantic v2 models for every request/response; never return raw ORM objects.
- Dependency injection via `Depends`; put auth, db sessions, config there.
- Async endpoints with async DB drivers; don't block the event loop with sync I/O.
- Routers split by domain; thin endpoints delegating to a service layer.
- Explicit status codes and error models; central exception handlers.
- Settings via pydantic-settings; no `os.environ` reads in handlers.
- Avoid: business logic in path functions, sync DB calls in async routes, returning ORM rows.
