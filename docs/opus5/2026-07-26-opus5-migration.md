# Fixing `claude-config` so the next install ships today's config

**Date:** 2026-07-26 · **Live config:** `D:\3__Projects\.claude_user` (= `~/.claude` via symlink)
**Bundle:** `D:\3__Projects\claude-config` (installer, **not** a git repo, files dated 2026-07-06)

The bundle is the thing you re-run to rebuild `~/.claude`. It has drifted three weeks behind the
live config, so **running `node setup.mjs` today would roll the live config backwards**. This
document is the plan to fix that, plus the Opus 5 work that must survive into it.

Read §1 for the danger, §2 for how the installer decides what to overwrite, §3 for what is
actually out of sync, §4 for the step-by-step port, §5 for verification. §6-§8 are the Opus 5
context: what changed, why, and the rules that came out of it.

---

## 1. Why you cannot just run `setup.mjs` right now

`setup.mjs` calls itself a *"Cross-platform installer for the curated ~/.claude config"* whose
whole point is that re-running it makes *"old files get the new data"*. That is correct behavior
— pointed at a **stale** bundle it means the bundle wins and three weeks of live work is gone.

Measured drift on two files alone:

| File | Bundle vs live |
|---|---|
| `rules/gsd.md` → live `rules-src/gsd.md` | **264** differing lines — whole sections missing from the bundle |
| `hooks/gsd-config-patch.mjs` | **258** differing lines — tier-2/tier-3 logic absent from the bundle |

And `.mjs` files are refreshed **without a prompt and without a backup** (§2), so that second one
would revert silently.

**Rule until §4 is done:** the only safe invocation is `node setup.mjs --dry-run`.

---

## 2. How the installer decides (`setup.mjs`, 408 lines)

**Paths are mirrored, not mapped.** `walkBundle()` yields a path relative to the bundle root and
`placeFile()` writes to `join(CDIR, ...parts)` — same relative path under `~/.claude`. There is
no rename table. This is why the bundle's `rules/` directory is a problem: the live directory is
`rules-src/`, so installing today would create a **second, dead `~/.claude/rules/`** next to the
real one, and the live rules would never be updated. Confirm with `--dry-run` before trusting it.

**Per-file conflict policy:**

| File kind | Behavior on an existing live file |
|---|---|
| `*.mjs` (managed code) | **Always overwritten, no prompt, no backup** |
| Non-`.mjs` content **without** `CURATED:NOEDIT` | **Always overwritten, no prompt** ("managed content, same as scripts") |
| Content **with** `<!-- CURATED:NOEDIT -->` | Prompt: keep / replace (writes `<name>.<timestamp>.bak`) / merge |
| `*.json` | Conflict-checked, additive merge (your values kept, missing keys added) |
| `settings.json` | Computed from `settings.partial.json`, additive, conflict-checked |

**Skipped at the bundle root** (`META`): `setup.mjs`, `README.md`, `settings.partial.json`,
`RISK_REGISTER.snippet.md`, `settings.json`. Note `README.md` is skipped *at the root only*;
nested ones (e.g. `rules/README.md`) are copied normally.

**Flags:** `--dry-run`, `--doctor` (validates that hook paths registered in `settings.json`
exist and parse), and the non-interactive bulk modes `--merge-all` / `--replace-all` /
`--skip-all`, plus `--md` / `--no-color`. In a non-TTY without a bulk flag, curated/JSON
conflicts default to **merge**.

---

## 3. What is actually out of sync

Counts are files. "Yours" vs "GSD-owned" is decided by membership in
`~/.claude/gsd-file-manifest.json` (GSD 1.8.0) — **GSD-owned files must never enter the bundle**,
they are installed by gsd-core and a stale bundled copy would fight it.

| Bundle dir → live dir | identical | differs | only in bundle | missing (yours) | missing (GSD-owned) |
|---|---|---|---|---|---|
| `bin/` → `bin/` | 0 | 2 | 0 | **23** | 0 |
| `commands/` → `commands/` | 0 | 1 | 0 | **4** | 0 |
| `hooks/` → `hooks/` | 2 | 5 | 0 | **30** | 27 |
| `rules/` → `rules-src/` | 24 | 6 | 0 | **6** | 0 |
| `setting-templates/` | 0 | 1 | **8** | **30** | 0 |
| `skills/` → `skills/` | 11 | 6 | **2** | **10** | 71 |

