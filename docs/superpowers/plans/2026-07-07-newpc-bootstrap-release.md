# New-PC Bootstrap + v1.0.0 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the curated `~/.claude` config on a fresh PC with one remote command (no prior manual download), then cut the first git release `v1.0.0`.

**Architecture:** Two thin bootstrap scripts (`bootstrap.sh`, `bootstrap.ps1`) fetched raw from `master`; each downloads the package as a GitHub tarball, extracts to a temp dir with `--strip-components=1`, and runs the existing idempotent `setup.mjs`. `setup.mjs` is taught to treat the two bootstrap files as installer-meta (never copied into `~/.claude`). README + RISK_REGISTER updated. Release = annotated tag `v1.0.0` pushed to origin.

**Tech Stack:** POSIX sh (bash), Windows PowerShell 5.1+, Node.js (setup.mjs), git, GitHub tarball archive endpoint.

## Global Constraints

- Repo: `axazolai-create/claude-config`, default branch `master`.
- Default bootstrap ref: `master` HEAD; overridable to a tag/SHA.
- Download URL form (accepts branch, tag, or SHA): `https://github.com/axazolai-create/claude-config/archive/<ref>.tar.gz`.
- Cross-platform mandatory: both scripts ship, identical behavior.
- Hard prerequisite on target PC: `node` (fail loudly if missing). Also need `tar` + a downloader (`curl` POSIX / `Invoke-WebRequest` Windows) — all present on Win10 1803+/macOS/Linux.
- `bootstrap.sh`: `set -euo pipefail`, quoted expansions, `command -v` dep checks, `trap` cleanup, shellcheck-clean.
- `bootstrap.ps1`: `Set-StrictMode -Version Latest`, `$ErrorActionPreference='Stop'`, `try…finally` cleanup, no secrets inline, no unapproved-verb functions.
- No git actions (tag/push) until explicit user go-ahead (already granted for `v1.0.0`).
- Docs/config text in English; RISK_REGISTER stable IDs.

---

### Task 1: `bootstrap.sh` (POSIX)

**Files:**
- Create: `bootstrap.sh`

**Interfaces:**
- Produces: a script fetchable at `raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh`, invoked as `curl -fsSL <url> | bash` (optionally `| bash -s -- --ref v1.0.0 [setup flags]`). Honors `REF` env; forwards non-`--ref` args to `setup.mjs`.

- [ ] **Step 1: Write `bootstrap.sh`**

```bash
#!/usr/bin/env bash
# Bootstrap installer for the curated ~/.claude config.
# Fetches the package tarball (no git needed) and runs setup.mjs.
#   curl -fsSL https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh | bash
#   curl -fsSL .../bootstrap.sh | bash -s -- --ref v1.0.0        # pin to a release tag
#   curl -fsSL .../bootstrap.sh | bash -s -- --replace-all       # forward flags to setup.mjs
set -euo pipefail

REPO="axazolai-create/claude-config"
REF="${REF:-master}"
SETUP_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)   REF="${2:?--ref needs a value}"; shift 2 ;;
    --ref=*) REF="${1#*=}"; shift ;;
    *)       SETUP_ARGS+=("$1"); shift ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "bootstrap: required tool '$1' not found." >&2
  if [ -n "${2:-}" ]; then echo "  $2" >&2; fi
  exit 1
}
need node "Install Node.js (>=18): https://nodejs.org"
need tar
need curl

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

url="https://github.com/${REPO}/archive/${REF}.tar.gz"
echo "bootstrap: downloading ${REPO}@${REF} ..."
curl -fsSL "$url" | tar -xzf - -C "$tmp" --strip-components=1

if [ ! -f "$tmp/setup.mjs" ]; then
  echo "bootstrap: setup.mjs not found in archive (bad --ref '${REF}'?)." >&2
  exit 1
fi

echo "bootstrap: running setup.mjs ..."
node "$tmp/setup.mjs" ${SETUP_ARGS+"${SETUP_ARGS[@]}"}

echo "bootstrap: done. Restart Claude Code to load hooks & settings."
```

- [ ] **Step 2: Syntax check**

Run: `bash -n bootstrap.sh`
Expected: no output, exit 0.

- [ ] **Step 3: Lint (if available)**

Run: `command -v shellcheck >/dev/null && shellcheck bootstrap.sh || echo "shellcheck absent — skipped"`
Expected: no warnings, or the "absent" line.

- [ ] **Step 4: Commit**

```bash
git add bootstrap.sh
git commit -m "feat(bootstrap): add POSIX tarball installer for new-PC setup"
```

---

### Task 2: `bootstrap.ps1` (Windows)

**Files:**
- Create: `bootstrap.ps1`

