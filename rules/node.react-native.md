---
paths:
  - "**/metro.config.js"
  - "**/app.config.{js,ts}"
  - "**/*.native.{ts,tsx,js,jsx}"
---

# React Native (direction)
- New Architecture (Fabric + TurboModules) is mandatory as of RN 0.83 / Expo SDK 55 — the
  Legacy Architecture has been removed. There is no "opt out" path to reach for anymore.
- Hermes is the default JS engine on both platforms; only switch to JSC for a specific,
  documented compatibility reason, never as a default choice.
- Expo managed workflow is the default starting point. Eject to bare workflow only when a
  required native module genuinely has no Expo config plugin — check the Expo/pub-equivalent
  ecosystem before writing custom native code.
- Platform-specific code via `Platform.OS` checks or `.ios.tsx`/`.android.tsx` file-suffix
  splitting, not runtime environment sniffing.
- Navigation: React Navigation or Expo Router (file-based) — avoid hand-bridging native
  navigation.
- Native modules: check for an existing Expo config plugin or community module first; a
  custom native module means maintaining Swift/Kotlin code per platform going forward.
- The `ios/` and `android/` native folders (if the project is ejected/bare) follow
  `swift.ios.md`/`kotlin.android.md` respectively, not this file — and the iOS side still
  needs Xcode on macOS to build/sign regardless of your primary editor.
- React rules (`node.react.md`) also apply — same component/hooks discipline as web React.
- Avoid: disabling the New Architecture, ejecting from Expo without a hard native-module
  requirement, switching to JSC without a documented reason.
