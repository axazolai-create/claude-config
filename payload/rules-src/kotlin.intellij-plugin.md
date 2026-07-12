---
paths:
  - "**/plugin.xml"
  - "**/*.form"
  - "**/META-INF/**/*.xml"
---

# IntelliJ / Gateway plugin (direction)
- Extensions/actions registered in `plugin.xml`; respect the platform's threading rules.
- Threading: never block the EDT — long work on a background thread / `Task.Backgroundable`;
  UI mutations on the EDT via invoke-later. Wrap PSI/VFS access in read/write actions.
- Gateway / remote-dev: keep host and client responsibilities separate; design RPC contracts
  explicitly and version them; assume the link can drop (timeouts, reconnect).
- Swing UI: build forms with platform components; keep layout logic out of business code.
- Dispose resources via `Disposable`; register listeners with a parent disposable.
- Avoid: EDT blocking, leaking disposables, tight coupling of Gateway host/client logic.
