---
paths:
  - "**/*.dart"
  - "**/pubspec.yaml"
---

# Dart (base)
- Dart 3+: sound null safety is non-negotiable — no `!` unless the value is genuinely
  guaranteed non-null right there; prefer `?.`, `??`, and pattern-matched destructuring.
- Use Dart 3 pattern matching / records / sealed classes for exhaustive state handling
  (a `switch` on a sealed class the compiler can prove is exhaustive beats a `default` case
  hiding a missed branch).
- Immutability by default: `const` constructors and `final` fields wherever the value
  doesn't need to change after construction — this also matters for widget rebuild
  performance in Flutter.
- Async: `Future`/`Stream` with `async`/`await`; an un-awaited `Future` that matters should be
  wrapped in `unawaited()` explicitly so it reads as an intentional fire-and-forget, not a
  missed `await`.
- Before pulling in a new dependency, check pub.dev for an existing, maintained package
  first — don't hand-roll what the ecosystem already solved well.
- Avoid: `dynamic` where the concrete type is known, silently un-awaited futures, deeply
  nested callback chains where `async`/`await` reads linearly.
