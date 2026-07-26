# Design: New-PC Bootstrap + v1.0.0 Release

Date: 2026-07-07
Repo: `axazolai-create/claude-config` (default branch `master`)
Status: Approved (design), pending implementation plan

## Goal

Let a fresh machine install the curated `~/.claude` config with a single remote command,
without manually downloading the ZIP/clone first. A thin bootstrap fetches the package as a
tarball and runs the existing idempotent `setup.mjs`. Then cut the first git release, `v1.0.0`.

## Non-goals

- No auto-installation of Node (hard prerequisite; Claude Code environments already have it).
- No `git` dependency on the target PC (tarball path chosen).
- No GitHub Release page automation (`gh` not installed) — a pushed annotated tag is the
  deliverable; GitHub auto-serves the tag tarball. Release page is optional/manual later.

## Decisions (locked)

- Fetch mechanism: **tarball, no git**.
- Default ref: **master HEAD**. Pinning to a tag is an opt-in override.
- First tag: **v1.0.0**.
- Cross-platform is mandatory (project principle): ship both `bootstrap.sh` and `bootstrap.ps1`.

## A. Bootstrap architecture

Two thin scripts at repo root, fetched raw from `master`, each downloading package contents
as a tarball and invoking `setup.mjs`.

Invocation:

```
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.ps1 | iex
```

Only the tiny bootstrap is fetched up front (executed on the fly by `| bash` / `| iex`); the
full package is pulled as an archive by the bootstrap itself.

## B. Bootstrap behavior (identical logic, per-OS syntax)

1. **Preflight**: require `node` (hard fail with a clear message + install hint if missing);
   require `tar`; use `curl` (POSIX) / `Invoke-WebRequest` (Windows) as downloader. All present
   on Win10 1803+ / macOS / Linux out of the box.
2. **Ref resolution**: default `master`. Override to pin on a release tag:
   - POSIX: `curl -fsSL .../bootstrap.sh | bash -s -- --ref v1.0.0` (also honor `REF` env).
   - Windows: `$env:CLAUDE_CONFIG_REF='v1.0.0'; irm .../bootstrap.ps1 | iex`.
3. **Download** one URL that accepts branch, tag, or SHA:
   `https://github.com/axazolai-create/claude-config/archive/<ref>.tar.gz`
   (302 → codeload; follow redirects: curl `-L`, IWR follows by default).
4. **Extract** into a temp dir with `tar -xzf <archive> -C <tmp> --strip-components=1` so
   `setup.mjs` lands directly in `<tmp>` (top archive folder name is irrelevant).
5. **Run** `node <tmp>/setup.mjs`, forwarding any extra flags through
   (`... | bash -s -- --replace-all`, `--dry-run`, etc.).
6. **Cleanup** temp dir (`trap EXIT` / `try…finally`) and print "restart Claude Code".

### Notes / edge cases

- Piped stdin means `setup.mjs` sees a non-TTY: on a fresh PC there are no curated conflicts
  (clean install); on re-run its documented non-TTY default is additive merge (safe, backups/
  sidecars, nothing silently destroyed). Users wanting non-interactive replace append
  `-- --replace-all`.
- `bootstrap.sh`: `set -euo pipefail`, quoted expansions, `command -v` dep checks, `main` +
  `trap` cleanup, shellcheck-clean (per shell rule).
- `bootstrap.ps1`: `Set-StrictMode -Version Latest`, `$ErrorActionPreference='Stop'`,
  `try…finally` cleanup, no secrets inline.

## C. `setup.mjs` change

`bootstrap.sh` and `bootstrap.ps1` are installer meta and MUST NOT be copied into `~/.claude`.
Add both to the same exclusion set that already holds `setup.mjs`, `README.md`,
`settings.partial.json` (verify exact mechanism in `setup.mjs` during implementation).

## D. Release (v1.0.0)

- Annotated tag `v1.0.0` on current `master` HEAD; push to origin.
- Tag message = concise release notes distilled from recent commit history.
- GitHub auto-serves `archive/refs/tags/v1.0.0.tar.gz`; `bootstrap --ref v1.0.0` works
  immediately. Web/`gh` release page is optional and non-blocking.
- All git actions (tag, push) only after explicit user go-ahead (already given for v1.0.0).

## E. Documentation

New README section "Установка на новом ПК (bootstrap)":
- both one-liners,
- the safe alternative (download → read → run) instead of `curl|bash` / `irm|iex`,
- how to pin to a tag,
- prerequisites (Node hard; tar/curl present on modern OS).

## Risk

`curl|bash` / `irm|iex` execute remote code — standard for installers but real. Log to
`RISK_REGISTER.md` with a stable ID; document the safe alternative (fetch, inspect, then run)
and tag-pinning for reproducibility.

## Deliverables checklist

- [ ] `bootstrap.sh` (POSIX)
- [ ] `bootstrap.ps1` (Windows)
- [ ] `setup.mjs` exclusion list updated (+ both bootstrap files)
- [ ] README "Установка на новом ПК" section
- [ ] `RISK_REGISTER.md` entry (remote-exec bootstrap)
- [ ] Annotated tag `v1.0.0` pushed to origin (after go-ahead)
