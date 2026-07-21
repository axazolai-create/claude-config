---
description: Detect pnpm phantom dependencies (undeclared-but-imported, e.g. @hookform/resolvers→zod) and additively declare them as optional peers in packageExtensions, so an out-of-tree store (enableGlobalVirtualStore) resolves them.
allowed-tools: Bash(node *), Bash(pnpm *), Read, Edit, Write
---

# /pnpm-phantom-fix

Detect and fix **pnpm phantom dependencies** — packages that import a module they never
declared but that happens to be installed (e.g. `@hookform/resolvers` imports `zod` while
listing it only under `devDependencies`). With the default hoisted store these resolve by
luck; with an out-of-tree store (`enableGlobalVirtualStore=true`) they break. The fix is to
additively declare each phantom as an **optional peer** in `packageExtensions`, so pnpm links
it by the dependency graph instead of by hoisting.

Follow these steps:

1. **Confirm this is a pnpm project.** Check for a `pnpm-lock.yaml` or `pnpm-workspace.yaml`
   at or above the project root. If neither exists, stop and tell me this is not a pnpm
   project — nothing to do.

2. **Scan.** Run:

   ```
   node ~/.claude/bin/pnpm-phantom-scan.mjs --root <project root>
   ```

   Show me its full report. The scan is additive-only and fail-safe: it never removes or
   rewrites existing `packageExtensions` entries, and if `pnpm-workspace.yaml` uses a shape it
   cannot safely edit, it prints the entries for manual addition instead of writing.

3. **Apply.** If entries were added, remind me to run `pnpm install` again so pnpm applies the
   new optional-peer links.

4. **Offer the always-on trigger (consent-gated).** Ask whether I want the guard wired into
   this project so it runs automatically after future installs:

   ```
   node ~/.claude/bin/pnpm-phantom-fix-install.mjs <project root>
   ```

   This adds a PostToolUse hook (runs after Claude-invoked `pnpm install`/`add`) and a root
   `postinstall` (covers my own terminal). Both are idempotent and additive. Only run it if I
   agree.

5. **Coverage caveat.** Note that the automatic trigger fires on top-level installs. An
   install run **inside a sub-package** in my own terminal may not trigger the hook; re-run
   this command manually if I add phantom-prone deps deep in the workspace.
