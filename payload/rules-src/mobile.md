---
paths:
  - "**/AndroidManifest.xml"
  - "**/Info.plist"
  - "**/*.xcodeproj/**"
  - "**/pubspec.yaml"
  - "**/app.config.{js,ts}"
  - "**/metro.config.js"
---

# Mobile (cross-cutting)
Applies regardless of stack (native Android/iOS, Flutter, React Native) — layers on top of
whichever language/direction rule also matched.

- Store review is a gate, not a formality: before implementing anything touching payments,
  background location, health data, or account deletion, check the current App Store Review
  Guidelines / Google Play policy section for that feature — a policy violation blocks the
  release, a code bug just delays it.
- Permissions: request at the point of use with a visible rationale, never in a blanket
  launch-time batch. Handle "denied" and "denied forever"/restricted as distinct states —
  a permission prompt is not a boolean gate for the whole feature; the feature should
  degrade, not crash or silently no-op.
- Secrets/credentials: platform Keychain (iOS) or Keystore/EncryptedSharedPreferences
  (Android) — never plaintext `UserDefaults`/`SharedPreferences`/AsyncStorage for tokens.
- Push notifications: request permission with context (not on first launch before the user
  has a reason to say yes); handle token refresh; treat delivery as best-effort — the app
  must still work if a push never arrives.
- Offline-first by default: assume the network is unreliable — cache reads, queue writes,
  show explicit stale/syncing state. Never block the UI on a network call with no timeout.
- Versioning: the store-facing version string and the internal build number are separate —
  bump both deliberately and document what changed; don't let CI silently auto-increment
  without a record of why.
- Signing: never commit signing keys, keystores, `.p12`/`.mobileprovision` files, or
  `google-services.json`/`GoogleService-Info.plist` with real credentials to the repo.
  Document the actual signing/release process (fastlane, EAS Build, manual Xcode/Play
  Console) in the project's own `CLAUDE.md` — it's project-specific, not assumed here.
- Accessibility: label interactive elements (`accessibilityLabel`/`contentDescription`),
  respect Dynamic Type / font-scale settings, never convey state (error, success, disabled)
  through color alone.
- Avoid: requesting permissions before the user has context, storing tokens in plaintext,
  bumping version/build numbers without a record of why, shipping a feature without
  checking the relevant store's current review guidelines for it.
