# Final-review fix report — csharp-stack-support branch

Commit: `cdd04a2` — "fix: cover C# in stack-rules-check markers, PRUNE, and WPF frontmatter paths"

## Finding 1 (Important) — stack-rules-check.mjs detectMarkers blind to C#

**File:** `payload/hooks/lib/stack-rules-check.mjs`

Added a `"csharp"` entry to `ROOT_PATTERNS`, placed after `"go"` (before `"turbo"`), matching
the existing array's tuple style exactly:

```js
["csharp", /\.(csproj|sln|xaml)$/],
```

This is a single desync-signal tag covering all C# root-level file types (`.csproj`, `.sln`,
`.xaml`), consistent with how `"swift"` covers multiple signal types (`Package.swift`,
`.xcodeproj`, `.xcworkspace`) in one entry. No flavor distinction (aspnet/wpf/cli) added here —
that stays `init-stack.py`'s job; this file only needs a project-changed-to/from-C# signal for
`computeStackFingerprint`.

Verified behavior directly (scratch ESM script, not committed) — `detectMarkers()` on a temp dir
containing only `MyApp.csproj` returns `["csharp"]`.

## Finding 2 (Minor) — PRUNE missing C# build-output dirs

**File:** `payload/bin/init-stack.py`

```python
PRUNE = {".git", "node_modules", ".venv", "venv", "dist", "build",
         "__pycache__", ".next", "target", ".gradle", ".idea", "obj", "bin"}
```

Added `"obj"` and `"bin"` to the existing flat set literal, same style as the other entries.

## Finding 3 (Minor) — csharp.wpf.md frontmatter missing WinForms path

**File:** `payload/rules-src/csharp.wpf.md`

```yaml
paths:
  - "**/*.xaml"
  - "**/*.xaml.cs"
  - "**/*.Designer.cs"
---
```

Added `**/*.Designer.cs` to reflect the WinForms half of the file's body coverage. YAML list
formatting matches `csharp.base.md`, `csharp.aspnet.md`, `csharp.cli.md` (checked all three
before editing).

## Test results

```
python payload/bin/test_init_stack.py -v
```
Result: **25 tests, all OK** (includes `DetectCSharpTests` and `RealTemplatesTests` covering the
C# stack IDs added by this branch — no regression from the `PRUNE` change).

## detectMarkers test coverage

Searched for any test file referencing `stack-rules-check` (grep across the repo for the module
name in filenames/imports). Only non-test references exist: `payload/rules-src/README.md`,
root `README.md`/`README.en.md`, `payload/hooks/session-init.mjs` (consumer),
`payload/commands/init-stack.md` (docs), and the module itself. **No test file exists for
`stack-rules-check.mjs`/`detectMarkers()` at all.** Per the task's instruction, did not create
one from scratch (out of scope for this fix). Instead ran an ad-hoc sanity check (scratch script
in the scratchpad dir, not committed) confirming `detectMarkers()` returns `["csharp"]` for a
dir containing a root-level `.csproj` file — matches the finding's expected behavior.

## Self-review

- All 3 fixes applied exactly as specified, each a single-line/minimal addition.
- Style consistency checked against existing entries in each file before editing.
- No unrelated changes; `git diff` limited to the 3 intended lines across 3 files.
- Commit is a single commit covering all 3 findings, as requested.

## Concerns

None. All three fixes are small, isolated, and verified (automated test suite green for
init-stack.py; manual verification for the untested `.mjs` module).
