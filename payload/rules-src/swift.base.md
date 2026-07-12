---
paths:
  - "**/*.swift"
  - "**/Package.swift"
---

# Swift (base)
- Swift 6 language mode: strict concurrency is compiler-enforced, not a lint suggestion —
  types crossing an `await`/actor boundary must be `Sendable`; treat a concurrency error as
  a real data race, not friction to silence.
- Value types by default: `struct`/`enum` over `class` unless you need reference semantics
  (shared mutable identity, inheritance).
- No force-unwrap (`!`) or force-cast (`as!`) in production paths — `guard let`/`if let`,
  `??`, or `try?` with an explicit fallback.
- Errors are typed: `throws` + a concrete `Error` enum, not sentinel values (`nil`/`-1`) or
  stringly-typed failures.
- Concurrency: `async`/`await` and actors; `@MainActor` on anything touching UI state. No new
  completion-handler APIs — wrap legacy callback APIs at the boundary, don't propagate them.
- Protocol-oriented: prefer small protocols + extensions over deep class hierarchies;
  `some`/`any` explicitly where existential vs. opaque type matters.
- Avoid: force-unwraps/force-casts, unstructured `Task { }` fire-and-forget where a
  structured parent task exists, stringly-typed APIs where an enum fits, disabling strict
  concurrency checking project-wide to silence warnings instead of fixing the isolation.
