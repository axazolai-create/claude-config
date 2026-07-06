---
paths:
  - "**/turbo.json"
  - "**/pnpm-workspace.yaml"
  - "**/nx.json"
---

# Monorepo (Turborepo / Nx / pnpm workspaces)
- Cross-package imports go through the package's published entry point (`package.json`
  `main`/`exports`), never deep paths into another package's `src/`.
- Shared config (tsconfig base, eslint, prettier) lives at the root and is extended, not
  duplicated, per package.
- Task graph reflects real dependencies (`dependsOn: ["^build"]`); don't hand-order tasks
  that the graph should express.
- Cache build/test outputs (Turborepo remote cache / Nx Cloud) keyed on real inputs — no
  cache poisoning from unlisted env vars affecting output.
- Version/publish strategy is explicit and consistent (fixed vs independent versioning) —
  don't mix ad hoc per-package tagging with a workspace-wide release tool.
- Avoid: circular deps between packages, a package reaching into another's internals,
  duplicated config drifting out of sync with the root.