Root files: `add-risk.mjs`, `README.md`, `RISK_REGISTER.snippet.md`, `settings.partial.json`
identical; `CLAUDE.md` and `setup.mjs` differ; `graphify-sync-all.ps1` exists only in the bundle
(the live config moved to `graphify-sync-all.mjs`); `gsd-defaults.partial.json` is missing from
the bundle entirely.

**Specifics worth knowing before you copy:**

- `setting-templates/` was restructured from flat to nested-by-direction. The bundle's 8 flat
  files (`django.json`, `fastapi.json`, `flask.json`, `kotlin.json`, `nest.json`, `next.json`,
  `react.json`, `sql.json`) are the **old** layout and must be deleted, not merged, or the
  installer will resurrect them alongside `backend/python/django.json` etc.
- `skills/gepeto/` and `skills/pinokio/` exist only in the bundle. They are not installed live —
  decide whether they are retired (delete) or intentionally optional (keep, and note why).
- The 6 differing `rules/` files are `gsd.md`, `node.next.md`, `python.fastapi.md`,
  `python.flask.md`, `README.md`, `sql.md`.
- The 5 differing hooks are `deny-curated-claude-md.mjs`, `graphify-global-sync.mjs`,
  `gsd-config-patch.mjs`, `lib/graphify-global-sync-run.mjs`, `session-init.mjs`.

---

## 4. The port

Direction is **live → bundle** for everything below: the live config is the source of truth, the
bundle is three weeks behind. Do not hand-merge; copy the live file over the bundle file.

### 4.1 Rename the rules directory

`claude-config/rules/` → `claude-config/rules-src/`. Without this the installer writes to a dead
`~/.claude/rules/`. Verify with `--dry-run` that the destination reads `rules-src`.

### 4.2 Copy the drifted files (live → bundle)

- `rules-src/`: the 6 differing files + the 6 missing ones (`csharp.aspnet.md`, `csharp.base.md`,
  `csharp.cli.md`, `csharp.wpf.md`, `node.telegram.md`, `python.telegram.md`).
- `hooks/`: the 5 differing + **30 missing yours** — including `lib/gsd-agent-patches.mjs`,
  `lib/leanmode-*.{mjs,md}`, `lib/stack-rules-check.mjs`, `lib/token-usage-*.mjs`,
  `token-usage-log.mjs`, `task-lifecycle-probe.mjs`, `worktree-executor-discipline-advisor.mjs`,
  `bg-supervision-nudge.mjs`, `ci-watch-nudge.mjs`, `context-mode-cache-heal.mjs`,
  `gsd-context-meter.mjs`, `leanmode-subagent.mjs`, `pnpm-phantom-fix-hook.mjs`, plus their
  `.test.mjs` siblings.
- `bin/`: 2 differing + 23 missing (graphify helpers, `lib/*` libraries and their tests,
  pnpm-phantom tooling, `supervise-bg.mjs`, `turbopack-gvs-check.mjs`).
- `commands/`: `init-stack.md` (differs) + `init-mcp.md`, `init-session.md`, `leanmode.md`,
  `pnpm-phantom-fix.md`.
- `setting-templates/`: delete the 8 flat files, copy the 30-file nested tree + `README.md`.
- `skills/`: the 6 differing `update-changelog/*` files + the 10 missing yours —
  `model-selection-policy/`, `verification-before-completion/` (§6.4), `stack-markers/`,
  `token-usage/`, and the 5 missing `update-changelog/scripts/*`.
- Root: `CLAUDE.md` (see §7.1 — apply the Model Selection Policy edit **before** copying, so the
  bundle ships the corrected text), `gsd-defaults.partial.json` (new to the bundle), and replace
  `graphify-sync-all.ps1` with the live `graphify-sync-all.mjs`.
- `setup.mjs` differs too — the live copy at `~/.claude/setup.mjs` is the newer one. Diff them
  deliberately rather than blind-copying; this is the installer itself.

### 4.3 Never put these in the bundle

- **Anything in `gsd-file-manifest.json`** — 27 hooks (`gsd-prompt-guard.js`, `gsd-read-guard.js`,
  `gsd-workflow-guard.js`, the `gsd-cursor-*` / `gsd-windsurf-*` adapters, …) and 71 `skills/gsd-*`.
  Also the whole `agents/` directory: every `gsd-*.md` agent is GSD-owned.
