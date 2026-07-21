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
- Git worktrees + dependency store: sharing one store across worktrees (pnpm
  `enableGlobalVirtualStore` / a relocated `virtual-store-dir` outside the worktree) avoids
  reinstalling per worktree, but it is OPT-IN for genuine parallel-worktree work, not a default.
  Moving the store out of the project tree breaks phantom-dependency resolution: a package that
  imports an UNDECLARED dep (in neither its `dependencies` nor `peerDependencies`) and relies on
  Node walking up `node_modules` to find it (e.g. `@hookform/resolvers`'s `/zod` subpath)
  resolved only because the in-tree store happened to sit under the app's `node_modules`; an
  out-of-tree store is never reached by that upward walk. A bundler root (Turbopack's `root`)
  does NOT fix this — it governs what the bundler may READ, not how Node resolves modules. Fix
  the offending package with `pnpm patch` to declare the missing dep as an OPTIONAL peer
  (`peerDependencies` + `peerDependenciesMeta.<dep>.optional: true`) so pnpm links it by the
  graph; or keep the local per-project store when you don't run parallel worktrees.
- Declare every imported package in `package.json` — never rely on phantom/hoisted deps that
  pnpm's strict isolation will (correctly) fail to resolve. For a third-party package that
  imports an undeclared dep, `pnpm patch` in the missing (optional) peer rather than loosening
  hoisting (`shamefully-hoist`/`public-hoist-pattern`), which papers over the graph.
- Avoid: circular deps between packages, a package reaching into another's internals,
  duplicated config drifting out of sync with the root.
