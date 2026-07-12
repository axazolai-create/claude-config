---
name: stack-markers
description: File→stack detection markers (pyproject→Python, package.json→Node, vite→React, build.gradle.kts→Kotlin, …) that drive stack detection and the rules-rebuild fingerprint. Use when detecting a project's stack or explaining which marker maps to which stack/plugin set.
---

# Stack Detection Markers

Stack markers (drive detection and the rebuild fingerprint):

pyproject.toml -> Python | package.json -> Node/TS |
next.config.* -> Next | nest-cli.json -> Nest | vite.config.* -> React |
build.gradle.kts -> Kotlin | plugin.xml -> IntelliJ/Gateway plugin | *.sql -> SQL |
*.sh / *.ps1 -> shell | AndroidManifest.xml -> Android (Kotlin) |
*.xcodeproj/Info.plist -> iOS (Swift) | pubspec.yaml -> Flutter (Dart) |
metro.config.js / app.config.* -> React Native | turbo.json -> Turborepo monorepo |
nx.json -> Nx monorepo | bot.ts/bot.py + telegraf/grammy/aiogram/python-telegram-bot ->
Telegram bot
