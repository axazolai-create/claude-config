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