- **Secrets and machine state:** `.credentials.json`, `mcp-needs-auth-cache.json`,
  `state/`, `sessions/`, `projects/`, `history.jsonl`, `stats-cache.json`, `usage-data/`,
  `logs/`, `shell-snapshots/`, `paste-cache/`, `security/`, `jobs/`, `tasks/`, `session-env/`.
- **Installed-by-others trees:** `plugins/`, `gsd-core/`, `cache/`, `backups/`,
  `gsd-migration-journal/`, `gsd-user-files-backup/`, `file-history/`, `ide/`, `daemon/`,
  `context-mode/`, `downloads/`.
- `references/`, `scripts/`, `docs/` (this file) are yours and unshipped today — decide
  per-directory whether the bundle should carry them; there is no automatic reason either way.

### 4.4 Two structural fixes while you are in there

- **`docs/gsd-config-defaults.md` does not exist.** The header of `hooks/gsd-config-patch.mjs`
  says the per-key decision log lives there and must be updated whenever overrides change.
  Either create it (seed it from §6.3) or correct the header. Today's rationale was written as a
  code comment instead.
- **The bundle has no version marker or manifest of its own.** Nothing records which live
  snapshot it was cut from, which is how a three-week drift went unnoticed. A one-line
  `BUNDLE-SOURCE.txt` with a date, or making `claude-config` a git repo, prevents the recurrence.
  It is currently **not** version-controlled — there is no undo for a bad copy.

---

## 5. Verify before trusting it

```sh
node setup.mjs --dry-run           # confirm destinations; check rules-src, not rules
node setup.mjs --doctor            # every hook path in settings.json exists and parses
```

Read the dry-run output for: writes landing in `~/.claude/rules-src/` (not `rules/`), no writes
to `agents/`, no writes to `skills/gsd-*`, and no resurrected flat `setting-templates/*.json`.

---

## 6. The Opus 5 changes that must survive into the bundle

Context: Opus 5 shipped, the session model moved to `opus[1m]`. Anthropic's migration guidance
drove all of this — chiefly *delete verification scaffolding* and *re-tune effort, because values
from earlier models do not transfer*.

### 6.1 Effort re-tune — GSD-owned, so the bundle cannot carry it

| File | Was | Now |
|---|---|---|
| `agents/gsd-plan-checker.md:6` | `low` | `medium` |
| `agents/gsd-codebase-mapper.md:12` | `low` | `medium` |
| `skills/gsd-plan-phase/SKILL.md:5` | `max` | `xhigh` |
| `skills/gsd-execute-phase/SKILL.md:5` | `max` | `xhigh` |
| `skills/gsd-autonomous/SKILL.md:5` | `max` | `xhigh` |

All five are in `gsd-file-manifest.json`, so **`/gsd-update` overwrites them** and they must not
go into the bundle (§4.3). Content-level patches have a re-apply mechanism
(`hooks/lib/gsd-agent-patches.mjs`, review-gated, run by `/init-stack` step 10 or
`/init-session`) but it patches **file content, not YAML frontmatter** — so there is no durable
home for these. Re-apply by hand after every GSD update; also recorded in project memory
(`project_opus5_effort_tuning.md`).

Why these: pre-change distribution was **16× `low`, 14× `high`, 9× `xhigh`, 3× `max`, 0× `medium`**
— the useful middle of the ladder was unused. `gsd-codebase-mapper` ran `low` while pinned to
`opus` (most expensive tier, least capable setting); `gsd-plan-checker` is a judgment role.
`max` overthinks; `xhigh` is the recommended start for coding/agentic work.

### 6.2 Delegation-width rule → `rules-src/gsd.md` (must reach the bundle)

New `###` subsection between the depth-boundary block and the depth-3 exception. The old rule
bounds how **deep** the dispatch tree goes; this one bounds how **wide**, because Opus 5 reaches
for subagents *more* readily than Opus 4.8 — the opposite direction, so 4.8-era "delegate more"
guidance is now harmful. Rules: delegate only when the payoff clears the context-rebuild
overhead; **never** delegate review or verification; don't split one modest job across parallel
agents; ≤20 parallel without an explicit request, and for worktree waves the existing
one-dispatch-per-turn contention rule overrides the "all in one message" form; brief precisely
once and don't redo a subagent's work.

