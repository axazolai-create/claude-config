---
description: Set or view the AI-dev-mode verbosity dial (off/lite/full/ultra) — how terse generated code is (comments/whitespace only)
argument-hint: "[--off|--lite|--full|--ultra]"
allowed-tools: Read, Write, Edit, Bash(node *), AskUserQuestion
---

Set the verbosity dial for THIS project (`.claude/verbosity.json` → `level`). Governs comment and
whitespace terseness ONLY — never minification, names, or correctness. Independent of leanmode
(which governs code structure). Never write without an explicit flag in `$ARGUMENTS` or my
confirmed menu choice.

## 1. Determine the flag
Check `$ARGUMENTS` for `--off`, `--lite`, `--full`, or `--ultra`.

## 2. If no flag: interactive menu
Use `AskUserQuestion` with exactly these options:

    AskUserQuestion([{
      question: "Set the AI-dev-mode verbosity dial for this project:",
      header: "verbosity dial",
      options: [
        { label: "off", description: "Normal commenting/whitespace. Verbosity axis inert here." },
        { label: "lite", description: "No change-log/restating comments; comment only the non-obvious why; no decorative blank lines." },
        { label: "full", description: "No comments except genuine why; drop grouping blank lines; docstrings only for public APIs." },
        { label: "ultra", description: "Zero comments, zero optional blank lines. Still NOT minification — names/structure preserved." }
      ]
    }])

## 3. Determine project root
Walk up from cwd to the nearest `.git`, `.planning`, `package.json`, `pyproject.toml`, `go.mod`,
or `build.gradle.kts` — same walk as `findRoot()` in `~/.claude/hooks/lib/leanmode-rules.mjs`.

## 4. Write the config
Read `<root>/.claude/verbosity.json` if it exists; else start from `{}`. Set `level` to the chosen
value, preserving any existing `overrides`. Write back (create `<root>/.claude/` first), pretty-
printed with a trailing newline.

## 5. Report both axes
Show the resolved verbosity level plus leanmode levels so the user sees the full picture:

```bash
node --input-type=module -e '
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.argv[1];
const lib = (f) => pathToFileURL(join(homedir(), ".claude", "hooks", "lib", f)).href;
const { resolveVerbosityLevel } = await import(lib("verbosity-rules.mjs"));
const { DEFAULT_LEANMODE_MAP, resolveEffectiveLevel } = await import(lib("leanmode-rules.mjs"));
console.log("verbosity (main + agents): " + resolveVerbosityLevel("main", root));
for (const k of Object.keys(DEFAULT_LEANMODE_MAP).sort()) {
  const l = resolveEffectiveLevel(k, root);
  if (l !== "off") console.log("leanmode " + k + ": " + l);
}
' -- "<root>"
```

(Uses a dynamic `import()` with `pathToFileURL` — not a static `import ... from "$HOME/..."` —
because `$HOME` inside a single-quoted `-e` script is never shell-expanded, and a static import
specifier can't be built from a runtime path anyway. `homedir()` resolves the real path in Node
itself, cross-platform, no shell interpolation needed.)

Present as a short table. If verbosity is `off`, say so explicitly.
