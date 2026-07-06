---
paths:
  - "**/lib/main.dart"
  - "**/ios/Runner/**"
  - "**/android/app/**"
---

# Flutter (direction)
- State management: Riverpod (2.x+, `@riverpod` code generation) is the default for new
  projects — compile-safe, no `BuildContext` dependency, testable via provider overrides.
  Bloc is the right call for large teams or regulated domains that need a strict
  event-driven audit trail. Don't introduce `Provider` in new code; if the project already
  uses it, don't churn a working screen just to migrate it mid-feature.
- Widget tree: small, composed widgets over deep nesting; `const` constructors everywhere
  the tree allows it (see `dart.base.md`) — this is what makes Flutter's rebuild skip work.
- Platform channels are a last resort — check pub.dev for an existing plugin/Expo-equivalent
  before writing custom platform-channel glue code.
- Navigation: a declarative router (`go_router` or equivalent) for anything with
  deep-linking; avoid ad-hoc `Navigator.push` chains once the app has more than a couple of
  screens.
- The `ios/` and `android/` folders are native projects, not Dart — code there follows
  `swift.ios.md`/`kotlin.android.md`, not this file.
- Building/signing the iOS target still requires Xcode on macOS no matter which IDE you
  write Dart in (Android Studio's Flutter plugin covers editing, hot reload, and DevTools
  for both platforms, but not iOS compilation/signing).
- Dart rules (`dart.base.md`) also apply.
- Avoid: `setState`-only state management past a trivial screen, introducing `Provider` in
  new code, hand-written platform channels when a maintained plugin already exists.
