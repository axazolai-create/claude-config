# Deploy impact assessment — master through phase 09

Written 2026-07-31, before the deploy carrying phase 09 and the two `rules-src/` rules added
the same day. Evidence is a `node setup.mjs --dry-run` run captured this session (output kept
in the session scratchpad, local to this machine) plus direct reads of the live config dir.
The dry run was verified safe before it was run: `write()` returns early under `--dry-run`,
every `rmSync` prune site is preceded by a `would-prune` guard, the plugin reconciler
short-circuits to "no plugin changes", and the gsd-core detector reports and stops on a
non-TTY stdin.

## What is installed now

| Fact | Value |
|---|---|
| Config dir | `C:\Users\Axa\.claude` — `CLAUDE_CONFIG_DIR` is unset, so this is the default |
| Deployed bundle | variant `base`, 153 tracked files, sha `51a65d0`, installed 2026-07-30T14:45:32Z |
| Master ahead by | 33 commits |
| Optional groups | `activeOptional: ["neo4j"]` — unchanged by this deploy |
| gsd-core | **not installed** — see the section below; the standing deploy warning is stale |
| ultrapowers plugin | enabled as `ultrapowers@ultrapowers`; `6.2.0-up.5` is published but not installed |
| Default model | `settings.json` says `opus[1m]` |

## What the deploy would change

Variant resolves to `base`, 155 files. Against the installed manifest: **149 unchanged, 3
created, 4 updated, 0 pruned.**

**Created (3)**

- `hooks/lib/autocompact.mjs`
- `hooks/lib/context-severity.mjs`
- `hooks/precompact-observe.mjs`

**Updated (4)**

- `hooks/lib/statusline-lib.mjs`
- `hooks/statusline.mjs`
- `rules-src/node.base.md`
- `rules-src/testing.md`

**Amended 2026-07-31, after the prose fixes.** Four `payload/claude-md/` fragments were
corrected the same day — `06-collaboration.md`, `06-collaboration.lite.md`, `13-graphify.md`,
`14-context-mode.md` — so the assembled `~/.claude/CLAUDE.md` no longer matches what is
installed. That file carries `CURATED:NOEDIT`, and curated text is never touched silently:
the installer prints the diff and asks, where **both the default `merge` and `skip` leave the
file byte-for-byte unchanged**. Pressing Enter therefore applies nothing. To actually land the
corrected rules, answer **`replace`** at that prompt (no backup is written — the printed diff
is the only copy of the old text), or apply the three hunks by hand. A non-interactive run
reports `kept (see diff above)` and changes nothing. This does not affect the file counts
below, which are about `payload/` content.

**`settings.json` — additive merge, one registration added.** The whole diff is a new
`PreCompact` event pointing at `hooks/precompact-observe.mjs`; existing keys are preserved
and no hook entry is removed. Under a non-TTY run the installer resolves the conflict as
`merge` by itself.

**Pruned: nothing.** No `would-prune` line appears anywhere in the dry run. The rule that
the deploy must come from `master` and never from a feature branch still holds for the
reason it was written — `setup.mjs` prunes against the previous manifest, so two branch
deploys would each prune the other's files — but on this particular run there is no prune to
get wrong.

**One prompt that is not about files.** An interactive run will offer to replace the default
model `opus[1m]`, which it reports as superseded, with `claude-opus-5`. The non-interactive
run only prints the notice. That is a change to the default model of every future session,
not part of the bundle, and it is a separate decision from the deploy itself.

**Not carried:** the working tree has three uncommitted record files (`RESUME.md`,
`ROADMAP.md`, `03-STATE.md`). They live outside `payload/`, so the deploy neither reads nor
ships them.

## The gsd-core decision is not on the table any more

`RESUME.md` carried a standing deploy warning: this machine runs `base` with gsd-core 1.8.0
installed — 71 skills, 34 agents, 24 hooks — and the next deploy would offer to move that
installation to the reversible trash. **That is no longer true, and the offer will not
appear.** Measured 2026-07-31:

- `~/.claude/gsd-core` does not exist, so `gsdCorePresent(CDIR)` is false and
  `detectForeignGsdCore` returns before printing anything. The dry run contains no gsd-core
  report at all.
- There are zero `gsd-*` entries under `~/.claude/skills`, `agents`, `commands` and `hooks`.
- `~/.claude/.cleanup-trash` does not exist, so **this installer did not remove it** — no
  trash batch was ever written. It left by some other route, and there is no seven-day
  restore window standing open for it.
- What remains is out of the installer's reach by construction: `~/.gsd/defaults.json`, and
  one `Bash(npx gsd-core *)` permission entry in `settings.json`.

Nothing here needs a decision. The consent-gated offer stays in the code for the machine
that still has gsd-core; on this one it is inert.

## Risks accepted by deploying now

- **`RISK-STATUSLINE-002`** — `~/.claude/state/autocompact.json` does not exist yet, so the
  autocompact point is still assumed rather than observed. It cannot be settled by this
  deploy: it needs one genuine automatic compaction in a session that runs the new
  `PreCompact` hook. The acceptance check is unchanged — a `models` entry whose `tokens` is
  below its `windowSize`, with no `pending` left.
- **Coloured rendering of the context segment** at the current fill level can only be
  confirmed by looking at a real status line after the restart.
- **`RISK-HOOKSTDIN-001`** is already deployed and is neither fixed nor worsened by this run.
- **Nothing binds until a restart.** Hooks load at startup, and the two `rules-src/` rules
  only reach a project through a compiled `.claude/stack-rules.md`, which means `/init-stack`
  in that project after the restart.

## Verification after deploying

1. Restart Claude Code.
2. `/hooks` — expect `PreToolUse` x7, `PostToolUse` x3, `Stop` x1, `SubagentStop` x1,
   `PreCompact` x1, `SessionStart` x1, `SubagentStart` x1. The `PreCompact` entry is the new
   one.
3. Status line shows context as both a token count and a percentage, coloured by severity.
4. `~/.claude/rules-src/node.base.md` and `testing.md` carry the two new rules.
5. After the first genuine automatic compaction, check `~/.claude/state/autocompact.json`
   against the `RISK-STATUSLINE-002` acceptance check above.

## Observation filed against `RISK-TESTUNIT-001`

The register's entry says the risk is that "run the full suite" means something smaller in a
worktree, because `.gitignore` excludes `.test/`. There is a second, sharper cause on
`master` itself: `.test/` starts with a dot, and `node --test` does not descend into hidden
directories. So the suite run from the repo root reports **556 passing** and never mentions
that 23 tests were not collected. Running the files explicitly —
`node --test .test/unit/*.test.mjs` — gives 23/23, and 556 + 23 = 579, the number the records
carry.

Worse, `node --test .test/unit/` (the directory, not the files) reports `pass 0, fail 1` with
no test having run: a false failure that looks like a broken suite. Both suites are green as
of 2026-07-31; only the invocation is a trap.
