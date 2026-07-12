---
paths:
  - "**/nest-cli.json"
  - "**/*.{module,controller,service,guard,interceptor,pipe,dto,entity}.ts"
  - "**/main.ts"
---

# NestJS (direction)
- Layering: Controller (HTTP only) -> Service (business logic) -> Repository/data.
  No business logic in controllers, no DB access in controllers.
- DI via providers/modules. Constructor injection; no manual `new` for services.
- DTOs + class-validator (or zod) at every boundary; enable a global ValidationPipe.
- Config via `@nestjs/config`; never read `process.env` directly in services.
- Errors: throw Nest `HttpException` subclasses; centralize with an exception filter.
- DB: migrations are explicit and reviewed (TypeORM/Prisma) — no auto-sync in prod.
- Tests: unit-test services with mocked deps; e2e for controller contracts.
- Avoid: circular module deps, fat services (split by responsibility), logic in guards.