### 6.3 Model overrides → `gsd-defaults.partial.json` + `hooks/gsd-config-patch.mjs` (must reach the bundle)

| Role | Was | Now | Why |
|---|---|---|---|
| pattern-mapper, integration-checker, nyquist-auditor, ui-checker, ui-auditor | `haiku` | `sonnet` | They read the codebase or produce scored verdicts; on Haiku 4.5 they had a 200K window and **no `effort` parameter at all** |
| gsd-verifier | `sonnet` | `opus` | Final goal-backward gate, once per phase; also contradicted `models.verification: "opus"` |
| doc-verifier, research-synthesizer | `haiku` | `haiku` | Genuinely mechanical: claim→grep→PASS/FAIL, and merging already-written text |

Valid values are the aliases `opus | sonnet | haiku | fable` (`bin/lib/model-resolver.cjs:156`;
unknown values warn on stderr at line 183). Full model IDs are accepted too
(`references/model-profiles.md:56`) — **prefer aliases**, they don't go stale. Under
`model_profile: "adaptive"`, opus-tier agents resolve to `"inherit"`, i.e. the parent session's
model (`references/model-profile-resolution.md:27`) — with the session on `opus[1m]` every
`"opus"` role is Opus 5 automatically.

⚠️ **Editing the defaults does not reach existing projects.** `gsd-config-patch.mjs` tier 1 fires
**once per project**, tracked by `gsdModelConfigPatched` in `state/project-init.json`. pik.mes was
stamped 2026-07-22, so its `.planning/config.json` was edited by hand (it is git-tracked). New
projects pick up the defaults automatically; existing ones never will.

### 6.4 `verification-before-completion` shadow (must reach the bundle)

New user-scope no-op at `skills/verification-before-completion/SKILL.md`, same mechanism as the
`using-git-worktrees` shadow already in the bundle (user scope wins over plugin cache).

Opus 5 verifies its own work; instructions telling it to verify cause over-verification with no
capability gain, and the guidance is to **delete** them, not reword them. It does **not** touch
structural verification owned by other agents or CI — `/gsd-verify-work`, `gsd-verifier`,
`gsd-plan-checker`, `gsd-nyquist-auditor`, CI gates all keep running. Honest reporting of
outcomes is unaffected; that comes from the harness system prompt, not this skill.

### 6.5 `skills/model-selection-policy/SKILL.md` rewritten (must reach the bundle)

Dropped the sonnet-5-vs-opus-4-8 framing and the `sonnet@ExtraHigh ≈ opus@medium-high` rule —
calibrated on OSWorld-Verified/BrowseComp for 4.8, it does not describe Opus 5. The inversion to
remember: **the cost lever is now `effort`, not tier** — start on Opus 5 and step effort down,
rather than starting on Sonnet and escalating the model.

Model facts the config now depends on:

| Model | ID | $/1M in | $/1M out | Context | Notes |
|---|---|---|---|---|---|
| Opus 5 | `claude-opus-5` | $5 | $25 | 1M | Thinking **on by default**; prompt-cache minimum drops to 512 tokens |
| Sonnet 5 | `claude-sonnet-5` | $3 (intro $2 → 2026-08-31) | $15 (intro $10) | 1M | Full effort ladder |
| Haiku 4.5 | `claude-haiku-4-5` | $1 | $5 | 200K | **No `effort` parameter** |
| Fable 5 | `claude-fable-5` | $10 | $50 | 1M | Only on explicit request |

The sonnet↔haiku gap is **2× today, 3× after 2026-08-31** — revisit §6.3 then.

### 6.6 What was *not* found