**Interfaces:**
- Produces: a script fetchable at `raw.githubusercontent.com/.../master/bootstrap.ps1`, invoked as `irm <url> | iex`. Honors `$env:CLAUDE_CONFIG_REF` (ref) and `$env:CLAUDE_SETUP_ARGS` (space-split flags forwarded to `setup.mjs`) since `iex` cannot pass positional args.

- [ ] **Step 1: Write `bootstrap.ps1`**

```powershell
#Requires -Version 5.1
# Bootstrap installer for the curated ~/.claude config (Windows).
# Fetches the package tarball (no git needed) and runs setup.mjs.
#   irm https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.ps1 | iex
#   $env:CLAUDE_CONFIG_REF='v1.0.0'; irm .../bootstrap.ps1 | iex     # pin to a release tag
#   $env:CLAUDE_SETUP_ARGS='--replace-all'; irm .../bootstrap.ps1 | iex   # forward flags to setup.mjs
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'axazolai-create/claude-config'
$Ref  = if ($env:CLAUDE_CONFIG_REF) { $env:CLAUDE_CONFIG_REF } else { 'master' }
$SetupArgs = if ($env:CLAUDE_SETUP_ARGS) { $env:CLAUDE_SETUP_ARGS -split '\s+' } else { @() }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "bootstrap: 'node' not found. Install Node.js (>=18): https://nodejs.org"
}
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
  throw "bootstrap: 'tar' not found. Requires Windows 10 1803+ (bsdtar) or install tar."
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('claude-config-' + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $archive = Join-Path $tmp 'pkg.tar.gz'
  $url = "https://github.com/$Repo/archive/$Ref.tar.gz"
  Write-Host "bootstrap: downloading $Repo@$Ref ..."
  Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  tar -xzf $archive -C $tmp --strip-components=1
  Remove-Item $archive -Force

  $setup = Join-Path $tmp 'setup.mjs'
  if (-not (Test-Path $setup)) {
    throw "bootstrap: setup.mjs not found in archive (bad ref '$Ref'?)."
  }
  Write-Host 'bootstrap: running setup.mjs ...'
  node $setup @SetupArgs
  Write-Host 'bootstrap: done. Restart Claude Code to load hooks & settings.'
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
```

- [ ] **Step 2: Parse/syntax check**

Run (PowerShell):
```powershell
$e=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\bootstrap.ps1), [ref]$null, [ref]$e); if($e){$e; exit 1} else {'parse OK'}
```
Expected: `parse OK`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add bootstrap.ps1
git commit -m "feat(bootstrap): add Windows PowerShell tarball installer for new-PC setup"
```

---

### Task 3: Exclude bootstrap files from the `~/.claude` copy in `setup.mjs`

**Files:**
- Modify: `setup.mjs:192` (the `META` set)

**Interfaces:**
- Consumes: existing `walkBundle` root-level skip `if (rel === "" && META.has(e.name)) continue;` (setup.mjs:198).
- Produces: `bootstrap.sh` / `bootstrap.ps1` are never copied into `~/.claude`.

- [ ] **Step 1: Add both files to `META`**

Change setup.mjs:192 from:
```js
const META = new Set(["setup.mjs", "README.md", "settings.partial.json", "RISK_REGISTER.snippet.md", "settings.json"]);
```
to:
```js
const META = new Set(["setup.mjs", "README.md", "settings.partial.json", "RISK_REGISTER.snippet.md", "settings.json", "bootstrap.sh", "bootstrap.ps1"]);
```

- [ ] **Step 2: Verify bootstrap files are not staged for copy**

Run: `node setup.mjs --dry-run`
Expected: the printed summary contains NO line mentioning `bootstrap.sh` or `bootstrap.ps1` (grep-check: `node setup.mjs --dry-run | grep -i bootstrap` prints nothing).

- [ ] **Step 3: Commit**

```bash
git add setup.mjs
git commit -m "chore(setup): treat bootstrap.sh/ps1 as installer-meta (do not copy to ~/.claude)"
```

---

### Task 4: README — "Установка на новом ПК" section

**Files:**
- Modify: `README.md` (insert a new section right after the top `node setup.mjs` block, before `## Зачем это всё`)

**Interfaces:**
- Consumes: bootstrap invocation contract from Tasks 1–2.

- [ ] **Step 1: Insert the section** (immediately after the "После установки — перезапусти Claude Code." line and its following `---`)

```markdown
## Установка на новом ПК (bootstrap, без ручного скачивания)

Одна команда — сама качает пакет tarball'ом (git не нужен) и запускает `setup.mjs`.
Требуется только **Node** (и `tar`/`curl`, они есть в Win10 1803+/macOS/Linux из коробки).

```
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.ps1 | iex
```

По умолчанию тянется `master` HEAD. Закрепиться на релиз-тег:

```
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh | bash -s -- --ref v1.0.0

