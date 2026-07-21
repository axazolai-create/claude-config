---
paths:
  - "**/*.{test,spec}.{js,jsx,ts,tsx}"
  - "**/__tests__/**/*.{js,ts,jsx,tsx}"
  - "**/test_*.py"
  - "**/*_test.py"
  - "**/tests/**/*.py"
  - "**/*Test.kt"
  - "**/*Spec.kt"
---

# Testing (cross-cutting)

## Test-first vs test-after
- TDD is the default for code with real behavior: services, guards/pipes, business logic,
  API contracts. Write the test, watch it fail (RED), then write the code.
- Exceptions (covered by the e2e/integration test of the behavior they enable, not a
  dedicated unit test on themselves): pure wiring/config (DI providers/module registration,
  Dockerfile, docker-compose.yml), trivial DTO mappers, pure getters/passthroughs with no
  branching.

## Test density — "boundary trust"
- Test behavior actually reachable given real callers/guarantees, not the full domain of a
  signature. If a precondition is already enforced upstream (schema validation, an
  exhaustive type union, an earlier guard), don't re-test it downstream — test it once, at
  the boundary that enforces it.
- Cover: business-logic branches, reachable errors, security-relevant behavior, integration
  seams (real DB/cache — don't mock the unit under test).
- Skip: paths already unreachable per types/schema, trivial DTO mappers, pure
  getters/passthroughs.
- Optional, project's call: tag tests whose failure means a crash, data corruption, a
  security bypass, or a broken core workflow (e.g. `@critical`) so a CI gate can run just
  that tier fast while the full suite runs separately/non-blocking. The tag convention and
  CI wiring are project-specific — put those specifics in that project's own `CLAUDE.md`.

- Arrange-Act-Assert; one behavior per test, name it after the behavior, not the method
  (`returns 404 when user missing`, not `testGetUser2`).
- Test through the public interface; don't mock the unit under test itself, only its
  external dependencies (network, DB, clock, filesystem).
- Deterministic: no real sleep/network/wall-clock; inject/fake time, fake I/O boundaries.
- Prefer real objects/fixtures over mocks when cheap; mock only true external boundaries.
- Cover failure paths and edge cases, not just the happy path — a bug fix needs a
  regression test that fails before the fix and passes after.
- Snapshot tests are for stable rendering/serialization output, never for business-logic
  assertions — a snapshot that always auto-updates is not a test.
- Coverage % is a smell detector, not a goal — 100% coverage of untested behavior is worse
  than 80% covering the real edge cases.
- Test data via factories/builders, not copy-pasted literals across tests.
- Avoid: testing private/internal implementation details, over-mocking that ends up
  asserting the mock instead of the behavior, flaky tests tolerated with retries instead of
  fixed, one giant test asserting many unrelated things.

## Parallel test isolation — never share one mutable DB across workers
- Jest (and vitest / pytest-xdist) parallelize at the test-FILE level — one worker per file. If
  every worker hits the SAME database, workers race: one file's truncate/seed clobbers another's
  reads → flaky, order-dependent passes. This is the same failure class as any mutable resource
  shared across a parallel wave; retries only mask it (and are banned above). Isolate DB state PER
  WORKER, keyed off the worker index (Jest `JEST_WORKER_ID` = 1..N; vitest `VITEST_POOL_ID`;
  pytest-xdist `PYTEST_XDIST_WORKER`). Create the namespace once in global/setup, drop it in
  teardown:
  - **PostgreSQL** — schema-per-worker: give each worker its own schema and
    `SET search_path TO test_w${JEST_WORKER_ID}` on its connections; migrate each schema once.
    Cheaper than a database per worker, full isolation. (DB-per-worker also works, heavier.)
  - **MySQL / MariaDB** — database-per-worker (a MySQL "schema" IS a database):
    `test_${JEST_WORKER_ID}`, migrate each once, `USE` it per connection.
  - **SQLite** — file-per-worker (`./.tmp/test_${JEST_WORKER_ID}.db`) or an in-memory DB per
    worker; isolation is free — often the best fit for unit-level DB tests.
  - **MongoDB** — database-per-worker (`test_${JEST_WORKER_ID}`) or, if lighter, a per-worker
    collection prefix; drop the DB in teardown.
- Faster alternative WITHIN a worker: wrap each test in a transaction and ROLLBACK in `afterEach`
  (no residue, fast). Caveat: breaks if the code under test opens/commits its own transactions or
  the test asserts commit behavior, and the pool must pin a single connection for the test.
- Testcontainers — an ephemeral DB container keyed by the worker index gives the strongest
  isolation at higher cost; reach for it when a shared server can't be namespaced cleanly.
- Last resort only: serialize DB-touching suites (`--runInBand` / `maxWorkers=1`, or split them
  into a separate Jest project run serially while unit tests stay parallel). Sacrifices speed —
  prefer per-worker isolation first.
- Every per-worker DB/schema/file MUST be torn down (drop schema/DB, delete file), or CI
  accumulates orphaned namespaces run after run.