There are **no** `max_tokens`, `MAX_THINKING_TOKENS`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`,
`alwaysThinkingEnabled` or `"thinking":` settings anywhere in `~/.claude` — swept across every
`.md/.mjs/.js/.json/.cjs/.sh/.ps1` outside `plugins/`, `cache/`, `gsd-core/`. `settings.json`
carries only `env: {CLAUDE_CONFIG_UPDATE_CHECK, GRAPHIFY_NEO4J}` and `"model": "opus[1m]"`.
Usefully, that means nothing here can trip Opus 5's new 400 on
`thinking: {type:"disabled"}` + `effort: xhigh|max`.

Only one genuine self-check instruction existed in the whole config
(`agents/gsd-user-profiler.md:129`, "Verify before returning:") — GSD-owned, left alone. Other
matches were the opposite of scaffolding (executor rules *limiting* test re-runs) or
human-in-the-loop gates in `gsd-debugger.md`.

---

## 7. Open items

### 7.1 `~/.claude/CLAUDE.md` lines 94-97 — must be pasted by hand

The file carries `<!-- CURATED:NOEDIT -->` and the PreToolUse hook `deny-curated-claude-md.mjs`
blocks Write/Edit on it, by design. Apply this, then copy the file into the bundle (§4.2):

```markdown
# Model Selection Policy
- DEFAULT executor: claude-opus-5. Step DOWN to claude-sonnet-5 for mechanical, high-volume,
  or latency-bound work; claude-haiku-4-5 for no-judgment classification/extraction.
  claude-fable-5 only when the user names it (2x Opus 5 cost).
- Tune cost with `effort`, not by dropping tier — `low`/`medium` on Opus 5 are strong.
  Start `xhigh` for coding/agentic work, `high` otherwise, then sweep down. `max` is a
  reserve, not a default; `effort` is inert on claude-haiku-4-5 (no such parameter).
- Opus 5 thinks by default and verifies its own work: do not add "verify"/"double-check"
  scaffolding, and revisit any `max_tokens` that was sized for a no-thinking budget.
- Full routing, the effort ladder, and the per-role GSD effort map → the
  `model-selection-policy` skill.
```

Optional extra bullet, if the reminder belongs in every session's context rather than only in
project memory:

```markdown
- GSD-owned `effort:` frontmatter (`agents/gsd-*.md`, `skills/gsd-*/SKILL.md`) is overwritten
  by `/gsd-update` — re-apply the tuned values from the skill's per-role map afterwards.
```

### 7.2 Rebuild pik.mes's stack-rules snapshot

`rules-src/gsd.md` changed today; `pik.mes/.claude/stack-rules.md` is dated **Jul 21**. Per
`rules-src/README.md:9-14`, `session-init.mjs` only checks that the snapshot *exists* — the
`sourceHash`/`stackFingerprint` comparison was removed 2026-07-13, so stale snapshots are never
detected. Run `/init-stack` (or ask for an explicit rebuild) in every project that should pick up
§6.2 — until then pik.mes reads rules without the delegation-width block.

---

## 8. Standing rules that came out of this

1. **Never add "verify" / "double-check" / "re-verify" instructions** to a prompt or agent role.
   Structural review owned by a *different* agent or by CI is fine — the line is self-check vs.
   separate reviewer.
2. **Cap delegation; never encourage it.** Verification is never a reason to spawn a subagent.
3. **Re-tune `effort` per role and actually use `medium`.** At `xhigh`/`max` keep
   `max_tokens` ≥ 64K — thinking and answer share that budget.
4. **Prefer tier aliases over full model IDs** in `model_overrides`.
5. **When a task mentions a Claude model, model IDs, pricing, thinking, or effort — load the
   `claude-api` skill before touching files.** This session did the opposite: it spent four tool
   passes grepping `~/.claude` for `max_tokens`/`thinking` strings that never existed (§6.6),
   because the request named those terms and the migration guide was only consulted after the
   user supplied the missing "we're on Opus 5 now" context. Reading the authoritative source
   first would also have made the clarifying question sharper — "delete verification scaffolding"
   is an explicit, named Opus 5 recommendation, not something to infer from filesystem evidence.
6. **Treat `~/.claude` as unversioned.** It is not a git repo, and neither is `claude-config`.
   Copy a file aside before a risky edit; `backups/` and `gsd-user-files-backup/` are the only
   safety net that exists.

---

## 9. Rollback for this session's changes

| Change | Undo |
|---|---|
| §6.1 effort values | Restore `low`, `low`, `max`, `max`, `max` in the five files |
| §6.2 delegation block | Delete the `### Delegation width` subsection from `rules-src/gsd.md`, then `/init-stack` |
| §6.3 model overrides | Revert the 6 keys in all three files; pik.mes's copy is git-tracked (`git checkout .planning/config.json`) |
| §6.4 shadow skill | Delete `~/.claude/skills/verification-before-completion/` — the plugin skill takes over again |
| §6.5 policy skill | No backup (`~/.claude` is unversioned); prior content is quoted in §6.5 |
