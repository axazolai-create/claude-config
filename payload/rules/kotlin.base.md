---
paths:
  - "**/*.{kt,kts}"
  - "**/build.gradle.kts"
  - "**/settings.gradle.kts"
---

# Kotlin (base)
- Target a current JVM LTS (25 current, 21 previous — still broadly supported). Prefer
  immutability: `val` over `var`, data classes.
- Null-safety: no `!!` in production paths; use `?.`, `?:`, `requireNotNull(x) { "..." }`.
- Idioms: `when` over long if-chains, sealed classes for closed hierarchies, extension
  functions over util classes.
- Coroutines for async; structured concurrency (scopes), never `GlobalScope`.
- Gradle Kotlin DSL; version catalogs (`libs.versions.toml`) for deps, not scattered version
  strings across modules. Pin the wrapper (`gradle/wrapper/gradle-wrapper.properties`) —
  never rely on whatever Gradle happens to be on PATH; `./gradlew`/`gradlew.bat`, not a bare
  `gradle` invocation.
- Avoid: `lateinit` where a constructor value works, leaking Java platform types,
  blocking calls inside coroutines, a bare `gradle` command instead of the wrapper.
