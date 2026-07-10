---
description: Set or view the leanmode project dial (off/lite/full/ultra) — how aggressively subagents get nudged toward minimal code
argument-hint: "[--off|--lite|--full|--ultra]"
allowed-tools: Read, Write, Edit, Bash(node *), AskUserQuestion
---

Set the leanmode project dial for THIS project (`.claude/leanmode.json` → `dial`). Never write
anything without either an explicit flag in `$ARGUMENTS` or my confirmed choice from the
interactive menu below.

## 1. Determine the flag
Check `$ARGUMENTS` for `--off`, `--lite`, `--full`, or `--ultra`.

## 2. If no flag: interactive menu
Use `AskUserQuestion` with exactly these four options (mirrors the shift table in
`docs/superpowers/specs/2026-07-10-leanmode-design.md`):

```text
AskUserQuestion([{
  question: "Set the leanmode dial for this project:",
  header: "leanmode dial",
  options: [
    { label: "off", description: "Every agent_type -> off. leanmode fully inert for this project." },
    { label: "lite", description: "Shifts the baseline map down one step (full->lite, lite->off). off stays off." },
    { label: "full", description: "Baseline map as authored — the default once /init-stack has run for this project." },
    { label: "ultra", description: "Shifts the baseline map up one step (lite->full, full->ultra). off stays off — never nudges planning/research/review/security agents." }
  ]
}])
```

## 3. Determine project root
Walk up from the current directory to the nearest `.git`, `.planning`, `package.json`,
`pyproject.toml`, `go.mod`, or `build.gradle.kts` — same walk this repo's hooks use
(`findRoot()` in `~/.claude/hooks/lib/leanmode-rules.mjs`).

## 4. Write the config
Read `<root>/.claude/leanmode.json` if it exists (`Read`); otherwise start from `{}`. Set/merge
`dial` to the chosen value, preserving any existing `default`/`overrides` keys untouched. Write
the result back with `Write` (create `<root>/.claude/` first if it doesn't exist), pretty-printed
with a trailing newline.

## 5. Report the effective levels
Run this to show which `agent_type`s are actually active after the change (only non-`off` ones
are worth showing):

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.argv[1];
const libPath = pathToFileURL(join(homedir(), ".claude", "hooks", "lib", "leanmode-rules.mjs")).href;
const { DEFAULT_LEANMODE_MAP, resolveEffectiveLevel } = await import(libPath);
const keys = new Set(Object.keys(DEFAULT_LEANMODE_MAP));
let cfg = {};
try { cfg = JSON.parse(readFileSync(join(root, ".claude", "leanmode.json"), "utf8")); } catch {}
for (const k of Object.keys(cfg.overrides || {})) keys.add(k);
for (const k of [...keys].sort()) {
  const level = resolveEffectiveLevel(k, root);
  if (level !== "off") console.log(`${k}: ${level}`);
}
' -- "<root>"
```

(Uses a dynamic `import()` with `pathToFileURL` — not a static `import ... from "$HOME/..."` — because
`$HOME` inside a single-quoted `-e` script is never shell-expanded, and a static import specifier
can't be built from a runtime path anyway. `homedir()` resolves the real path in Node itself,
cross-platform, no shell interpolation needed.)

Present the output as a short table to me: `agent_type` → effective level. If the list is empty,
say so explicitly (e.g. dial is `off`, or every mapped agent shifted down to `off` under `lite`).
