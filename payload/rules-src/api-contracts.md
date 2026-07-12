---
paths:
  - "**/openapi.{yml,yaml,json}"
  - "**/swagger.{yml,yaml,json}"
  - "**/*.dto.ts"
  - "**/schemas.py"
  - "**/serializers.py"
---

# API contracts (cross-cutting REST)
- Version the API surface (`/v1/...` or a header) before the first external consumer;
  breaking changes get a new version, not a mutated one.
- One error envelope shape across all endpoints (`{ code, message, details? }` or
  equivalent) — never a bare string or an ad-hoc shape per route.
- Explicit status codes: 2xx only on success, 4xx for client error, 5xx for server error;
  never return 200 with an error body.
- Pagination on any collection endpoint that can grow unbounded — cursor-based for large/
  changing datasets, offset only for small stable ones.
- Idempotency keys on retryable mutations (payments, order creation) — a client retry must
  not double-create.
- Validate request/response against the schema at the boundary — reject early, don't let
  invalid data reach business logic.
- Document nullable vs optional explicitly; don't conflate "absent" and "null".
- Avoid: leaking internal/ORM field names verbatim, silently ignoring unknown fields when
  strict validation is intended, breaking changes without a version bump.
