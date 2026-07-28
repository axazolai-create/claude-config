# Design: `/pnpm-phantom-fix` — auto-declare phantom deps via packageExtensions

Date: 2026-07-21
Status: Approved for planning
Scope: claude-config (dotfiles repo). Branch: `feat/pnpm-phantom-fix`.

## 1. Problem & goal

Moving pnpm's store out of the worktree (`enableGlobalVirtualStore` / a relocated
`virtual-store-dir`, for sharing across git worktrees) breaks **phantom dependencies**: a
package imports a bare module it does NOT declare in its own `package.json`
(dependencies / peerDependencies / optionalDependencies) and relies on Node walking up
`node_modules` to find it — e.g. `@hookform/resolvers`'s `/zod` subpath imports `zod`,
which 5.4.0 declares nowhere (only `react-hook-form` is a peer; it supports 14+ validators,
each via a subpath, and deliberately declares none). In-tree the store sat under the app's
`node_modules` so the upward walk reached the app's `zod`; out-of-tree it never does.

**Goal:** a skill `/pnpm-phantom-fix` that, after any pnpm install, detects such undeclared
imports and auto-writes `packageExtensions` entries in `pnpm-workspace.yaml` declaring the
missing dep as an **optional peer**, so pnpm links it by the dependency graph instead of a
fragile tree-walk. This makes `enableGlobalVirtualStore=true` safe to re-enable.

**Why `packageExtensions` (not a store/patch manifest edit):** `packageExtensions` is INPUT
to pnpm's resolution — pnpm merges it into the package's effective manifest before building
the isolated `node_modules` symlink farm, so it actually CREATES the `zod` symlink in the
resolver's private `node_modules`. Editing an already-installed manifest changes text but
not the built symlink graph, and is wiped on reinstall. Effect requires a follow-up
`pnpm install`.

## 2. The fix form (confirmed: optional peer)

Per offending package `P` and undeclared-but-present import `Q`:
```yaml
packageExtensions:
  "@hookform/resolvers":
    peerDependencies:
      zod: "*"
    peerDependenciesMeta:
      zod:
        optional: true
```
- `"*"` range: we only tell pnpm to link whatever `Q` the workspace already has; a narrow
  range risks an unmet-peer warning.
- Optional: a hard peer would emit "missing peer zod" for apps using yup/joi instead. Optional
  links `Q` when present, stays silent when absent — matches the multi-adapter design.

## 3. Components

### C1 — Detection script `payload/bin/pnpm-phantom-scan.mjs` (Node, stdlib only)
1. Resolve workspace root: walk up from cwd to the nearest `pnpm-workspace.yaml` (fallback: cwd).
2. Enumerate installed packages: iterate the real package copies in the pnpm virtual store
   (`**/node_modules/.pnpm/<name>@<ver>/node_modules/<name>/`) plus top-level workspace
   `node_modules` at every level (root + each workspace package). Cover nested/child
   `node_modules` trees, not just the root (monorepo/turbopack installs can touch children).
3. For each installed package `P` (with a `package.json`):
   - Declared set = `dependencies` ∪ `peerDependencies` ∪ `optionalDependencies` ∪
     `{P.name}` (self) ∪ `bundledDependencies`.
   - Scan P's published runtime files (`.js`/`.mjs`/`.cjs`/`.jsx`) — skip `node_modules`
     inside P, skip type-only — for bare specifiers in `import … from 'x'`,
     `require('x')`, `export … from 'x'`, and `import('x')` (string-literal only).
   - Reduce each specifier to its package name: `@scope/name/sub` → `@scope/name`,
     `name/sub` → `name`. Drop Node builtins (bare `fs`/`path`/… and any `node:` prefix),
     relative/absolute paths, and the self name.
   - Undeclared = imported package names not in P's declared set.
4. For each undeclared `Q`: keep it only if `Q` is actually installed/resolvable somewhere in
   the workspace (a real phantom currently resolving by luck — not a genuinely-absent adapter).
5. Emit, per `P`, an optional-peer `packageExtensions` entry for each surviving `Q`.
6. **Scope filter** (targeted installs): with `--packages a,b,c`, restrict `P` to those
   packages ∪ their transitive dependencies (cascade). Without it → full scan of all trees.
7. **Auto-write** into `pnpm-workspace.yaml` `packageExtensions`, strictly ADDITIVE: only add
   a missing `P→Q` optional peer; never modify or remove an existing entry. If the file has no
   `packageExtensions` key, create it. Preserve existing content/formatting.
8. Report to stdout: the entries added (or "no phantom deps found"); if any were added, print
   `→ run \`pnpm install\` again to apply the new peer links`.
9. NEVER removes entries — uninstall-safety is structural (the scan only adds).

### C2 — Claude PostToolUse hook `payload/hooks/pnpm-phantom-fix-hook.mjs`
- Matcher `Bash` (sibling of the existing `graphify-global-sync.mjs` PostToolUse hook).
- **Self-gates on pnpm (belt-and-suspenders):** no-ops unless the command's project has a
  `pnpm-lock.yaml`/`pnpm-workspace.yaml` AND the command is a pnpm install-family command.
- Fire ONLY for `pnpm install` / `pnpm i` / `pnpm add` (and `--filter`/workspace variants).
  Do NOT fire for `remove`/`uninstall`/`rm`, nor `dlx`/`exec`/`run`/`test`/etc.
- Scope: no package args (bare `install`/`i`) → full scan; `add <pkgs>` or `i <pkgs>` →
  `--packages <pkgs>`.
