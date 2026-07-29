---
description: Detect stack, run the interactive plugin selector in your terminal, then settings merge on apply
argument-hint: "[--apply-all]"
allowed-tools: Bash(node *), Bash(claude *), Read
---

Set up stack-specific Claude Code plugins for THIS project. Never run installs, marketplace
changes, or removals without my explicit OK. In the interactive flow (step 3) my on-screen
confirmation IS that OK - the tool installs exactly the plugins I check, nothing else.

## Content check, not just existence (applies to every step below)
Any step that touches `.claude/settings.json` or the generated rules snapshot
`.claude/stack-rules.md` treats "the file exists" as necessary, never sufficient:
- **`.claude/settings.json`**: check the specific field the step cares about (`enabledPlugins`),
  not just the file's presence. Missing -> add it (a plain additive merge, preserving every
  sibling key - never a full-file rewrite).
- **`.claude/stack-rules.md`**: check content freshness (step 2's `stack-rules-check.mjs`
  status), not mere presence - rebuild when stale, same as when missing.

## 1. Detect + classify (you run this)
Run: `node ~/.claude/bin/init-stack.mjs`
Parse the `STATUS_JSON` block (`stacks`, `plugins[]` with `state`, `present[]` already-enabled) and
show me the human report (state per plugin, and which are already enabled).
This same run also re-migrates a GSD project's `.planning/config.json` `model_overrides` to the
current model defaults (surgical, non-clobbering; silent no-op when there's no `.planning/config.json`).
Surface any `Re-migrated ...` lines it prints.

## 2. Stack-rules snapshot (build if missing or stale)
`.claude/stack-rules.md` is the compiled per-project rules snapshot (language/framework rules,
no longer auto-loaded from `~/.claude/rules-src/` - see that folder's README). `session-init.mjs`
only flags it as missing; its passive every-session sourceHash/stackFingerprint check was removed
(too eager, fired on any drift). Staleness gets caught and fixed here instead - an explicit,
review-gated invocation, not a background nag.

Check:
```bash
node ~/.claude/hooks/lib/stack-rules-check.mjs
```
Prints `{ status, sourceHash, stackFingerprint, markers, added, removed, snapshotPath }`.
`markers` is the detected stack per workspace, keyed by workspace-relative directory with `"."`
for the root; `added`/`removed` name the `{ workspace, marker }` pairs that appeared and vanished
since the snapshot was stamped. `status` is one of:
- `"ok"` - the snapshot's recorded `markers` still match the tree. Skip the rest of this step.
- `"stale"` - `added`/`removed` are non-empty. Update the snapshot.
- `"missing"` - never built. Build it.
- `"legacy"` - the snapshot predates the `markers:` line, so nothing can be compared. It is never
  reported as drift, so it will not fix itself: rebuild once, fully, and it is comparable after.

`sourceHash` decides nothing - it hashes path/size/mtime, so every `setup.mjs` deploy moves it
with no rule text changing. Stamp it, report it, never rebuild on it.

If `"stale"`, `"missing"` or `"legacy"`: dispatch a subagent (general-purpose) to (re)build it,
following `~/.claude/rules-src/README.md` § "Building stack-rules" exactly. Pass the check's
**entire JSON object** through - `markers` as well as `sourceHash`/`stackFingerprint`, plus
`added`/`removed` when `"stale"` - so the subagent can stamp the frontmatter without re-running
the check. `markers` must be stamped verbatim, as the one-line flow mapping the check printed:
a snapshot written without it reads back `"legacy"`, which at this call site is indistinguishable
from never having built it at all. Step 1's `stacks` list can seed which rules to select, but it
is flat and root-scoped - the per-workspace attribution the snapshot's `stacks:`/`markers:` maps
need comes from `markers`, not from it. On `"stale"`, name the "Updating an existing snapshot
after drift" step (its number differs per profile) and have the subagent update additively rather
than regenerate.

Then re-run the check. It must now print `"ok"`. Anything else means the snapshot was written but
not stamped in a shape the check can read - report that, do not report success.

## 3. Interactive install + activate (I run this myself, in my terminal) - the main path
This reads from stdin, so tell me to run it directly:

    node ~/.claude/bin/init-stack.mjs -i

It shows two lists - the detected stack's plugins (each marked `[installed]` or `[needs
install]`) and every OTHER known plugin (opt-in, each with a one-line description) - then a
single numbered checklist where **checked = active**. Pre-checked = what's already enabled plus
the stack's auto-enable set. Type the numbers to toggle (space/comma separated), press Enter
with no input to confirm the current selection, or `q` to cancel. On confirm it:
- runs `claude plugin install` (and `marketplace add` when needed) for every checked plugin that
  isn't installed yet;
- writes `./.claude/settings.json` enabling the checked plugins and disabling any I unchecked;
- prints exactly what installed / enabled / removed, and lists anything that failed to install.

`placeholder` / `no_template` plugins can't be installed - fill the matching template under
`~/.claude/setting-templates/` first (see `STACK_PATHS` in `bin/init-stack.mjs`, or that folder's
README, for the exact path).

After the plugin step, `-i` also lists the stack's declared **skills** (npx Agent Skills) and
offers to `npx skills add` the missing ones. Skills are opt-in (none pre-checked), have no
enable/disable, and their slugs drift - if an install fails, verify the current slug and retry.

## 4. Non-interactive fallback (if I can't use a TTY)
`-i` needs a real terminal. If I can't run it, this path does ACTIVATION ONLY (it does not
install): confirm the id list with me first, then
`node ~/.claude/bin/init-stack.mjs --enable <installed ids...> --remove <to_remove ids...>`
(or `--apply-all` to enable every declared non-placeholder plugin). For any not-installed plugin,
install it by hand first, by state (always wait for my OK):
- **available** -> `install.cmd`.
- **marketplace_missing** -> `marketplace_add.cmd` then `install.cmd`; if `marketplace_add` still
  contains `<...>`, STOP and ask me for the real source.
- **unavailable** -> `refresh`, then retry or fix the id in the template.
Re-check after each: `node ~/.claude/bin/init-stack.mjs --status <plugin-id>` until `installed`.

## 5. Design stack (only if a frontend stack was detected)
Runs after install/activate completes, whichever path was taken (step 3 interactive or step 4
fallback). If step 1 classified the project as a frontend stack (react / next / react-native /
vue / …), install the per-project design stack - Impeccable + the grafted Pro Max subset:

    node "$CLAUDE_CONFIG_DIR/bin/install-design-stack.mjs" --root .

(Falls back to `~/.claude/bin/...` when `CLAUDE_CONFIG_DIR` is unset.) It is idempotent and
fail-soft - safe to re-run; it installs only what is missing and re-verifies the hook + graft.
Skip entirely for non-frontend stacks.

## 6. Finish
After settings are written, remind me: `enabledPlugins` resolves at STARTUP - I must RESTART Claude
Code (or `/reload-plugins` if available). Do NOT claim plugins are active in the current session.

## 7. Mark completion + graphify freshness (always, no gate)
Run `node ~/.claude/hooks/lib/mark-initstack-done.mjs` (silent, idempotent). Lets leanmode's
project dial default to `full` for this project instead of staying `off` (rationale:
`docs/superpowers/specs/2026-07-10-leanmode-design.md`).

Check graphify freshness (best-effort, non-blocking): run
`node ~/.claude/bin/graphify-freshness.mjs`. If it prints an update line, tell me the upgrade
command; never upgrade automatically.
