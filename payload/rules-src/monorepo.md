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
- Git worktrees + dependency store: keep pnpm's default per-project store — do NOT share/relocate
  it out of the worktree (`enableGlobalVirtualStore` / a moved `virtual-store-dir`). It looks like
  it saves per-worktree reinstalls, but an out-of-tree store breaks phantom-dependency resolution:
  a package importing an UNDECLARED dep it finds via Node's upward `node_modules` walk (e.g.
  `@hookform/resolvers`'s `/zod` subpath) stops resolving, and a bundler root (Turbopack's `root`)
  does NOT fix it — that governs bundler reads, not Node module resolution.
- Declare every imported package in `package.json` — never rely on phantom/hoisted deps that
  pnpm's strict isolation will (correctly) fail to resolve. For a third-party package that
  imports an undeclared dep, `pnpm patch` in the missing (optional) peer rather than loosening
  hoisting (`shamefully-hoist`/`public-hoist-pattern`), which papers over the graph.
- Avoid: circular deps between packages, a package reaching into another's internals,
  duplicated config drifting out of sync with the root.