# Windows PowerShell
$env:CLAUDE_CONFIG_REF='v1.0.0'; irm https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.ps1 | iex
```

Проброс флагов в `setup.mjs` (напр. неинтерактивная замена): POSIX — `… | bash -s -- --replace-all`;
Windows — `$env:CLAUDE_SETUP_ARGS='--replace-all'; irm … | iex`.

**Безопасная альтернатива** `curl|bash` / `irm|iex` (сначала прочитать, потом запустить):

```
# Linux / macOS
curl -fsSLO https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh
less bootstrap.sh && bash bootstrap.sh

# Windows PowerShell
irm https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.ps1 -OutFile bootstrap.ps1
notepad bootstrap.ps1; .\bootstrap.ps1
```

После установки — **перезапусти Claude Code**.

---
```

- [ ] **Step 2: Visual check**

Run: `grep -n "Установка на новом ПК" README.md`
Expected: one match; section renders with both one-liners.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add new-PC bootstrap install section"
```

---

### Task 5: RISK_REGISTER.md — remote-exec risk entry

**Files:**
- Create or Modify: `RISK_REGISTER.md` (project root; create if absent, seed header from `RISK_REGISTER.snippet.md` style)

**Interfaces:**
- Produces: stable risk ID `RISK-BOOTSTRAP-001`.

- [ ] **Step 1: Append the entry** (create file with a header first if it does not exist)

```markdown
## RISK-BOOTSTRAP-001 — Remote code execution via `curl|bash` / `irm|iex` bootstrap

- **Status:** Open (accepted)
- **Context:** `bootstrap.sh`/`bootstrap.ps1` are executed straight from the network, and they
  download+run `setup.mjs` from a GitHub tarball. A compromised repo, MITM, or wrong ref runs
  arbitrary code on the new machine.
- **Mitigation:** HTTPS-only endpoints; pin to a signed release tag via `--ref v1.0.0` for
  reproducibility; documented safe alternative (download → inspect → run) in README; secrets
  never embedded in bootstrap scripts.
- **Residual:** Standard installer trust model — user must trust the repo owner. Accepted.
```

- [ ] **Step 2: Verify**

Run: `grep -n "RISK-BOOTSTRAP-001" RISK_REGISTER.md`
Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add RISK_REGISTER.md
git commit -m "docs(risk): log RISK-BOOTSTRAP-001 remote-exec bootstrap"
```

---

### Task 6: Release `v1.0.0` (GATED — only after explicit user go-ahead)

**Files:** none (git tag on current `master` HEAD)

**Interfaces:**
- Consumes: all prior tasks committed & pushed to `origin/master`.
- Produces: tag `v1.0.0` on origin; GitHub auto-serves `archive/refs/tags/v1.0.0.tar.gz`.

- [ ] **Step 1: Push accumulated commits**

```bash
git push origin master
```

- [ ] **Step 2: Create annotated tag** (message = concise release notes)

```bash
git tag -a v1.0.0 -m "v1.0.0 — first tagged release

- New-PC bootstrap: curl|bash / irm|iex tarball installer (bootstrap.sh, bootstrap.ps1)
- setup.mjs: manifest-based prune, JSON deep-merge, curated-file protection
- Hooks: curated-CLAUDE.md guard, secrets-gate, db-live-access-gate, graphify sync, session-init
- init-stack, per-stack setting-templates, graphify integration, GSD rules"
```

- [ ] **Step 3: Push the tag**

```bash
git push origin v1.0.0
```

- [ ] **Step 4: Verify the release tarball is live**

Run: `curl -fsSL -o /dev/null -w "%{http_code}\n" https://github.com/axazolai-create/claude-config/archive/refs/tags/v1.0.0.tar.gz`
Expected: `200`.

- [ ] **Step 5 (manual, post-push): real end-to-end smoke test** on a clean shell / VM:

```
curl -fsSL https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.sh | bash -s -- --dry-run
```
Expected: downloads, extracts, runs `setup.mjs --dry-run`, prints a plan with no errors.

---

## Self-Review

**Spec coverage:** A(bootstrap arch)→Tasks 1,2; B(behavior/edge cases)→Tasks 1,2; C(setup.mjs exclusion)→Task 3; D(release)→Task 6; E(docs)→Task 4; Risk→Task 5. All spec sections mapped.

**Placeholder scan:** No TBD/TODO; every code step shows full content; verification commands concrete. OK.

**Type/name consistency:** `REF`/`--ref`/`$env:CLAUDE_CONFIG_REF`, `SETUP_ARGS`/`$env:CLAUDE_SETUP_ARGS`, `META` set, `RISK-BOOTSTRAP-001`, tag `v1.0.0`, URL form `.../archive/<ref>.tar.gz` — consistent across tasks. OK.

**Note:** Bootstrap scripts are network installers, not unit-testable via classic TDD; each task ends in a concrete static verification (syntax/parse/lint/dry-run), with a real end-to-end smoke test gated to after push (Task 6 Step 5).
```