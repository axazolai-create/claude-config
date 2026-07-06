---
paths:
  - "**/*.xcodeproj/**"
  - "**/*.xcworkspace/**"
  - "**/Info.plist"
  - "**/*App.swift"
---

# iOS (direction)
- SwiftUI-first for new UI. Reach for UIKit only where SwiftUI genuinely can't (custom
  scroll/animation behavior, or a minimum-OS target below SwiftUI's floor for the feature) —
  wrap it with `UIViewRepresentable`/`UIViewControllerRepresentable`, don't rewrite the
  screen in UIKit wholesale.
- State: `@Observable` (Observation framework) for view models in new code, not
  `ObservableObject` + `@Published` — less boilerplate, more granular re-renders.
- Persistence: SwiftData for new projects; Core Data only where an existing store/migration
  path already depends on it.
- Navigation: `NavigationStack`, not the deprecated `NavigationView`.
- Dependencies: Swift Package Manager first; CocoaPods only for a third-party lib with no
  SPM support.
- App entry: SwiftUI `App` protocol (`@main struct ... : App`); keep `AppDelegate` only for
  the hooks that still require it (push notifications, some background tasks).
- Secrets/tokens: Keychain, never `UserDefaults` or hardcoded in the bundle.
- **Building this app still requires Xcode on macOS regardless of your primary editor** —
  Android Studio (or any other IDE) cannot compile, sign, or run the iOS target. If daily
  editing happens elsewhere, iOS builds/archiving/TestFlight uploads still go through Xcode
  (or `xcodebuild`/fastlane driving the same toolchain).
- Swift rules (`swift.base.md`) also apply.
- Avoid: `NavigationView`, `ObservableObject`/`@Published` in new code, force-unwraps,
  assuming a non-Xcode IDE can produce a signed/archived build.