- Run the scan in the command's cwd; surface its report as non-blocking `additionalContext`.
- Fail-open (any error → silent, never blocks the tool). Only covers Claude-invoked pnpm.
- **NOT globally registered.** It is wired into the PROJECT's `.claude/settings.json` by
  `/init-stack` only when pnpm is detected (see C6). The self-gate is a safety net for the
  case where it is ever registered more broadly.

### C3 — pnpm-native trigger (covers the user's own terminal)
A root `package.json` `postinstall` hook that runs `pnpm-phantom-scan.mjs` — so it fires on
ANY `pnpm install` in that project, not only Claude-invoked ones. Installed into the target
project by `/init-stack` on pnpm detection (C6), consent-gated (modifies the target project);
also installable via the `/pnpm-phantom-fix` command. **Documented coverage gap:** a
`pnpm add` run from *inside a sub-package* (not the root) may not trigger the root
`postinstall`; those are caught by the Claude hook (when run via Claude) or a manual
`/pnpm-phantom-fix`. The scan always sweeps all workspace `node_modules` trees, so a later
root install reconciles everything.

### C4 — Command `payload/commands/pnpm-phantom-fix.md`
`/pnpm-phantom-fix`: run the full scan on the current workspace (report + additive
auto-write), then offer to install the C3 native trigger. Frontmatter: `description`,
`allowed-tools: Bash(node *), Read, Edit`. Always deployed by setup (a command's availability
is inert until invoked); it works on any pnpm project on demand.

### C5 — Deployment model (setup) vs conditional wiring (init-stack)
- **setup.mjs deploys the FILES** (scan script, hook, command) into `~/.claude` as part of the
  normal `payload/` copy — always, but inert until wired/invoked. setup does NOT globally
  enable the hook.
- **`settings.partial.json` is NOT changed** — the hook is never globally registered.
- The activation is per-project and pnpm-gated, done by init-stack (C6).

### C3+C6 shared installer `payload/bin/pnpm-phantom-fix-install.mjs`
To keep wiring deterministic and idempotent, a single installer does both jobs, gated on
pnpm detection. `node pnpm-phantom-fix-install.mjs <projectRoot>`:
- If neither `pnpm-lock.yaml` nor `pnpm-workspace.yaml` exists at/above `<projectRoot>` → print
  "not a pnpm project, skipping" and exit 0 (no changes).
- Else: (1) add the C2 PostToolUse `Bash` hook to `<projectRoot>/.claude/settings.json`
  (additive; skip if already present), and (2) add a root `postinstall` line to
  `<projectRoot>/package.json` running the scan (append to an existing `postinstall` with
  `&&` if one exists, without duplicating). Idempotent, English output of what it did.
Called by both `/init-stack` (C6) and the `/pnpm-phantom-fix` command (C4).

### C6 — Conditional wiring in `/init-stack` (only if the project uses pnpm)
`init-stack` detects pnpm via `pnpm-lock.yaml`/`pnpm-workspace.yaml` at/above the project
root. **Only when pnpm is present**, and with consent, it:
1. wires the C2 PostToolUse `Bash` hook into the project's `.claude/settings.json` (additive,
   same shape as its existing hook entries), and
2. installs the C3 native `postinstall` trigger into the project's root `package.json`.
For a non-pnpm project it does nothing (no hook, no trigger). Re-runnable/idempotent: it does
not duplicate an already-present hook entry or postinstall line. This is the sole place the
skill/hooks get "added," satisfying "added at setup|init-stack, only if the project uses
pnpm."

## 4. Data flow
```
pnpm install ──▶ (native postinstall  OR  Claude PostToolUse hook) ──▶ pnpm-phantom-scan.mjs
   scans all node_modules trees → finds undeclared-but-present imports (P imports Q)
   → adds optional-peer packageExtensions[P][Q] to pnpm-workspace.yaml (additive)
   → reports "run pnpm install to apply"
next pnpm install ──▶ pnpm links Q into P's isolated node_modules ──▶ phantom resolved
```

## 5. How to verify quality
- Unit: specifier→package reduction (`@a/b/c`→`@a/b`, `x/y`→`x`, `node:fs`/`fs`→dropped);
  declared-set filtering; additive YAML merge (existing entries untouched, new added, no dup).
- Fixture: a temp `node_modules` with a package importing an undeclared-but-installed `Q` →
  scan emits exactly the optional-peer entry; a package importing an undeclared-but-ABSENT
  `Q` → no entry.
- Idempotency: re-run adds nothing new.
- Uninstall-safety: entries are never removed (no removal code path exists).
- Real check: `@hookform/resolvers` importing `zod` (both installed) → correct entry.

## 6. Risks (RISK_REGISTER.md)
- RISK-PNPM-001 — false positives from dynamic/conditional requires or optional adapters →
  mitigated by the "Q must be installed in the workspace" gate + optional-peer (harmless if
  unused); still possible for exotic dynamic imports. Additive-only means a stray entry is
  inert, not destructive.
- RISK-PNPM-002 — native-trigger coverage gap for sub-package installs in the user's own
  terminal (see C3) → Claude hook + manual command backstop.
- RISK-PNPM-003 — auto-writing `pnpm-workspace.yaml` could disturb formatting/comments →
  minimal, additive YAML edit; never touches existing keys.

## 7. Out of scope
- Fixing the phantom by `pnpm patch` or `.pnpmfile.cjs readPackage` (both work but the user
  chose `packageExtensions` in `pnpm-workspace.yaml`).
- Auto-running `pnpm install` after writing (recursive from a postinstall); we report instead.
- Removing/pruning packageExtensions on uninstall (explicitly additive-only).
