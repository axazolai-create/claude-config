# Deploy impact assessment — master through phase 07

Written 2026-07-29, before the first deploy carrying phases 06 and 07. Evidence is
a `node setup.mjs --dry-run` run captured at `.reference/up-dryrun.txt` (gitignored,
local to this machine) plus direct reads of the live config dir.

## What is installed now

| Fact | Value |
|---|---|
| Config dir | `C:\Users\Axa\.claude` — `CLAUDE_CONFIG_DIR` is unset, so this is the default |
| Deployed bundle | variant `base`, 149 files, sha `dd147c8` ("Merge feat/versioning-changelog"), installed 2026-07-29T06:26:43Z |
| Master ahead by | 26 commits |
| gsd-core | 1.8.0, `.gsd-profile` says `full`, sourced from the npx cache copy of `@opengsd/gsd-core` |
| ultrapowers plugin | `6.2.0-up.1` (`plugins/marketplaces/ultrapowers/...`), against a published `6.2.0-up.4` |

`~/.claude` is a git repository, but **it is not a rollback path**. It holds one
commit (`186da12`, the live-DB access gate) and tracks four files; three of them
are deleted in the working tree. Any rollback has to come from the installer's own
reversible trash or from re-running a previous bundle revision, not from `git -C
~/.claude checkout`.

## What the deploy would change

Variant resolves to `base`, 152 files — three more than the installed manifest.

**Created (4)**

- `bin/lib/gsd-core-detect.mjs`
- `bin/lib/workspaces.mjs`
- `hooks/lib/statusline-lib.mjs`
- `hooks/statusline.mjs`

**Updated (5)**

- `commands/init-stack.md`
- `hooks/lib/component-registry.mjs`
- `hooks/lib/stack-rules-check.mjs`
- `rules-src/README.md`
- `skills/update-changelog/scripts/list-workspaces.mjs`

**`settings.json`** — additive merge, existing keys preserved. The one addition
that matters is the `statusLine` key, pointing at
`node "C:/Users/Axa/.claude/hooks/statusline.mjs"`. Until phase 07 this profile
had no status line at all.

**`CLAUDE.md`** — unchanged. **Prunes — none.** Nothing is removed, which is the
outcome the "deploy only from `master`" rule exists to protect: the installer
prunes against the previous manifest, and the previous manifest is a `master`
deploy.

**Plugins** — no changes. `superpowers@claude-plugins-official` stays installed
and disabled on purpose, kept as a rollback.

## The gsd-core decision, and who takes it

The detector fires: gsd-core 1.8.0 is present and is not part of this bundle.
Measured inventory, from the dry run rather than from memory:

| Category | Items | Size |
|---|---|---|
| `gsd-core/` | 1 | 6667 KB |
| skills | 71 | 161 KB |
| agents | 34 | 744 KB |
| hooks | 24 | 141 KB |
| `hooks/lib` | 1 | 2 KB |
| **total** | | **7716 KB** |

`~/.gsd/` and every project's `.planning/` are never touched.

A non-interactive run — which is what an agent-driven deploy is — **reports and
does nothing**: removal needs either the interactive prompt or an explicit
`--uninstall-gsd`. So a deploy run from this session leaves gsd-core exactly where
it is, and the decision stays open for the user to take deliberately rather than
inside an unrelated deploy.

## Risks accepted by deploying now

1. **The status line will be wrong on this repository from the moment it is
   registered.** Measured the same day: against `.ultrapowers/` it renders a stale
   SDD ledger (`2026-07-28-ultrapowers-planning-tree ✔12 →13`) for a phase that is
   complete and merged, because `gsdState` requires `.planning/config.json` and
   `sddState` intercepts first. It degrades to a wrong label, not to a broken
   prompt — every error path in the renderer yields empty output. Phase 08 owns
   the fix; deploying first is still right, because the ordering constraint below
   is the more expensive one to get wrong.
2. **The ordering constraint is now three revisions wide.** The installed plugin is
   `up.1`, the fork publishes `up.4`. The published fork tells design sessions to
   run a checker whose deployed copy answers differently, so the bundle must be
   deployed **before** the plugin is updated. Deploying now shrinks that exposure;
   updating the plugin first would widen it.
3. **`hooks/db-live-access-gate.mjs` is bundled but not installed, by design.**
   `variants.json` lists it under `profiles.base.exclude`, so this profile has
   never had it and the deploy does not add it. Any belief that the live-DB gate is
   active on this machine is false — it is a `full`-profile hook.

## Verification after deploying

- `hooks/statusline.mjs` and `hooks/lib/statusline-lib.mjs` exist in the config dir.
- `settings.json` carries a `statusLine` key and the pre-existing keys are intact.
- The bundle manifest records `installedSha` equal to `master`'s HEAD and 152 files.
- Claude Code is restarted — hooks and `statusLine` load only at startup.
