---
paths:
  - "**/AndroidManifest.xml"
  - "**/src/main/res/**"
  - "**/src/androidTest/**"
---

# Android (direction)
- Jetpack Compose for all new UI. XML layouts (`res/layout/*.xml`) are legacy-maintenance
  only — don't add new screens with them.
- Architecture: ViewModel + `StateFlow` + a sealed `UiState` hierarchy per screen; the
  ViewModel stays unit-testable without Compose in the loop.
- DI: Hilt — `hiltViewModel()` scoped to the nav destination, not a manual service locator
  or a Fragment-lifetime-scoped instance.
- Async: coroutines + `Flow`; launch work in `viewModelScope`/`lifecycleScope`, never
  `GlobalScope`.
- Persistence: Room for local storage; migrations checked in, never dropped-and-recreated
  against a shipped schema.
- Navigation: Compose Navigation with type-safe routes, not string-based destinations passed
  by hand.
- Permissions: request at the point of use with a rationale, not in a blanket launch-time
  batch; handle "denied" and "denied forever" (don't-ask-again) as distinct states.
- Secrets/tokens: EncryptedSharedPreferences or the Android Keystore, never plain
  `SharedPreferences`. Never log PII or tokens (Logcat is not private).
- Android Studio conventions: standard module layout (`app/src/main/...`), Gradle Kotlin DSL
  with version catalogs, Logcat for runtime debugging, Gradle sync after any
  dependency/version-catalog change before assuming a build error is real code.
- Gradle at Android scale: enable configuration cache and build cache
  (`gradle.properties`: `org.gradle.configuration-cache=true`,
  `org.gradle.caching=true`) — a multi-module app rebuilds every module on every clean
  build otherwise. For 3+ feature modules, share build config through a `build-logic`
  convention plugin (`buildSrc` or an included build), not copy-pasted `build.gradle.kts`
  blocks per module. Check `./gradlew :app:dependencies` before adding a duplicate/conflicting
  transitive dependency rather than guessing at version alignment.
- Kotlin rules (`kotlin.base.md`) also apply.
- Avoid: new XML layouts, `GlobalScope`, hand-rolled DI, plaintext token storage, requesting
  every permission at app launch, duplicated per-module Gradle config instead of a
  convention plugin.
